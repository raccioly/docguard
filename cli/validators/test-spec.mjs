/**
 * Test Spec Validator — Checks that tests exist per TEST-SPEC.md coverage rules
 * Now respects projectTypeConfig (e.g., skip E2E for CLI tools)
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
      } else if (status && status.includes('✅')) {
        results.total++;
        results.passed++;
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
        } else if (status && status.includes('✅')) {
          results.total++;
          results.passed++;
        }
      }
    }
  }

  // If no test spec entries parsed, check if test directory exists
  if (results.total === 0) {
    results.total = 1;
    const commonTestDirs = ['tests', 'test', '__tests__', 'spec'];
    const hasTestDir = commonTestDirs.some(d =>
      existsSync(resolve(projectDir, d))
    );
    if (hasTestDir) {
      results.passed = 1;
    } else {
      results.warnings.push('No test directory found (expected: tests/, test/, __tests__/)');
    }
  }

  return results;
}
