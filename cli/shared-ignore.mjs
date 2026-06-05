/**
 * Shared Ignore Utility — Unified file filtering for all validators.
 *
 * Provides consistent glob matching for config ignore arrays:
 *   - config.ignore        (global — all validators)
 *   - config.securityIgnore (security validator only)
 *   - config.todoIgnore     (TODO-tracking validator only)
 *
 * Supports exact paths AND glob patterns:
 *   - "src/foo.ts"           → exact match
 *   - "packages/cdk/**"      → match any file under packages/cdk/
 *   - "backend/src/__tests__/**" → match any file under that path
 *   - "*.test.ts"            → match files ending in .test.ts
 *
 * Zero NPM dependencies — pure Node.js built-ins only.
 */

/**
 * Canonical set of directory names that should never be scanned, regardless
 * of validator. Build outputs, VCS internals, package caches, framework synth
 * outputs. Validators MAY extend this with their own additions but SHOULD
 * start from this base so behavior is consistent across the tool.
 */
export const DEFAULT_IGNORE_DIRS = new Set([
  // Package managers
  'node_modules', 'vendor', '.venv', '__pycache__',
  // VCS
  '.git', '.jj', '.hg', '.svn',
  // Build outputs — JS/TS, Rust/Java, generic
  'dist', 'build', 'out', 'coverage', 'target', '.gradle',
  // Framework synth/cache
  '.next', '.nuxt', '.turbo', '.vercel', '.cache', '.svelte-kit', 'cdk.out',
  // OS
  '.DS_Store',
]);

// Regex for paths that must always be rejected at any depth, regardless of
// the glob pattern matching them. These are duplicate file trees (worktrees)
// or runtime caches that should NEVER be treated as primary source.
const ALWAYS_REJECT_PATH_RE =
  /(?:^|[/\\])(?:node_modules|\.claude[/\\]worktrees|\.git[/\\]worktrees|\.jj)(?:[/\\]|$)/;

/**
 * Read `.docguardignore` from a project directory and return its patterns.
 *
 * Format: gitignore-style — one pattern per line, `#` for comments, blank lines
 * ignored. Returned patterns are normalized but not transformed (callers
 * decide whether to expand directory globs).
 *
 * Returns [] if the file is missing or unreadable — never throws.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath, relative as relativePath, sep } from 'node:path';

/**
 * Project-relative path with POSIX (`/`) separators — the canonical form that
 * every validator should compare against docs, ignore globs, and changed-file
 * sets.
 *
 * Replaces the old `absPath.replace(projectDir + '/', '')` idiom, which failed
 * two ways: on Windows the `/` literal never matched the OS `\` separators, and
 * for a sibling dir sharing a prefix (`/repo` vs `/repo-staging`) the replace
 * was a no-op — both cases left an ABSOLUTE path, silently breaking
 * `content.includes(relPath)`, glob matching, and `--changed-only` scoping.
 */
export function relPosix(projectDir, absPath) {
  return relativePath(projectDir, absPath).split(sep).join('/');
}

export function loadDocguardIgnore(projectDir) {
  const p = resolvePath(projectDir, '.docguardignore');
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, 'utf-8');
    return raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Merge `.docguardignore` patterns into a config object's `ignore` array.
 *
 * Used at config-load time so every validator sees the combined set without
 * having to know about the file. Mutates and returns the config for ergonomics.
 *
 * Idempotent — calling twice produces the same result. Skips duplicates.
 */
export function mergeIgnoreFile(projectDir, config) {
  const filePatterns = loadDocguardIgnore(projectDir);
  if (filePatterns.length === 0) return config;
  const existing = Array.isArray(config.ignore) ? config.ignore : [];
  const seen = new Set(existing);
  const merged = [...existing];
  for (const p of filePatterns) {
    if (!seen.has(p)) {
      merged.push(p);
      seen.add(p);
    }
  }
  config.ignore = merged;
  return config;
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports: * (any chars except /), ** (any path segments), . (literal dot).
 *
 * @param {string} pattern - Glob pattern
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  // gitignore-style trailing slash ("dir/") means "this directory and everything
  // under it". Strip it so "dir/" matches identically to "dir" — otherwise the
  // escaped pattern keeps the slash and the alternation below can only match a
  // literal "dir//" (double slash), so the pattern silently matches nothing.
  // `|| pattern` guards the degenerate all-slashes case (e.g. "/") from emptying.
  const normalized = pattern.replace(/\/+$/, '') || pattern;
  const escaped = normalized
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '§§')     // temp placeholder for **
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  // Match if the relative path:
  //   - equals the pattern exactly
  //   - ends with /pattern
  //   - starts with pattern/
  //   - contains /pattern/
  return new RegExp(`^${escaped}$|/${escaped}$|^${escaped}/|/${escaped}/`);
}

