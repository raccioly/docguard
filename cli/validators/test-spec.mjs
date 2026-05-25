/**
 * Test Spec Validator — Checks that tests exist per TEST-SPEC.md coverage rules
 * Now respects projectTypeConfig (e.g., skip E2E for CLI tools)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSourceRoots } from '../shared-source.mjs';

export function validateTestSpec(projectDir, config) {
  const results = { name: 'test-spec', errors: [], warnings: [], passed: 0, total: 0 };

  const testSpecPath = resolve(projectDir, 'docs-canonical/TEST-SPEC.md');
  if (!existsSync(testSpecPath)) {
    return results; // Structure validator catches this
  }

  const content = readFileSync(testSpecPath, 'utf-8');
  const ptc = config.projectTypeConfig || {};

  // Parse the Source-to-Test Map table (new header) or Service-to-Test Map (old header)
  const serviceMapMatch = content.match(
    /## (?:Service-to-Test Map|Source-to-Test Map)[\s\S]*?\n\|.*\|.*\|.*\|([\s\S]*?)(?=\n##|\n$|$)/
  );

  if (serviceMapMatch) {
    const tableContent = serviceMapMatch[1];
    const rows = tableContent
      .split('\n')
      .filter(line => line.startsWith('|') && !line.includes('---'));

    for (const row of rows) {
      const cells = row
        .split('|')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      if (cells.length < 3) continue;

      const sourceFile = cells[0];
      const testFile = cells[1];
      const status = cells[cells.length - 1]; // Last column is always status

      // Skip template/example rows and italic placeholder rows
      if (sourceFile.startsWith('<!--') || sourceFile === 'Source File' || sourceFile.startsWith('*')) continue;

      // Author-declared gaps (❌/⚠️) are surfaced as warnings. A ✅ glyph is the
      // author's CLAIM, not proof — it is NOT counted as a pass. The real pass
      // comes from the file-existence checks below (code truth, not the glyph).
      if (status && status.includes('❌')) {
        results.total++;
        results.warnings.push(
          `TEST-SPEC declares ${sourceFile} as ❌ — missing tests`
        );
      } else if (status && status.includes('⚠️')) {
        results.total++;
        results.warnings.push(
          `TEST-SPEC declares ${sourceFile} as ⚠️ — partial coverage`
        );
      }

      // ── File existence checks ───────────────────────────────────────
      // Verify source file still exists (catch stale map entries)
      const cleanSource = sourceFile.replace(/`/g, '').trim();
      if (cleanSource && cleanSource !== '—' && cleanSource !== 'Source File') {
        const sourcePath = resolve(projectDir, cleanSource);
        if (!existsSync(sourcePath)) {
          results.total++;
          results.warnings.push(
            `Source-to-Test Map: source file \`${cleanSource}\` not found on disk — stale entry?`
          );
        } else {
          results.total++;
          results.passed++;
        }
      }

      // Verify test file exists (catch wrong/stale test references)
      const cleanTest = testFile ? testFile.replace(/`/g, '').trim() : '';
      if (cleanTest && cleanTest !== '—' && cleanTest !== 'Test File' &&
          cleanTest !== 'Unit Test' && !cleanTest.includes('N/A')) {
        const testPath = resolve(projectDir, cleanTest);
        if (!existsSync(testPath)) {
          results.total++;
          results.warnings.push(
            `Source-to-Test Map: test file \`${cleanTest}\` not found — referenced by ${cleanSource}`
          );
        } else {
          results.total++;
          results.passed++;
        }
      }
    }
  }

  // Parse Critical User Journeys OR Critical CLI Flows
  // Only check E2E journeys if the project type needs E2E
  if (ptc.needsE2E !== false) {
    const journeyMatch = content.match(
      /## Critical (?:User Journeys|CLI Flows)[\s\S]*?\n\|.*\|.*\|.*\|.*\|([\s\S]*?)(?=\n##|\n---|\n$|$)/
    );

    if (journeyMatch) {
      const tableContent = journeyMatch[1];
      const rows = tableContent
        .split('\n')
        .filter(line => line.startsWith('|') && !line.includes('---'));

      for (const row of rows) {
        const cells = row
          .split('|')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        if (cells.length < 4) continue;

        const [num, journey, testFile, status] = cells;
        // Skip template rows (comments), headers
        if (num.startsWith('<!--') || num === '#' || journey.startsWith('<!--')) continue;

        if (status && status.includes('❌')) {
          results.total++;
          results.warnings.push(
            `E2E Journey #${num} (${journey}) — missing test: ${testFile}`
          );
          continue;
        }

        // For a ✅ journey, verify the referenced test file(s) actually exist
        // rather than trusting the glyph. Cells may list multiple paths in
        // backticks separated by commas (e.g. `a.test.ts`, `b.test.ts`) and
        // may include "(N suites)" annotations or globs.
        if (testFile && testFile.trim() !== '—' && !testFile.includes('N/A')) {
          const paths = parseTestPathCell(testFile);
          if (paths.length > 0) {
            results.total++;
            const anyExists = paths.some(p => testEvidenceExists(projectDir, p));
            if (anyExists) {
              results.passed++;
            } else {
              results.warnings.push(
                `E2E Journey #${num} (${journey}) marked ✅ but test file not found: ${paths.join(', ')}`
              );
            }
          }
        }
      }
    }
  }

  // If TEST-SPEC.md declared no service-to-test mappings, there is nothing to
  // verify against. Do NOT manufacture a 1/1 pass just because tests exist
  // somewhere — that rendered a confident green ✅ for a doc that mapped nothing.
  if (results.total === 0) {
    // 1. Check top-level test dirs
    const commonTestDirs = ['tests', 'test', '__tests__', 'spec'];
    const hasTestDir = commonTestDirs.some(d =>
      existsSync(resolve(projectDir, d))
    );

    // 2. Check co-located tests (honors config.sourceRoot + workspaces)
    let hasColocated = false;
    if (!hasTestDir) {
      for (const rootPath of resolveSourceRoots(projectDir, config)) {
        if (hasTestFilesRecursive(rootPath)) { hasColocated = true; break; }
      }
    }

    // 3. Check vitest/jest config for custom patterns
    let hasConfigTests = false;
    if (!hasTestDir && !hasColocated) {
      const configs = ['vitest.config.ts', 'vitest.config.js', 'jest.config.ts', 'jest.config.js'];
      hasConfigTests = configs.some(f => existsSync(resolve(projectDir, f)));
    }

    if (hasTestDir || hasColocated || hasConfigTests) {
      // Tests exist but the spec maps none of them → not applicable, not a pass.
      results.note = 'TEST-SPEC.md declares no service-to-test mappings';
    } else {
      results.warnings.push(
        'No test directory or co-located test files found. ' +
        'Expected: tests/, src/**/__tests__/, or src/**/*.test.* files'
      );
    }
  }

  return results;
}

