/**
 * Changelog Validator — Checks CHANGELOG.md has an [Unreleased] section,
 * follows Keep a Changelog format, and (per STANDARD.md) that staged code
 * changes are accompanied by a CHANGELOG update.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkFinding, resultFromFindings } from '../findings.mjs';

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

// v0.29: migrated to structured findings (CHG001–CHG003). Messages are
// byte-identical to the legacy strings; the `fixes` array is preserved for
// the fix applier.
export function validateChangelog(projectDir, config) {
  const findings = [];
  const fixes = [];
  let passed = 0;
  let total = 0;

  const changelogPath = resolve(projectDir, config.requiredFiles.changelog);
  if (!existsSync(changelogPath)) {
    // Structure validator catches missing files
    return { name: 'changelog', ...resultFromFindings([], { passed: 0, total: 0 }), fixes };
  }

  const content = readFileSync(changelogPath, 'utf-8');

  // Check for [Unreleased] section
  total++;
  if (content.includes('[Unreleased]') || content.includes('[unreleased]')) {
    passed++;
  } else {
    findings.push(mkFinding({
      code: 'CHG001',
      validator: 'changelog',
      severity: 'warn',
      message: 'CHANGELOG.md: missing [Unreleased] section — fix with `docguard fix --write`',
      location: config.requiredFiles.changelog,
      suggestion: { kind: 'fix', text: 'Insert an [Unreleased] section', command: 'docguard fix --write' },
    }));
    fixes.push({ type: 'insert-changelog-unreleased', file: config.requiredFiles.changelog });
  }

  // Check it follows Keep a Changelog format (at least has ## headers)
  total++;
  const hasVersionHeaders = /^## \[/m.test(content);
  if (hasVersionHeaders) {
    passed++;
  } else {
    findings.push(mkFinding({
      code: 'CHG002',
      validator: 'changelog',
      severity: 'warn',
      message: 'CHANGELOG.md: no version sections found (expected ## [version] format)',
      location: config.requiredFiles.changelog,
      suggestion: { kind: 'review', text: 'Adopt Keep a Changelog format: ## [version] - YYYY-MM-DD headers' },
    }));
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
      total++;
      if (changelogStaged) {
        passed++;
      } else {
        findings.push(mkFinding({
          code: 'CHG003',
          validator: 'changelog',
          severity: 'warn',
          message: `${stagedCode.length} code file(s) staged but ${changelogName} is not — add a CHANGELOG entry for this change`,
          location: config.requiredFiles.changelog,
          suggestion: { kind: 'fix', text: `Describe the staged change under [Unreleased] in ${changelogName}, then stage it` },
        }));
      }
    }
  }

  return { name: 'changelog', ...resultFromFindings(findings, { passed, total }), fixes };
}
