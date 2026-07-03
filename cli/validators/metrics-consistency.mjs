/**
 * Metrics Consistency Validator — Detects stale hardcoded numbers in docs.
 *
 * Scans all .md files for patterns like "N checks", "N validators", "N tests"
 * and compares against actual values from guard results and package.json.
 * Returns warnings for mismatches.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { loadIgnorePatterns, resolveDocDirs } from '../shared.mjs';
// v0.29 consolidation: walker + glob counting live in shared-ignore.mjs (the
// single implementations) — this file previously carried private copies.
import { walkFiles, countGlobFiles } from '../shared-ignore.mjs';
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

  // Guard check count (from guard results if available)
  if (guardResults && Array.isArray(guardResults)) {
    const totalChecks = guardResults.reduce((sum, r) => {
      if (r.status === 'skipped') return sum;
      return sum + (r.total || 0);
    }, 0);
    // +1 because Metrics-Consistency itself hasn't been added to results yet
    const validatorCount = guardResults.filter(r => r.status !== 'skipped').length + 1;

    actuals.checks = totalChecks;
    actuals.validators = validatorCount;
  }

  // Test count — count test files on disk
  const testFiles = findTestFiles(projectDir);
  if (testFiles.length > 0) {
    actuals.tests = testFiles.length;
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
    { key: 'validators', regex: /(?<!\d\/)\b(\d{2,})\s+validators?\b/gi, label: 'validators', requireBind: true, subject: "DocGuard's own", actualSource: 'docguard.guard.validators' },
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

    for (const { key, regex, label, requireBind, subject, actualSource, isCollection, glob } of patterns) {
      if (actuals[key] === undefined) continue;

      regex.lastIndex = 0;
      let match;
      // Collect distinct (found-value) instances within THIS file first,
      // then emit ONE warning per distinct value. A file that says "20" on
      // line 5 and "20" on line 50 is the same drift; "20" on line 5 and
      // "19" on line 50 are two distinct drifts.
      const distinctFoundInFile = new Set();
      while ((match = regex.exec(content)) !== null) {
        // Bug #2 (subject-binding): for the built-in meta-counts, only validate a
        // number BOUND to DocGuard. An unbound "N checks" (a proof harness, a CI
        // job, a third-party tool) describes a DIFFERENT subject — comparing it to
        // DocGuard's own count is a false positive, and auto-fixing it overwrites a
        // correct number. Project-declared collections (requireBind:false) skip
        // this: naming the noun in `config.collections` IS the explicit binding.
        if (requireBind && !isDocguardBound(content, match.index)) continue;
        distinctFoundInFile.add(parseInt(match[1], 10));
      }
      if (distinctFoundInFile.size === 0) continue;

      for (const found of distinctFoundInFile) {
        if (found > 0 && found !== actuals[key]) {
          const driftKey = `${relPath}|${label}|${found}`;
          if (reportedDrift.has(driftKey)) continue;
          reportedDrift.add(driftKey);
          total++;
          const phrase = isCollection
            ? `the code has ${actuals[key]} (${glob})`
            : `${subject} ${label} count is ${actuals[key]}`;
          findings.push(mkFinding({
            code: isCollection ? 'MET002' : 'MET001',
            validator: 'metricsConsistency',
            severity: 'warn',
            message: `${relPath} says "${found} ${label}" but ${phrase}. Fix with \`docguard fix --write\``,
            location: relPath,
            suggestion: {
              kind: 'fix',
              text: isCollection
                ? `Confirm which side is right, then rewrite the stale count (${found} → ${actuals[key]})`
                : `Rewrite the stale docguard-bound count (${found} → ${actuals[key]})`,
              command: 'docguard fix --write',
            },
          }));
          // actualSource records WHAT the actual count describes, so the applier
          // (and a human) can confirm both sides are the same subject before any
          // overwrite. Without it the fix is refused (fail-closed). See Bug #2.
          fixes.push({ type: 'replace-count', file: relPath, label, found, actual: actuals[key], actualSource });
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
  const lineStart = content.lastIndexOf('\n', index) + 1;
  let lineEnd = content.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = content.length;
  return /docguard/i.test(content.slice(lineStart, lineEnd));
}

function findTestFiles(dir) {
  const tests = [];
  const testDirs = ['tests', 'test', '__tests__', 'spec', 'e2e'];

  // Top-level test dirs
  for (const td of testDirs) {
    const fullDir = resolve(dir, td);
    if (existsSync(fullDir)) {
      walkFiles(fullDir, (f) => {
        if (/\.(test|spec)\.[^.]+$/.test(f)) tests.push(f);
      });
    }
  }

  // Co-located tests in src/
  const srcDir = resolve(dir, 'src');
  if (existsSync(srcDir)) {
    walkFiles(srcDir, (f) => {
      if (/\.(test|spec)\.[^.]+$/.test(f) || f.includes('__tests__')) {
        if (!tests.includes(f)) tests.push(f);
      }
    });
  }

  return tests;
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
  // USER's drift (field test: wu-whatsappinbox, ~39 false warnings the author
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
  // wu-whatsappinbox false-positive flood the scoping fix removed).
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
