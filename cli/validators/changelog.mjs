/**
 * Changelog Validator — Checks CHANGELOG.md has an [Unreleased] section,
 * follows Keep a Changelog format, and (per STANDARD.md) that staged code
 * changes are accompanied by a CHANGELOG update.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs|kt|swift)$/;

/** Return staged file paths (relative to repo root), or null if git is unavailable. */
function getStagedFiles(projectDir) {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return null; // not a git repo, or git not installed
  }
}

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

  // Per STANDARD.md: if there are staged CODE changes, CHANGELOG.md should be
  // updated in the same commit. Only assessed when git is available AND there
  // are staged code changes (otherwise the check is not applicable).
  const staged = getStagedFiles(projectDir);
  if (staged && staged.length > 0) {
    const changelogName = basename(config.requiredFiles.changelog);
    const stagedCode = staged.filter(f => CODE_EXT_RE.test(f));
    const changelogStaged = staged.some(f => basename(f) === changelogName);

    if (stagedCode.length > 0) {
      results.total++;
      if (changelogStaged) {
        results.passed++;
      } else {
        results.warnings.push(
          `${stagedCode.length} code file(s) staged but ${changelogName} is not — add a CHANGELOG entry for this change`
        );
      }
    }
  }

  return results;
}
