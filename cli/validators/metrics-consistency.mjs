/**
 * Metrics Consistency Validator — Detects stale hardcoded numbers in docs.
 *
 * Scans all .md files for patterns like "N checks", "N validators", "N tests"
 * and compares against actual values from guard results and package.json.
 * Returns warnings for mismatches.
 *
 * "N tests" (MET003) is a LOWER-BOUND check. The actual is the number of test
 * cases DECLARED in the test files (shared-test-cases.mjs); the runner reports
 * at least that many, more when cases are generated in loops. A documented
 * count below the declared count is provably stale; a count at or above it
 * cannot be disproven without running the suite, so it passes. Because the
 * true number is unknowable statically, MET003 never carries a mechanical
 * fix. History: `actuals.tests` was computed from v0.8.2 on and never
 * compared to anything, so the README said "33 tests" for 92 releases while
 * the suite grew past 2,000 and every self-guard stayed green.
 *
 * MET004 compares runtime-dependency count claims ("zero runtime
 * dependencies", "Dependencies: None") with package.json. DocGuard's own
 * constitution said "None. Zero. Ever." beside one shipped dependency for six
 * months: nothing read the constitution, and nothing checked the claim.
 *
 * @implements docguard.spec-kit-artifact-coverage#FR-004
 * @implements docguard.spec-kit-artifact-coverage#FR-005
 * @implements docguard.spec-kit-artifact-coverage#FR-006
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIgnorePatterns, resolveDocDirs } from '../shared.mjs';
import { countValidatorModules } from '../shared-validator-surface.mjs';
// v0.29 consolidation: walker + glob counting live in shared-ignore.mjs (the
// single implementations) — this file previously carried private copies.
import { walkFiles, countGlobFiles } from '../shared-ignore.mjs';
import { findTestFiles, countDeclaredTestCases } from '../shared-test-cases.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { findConstitution } from '../scanners/speckit.mjs';
import { contractFields } from '../shared-result-contract.mjs';
import { LANGUAGE_NOT_SUPPORTED, unreadEntry } from '../shared-labels.mjs';
import { nonEnglishDocument } from '../shared-doc-language.mjs';
import { sample } from '../shared-project-evidence.mjs';

/**
 * Does this kind of check belong to the project? It does when the project's
 * documents state a number it can compare: a count of checks, validators or
 * tests bound to DocGuard or to the project's own suite, a count of a collection
 * the project declared (`collections`), or a runtime-dependency claim. A project
 * whose documents state none has nothing of this kind; a declared collection
 * whose glob matches no file, while a document counts it, is a layout it does not read.
 *
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}, guardResults) {
  const run = validateMetricsConsistency(projectDir, config, guardResults);
  return { applies: run.applies.applies, evidence: run.applies.evidence };
}

/**
 * Validate metrics consistency across documentation.
 * @param {string} projectDir - Project root directory
 * @param {object} config - DocGuard config
 * @param {object} [guardResults] - Results from runGuardInternal (optional)
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
// v0.29: migrated to structured findings (MET001 built-in meta-counts, MET002
// declared collections). Messages are byte-identical to the legacy strings;
// the `fixes` array is preserved for the fix applier.
export function validateMetricsConsistency(projectDir, config, guardResults) {
  const findings = [];
  const fixes = [];
  let passed = 0;
  let total = 0;

  // ── Collect actual metrics ──
  const actuals = {};

  // Guard check count is configuration-dependent, so it comes from this run.
  // Validator count is a package capability: it must not shrink when a project
  // disables a validator. Resolve this module's installed directory rather
  // than projectDir, which points at the consumer repository.
  if (guardResults && Array.isArray(guardResults)) {
    const totalChecks = guardResults.reduce((sum, r) => {
      if (r.status === 'skipped') return sum;
      return sum + (r.total || 0);
    }, 0);
    actuals.checks = totalChecks;
  }
  const shippedValidatorCount = countShippedValidators();
  if (shippedValidatorCount !== null) actuals.validators = shippedValidatorCount;

  // Test count — declared test CASES, a lower bound of what the runner reports
  // (see shared-test-cases.mjs). A project with test files but zero declared
  // cases (unrecognised framework) asserts nothing rather than "0".
  const testFiles = findTestFiles(projectDir);
  let testCases = null;
  if (testFiles.length > 0) {
    testCases = countDeclaredTestCases(testFiles);
    if (testCases.cases > 0) actuals.tests = testCases.cases;
  }

  // If no actuals to compare, skip
  if (Object.keys(actuals).length === 0) {
    return resultFromFindings([], { passed: 0, total: 0 });
  }

  // ── Scan markdown files for hardcoded numbers ──
  const isIgnored = loadIgnorePatterns(projectDir);
  // spec 104 FR-022: every count pattern reads English nouns ("checks", "validators", "runtime dependencies"),
  // so a document in another language is listed with `language-not-supported`, never read and never passed
  // silently. A changelog and an ignored file are not read in any language, so they are not listed. Without
  // `docs.language` this partition is empty and the scan is unchanged.
  const unread = [];
  const mdFiles = findMarkdownFiles(projectDir, config).filter(file => {
    const rel = relative(projectDir, file).replace(/\\/g, '/');
    const language = nonEnglishDocument(config, rel);
    if (!language || rel.toLowerCase().includes('changelog') || isIgnored(rel)) return true;
    unread.push(unreadEntry(rel, language, 'documented counts'));
    return false;
  });
  // Patterns must match standalone number references, not ratio-style "8/8 checks".
  // `requireBind`: built-in DocGuard meta-counts (checks/validators) describe a
  // generic noun, so they only fire when the line is bound to "docguard" (Bug #2).
  // `subject`: human phrasing for the warning. `actualSource`: records WHAT the
  // actual count describes so the fix applier can confirm both sides are the same
  // subject before overwriting.
  // Every count may carry thousands separators ("1,183 checks"). COUNT_START
  // keeps "1,183" from matching as "183", and an identifier or ratio
  // ("FR365", "#365", "v3.65", "8/8") from matching at all.
  const patterns = [
    { key: 'checks', regex: new RegExp(`${COUNT_START}(\\d{1,3}(?:,\\d{3})+|\\d{2,})\\s+(?:automated\\s+)?checks?\\b`, 'gi'), label: 'checks', requireBind: true, subject: "DocGuard's own", actualSource: 'docguard.guard.checks' },
    { key: 'validators', regex: new RegExp(`${COUNT_START}(\\d{1,3}(?:,\\d{3})+|\\d{2,})\\s+validators?\\b`, 'gi'), label: 'validators', requireBind: true, subject: "DocGuard's shipped", actualSource: 'docguard.package.validators' },
    // "N tests" is the project's OWN suite, so the binding is test-suite
    // vocabulary on the line (isTestSuiteBound), not the word "docguard".
    // "20 test files" counts files, not cases, so it is not this metric.
    // lowerBound: drift only when the doc's number is BELOW the declared count.
    { key: 'tests', regex: new RegExp(`${COUNT_START}(\\d{1,3}(?:,\\d{3})+|\\d{2,})\\s+tests?\\b${NOT_A_CASE_COUNT}`, 'gi'), label: 'tests', bind: isWholeSuiteClaim, fileScope: isSuiteClaimFile, lowerBound: true, actualSource: 'docguard.project.testCases' },
  ];

  // v0.29 (field report #6): project-declared collections. `config.collections`
  // maps a documentation noun (e.g. "extractors") to a glob whose matching-file
  // count is the source of truth. This catches the exact class that shipped a
  // wrong "16 extractors" past a green guard — deterministically, in `guard`, with
  // no LLM. A declared collection IS the opt-in binding (the user named this noun),
  // so unlike the built-ins it does NOT require "docguard" on the line. Fail-safe:
  // an unresolved glob (0 matches) never asserts "0", so a misconfigured pattern
  // can't manufacture a false drift. Reserved nouns keep the built-in count.
  const RESERVED = new Set(['checks', 'validators', 'tests']);
  const unresolved = []; // declared collections whose glob matched no file: counted claims about them are not compared
  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // noun stems, not globs
  const collections = (config && config.collections && typeof config.collections === 'object') ? config.collections : {};
  for (const [noun, glob] of Object.entries(collections)) {
    const key = String(noun).toLowerCase();
    if (RESERVED.has(key) || typeof glob !== 'string' || !glob.trim()) continue;
    const count = countGlobFiles(projectDir, glob);
    if (count <= 0) unresolved.push({ noun: String(noun), glob, regex: new RegExp(`${COUNT_START}(\\d{1,3}(?:,\\d{3})+|\\d+)\\s+${escapeRegExp(String(noun).replace(/s$/i, ''))}s?\\b`, 'i') });
    // <= 0 covers BOTH "unresolved/empty glob" (0) and "walk incomplete" (-1,
    // e.g. permission-denied subtree). Either way: never assert a count we
    // can't stand behind — a partial count auto-"fixing" a correct doc number
    // is the tool's worst failure mode.
    if (count <= 0) continue;
    actuals[key] = count;
    const stem = escapeRegExp(String(noun).replace(/s$/i, ''));
    patterns.push({
      key,
      regex: new RegExp(`${COUNT_START}(\\d{1,3}(?:,\\d{3})+|\\d+)\\s+${stem}s?\\b`, 'gi'),
      label: String(noun),
      requireBind: false,
      isCollection: true,
      glob,
      actualSource: `docguard.collections.${key}`,
    });
  }

  // v0.14.1-N1: dedup by (file, label, found) — a file that mentions the
  // stale number multiple times produces ONE warning, not one per occurrence.
  // The replace-count applier already uses replace-all semantics, so a single
  // fix per (file, label) is sufficient. Previously: "X.md" appearing 2× with
  // the same drift would generate 2 warnings + 2 fixes (the second a no-op).
  const reportedDrift = new Set();      // key: `${relPath}|${label}|${found}`
  const reportedPass  = new Set();      // key: `${relPath}|${label}` — only count one pass per (file, label)

  for (const mdFile of mdFiles) {
    const relPath = relative(projectDir, mdFile);
    // Skip changelog (historical numbers are fine by definition)
    if (relPath.toLowerCase().includes('changelog')) continue;
    // Skip files matched by .docguardignore
    if (isIgnored(relPath)) continue;

    let content;
    try { content = readFileSync(mdFile, 'utf-8'); } catch { continue; }

    for (const { key, regex, label, requireBind, bind, fileScope, lowerBound, subject, actualSource, isCollection, glob } of patterns) {
      if (actuals[key] === undefined) continue;

      if (fileScope && !fileScope(relPath)) continue;
      regex.lastIndex = 0;
      let match;
      // Collect distinct (found-value) instances within THIS file first,
      // then emit ONE warning per distinct value. A file that says "20" on
      // line 5 and "20" on line 50 is the same drift; "20" on line 5 and
      // "19" on line 50 are two distinct drifts.
      const occurrencesByValue = new Map();
      while ((match = regex.exec(content)) !== null) {
        // Bug #2 (subject-binding): for the built-in meta-counts, only validate a
        // number BOUND to DocGuard. An unbound "N checks" (a proof harness, a CI
        // job, a third-party tool) describes a DIFFERENT subject — comparing it to
        // DocGuard's own count is a false positive, and auto-fixing it overwrites a
        // correct number. Project-declared collections (requireBind:false) skip
        // this: naming the noun in `config.collections` IS the explicit binding.
        if (requireBind && !isDocguardBound(content, match.index)) continue;
        if (bind && !bind(lineAt(content, match.index))) continue;
        const found = parseInt(match[1].replace(/,/g, ''), 10);
        const occurrences = occurrencesByValue.get(found) || { current: 0, historical: 0, text: match[1] };
        occurrences[isHistoricalMetricContext(content, match.index) ? 'historical' : 'current']++;
        occurrencesByValue.set(found, occurrences);
      }
      if (occurrencesByValue.size === 0) continue;

      for (const [found, occurrences] of occurrencesByValue) {
        // Historical transitions are evidence about an earlier release, not an
        // assertion of the current count. Rewriting them would falsify history.
        if (occurrences.current === 0) continue;
        if (lowerBound) {
          // MET003: the declared count is a floor, not the runner's number.
          // Below the floor is stale for certain; at or above it is unprovable
          // either way, so it passes. Never a mechanical fix — the tool cannot
          // know the number the doc should say (loop-generated cases).
          const driftKey = `${relPath}|${label}|${found}`;
          if (reportedDrift.has(driftKey)) continue;
          reportedDrift.add(driftKey);
          total++;
          if (found > 0 && found < actuals[key]) {
            findings.push(mkFinding({
              code: 'MET003',
              validator: 'metricsConsistency',
              severity: 'warn',
              confidence: 'high',
              parserTier: testCases ? testCases.parserTier : 'not-applicable',
              message: `${relPath} says "${occurrences.text} ${label}" but at least ${actuals[key].toLocaleString('en-US')} test cases are declared across ${testCases.files} test files (a static count; cases generated in loops are not expanded, so the suite may report more). Run the suite and update the count`,
              location: relPath,
              suggestion: {
                kind: 'review',
                text: `Run the test suite and replace the stale count (${occurrences.text}) with the number it reports`,
              },
            }));
          } else {
            passed++;
          }
          continue;
        }
        if (found > 0 && found !== actuals[key]) {
          const driftKey = `${relPath}|${label}|${found}`;
          if (reportedDrift.has(driftKey)) continue;
          reportedDrift.add(driftKey);
          total++;
          const phrase = isCollection
            ? `the code has ${actuals[key]} (${glob})`
            : `${subject} ${label} count is ${actuals[key]}`;
          const safeToRewrite = occurrences.historical === 0;
          findings.push(mkFinding({
            code: isCollection ? 'MET002' : 'MET001',
            validator: 'metricsConsistency',
            severity: 'warn',
            confidence: safeToRewrite ? 'high' : 'low',
            reportable: !safeToRewrite,
            message: `${relPath} says "${occurrences.text} ${label}" but ${phrase}. ${safeToRewrite
              ? 'Fix with `docguard fix --write`'
              : 'Review manually because the same count also appears in historical context'}`,
            location: relPath,
            suggestion: {
              kind: safeToRewrite ? 'fix' : 'review',
              text: safeToRewrite
                ? (isCollection
                  ? `Confirm which side is right, then rewrite the stale count (${found} → ${actuals[key]})`
                  : `Rewrite the stale docguard-bound count (${found} → ${actuals[key]})`)
                : `Review the current assertion without changing historical ${found} ${label} statements`,
              ...(safeToRewrite ? { command: 'docguard fix --write' } : {}),
            },
          }));
          // actualSource records WHAT the actual count describes, so the applier
          // (and a human) can confirm both sides are the same subject before any
          // overwrite. Without it the fix is refused (fail-closed). See Bug #2.
          if (safeToRewrite) {
            fixes.push({ type: 'replace-count', file: relPath, label, found, actual: actuals[key], actualSource });
          }
        } else {
          // Matches the actual count — one pass per (file, label), not per occurrence.
          const passKey = `${relPath}|${label}`;
          if (reportedPass.has(passKey)) continue;
          reportedPass.add(passKey);
          total++;
          passed++;
        }
      }
    }
  }

  // docguard.documented-quantities#FR-002 to FR-004: the Node.js minimum and command durations.
  const quantities = checkQuantityClaims(projectDir, mdFiles, isIgnored);
  findings.push(...quantities.findings);
  passed += quantities.passed;
  total += quantities.total;

  const deps = checkDependencyClaims(projectDir, mdFiles, isIgnored);
  findings.push(...deps.findings);
  passed += deps.passed;
  total += deps.total;

  const decide = () => {
    // Only an empty result pays for the second read.
    const counted = [];
    if (unresolved.length) {
      for (const mdFile of mdFiles) {
        const rel = relative(projectDir, mdFile);
        if (rel.toLowerCase().includes('changelog') || isIgnored(rel)) continue;
        let content;
        try { content = readFileSync(mdFile, 'utf-8'); } catch { continue; }
        for (const u of unresolved) if (u.regex.test(content) && !counted.includes(u)) counted.push(u);
      }
    }
    if (counted.length) return { applies: true, kind: 'unresolved', collections: counted, evidence: `a document counts ${sample(counted.map(u => u.noun))}, but the glob declared for ${counted.length === 1 ? 'it' : 'them'} matches no file` };
    if (unread.length) return { applies: true, kind: 'language', evidence: `${unread.length} document(s) not read for counts because of their language, for example ${unread[0].path}` };
    return { applies: false, kind: 'none', evidence: `${mdFiles.length} document(s) scanned, none states a count of DocGuard's checks or validators, of the project's tests, of a declared collection, or of runtime dependencies` };
  };
  return {
    ...resultFromFindings(findings, { passed, total }), fixes,
    ...(unread.length ? { unexaminedDocuments: unread } : {}),
    ...contractFields({
      performed: total,
      found: findings.length > 0,
      ran: `${total} documented count(s) compared with the code`,
      decide,
      empty: d => (d.kind === 'language'
        ? { emptyCause: LANGUAGE_NOT_SUPPORTED, note: `Metrics-Consistency read no document for counts: ${unread[0].reason}.`, howToConfigure: unread[0].howToConfigure }
        : d.applies
        ? { emptyCause: 'needs-content', note: `Metrics-Consistency read a count it could not compare: ${d.evidence}.`, howToConfigure: `The "collections" entry for ${d.collections.map(u => `${u.noun} (${u.glob})`).join(', ')} in .docguard.json matches no file, so the count a document states is not compared. Point the glob at the files you count (it is relative to the project root), or remove the entry.` }
        : { emptyCause: 'nothing-of-this-kind', note: `Metrics-Consistency found no documented count to compare: ${d.evidence}.`, howToConfigure: 'Nothing to configure unless the documents state a count: Metrics-Consistency compares "N checks" and "N validators" bound to DocGuard, "N tests" about the project\'s own suite, "N <noun>" for a noun declared under `collections` in .docguard.json (`{ "extractors": "src/extractors/*.js" }`), and runtime-dependency claims.' }),
    }),
  };
}

/**
 * Where a documented count may start: not after a word character, a digit
 * group separator, a decimal point, `#`, `-` or `/`. "FR365 tests", "FR-365",
 * "#365", "v3.65" and the "183" of "1,183" are not counts, and "8/8 checks" is
 * a ratio (docguard.consumer-report-precision#FR-001, FR-002).
 */
