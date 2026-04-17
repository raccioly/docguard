/**
 * Freshness Validator — Check if documentation is stale relative to code changes.
 * Uses git history to compare when docs were last modified vs when code was last changed.
 * 
 * This catches the exact issue the user identified: docs say "[ ] planned"
 * but the code has already been implemented and committed.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'templates', 'configs', 'Research',
]);

/**
 * Get the last git commit date for a file.
 * Returns null if the file isn't tracked or git isn't available.
 */
function getLastGitDate(filePath, dir) {
  try {
    const result = execFileSync(
      'git',
      ['log', '-1', '--format=%aI', '--', filePath],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return result ? new Date(result) : null;
  } catch {
    return null;
  }
}

/**
 * Get the count of commits that touched code files since a given date.
 */
function getCodeCommitsSince(date, dir) {
  try {
    const isoDate = date.toISOString();
    const result = execSync(
      `git log --since="${isoDate}" --oneline --diff-filter=M -- "*.js" "*.mjs" "*.ts" "*.tsx" "*.py" "*.java" "*.go" | wc -l`,
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return parseInt(result) || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if git is available in this project.
 */
function isGitRepo(dir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get total number of commits in the repo.
 */
function getTotalCommits(dir) {
  try {
    return parseInt(execSync('git rev-list --count HEAD', {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Get the last N commits touching code files (not docs).
 */
function getRecentCodeCommits(dir, count = 5) {
  try {
    const result = execSync(
      `git log -${count} --format="%h %aI %s" -- "*.js" "*.mjs" "*.ts" "*.tsx" "*.py" "*.java"`,
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return result ? result.split('\n') : [];
  } catch {
    return [];
  }
}

export function validateFreshness(dir, config) {
  const results = [];

  if (!isGitRepo(dir)) {
    results.push({
      status: 'skip',
      message: 'Not a git repository — freshness check skipped',
    });
    return results;
  }

  const totalCommits = getTotalCommits(dir);
  if (totalCommits < 3) {
    results.push({
      status: 'skip',
      message: `Only ${totalCommits} commits — freshness check needs ≥3 commits`,
    });
    return results;
  }

  // ── 1. Check each canonical doc's last update vs latest code commit ──
  const docFiles = [
    'docs-canonical/ARCHITECTURE.md',
    'docs-canonical/DATA-MODEL.md',
    'docs-canonical/SECURITY.md',
    'docs-canonical/TEST-SPEC.md',
    'docs-canonical/ENVIRONMENT.md',
    'ROADMAP.md',
    'AGENTS.md',
  ];

  // Get the most recent code commit date
  const recentCodeCommits = getRecentCodeCommits(dir, 1);
  let latestCodeDate = null;
  if (recentCodeCommits.length > 0) {
    const parts = recentCodeCommits[0].split(' ');
    if (parts.length >= 2) {
      latestCodeDate = new Date(parts[1]);
    }
  }

  const STALE_THRESHOLD_DAYS = 30; // Docs older than 30 days vs latest code = stale
  const WARNING_THRESHOLD_COMMITS = 10; // More than 10 code commits since last doc update = stale

  for (const docFile of docFiles) {
    const docPath = resolve(dir, docFile);
    if (!existsSync(docPath)) continue;

    const docDate = getLastGitDate(docFile, dir);
    if (!docDate) {
      // File exists but isn't tracked in git yet
      results.push({
        status: 'warn',
        message: `${docFile} exists but is not yet committed to git`,
      });
      continue;
    }

    // Check how many code commits happened since this doc was last updated
    const codeCommitsSince = getCodeCommitsSince(docDate, dir);

    if (codeCommitsSince >= WARNING_THRESHOLD_COMMITS) {
      results.push({
        status: 'warn',
        message: `${docFile} — ${codeCommitsSince} code commits since last doc update (${docDate.toISOString().split('T')[0]})`,
      });
      continue;
    }

    // Check age vs latest code commit
    if (latestCodeDate) {
      const daysDiff = Math.floor((latestCodeDate - docDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > STALE_THRESHOLD_DAYS) {
        results.push({
          status: 'warn',
          message: `${docFile} — last updated ${daysDiff} days before latest code change`,
        });
        continue;
      }
    }

    results.push({
      status: 'pass',
      message: `${docFile} is fresh`,
    });
  }

  // ── 2. Check CHANGELOG.md was updated in the last 5 code commits ──
  const changelogPath = resolve(dir, config.requiredFiles?.changelog || 'CHANGELOG.md');
  if (existsSync(changelogPath)) {
    const changelogDate = getLastGitDate(config.requiredFiles?.changelog || 'CHANGELOG.md', dir);
    if (changelogDate && latestCodeDate) {
      const daysDiff = Math.floor((latestCodeDate - changelogDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > 7) {
        results.push({
          status: 'warn',
          message: `CHANGELOG.md not updated in ${daysDiff} days despite code changes`,
        });
      } else {
        results.push({
          status: 'pass',
          message: 'CHANGELOG.md is up to date',
        });
      }
    }
  }

  // ── 3. Check DRIFT-LOG.md was updated if there are DRIFT comments ──
  const driftPath = resolve(dir, config.requiredFiles?.driftLog || 'DRIFT-LOG.md');
  if (existsSync(driftPath)) {
    const driftDate = getLastGitDate(config.requiredFiles?.driftLog || 'DRIFT-LOG.md', dir);
    // Check for recent DRIFT comments added to code
    try {
      const recentDrifts = execSync(
        `git log -5 --all -p -- "*.js" "*.mjs" "*.ts" "*.tsx" "*.py" | grep -c "DRIFT:" || true`,
        { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      const driftCount = parseInt(recentDrifts) || 0;
      if (driftCount > 0 && driftDate) {
        const codeCommitsSince = getCodeCommitsSince(driftDate, dir);
        if (codeCommitsSince > 3) {
          results.push({
            status: 'warn',
            message: `DRIFT-LOG.md may be stale — ${driftCount} DRIFT comments found in recent commits`,
          });
        }
      }
    } catch { /* skip */ }
  }

  return results;
}
