/**
 * Freshness Validator — Check if documentation is stale relative to code changes.
 * Uses git history to compare when docs were last modified vs when code was last changed.
 * 
 * This catches the exact issue the user identified: docs say "[ ] planned"
 * but the code has already been implemented and committed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

// B-5 fix (v0.13.1): use a defensive import. If `shared-git.mjs` is missing
// or unloadable in the end-user install (whatever the root cause — partial
// upgrade, package corruption, weird module resolution), we fall back to
// the original inline implementation below. The worst-case outcome is
// "rename detection doesn't work", NOT "validator crashes with a useless
// ReferenceError". Reported by an enterprise client project v0.13.x feedback.
let _sharedGetLastCommitDate = null;
try {
  const mod = await import('../shared-git.mjs');
  if (mod && typeof mod.getLastCommitDate === 'function') {
    _sharedGetLastCommitDate = mod.getLastCommitDate;
  }
} catch {
  // Silently fall back. Test in tests/freshness-resilience.test.mjs verifies
  // the validator stays operational when the import goes sideways.
  _sharedGetLastCommitDate = null;
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'templates', 'configs', 'Research',
]);

/**
 * Read the `<!-- docguard:last-reviewed YYYY-MM-DD -->` header from a doc file.
 * Returns the parsed Date when present, null otherwise (file missing, header
 * absent, or date unparseable). The header is the authoritative review date
 * — it represents an explicit human review action that `git log` cannot see
 * (e.g., the reviewer read the file, confirmed it still matches reality, and
 * stamped the header without touching content, so there is no commit to find).
 */
function readLastReviewedDate(absPath) {
  try {
    const content = readFileSync(absPath, 'utf-8');
    const m = content.match(/<!--\s*docguard:last-reviewed\s+(\d{4}-\d{2}-\d{2})\s*-->/);
    if (!m) return null;
    const d = new Date(m[1] + 'T00:00:00Z');
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Get the last git commit date for a file.
 * Returns null if the file isn't tracked or git isn't available.
 */
function getLastGitDate(filePath, dir) {
  // Prefer the shared-git --follow-aware path when available (v0.13+ default).
  // Fall back to inline implementation if the import failed at module load —
  // this guarantees the validator never throws a ReferenceError even in
  // environments where ESM resolution is broken.
  if (_sharedGetLastCommitDate) {
    try {
      return _sharedGetLastCommitDate(dir, filePath);
    } catch {
      // fall through to inline
    }
  }
  // Inline pre-v0.13 implementation — works without rename detection, but
  // is guaranteed to not throw a "not defined" error.
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
    const result = execFileSync(
      'git',
      ['log', `--since=${isoDate}`, '--oneline', '--diff-filter=M', '--', '*.js', '*.mjs', '*.ts', '*.tsx', '*.py', '*.java', '*.go'],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return result ? result.split('\n').length : 0;
  } catch {
    return 0;
  }
}

/**
 * Check if git is available in this project.
 */
function isGitRepo(dir) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
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
    return parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], {
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
    const result = execFileSync(
      'git',
      ['log', `-${count}`, '--format=%h %aI %s', '--', '*.js', '*.mjs', '*.ts', '*.tsx', '*.py', '*.java'],
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

    // Prefer the explicit `<!-- docguard:last-reviewed YYYY-MM-DD -->` header
    // over the git commit date. A reviewer who reads a doc and stamps the
    // header without changing content has signaled "I confirmed this is still
    // current" — git log cannot see that signal, so it would falsely flag the
    // doc as stale despite the explicit review. Fall back to git log only when
    // the header is absent. Symmetric with the ALCOA+ "review metadata present"
    // check in score.mjs, which reads the same header.
    const reviewedDate = readLastReviewedDate(docPath);
    const docDate = reviewedDate || getLastGitDate(docFile, dir);
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
    const changelogDate =
      readLastReviewedDate(changelogPath) ||
      getLastGitDate(config.requiredFiles?.changelog || 'CHANGELOG.md', dir);
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
      const gitLogOutput = execFileSync(
        'git',
        ['log', '-5', '--all', '-p', '--', '*.js', '*.mjs', '*.ts', '*.tsx', '*.py'],
        { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const driftCount = gitLogOutput.match(/DRIFT:/g)?.length || 0;
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
