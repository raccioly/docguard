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
    { key: 'tests', regex: /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d{2,})\s+tests?\b/gi, label: 'tests', bind: isTestSuiteBound, lowerBound: true, actualSource: 'docguard.project.testCases' },
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

    for (const { key, regex, label, requireBind, bind, lowerBound, subject, actualSource, isCollection, glob } of patterns) {
      if (actuals[key] === undefined) continue;

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

  return { ...resultFromFindings(findings, { passed, total }), fixes };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

  return mdFiles;
}

// Local walker + glob→count helpers were removed in the v0.29 consolidation —
// `walkFiles` / `countGlobFiles` are imported from ../shared-ignore.mjs, the
// single canonical implementations.
