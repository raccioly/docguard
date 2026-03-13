/**
 * Test Spec Validator — Checks that tests exist per TEST-SPEC.md coverage rules
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createRequire } from 'node:module';

export function validateTestSpec(projectDir, config) {
  const results = { name: 'test-spec', errors: [], warnings: [], passed: 0, total: 0 };

  const testSpecPath = resolve(projectDir, 'docs-canonical/TEST-SPEC.md');
  if (!existsSync(testSpecPath)) {
    return results; // Structure validator catches this
  }

  const content = readFileSync(testSpecPath, 'utf-8');

  // Parse the Service-to-Test Map table
  const serviceMapMatch = content.match(
    /## Service-to-Test Map[\s\S]*?\n\|.*\|.*\|.*\|.*\|([\s\S]*?)(?=\n##|\n$|$)/
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

      if (cells.length < 4) continue;

      const [sourceFile, unitTest, integrationTest, status] = cells;

      // Skip template/example rows
      if (sourceFile.startsWith('<!--') || sourceFile === 'Source File') continue;

      // Check if source file is mentioned with ❌ status
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
        // Verify the test files actually exist
        if (unitTest && unitTest !== '—' && unitTest !== '-') {
          const testPath = findFile(projectDir, unitTest);
          if (testPath) {
            results.passed++;
          } else {
            results.warnings.push(
              `TEST-SPEC says ${unitTest} exists but file not found`
            );
          }
        } else {
          results.passed++;
        }
      }
    }
  }

  // Parse Critical User Journeys
  const journeyMatch = content.match(
    /## Critical User Journeys[\s\S]*?\n\|.*\|.*\|.*\|.*\|([\s\S]*?)(?=\n##|\n$|$)/
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
      if (num.startsWith('<!--') || num === '#') continue;

      if (status && status.includes('❌')) {
        results.total++;
        results.warnings.push(
          `E2E Journey #${num} (${journey}) — missing test: ${testFile}`
        );
      }
    }
  }

  // If no test spec entries parsed, just check test directory exists
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

function findFile(projectDir, filename) {
  // Try common locations
  const locations = [
    filename,
    `tests/${filename}`,
    `test/${filename}`,
    `tests/unit/${filename}`,
    `tests/integration/${filename}`,
    `tests/e2e/${filename}`,
    `__tests__/${filename}`,
  ];

  for (const loc of locations) {
    if (existsSync(resolve(projectDir, loc))) {
      return resolve(projectDir, loc);
    }
  }
  return null;
}