/**
 * Build a filter function from an array of glob patterns.
 * Returns a function that returns true if a relative path should be SKIPPED.
 *
 * @param {string[]} patterns - Glob patterns (from config.ignore, config.securityIgnore, etc.)
 * @returns {(relPath: string) => boolean} - true if file should be ignored
 */
export function buildIgnoreFilter(patterns = []) {
  if (!patterns || patterns.length === 0) return () => false;

  const regexes = patterns.map(p => globToRegex(p));
  return (relPath) => regexes.some(regex => regex.test(relPath));
}

/**
 * Check if a relative path should be ignored by BOTH
 * global ignore + validator-specific ignore.
 *
 * @param {string} relPath - Relative file path (e.g., "backend/src/__tests__/foo.test.ts")
 * @param {object} config - DocGuard config object
 * @param {string} [validatorKey] - Optional validator-specific key (e.g., 'securityIgnore', 'todoIgnore')
 * @returns {boolean} - true if file should be skipped
 */
export function shouldIgnore(relPath, config, validatorKey) {
  // Check global ignore
  if (config.ignore && config.ignore.length > 0) {
    const globalFilter = buildIgnoreFilter(config.ignore);
    if (globalFilter(relPath)) return true;
  }

  // Check validator-specific ignore
  if (validatorKey && config[validatorKey] && config[validatorKey].length > 0) {
    const validatorFilter = buildIgnoreFilter(config[validatorKey]);
    if (validatorFilter(relPath)) return true;
  }

  return false;
}

/**
 * Convert a glob pattern to a RegExp for POSITIVE matching.
 * Unlike globToRegex (used for ignore filtering), this anchors the match
 * to the full relative path from the project root.
 *
 * Supports: * (any chars except /), ** (any path segments), . (literal dot).
 *
 * @param {string} pattern - Glob pattern (e.g., "backend/**\/__tests__/**\/*.test.ts")
 * @returns {RegExp}
 */
function globToMatchRegex(pattern) {
  // Normalize: replace **/ with a placeholder that means "zero or more path segments"
  let escaped = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '§STARSTAR§')   // **/ → zero-or-more segments
    .replace(/\*\*/g, '.*')             // standalone ** → any chars
    .replace(/\*/g, '[^/]*')            // single * → any chars except /
    .replace(/§STARSTAR§/g, '(.*/)?');  // **/ → optional path prefix
  return new RegExp(`^${escaped}$`);
}

/**
 * Check if a relative path matches ANY of the given glob patterns.
 * Purpose-built for POSITIVE matching (e.g., "is this a test file?").
 *
 * ALWAYS rejects paths containing node_modules at any depth.
 * This is the correct function for test file discovery — do NOT use
 * buildIgnoreFilter() for this purpose.
 *
 * @param {string} relPath - Relative path from project root
 * @param {string[]} patterns - Array of glob patterns to match against
 * @returns {boolean} - true if path matches a pattern AND is not in node_modules
 */
export function globMatch(relPath, patterns) {
  if (!relPath || !patterns || patterns.length === 0) return false;

  // Always reject paths inside node_modules / worktree copies / .jj at any
  // depth. A user's testPatterns like "**/*.test.ts" would otherwise match
  // duplicate trees under .claude/worktrees and inflate test counts.
  if (ALWAYS_REJECT_PATH_RE.test(relPath)) return false;

  const regexes = patterns.map(p => globToMatchRegex(p));
  return regexes.some(r => r.test(relPath));
}