const COUNT_START = '(?<![\\w,.#/-])';

/**
 * "N tests" followed by one of these nouns counts something other than test
 * cases ("20 test files", "3 test suites"); "20 test cases" still counts
 * (docguard.consumer-report-precision#FR-003).
 */
const NOT_A_CASE_COUNT = '(?!\\s+(?:files?|suites?|modules?|runs?|directories|dirs?|folders?|scripts?|fixtures?|helpers?|jobs?|packages?)\\b)';

const NUMBER_WORDS = { zero: 0, no: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// Qualified wording only: "no dependencies between validators" is about
// modules, not packages, and must never be compared to package.json.
const DEP_QUALIFIED_RE = /\b(zero|no|none|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:runtime|production|npm|package|external|third-party)\s+dependenc(?:y|ies)\b/gi;
const DEP_LABEL_RE = /^\s*(?:[-*|]\s*)?\**Dependencies\**\s*[:|]\s*\**\s*(none|zero|no|\d+)\b/gim;

/** Runtime dependency count from package.json, or null when there is none to compare. */
function runtimeDependencyCount(projectDir) {
  const manifest = resolve(projectDir, 'package.json');
  if (!existsSync(manifest)) return null;
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf-8'));
    const deps = pkg && typeof pkg.dependencies === 'object' && pkg.dependencies ? pkg.dependencies : {};
    return Object.keys(deps).length;
  } catch {
    return null;
  }
}

