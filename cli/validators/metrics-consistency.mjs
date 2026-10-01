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
  const mdFiles = findMarkdownFiles(projectDir, config);
  // Patterns must match standalone number references, not ratio-style "8/8 checks".
  // `requireBind`: built-in DocGuard meta-counts (checks/validators) describe a
  // generic noun, so they only fire when the line is bound to "docguard" (Bug #2).
  // `subject`: human phrasing for the warning. `actualSource`: records WHAT the
  // actual count describes so the fix applier can confirm both sides are the same
  // subject before overwriting.
  const patterns = [
    { key: 'checks', regex: /(?<!\d\/)\b(\d{2,})\s+(?:automated\s+)?checks?\b/gi, label: 'checks', requireBind: true, subject: "DocGuard's own", actualSource: 'docguard.guard.checks' },
    { key: 'validators', regex: /(?<!\d\/)\b(\d{2,})\s+validators?\b/gi, label: 'validators', requireBind: true, subject: "DocGuard's shipped", actualSource: 'docguard.package.validators' },
    // "N tests" is the project's OWN suite, so the binding is test-suite
    // vocabulary on the line (isTestSuiteBound), not the word "docguard". The
    // number may carry thousands separators ("1,733 tests"); the digit
    // alternation and the lookbehind keep "1,733" from matching as "733".
    // lowerBound: drift only when the doc's number is BELOW the declared count.
    { key: 'tests', regex: /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d{2,})\s+tests?\b/gi, label: 'tests', bind: isWholeSuiteClaim, fileScope: isSuiteClaimFile, lowerBound: true, actualSource: 'docguard.project.testCases' },
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
  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // noun stems, not globs
  const collections = (config && config.collections && typeof config.collections === 'object') ? config.collections : {};
  for (const [noun, glob] of Object.entries(collections)) {
    const key = String(noun).toLowerCase();
    if (RESERVED.has(key) || typeof glob !== 'string' || !glob.trim()) continue;
    const count = countGlobFiles(projectDir, glob);
    // <= 0 covers BOTH "unresolved/empty glob" (0) and "walk incomplete" (-1,
    // e.g. permission-denied subtree). Either way: never assert a count we
    // can't stand behind — a partial count auto-"fixing" a correct doc number
    // is the tool's worst failure mode.
    if (count <= 0) continue;
    actuals[key] = count;
    const stem = escapeRegExp(String(noun).replace(/s$/i, ''));
    patterns.push({
      key,
      regex: new RegExp(`(?<!\\d\\/)\\b(\\d+)\\s+${stem}s?\\b`, 'gi'),
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
            message: `${relPath} says "${found} ${label}" but ${phrase}. ${safeToRewrite
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

  const deps = checkDependencyClaims(projectDir, mdFiles, isIgnored);
  findings.push(...deps.findings);
  passed += deps.passed;
  total += deps.total;

  return { ...resultFromFindings(findings, { passed, total }), fixes };
}

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
    if (existsSync(searchDir)) walkFiles(searchDir, add);
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
