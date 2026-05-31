/**
 * Metrics Consistency Validator — Detects stale hardcoded numbers in docs.
 *
 * Scans all .md files for patterns like "N checks", "N validators", "N tests"
 * and compares against actual values from guard results and package.json.
 * Returns warnings for mismatches.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { loadIgnorePatterns, c } from '../shared.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
]);

/**
 * Validate metrics consistency across documentation.
 * @param {string} projectDir - Project root directory
 * @param {object} config - DocGuard config
 * @param {object} [guardResults] - Results from runGuardInternal (optional)
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateMetricsConsistency(projectDir, config, guardResults) {
  const warnings = [];
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
    return { errors: [], warnings, passed: 0, total: 0 };
  }

  // ── Scan markdown files for hardcoded numbers ──
  const isIgnored = loadIgnorePatterns(projectDir);
  const mdFiles = findMarkdownFiles(projectDir);
  // Patterns must match standalone number references, not ratio-style "8/8 checks"
  const patterns = [
    { key: 'checks', regex: /(?<!\d\/)\b(\d{2,})\s+(?:automated\s+)?checks?\b/gi, label: 'checks' },
    { key: 'validators', regex: /(?<!\d\/)\b(\d{2,})\s+validators?\b/gi, label: 'validators' },
  ];

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

    for (const { key, regex, label } of patterns) {
      if (actuals[key] === undefined) continue;

      regex.lastIndex = 0;
      let match;
      // Collect distinct (found-value) instances within THIS file first,
      // then emit ONE warning per distinct value. A file that says "20" on
      // line 5 and "20" on line 50 is the same drift; "20" on line 5 and
      // "19" on line 50 are two distinct drifts.
      const distinctFoundInFile = new Set();
      while ((match = regex.exec(content)) !== null) {
        distinctFoundInFile.add(parseInt(match[1], 10));
      }
      if (distinctFoundInFile.size === 0) continue;

      for (const found of distinctFoundInFile) {
        if (found > 0 && found !== actuals[key]) {
          const driftKey = `${relPath}|${label}|${found}`;
          if (reportedDrift.has(driftKey)) continue;
          reportedDrift.add(driftKey);
          total++;
          warnings.push(
            `${relPath} says "${found} ${label}" but actual count is ${actuals[key]}. Fix with \`docguard fix --write\``
          );
          fixes.push({ type: 'replace-count', file: relPath, label, found, actual: actuals[key] });
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

  return { errors: [], warnings, passed, total, fixes };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function findMarkdownFiles(dir) {
  const seen = new Set();
  const mdFiles = [];
  // Check root, docs-canonical, and extensions
  const searchDirs = [
    dir,
    resolve(dir, 'docs-canonical'),
    resolve(dir, 'extensions'),
  ];

  for (const searchDir of searchDirs) {
    if (!existsSync(searchDir)) continue;
    walkFiles(searchDir, (f) => {
      if (f.endsWith('.md') && !seen.has(f) && !DOCGUARD_OWN_DOC_RE.test(f)) {
        seen.add(f);
        mdFiles.push(f);
      }
    });
  }

  return mdFiles;
}

function walkFiles(dir, callback) {
  if (!existsSync(dir)) return;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkFiles(fullPath, callback);
      } else if (stat.isFile()) {
        callback(fullPath);
      }
    } catch (err) {
      console.error(`${c.red}Error reading file or directory: ${err.message}${c.reset}`);
    }
  }
}