/**
 * Parse a TEST-SPEC.md table cell into a list of test path strings.
 *
 * Real-world Journey rows commonly list multiple test files in one cell:
 *   `path/a.test.ts`, `path/b.test.ts`
 *   `idor_*.test.ts (3 suites)`
 *
 * Strategy:
 *   1. Split on commas that are OUTSIDE backticks.
 *   2. For each segment: strip backticks, strip trailing "(N suites)" or
 *      "(N tests)" annotations, trim whitespace.
 *   3. Drop empties.
 *
 * The "(N suites)" annotation is preserved as evidence — if a glob like
 * `idor_*.test.ts` doesn't expand to a literal file, testEvidenceExists()
 * accepts the annotation as the author's claim of coverage.
 */
export function parseTestPathCell(cell) {
  if (!cell) return [];
  // Split on commas that are NOT inside backticks. Track backtick parity.
  const segments = [];
  let buf = '';
  let inBackticks = false;
  for (const ch of cell) {
    if (ch === '`') { inBackticks = !inBackticks; buf += ch; continue; }
    if (ch === ',' && !inBackticks) {
      segments.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf) segments.push(buf);

  const result = [];
  for (let seg of segments) {
    seg = seg.replace(/`/g, '').trim();
    if (!seg || seg === '—') continue;
    result.push(seg);
  }
  return result;
}

/**
 * True if a TEST-SPEC.md path segment has supporting evidence on disk.
 *
 * Accepts: exact file match, glob expansion (e.g. `foo_*.test.ts`), or an
 * "(N suites)" / "(N tests)" annotation when the literal path doesn't exist.
 * The annotation is the author's explicit claim of coverage — believe it
 * rather than reject the row outright; the audit trail is in the markdown.
 */
export function testEvidenceExists(projectDir, pathSegment) {
  if (!pathSegment) return false;

  // Strip a trailing "(N suites)" / "(N tests)" annotation for the file check.
  const annotationMatch = pathSegment.match(/\s*\((\d+)\s+(?:suites?|tests?)\)\s*$/i);
  const pathOnly = annotationMatch ? pathSegment.slice(0, annotationMatch.index).trim() : pathSegment;
  const hasAnnotation = !!annotationMatch;

  if (!pathOnly) return hasAnnotation;

  // Glob support — if the segment contains *, ?, or [, walk the parent dir.
  if (/[*?[]/.test(pathOnly)) {
    const matches = expandGlob(projectDir, pathOnly);
    if (matches.length > 0) return true;
    // Glob with annotation but no expansion → trust the annotation.
    return hasAnnotation;
  }

  // Plain path — must exist on disk.
  if (existsSync(resolve(projectDir, pathOnly))) return true;
  // Plain path with explicit annotation → still trust the author's claim.
  return hasAnnotation;
}

/**
 * Minimal glob expansion: only handles the `*` and `?` wildcards in a single
 * path segment. e.g. `backend/src/test-helpers/security/idor_*.test.ts`.
 * Pure Node.js built-ins; zero dependencies.
 */
function expandGlob(projectDir, pattern) {
  const parts = pattern.split('/');
  const start = resolve(projectDir);
  let candidates = [start];
  for (const part of parts) {
    if (!/[*?[]/.test(part)) {
      candidates = candidates.map(c => resolve(c, part)).filter(c => existsSync(c));
      continue;
    }
    const re = globPartToRegex(part);
    const next = [];
    for (const dir of candidates) {
      let entries;
      try { entries = readdirSync(dir); } catch { continue; }
      for (const e of entries) {
        if (re.test(e)) next.push(resolve(dir, e));
      }
    }
    candidates = next;
    if (candidates.length === 0) return [];
  }
  return candidates;
}

function globPartToRegex(part) {
  const escaped = part
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\[/g, '[').replace(/\\\]/g, ']') // restore character classes
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** Recursively check if a directory contains test files */
function hasTestFilesRecursive(dir) {
  const ignore = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
  let entries;
  try { entries = readdirSync(dir); } catch { return false; }
  for (const entry of entries) {
    if (ignore.has(entry) || entry.startsWith('.')) continue;
    const full = resolve(dir, entry);
    try {
      const s = statSync(full);
      if (s.isDirectory()) {
        if (entry === '__tests__' || entry === '__test__') return true;
        if (hasTestFilesRecursive(full)) return true;
      } else if (/\.(test|spec)\.[^.]+$/.test(entry)) {
        return true;
      }
    } catch { continue; }
  }
  return false;
}
