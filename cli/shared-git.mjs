/**
 * Shared Git Utilities — single source of truth for `git log` plumbing
 * across DocGuard. All file-scoped queries use `--follow` so renames are
 * preserved in commit history (L-3 / S-4).
 *
 * Why this matters: before --follow, renaming a service file would reset
 * its "last commit date", which then reset the Freshness validator's
 * "X commits since last doc update" counter — silently hiding drift.
 *
 * Zero NPM dependencies. Pure Node.js built-ins.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * True if the directory is inside a git work tree. Cached per-call.
 */
export function isGitRepo(dir) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the ISO date string of the most recent commit that touched the file,
 * following renames. Returns null if the file isn't tracked, the dir isn't
 * a git repo, or git is unavailable.
 *
 * `--follow` requires a single path arg (not a glob), which is the case for
 * every caller — we pass a literal file path.
 */
export function getLastCommitDate(dir, filePath) {
  try {
    const result = execFileSync(
      'git',
      ['log', '--follow', '-1', '--format=%aI', '--', filePath],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return result ? new Date(result) : null;
  } catch {
    return null;
  }
}

/**
 * Get all commits that touched the file (following renames), in reverse-
 * chronological order. Each entry is { hash, isoDate, subject }.
 *
 * `limit` caps the number returned (default 100) so we don't blow up on
 * long-lived files in deep histories.
 */
export function getFileHistory(dir, filePath, limit = 100) {
  try {
    const raw = execFileSync(
      'git',
      ['log', '--follow', `-${limit}`, '--format=%H%x00%aI%x00%s', '--', filePath],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!raw) return [];
    // Fields are NUL-delimited (the %x00 in the format above) precisely so
    // commit subjects — which contain spaces — survive intact. The delimiter
    // is written as the \x00 escape, NOT a literal NUL byte in the source
    // (that was an invisible footgun: editors and tooling silently strip it).
    return raw.split('\n').map(line => {
      const [hash, isoDate, subject] = line.split('\x00');
      return { hash, isoDate, subject: subject || '' };
    });
  } catch {
    return [];
  }
}

/**
 * Get all file paths the given file has had over its history (most recent
 * name first). Useful for diff scanners that need to match the file against
 * historical commits — without this, a rename completely hides earlier work.
 *
 * Returns [currentPath] when there's no rename history (or git unavailable).
 */
export function getRenameHistory(dir, filePath) {
  try {
    const raw = execFileSync(
      'git',
      ['log', '--follow', '--name-only', '--format=', '--', filePath],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!raw) return [filePath];
    const seen = new Set();
    const paths = [];
    for (const line of raw.split('\n')) {
      const p = line.trim();
      if (p && !seen.has(p)) {
        seen.add(p);
        paths.push(p);
      }
    }
    return paths.length > 0 ? paths : [filePath];
  } catch {
    return [filePath];
  }
}

/**
 * Count commits that touched any of the given path patterns since `date`.
 * Used by Freshness's "X commits since last doc update".
 *
 * `pathPatterns` can be globs (`*.ts`) — these are passed through to git
 * unchanged. `--follow` is NOT applied here because git doesn't support it
 * with multiple/glob path args.
 */
export function countCommitsSince(dir, date, pathPatterns = ['*.js', '*.mjs', '*.ts', '*.tsx', '*.py', '*.java', '*.go', '*.rs', '*.kt', '*.rb']) {
  try {
    const args = ['log', `--since=${date.toISOString()}`, '--oneline', '--diff-filter=M', '--'].concat(pathPatterns);
    const result = execFileSync('git', args, {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return (result.match(/\n/g) || []).length;
  } catch {
    return 0;
  }
}

/**
 * Return the list of files changed since the given ref (default HEAD~1).
 * Used by `--changed-only` mode and `sync --since`.
 *
 * Returns an array of paths relative to `dir`. Empty array on error or
 * when the ref doesn't exist.
 */
export function changedFilesSince(dir, ref = 'HEAD~1') {
  try {
    const raw = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMR', ref, 'HEAD'],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve the absolute path to this repo's git hooks directory.
 *
 * Critically, this does NOT assume `<projectDir>/.git/hooks`: in a linked
 * worktree `.git` is a *file* (a `gitdir:` pointer), so that path doesn't
 * exist and `mkdir` of it fails with ENOTDIR. `git rev-parse --git-path hooks`
 * returns the correct location for the current worktree, and also honors a
 * custom `core.hooksPath`. Returns null when git is unavailable or the dir
 * isn't a repo — callers should treat that as "not a git repo".
 */
export function getHooksDir(dir) {
  try {
    const out = execFileSync(
      'git',
      ['rev-parse', '--git-path', 'hooks'],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    // --git-path returns a path relative to `dir` (cwd) or an absolute path;
    // resolve() handles both.
    if (out) return resolve(dir, out);
  } catch {
    // git unavailable or not a repo — fall through to the literal-path check.
  }
  // Fallback: a real `.git/` DIRECTORY (normal clone) → `.git/hooks`. We
  // require it to be a directory so we don't recreate the worktree bug, where
  // `.git` is a file pointer and `.git/hooks` is invalid. Returns null when
  // there's no `.git` at all, which callers treat as "not a git repo".
  const dotGit = resolve(dir, '.git');
  try {
    if (existsSync(dotGit) && statSync(dotGit).isDirectory()) {
      return resolve(dotGit, 'hooks');
    }
  } catch { /* ignore */ }
  return null;
}