/**
 * MET004 — a documented runtime-dependency count that package.json contradicts.
 * An escalation with no mechanical fix: the reader decides whether the prose
 * or the manifest is wrong (a dependency may have been added by mistake).
 */
/** Seconds in one unit of a written duration. */
const UNIT_SECONDS = { ms: 0.001, millisecond: 0.001, milliseconds: 0.001, s: 1, sec: 1, secs: 1, second: 1, seconds: 1, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600 };
const DURATION = /(?<![\w.$])((?:~|about |around |roughly )?(\d+(?:\.\d+)?)\s?(milliseconds?|ms|seconds?|secs?|sec|s|minutes?|mins?|min|hours?|hrs?|hr|h))(?![\w'’-])(?!\s+of\b)/i;
// npm test | npm t | npm run x | pnpm [run] x | yarn [run] x | bun run x
const SCRIPT_CALL = /(?<![\w-])(?:npm\s+(?:run(?:-script)?\s+([\w:.-]+)|(test|t)\b)|pnpm\s+(?:run\s+)?([\w:.-]+)|yarn\s+(?:run\s+)?([\w:.-]+)|bun\s+run\s+([\w:.-]+))/;
const NODE_MINIMUM = /\bNode(?:\.js)?\s*(?:(?:≥|>=)\s*v?(\d{1,2})|v?(\d{1,2})(?:\.\d+)*\s*(?:\+|or\s+(?:later|newer|higher|above)))/i;

/** The package script a command line runs, or null. */
function scriptCalled(text, scripts) {
  const m = SCRIPT_CALL.exec(text);
  if (!m) return null;
  const name = m[1] || (m[2] ? 'test' : null) || m[3] || m[4] || m[5];
  return name && Object.hasOwn(scripts, name) ? { name, text: m[0] } : null;
}

/**
 * The budget CI gives each package script, from `.github/workflows/*.yml`: the smallest of a
 * `*_BUDGET`/`*_TIMEOUT`/`*_CEILING` env var with a unit suffix on the step, job or workflow, and the
 * step's or job's `timeout-minutes`. Line-based, for the plain shapes workflows use.
 * @returns {Map<string, { seconds: number, source: string, file: string }>}
 */
function ciBudgets(projectDir, scripts) {
  const budgets = new Map();
  const dir = resolve(projectDir, '.github', 'workflows');
  let files = [];
  try { files = readdirSync(dir).filter(f => /\.ya?ml$/.test(f)); } catch { return budgets; }
  const envBudget = (key, value) => {
    const m = /(?:BUDGET|TIMEOUT|CEILING)_(MS|S|SEC|SECONDS|MIN|MINUTES)$/i.exec(key);
    const n = Number(String(value).replace(/["']/g, ''));
    if (!m || !Number.isFinite(n) || n <= 0) return null;
    const unit = m[1].toUpperCase();
    return { seconds: unit === 'MS' ? n / 1000 : unit.startsWith('MIN') ? n * 60 : n, source: `${key}: ${String(value).replace(/["']/g, '')}` };
  };
  for (const file of files) {
    let lines;
    try { lines = readFileSync(join(dir, file), 'utf8').split('\n'); } catch { continue; }
    const rel = `.github/workflows/${file}`;
    let workflowEnv = [], job = null, step = null, envTarget = null, envIndent = -1, runIndent = -1;
    const flushStep = () => {
      if (!step || !job) return;
      for (const call of step.calls) {
        const limits = [...step.env, ...job.env, ...workflowEnv, ...(step.timeout ? [step.timeout] : []), ...(job.timeout ? [job.timeout] : [])];
        if (!limits.length) continue;
        const best = limits.reduce((a, b) => (b.seconds < a.seconds ? b : a));
        const cur = budgets.get(call);
        if (!cur || best.seconds < cur.seconds) budgets.set(call, { ...best, file: rel });
      }
    };
    for (const raw of lines) {
      const line = raw.replace(/\s+#.*$/, '');
      if (!line.trim()) continue;
      const indent = raw.match(/^\s*/)[0].length;
      if (envTarget && indent > envIndent) {
        const kv = /^\s*([A-Za-z_][\w]*)\s*:\s*(.+)$/.exec(line);
        const b = kv && envBudget(kv[1], kv[2].trim());
        if (b) envTarget.push(b);
        continue;
      }
      envTarget = null;
      if (runIndent >= 0 && indent > runIndent && step) {
        const call = scriptCalled(line, scripts);
        if (call) step.calls.push(call.name);
        continue;
      }
      runIndent = -1;
      if (/^jobs:\s*$/.test(line)) { flushStep(); step = null; job = null; continue; }
      if (indent === 2 && /^\s{2}[\w-]+:\s*$/.test(line)) { flushStep(); step = null; job = { env: [], timeout: null }; continue; }
      if (/^\s*-\s/.test(line) && job) { flushStep(); step = { env: [], timeout: null, calls: [] }; }
      const body = line.replace(/^\s*-\s+/, ' '.repeat(indent + 2));
      const kv = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(body);
      if (!kv) continue;
      const [, key, value] = kv;
      if (key === 'env' && !value.trim()) {
        envTarget = indent === 0 ? workflowEnv : step && indent > 4 ? step.env : job ? job.env : workflowEnv;
        envIndent = indent;
        continue;
      }
      if (key === 'timeout-minutes' && Number(value) > 0) {
        const t = { seconds: Number(value) * 60, source: `timeout-minutes: ${Number(value)}` };
        if (step && indent > 4) step.timeout = t; else if (job) job.timeout = t;
        continue;
      }
      if (key === 'run' && step) {
        if (/^[|>]/.test(value.trim())) { runIndent = indent; continue; }
        const call = scriptCalled(value, scripts);
        if (call) step.calls.push(call.name);
      }
    }
    flushStep();
  }
  return budgets;
}

/**
 * MET005: a documented minimum Node.js version against `engines.node`. MET006 and MET007: a duration
 * documented for a package-script command against the CI budget of that command (a budget is a ceiling:
 * a longer documented time contradicts it, MET006; a budget ten times or more the documented time is only
 * evidence the number may be stale, MET007, informational). A duration counts only on a line that names
 * the command; in a shell fence, the command is the code and the duration its trailing `#` comment.
 * @implements docguard.documented-quantities#FR-002
 * @implements docguard.documented-quantities#FR-003
 * @implements docguard.documented-quantities#FR-004
 */
function checkQuantityClaims(projectDir, mdFiles, isIgnored) {
  const findings = [];
  let passed = 0, total = 0;
  let pkg = null;
  try { pkg = JSON.parse(readFileSync(resolve(projectDir, 'package.json'), 'utf8')); } catch { return { findings, passed, total }; }
  const enginesNode = typeof pkg?.engines?.node === 'string' ? pkg.engines.node : null;
  const engineMajor = enginesNode ? Number((/(\d+)/.exec(enginesNode) || [])[1]) || null : null;
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const budgets = Object.keys(scripts).length ? ciBudgets(projectDir, scripts) : new Map();
  if (!engineMajor && budgets.size === 0) return { findings, passed, total };
  for (const mdFile of mdFiles) {
    const rel = relative(projectDir, mdFile).replace(/\\/g, '/');
    if (rel.toLowerCase().includes('changelog') || /^specs\//.test(rel) || isIgnored(rel)) continue;
    let content;
    try { content = readFileSync(mdFile, 'utf8'); } catch { continue; }
    let fence = null;
    content.split('\n').forEach((line, i) => {
      const f = /^\s*```\s*([\w-]*)/.exec(line);
      if (f) { fence = fence === null ? f[1].toLowerCase() : null; return; }
      const location = `${rel}:${i + 1}`;
      if (engineMajor && fence === null) {
        const n = NODE_MINIMUM.exec(line);
        if (n) {
          total++;
          const major = Number(n[1] || n[2]);
          if (major === engineMajor) passed++;
          else findings.push(mkFinding({
            code: 'MET005', validator: 'metricsConsistency', severity: 'warn', confidence: 'high',
            message: `${location} says ${n[0].trim()}; package.json engines.node is "${enginesNode}"`,
            location,
            suggestion: { kind: 'review', text: 'Decide which minimum is right and change the other: the document or engines.node in package.json.' },
          }));
        }
      }
      if (!budgets.size) return;
      const shell = fence !== null && /^(?:bash|sh|shell|zsh|console|terminal|shell-session|bash-session)$/.test(fence);
      if (fence !== null && !shell) return;
      const hash = shell ? line.search(/\s#/) : -1;
      const code = shell ? (hash >= 0 ? line.slice(0, hash) : line) : line;
      const prose = shell ? (hash >= 0 ? line.slice(hash + 2) : '') : line;
      const call = scriptCalled(code, scripts);
      const d = call && DURATION.exec(prose);
      const budget = call && budgets.get(call.name);
      if (!d || !budget) return;
      const seconds = Number(d[2]) * UNIT_SECONDS[d[3].toLowerCase()];
      if (!(seconds > 0)) return;
      total++;
      const said = d[1].trim();
      const where = `${budget.source} (${Math.round(budget.seconds)} s) in ${budget.file}`;
      if (seconds > budget.seconds) {
        findings.push(mkFinding({
          code: 'MET006', validator: 'metricsConsistency', severity: 'warn', confidence: 'high',
          message: `${location} says \`${call.text}\` takes ${said}; CI gives it ${where}, so a run that long fails there`,
          location,
          suggestion: { kind: 'review', text: 'Time the command, then fix the document or the CI budget.' },
        }));
      } else if (budget.seconds >= 10 * seconds) {
        findings.push(mkFinding({
          code: 'MET007', validator: 'metricsConsistency', severity: 'warn', confidence: 'medium',
          message: `${location} says \`${call.text}\` takes ${said}; CI budgets it ${where}: ${Math.round(budget.seconds / seconds)}x the documented time, so the number may be stale`,
          location,
          suggestion: { kind: 'review', text: 'Time the command and update the document, or lower the CI budget if it is generous on purpose.' },
        }));
      } else passed++;
    });
  }
  return { findings, passed, total };
}

function checkDependencyClaims(projectDir, mdFiles, isIgnored) {
  const out = { findings: [], passed: 0, total: 0 };
  const actual = runtimeDependencyCount(projectDir);
  if (actual === null) return out;
  const reported = new Set();
  for (const mdFile of mdFiles) {
    const relPath = relative(projectDir, mdFile).replace(/\\/g, '/');
    if (relPath.toLowerCase().includes('changelog') || isIgnored(relPath)) continue;
    let content;
    try { content = readFileSync(mdFile, 'utf-8'); } catch { continue; }
    for (const regex of [DEP_QUALIFIED_RE, DEP_LABEL_RE]) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(content)) !== null) {
        if (isHistoricalMetricContext(content, match.index)) continue;
        // A `| Dependencies | 5 |` row is a count only when its column says so:
        // a scoring table's `Max Points` column is not (docguard.dogfood-findings#FR-003).
        if (regex === DEP_LABEL_RE && !tableRowIsCount(content, match.index)) continue;
        // "External dependencies" is software wording only in software context:
        // "2 External Dependencies" in a plan template counts workstreams.
        if (regex === DEP_QUALIFIED_RE && !externalCountIsSoftware(content, match)) continue;
        const word = match[1].toLowerCase();
        const claimed = word in NUMBER_WORDS ? NUMBER_WORDS[word] : parseInt(word, 10);
        const key = `${relPath}|${claimed}`;
        if (reported.has(key)) continue;
        reported.add(key);
        out.total++;
        if (claimed === actual) { out.passed++; continue; }
        const line = content.slice(0, match.index).split('\n').length;
        out.findings.push(mkFinding({
          code: 'MET004',
          validator: 'metricsConsistency',
          severity: 'warn',
          confidence: 'high',
          message: `${relPath}:${line} claims ${claimed} runtime ${claimed === 1 ? 'dependency' : 'dependencies'} ("${match[0].trim()}") but package.json declares ${actual}`,
          location: `${relPath}:${line}`,
          suggestion: {
            kind: 'review',
            text: `Decide which side is wrong: correct the document, or remove the dependency the claim says should not exist`,
          },
        }));
      }
    }
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SOFTWARE_CONTEXT = /\b(?:npm|pnpm|yarn|package(?:\.json|s)?|runtime|librar(?:y|ies)|install|node_modules|import|bundle|pip|crate|module)\b/i;

/**
 * "N external dependencies" is a package count only when its line says so.
 * "zero/no/none external dependencies" stays a claim: that wording is the
 * usual package boast. Other qualifiers (runtime, npm, …) are unaffected.
 *
 * @implements docguard.dogfood-findings#FR-005
 */
function externalCountIsSoftware(content, match) {
  // "no npm dependency" (singular) says a change added none, not that the
  // package has none: "a small built-in map (no npm dependency)".
  if (/^(?:zero|no|none)$/i.test(match[1]) && /dependency\b/i.test(match[0])) return false;
  if (!/\bexternal\s+dependenc/i.test(match[0])) return true;
  if (/^(?:zero|no|none)$/i.test(match[1])) return true;
  const lineStart = content.lastIndexOf('\n', match.index) + 1;
  const lineEnd = content.indexOf('\n', match.index);
  const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).replace(match[0], '');
  return SOFTWARE_CONTEXT.test(line);
}

const COUNT_HEADER = /^(?:count|value|total|number|no\.?|#|amount|qty|quantity|dependencies)$/i;

/**
 * For a match on a Markdown table row, true only when the table's header cell
 * above the value names a count. A match outside a table is a label line and
 * always counts.
 *
 * @implements docguard.dogfood-findings#FR-003
 */
function tableRowIsCount(content, index) {
  const lineStart = content.lastIndexOf('\n', index) + 1;
  const lineEnd = content.indexOf('\n', index);
  const row = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  if (!row.trimStart().startsWith('|')) return true;
  const lines = content.slice(0, lineStart).split('\n');
  lines.pop();
  let header = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trimStart().startsWith('|')) break;
    header = lines[i];
  }
  if (!header) return false;
  const cells = s => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim().replace(/[*_`]/g, ''));
  const rowCells = cells(row);
  const valueColumn = rowCells.findIndex((c, i) => i > 0 && /^(none|zero|no|\d+)$/i.test(c));
  if (valueColumn < 1) return false;
  return COUNT_HEADER.test(cells(header)[valueColumn] || '');
}

/**
 * Bug #2 — subject binding. A "N checks/validators" claim is DocGuard's to
 * govern ONLY if it's bound to DocGuard: the line containing the number must
 * reference "docguard" (case-insensitive), which also covers an explicit
 * `<!-- docguard:metric ... -->` marker on that line. Numbers describing
 * anything else (a proof harness, a CI pipeline, a competitor's tool) are out
 * of scope — validating them is a false positive and auto-fixing them corrupts
 * a correct number with DocGuard's unrelated count.
 */
function isDocguardBound(content, index) {
  return /docguard/i.test(lineAt(content, index));
}

/** The full line of `content` containing offset `index`. */
function lineAt(content, index) {
  const lineStart = content.lastIndexOf('\n', index) + 1;
  let lineEnd = content.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = content.length;
  return content.slice(lineStart, lineEnd);
}

/**
 * MET003 subject binding. "N tests" is the project's own suite only when the
 * line says so: a runner invocation (`npm test`, `pytest`, `go test`, …), the
 * words "test suite"/"suite", or a pass verb ("2,085 tests passing"). A number
 * about something else ("the study ran 400 tests", a sample-output line
 * "TEST-SPEC.md (45 tests, …)") is out of scope — comparing it to the declared
 * count would be a false positive.
 */
/**
 * A suite-bound "N tests" that is about the whole suite today: not pinned to a
 * commit ("pass on `9c55dac6`"), and not a subset ("49 frontend files (606
 * tests)", "12 unit tests").
 *
 * @implements docguard.dogfood-findings#FR-006
 */
export function isWholeSuiteClaim(line) {
  if (!isTestSuiteBound(line)) return false;
  if (/`[0-9a-f]{7,40}`|\b(?:at|on|commit)\s+[0-9a-f]{7,40}\b/i.test(line)) return false;
  return !/\b(?:frontend|backend|front-end|back-end|unit|integration|e2e|end-to-end|smoke|ui|api|component|regression|new|added|feature|spec)\s+(?:test\s+)?(?:files?\s*\(\s*)?(?:\d[\d,]*\s+)?tests?\b/i.test(line)
    && !/\b(?:frontend|backend|front-end|back-end|unit|integration|e2e|end-to-end)\b[^.]{0,40}\(\s*\d[\d,]*\s+tests?\s*\)/i.test(line);
}

/**
 * Files whose "N tests" describe something other than today's suite: Spec Kit
 * artifacts (a feature's own tests) and dated records (an audit or plan named
 * for its date).
 *
 * @implements docguard.dogfood-findings#FR-006
 */
export function isSuiteClaimFile(relPath) {
  const path = String(relPath).replace(/\\/g, '/');
  if (/(?:^|\/)specs\/[^/]+\//.test(path)) return false;
  return !/(?:^|[^\d])\d{4}-\d{2}-\d{2}(?:[^\d]|$)/.test(path.split('/').pop());
}

export function isTestSuiteBound(line) {
  return /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bnode\s+--test\b|\b(?:pytest|unittest|vitest|jest|mocha|ava|tap|cargo\s+test|go\s+test|node:test)\b|\btest\s+suite\b|\bsuite\b|\bpass(?:ed|es|ing)?\b/i.test(line);
}

/**
 * Return true when a metric occurrence describes history rather than current
 * state. The classifier deliberately recognizes only explicit historical
 * evidence: transition arrows/from-to wording, historical metadata, and
 * release-history headings. Ambiguous prose remains visible, but a count that
 * appears in both contexts is never handed to the mechanical replace-all fix.
 */
function isHistoricalMetricContext(content, index) {
  const lineStart = content.lastIndexOf('\n', index) + 1;
  let lineEnd = content.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = content.length;
  const line = content.slice(lineStart, lineEnd);

  if (/\d[\d,]*\s*(?:→|->|=>)\s*\d[\d,]*/.test(line)) return true;
  if (/\b(?:increased|grew|rose|decreased|dropped|fell|expanded|reduced|changed|moved|went|bumped|upgraded)\s+from\s+\d[\d,]*\s+to\s+\d[\d,]*/i.test(line)) return true;
  if (/\b(?:previously|formerly|historically|back then|at launch|in (?:release|version|v)\s*\d|during (?:the )?(?:release|upgrade|migration))\b/i.test(line)) return true;

  const before = content.slice(0, lineStart);
  const headings = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)];
  const heading = headings.at(-1)?.[1] || '';
  if (/\b(?:change\s*log|release (?:notes|history)|version history|migration history|what changed)\b/i.test(heading)) return true;
  // A section pinned to a version ("Results — v0.32.0", "R5 (released in
  // v0.40.0)", "v0.40.0 candidate") describes that version, not today's tree.
  if (/\bv\d+\.\d+(?:\.\d+)?\b|\breleased in\b|\bcandidate\b/i.test(heading)) return true;

  const prefix = content.slice(0, Math.min(content.length, 4096));
  return /<!--\s*docguard:status\s+(?:historical|superseded|deprecated|archived)\s*-->/i.test(prefix);
}

/**
 * Count validator modules shipped beside this file. This is deliberately
 * package-local: a consumer's disabled validators or repository layout cannot
 * alter a statement about DocGuard's own capability surface.
 */
function countShippedValidators() {
  return countValidatorModules(dirname(fileURLToPath(import.meta.url)));
}

// DocGuard's OWN installed slash-command docs (commands/docguard.*.md, and the
// .agent/commands/ variant). These are tool-managed, not the project's docs —
// scanning them flags DocGuard's own (sometimes stale) shipped "N validators"
// count as the USER's drift, which they can't meaningfully act on. (.agent/ and
// .specify/ are already dot-skipped by walkFiles; this catches the legacy ROOT
// commands/ install location. A user's own commands/<name>.md is NOT excluded.)
const DOCGUARD_OWN_DOC_RE = /[\\/](?:\.agent[\\/])?commands[\\/]docguard\.[a-z-]+\.md$/i;

function findMarkdownFiles(dir, config = {}) {
  const seen = new Set();
  const mdFiles = [];
  const add = (f) => {
    if (f.endsWith('.md') && !seen.has(f) && !DOCGUARD_OWN_DOC_RE.test(f)) {
      seen.add(f);
      mdFiles.push(f);
    }
  };

  // Root LEVEL ONLY (non-recursive): README and other top-level docs. A
  // "N validators / N checks" claim that refers to DocGuard lives in the README
  // or the canonical docs — not five levels deep under security/ or backend/.
  // The old code recursively walked the WHOLE repo from the root, so it swept in
  // OpenWolf session archives (security/wolf-archive/**/memory.md) and vendored
  // toolkit READMEs whose unrelated "N checks" prose was then reported as the
  // USER's drift (field test: downstream-project, ~39 false warnings the author
  // could not act on). Scoping to the docs DocGuard actually governs fixes it.
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try { if (statSync(full).isFile()) add(full); } catch { /* unreadable entry */ }
    }
  } catch { /* unreadable root */ }

  // Configured canonical docs (wherever they live), plus every resolved doc
  // home — scanned in full (recursive). v0.29 (field report #6, follow-up): the
  // doc-home set is no longer the hardcoded trio; resolveDocDirs auto-detects
  // conventional doc dirs (docs/, documentation/, guides/, …) or honors an
  // explicit config.docs.dirs. NAMED dirs only — code/tooling dirs (security/,
  // backend/, src/, …) and arbitrary subdirs are still NEVER walked (the
  // downstream-project false-positive flood the scoping fix removed).
  const canonical = config && config.requiredFiles && Array.isArray(config.requiredFiles.canonical)
    ? config.requiredFiles.canonical : [];
  for (const rel of canonical) {
    const full = resolve(dir, rel);
    if (existsSync(full)) { try { if (statSync(full).isFile()) add(full); } catch { /* skip */ } }
  }
  for (const sub of resolveDocDirs(dir, config)) {
    const searchDir = resolve(dir, sub);
    // A backup-named document is not a document (specs/100-file-kinds D6).
    if (existsSync(searchDir)) walkFiles(searchDir, add, { root: resolve(dir), config, skipKinds: ['backup'] });
  }
  // The Spec Kit constitution governs the project and lives in a dot
  // directory the walkers skip — read it explicitly.
  const constitution = findConstitution(dir);
  if (constitution) add(constitution.abs);

  return mdFiles;
}

// Local walker + glob→count helpers were removed in the v0.29 consolidation —
// `walkFiles` / `countGlobFiles` are imported from ../shared-ignore.mjs, the
// single canonical implementations.
