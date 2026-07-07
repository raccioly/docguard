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

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * True if the directory is inside a git work tree. Cached per-call.
 */
export function isGitRepo(dir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
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
 * Return the raw unified-diff TEXT between `ref` and HEAD, restricted to code
 * files (docs are excluded — a doc changing is not a code change that could
 * make OTHER docs stale). Consumed by shared-diff.parseUnifiedDiff.
 *
 * `-U0`? No — we want a few lines of context so the parser can group activities
 * and callers can see surrounding tokens; default 3 is fine. Returns '' on
 * error / no diff. Caps output at ~5MB so a giant refactor can't OOM the CLI.
 */
export function getDiffText(dir, ref = 'HEAD~1', pathspec = null) {
  try {
    const args = ['diff', '--no-color', '--no-ext-diff', ref, 'HEAD'];
    if (pathspec && pathspec.length) args.push('--', ...pathspec);
    const raw = execFileSync('git', args, {
      cwd: dir, encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024 * 5,
    });
    return raw || '';
  } catch {
    return '';
  }
}

/**
 * Read a file's contents AS OF a given revision (e.g. the commit where a doc
 * was last touched), following the `<rev>:<path>` git addressing. Returns null
 * when the path didn't exist at that rev, the rev is unknown, or git is
 * unavailable — callers treat null as "no prior snapshot to compare".
 *
 * This is the backbone of the two-revision reference-existence check: read the
 * source at the doc's last-updated commit vs HEAD and diff symbol presence.
 */
export function fileContentAtRev(dir, rev, filePath) {
  try {
    const raw = execFileSync(
      'git',
      ['show', `${rev}:${filePath}`],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1024 * 1024 * 10 }
    );
    return raw;
  } catch {
    return null;
  }
}

// Default source globs for symbol-existence grep (any-language).
export const CODE_GLOBS = [
  '*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.py', '*.go', '*.rs',
  '*.java', '*.kt', '*.rb', '*.php', '*.cs', '*.swift', '*.scala', '*.dart', '*.c', '*.cpp', '*.h',
];

/**
 * True if `symbol` appears as a whole word in the source tree AS OF `rev`.
 * Uses `git grep -w -F` (fixed string, word boundary) at the given revision —
 * exactly the "whole-word, case-sensitive, exact string match" the two-revision
 * outdated-reference method specifies (arXiv 2212.01479). Restricted to code
 * globs so a symbol still named in prose/docs doesn't count as "present".
 *
 * Returns false when absent, the rev is unknown, or git is unavailable — the
 * caller pairs two calls (doc's last-update rev vs HEAD) to detect present→gone.
 */
export function symbolExistsAtRev(dir, symbol, rev, pathspecs = CODE_GLOBS) {
  try {
    execFileSync(
      'git',
      ['grep', '-q', '-w', '-F', '-e', symbol, rev, '--', ...pathspecs],
      { cwd: dir, stdio: ['pipe', 'ignore', 'ignore'] }
    );
    return true; // exit 0 → at least one match
  } catch {
    return false; // exit 1 → no match (or bad rev / no git)
  }
}

/**
 * Resolve the commit hash that last touched `filePath` (following renames), or
 * null. Used to anchor "the revision when this doc was last updated" for the
 * two-revision check without re-parsing getFileHistory at every call site.
 */
export function lastCommitHash(dir, filePath) {
  try {
    const raw = execFileSync(
      'git',
      ['log', '--follow', '-1', '--format=%H', '--', filePath],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    return raw || null;
  } catch {
    return null;
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
    //
    // Guard `/dev/null`: when `core.hooksPath` is set to /dev/null (a common
    // "disable all hooks" convention — and what Jules's sandbox VM does),
    // git returns the literal `/dev/null`. resolve()-ing it and then writing
    // `<hooksDir>/pre-commit` gives `ENOTDIR: /dev/null/pre-commit`. Treat it
    // as "no usable hooks dir" and fall through to the `.git/hooks` check so
    // hook install/list still works in that environment. (bug-200)
    if (out && out !== '/dev/null') return resolve(dir, out);
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
