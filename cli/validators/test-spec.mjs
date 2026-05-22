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

        // For a ✅ journey, verify the referenced test file actually exists
        // rather than trusting the glyph.
        const cleanTest = testFile ? testFile.replace(/`/g, '').trim() : '';
        if (cleanTest && cleanTest !== '—' && !cleanTest.includes('N/A')) {
          results.total++;
          if (existsSync(resolve(projectDir, cleanTest))) {
            results.passed++;
          } else {
            results.warnings.push(
              `E2E Journey #${num} (${journey}) marked ✅ but test file not found: ${cleanTest}`
            );
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
