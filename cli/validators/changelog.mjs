/**
 * Changelog Validator — Checks CHANGELOG.md has [Unreleased] section
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function validateChangelog(projectDir, config) {
  const results = { name: 'changelog', errors: [], warnings: [], passed: 0, total: 0 };

  const changelogPath = resolve(projectDir, config.requiredFiles.changelog);
  if (!existsSync(changelogPath)) {
    // Structure validator catches missing files
    return results;
  }

  const content = readFileSync(changelogPath, 'utf-8');

  // Check for [Unreleased] section
  results.total++;
  if (content.includes('[Unreleased]') || content.includes('[unreleased]')) {
    results.passed++;
  } else {
    results.warnings.push('CHANGELOG.md: missing [Unreleased] section');
  }

  // Check it follows Keep a Changelog format (at least has ## headers)
  results.total++;
  const hasVersionHeaders = /^## \[/m.test(content);
  if (hasVersionHeaders) {
    results.passed++;
  } else {
    results.warnings.push(
      'CHANGELOG.md: no version sections found (expected ## [version] format)'
    );
  }

  return results;
}
