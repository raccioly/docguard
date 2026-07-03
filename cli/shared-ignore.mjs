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
 * Directory names that hold NON-PRODUCT code — test fixtures, sample apps,
 * example projects, mocks. Excluded from SURFACE DETECTION (framework / route /
 * integration / env-var inference) BY DEFAULT, with no `.docguardignore`
 * required.
 *
 * Why this exists (v0.26, field report Bug #1): a tool's own test fixtures —
 * e.g. a deliberately-vulnerable Express sample under `tests/fixtures/` — were
 * being read as the PRODUCT's architecture, so a pure-Python CLI got documented
 * as an Express/Flask web app. Honoring `config.ignore` (added v0.25) wasn't
 * enough: the realistic first run has no `.docguardignore` yet.
 *
 * SCOPE: detection/generate scanners ONLY — deliberately NOT guard's structural
 * validators. A user's real `examples/` dir still counts toward docs coverage.
 * Anti-false-green: when a surface signal appears ONLY under these dirs, callers
 * SHOULD surface a low-confidence "confirm these are fixtures" note rather than
 * silently drop it. Override via `config.detection.includeNonProduct = true`.
 */
export const DEFAULT_DETECTION_IGNORE_DIRS = new Set([
  'fixtures', '__fixtures__', 'test-fixtures', 'testfixtures', 'testdata',
  'test', 'tests', '__tests__', 'spec', 'specs', '__mocks__', 'mocks',
  'examples', 'example', 'sample', 'samples',
]);

/** True if `dirName` is a non-product dir detection should skip by default. */
export function isNonProductDir(dirName, config = {}) {
  if (config?.detection?.includeNonProduct) return false;
  return DEFAULT_DETECTION_IGNORE_DIRS.has(dirName);
}

/**
 * True if ANY path segment of `relPath` (POSIX, project-relative) is a
 * non-product detection dir — for filtering file-level detection results.
 */
export function isNonProductPath(relPath, config = {}) {
  if (config?.detection?.includeNonProduct) return false;
  if (!relPath) return false;
  return relPath.split('/').some(seg => DEFAULT_DETECTION_IGNORE_DIRS.has(seg));
}

/**
 * Read `.docguardignore` from a project directory and return its patterns.
 *
 * Format: gitignore-style — one pattern per line, `#` for comments, blank lines
 * ignored. Returned patterns are normalized but not transformed (callers
 * decide whether to expand directory globs).
 *
 * Returns [] if the file is missing or unreadable — never throws.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve as resolvePath, relative as relativePath, join as joinPath, sep } from 'node:path';

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
 * THE canonical anchored glob compiler (v0.29 consolidation).
 *
 * The repo previously carried THREE glob→regex implementations (ignore-side
 * `globToRegex` above, the old `globToMatchRegex` here, and a third private
 * copy in metrics-consistency for collection counting) with subtly different
 * feature sets — a maintenance hazard for exactly the drift class this tool
 * detects in others. This is now the single anchored compiler; the ignore-side
 * `globToRegex` deliberately stays separate because its UNanchored,
 * boundary-substring semantics ("dir" matches at any depth) are a different
 * contract, documented above, with its own bug history.
 *
 * Supports (superset of all prior anchored variants):
 *   `**\/`  → zero or more path segments   → (?:.*\/)?
 *   `**`    → any chars (incl. /)          → .*
 *   `*`     → any chars except /           → [^/]*
 *   `?`     → one char except /            → [^/]
 *   `{a,b}` → alternation (non-nested)     → (?:a|b)
 * Everything else is regex-escaped. Fully anchored: ^...$.
 *
 * @param {string} pattern - Glob pattern (e.g., "backend/**\/__tests__/**\/*.test.{ts,js}")
 * @returns {RegExp}
 */
export function compileGlob(pattern) {
  const glob = String(pattern);
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { re += '(?:.*/)?'; i++; }
        else re += '.*';
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '{') {
      const end = glob.indexOf('}', i);
      if (end > i) {
        re += '(?:' + glob.slice(i + 1, end).split(',')
          .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
        i = end;
      } else {
        re += '\\{';
      }
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

// Back-compat internal alias — globMatch below always used the anchored form.
const globToMatchRegex = compileGlob;

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

/**
 * THE canonical recursive file walker (v0.29 consolidation).
 *
 * ~13 validators each carried a private recursive walker with its own copied
 * IGNORE_DIRS set and its own error handling — thirteen chances for skip logic
 * to disagree. This is the single shared implementation.
 *
 * Contract:
 *   - Skips directory names in `ignoreDirs` (default: DEFAULT_IGNORE_DIRS) and,
 *     by default, every dot-prefixed entry (files AND dirs — matches the
 *     dominant prior behavior).
 *   - Calls `callback(absPath)` for every regular file reached.
 *   - NEVER throws. Unreadable entries invoke `onError(err, path)` if given.
 *   - Returns `true` iff the walk was COMPLETE (no unreadable entries). Callers
 *     computing counts MUST check this: a partial walk that silently under-
 *     counts is how a "code has N" assertion becomes confidently wrong — the
 *     tool's own worst failure mode.
 *
 * @param {string} dir - Absolute directory to walk
 * @param {(absPath: string) => void} callback
 * @param {{ignoreDirs?: Set<string>, skipDotEntries?: boolean, keepDot?: (entry: string) => boolean, onError?: (err: Error, path: string) => void}} [opts]
 *   `keepDot` — exception predicate for dot entries that MUST be walked even
 *   with skipDotEntries on. Load-bearing for e.g. the security validator
 *   (must scan `.env`) and traceability (`.env*`, `.gitignore`, `.github/`).
 * @returns {boolean} - true if every entry was readable
 */
export function walkFiles(dir, callback, opts = {}) {
  const {
    ignoreDirs = DEFAULT_IGNORE_DIRS,
    skipDotEntries = true,
    keepDot = null,
    onError = null,
  } = opts;
  let entries;
  try { entries = readdirSync(dir); } catch (err) {
    if (onError) onError(err, dir);
    return false;
  }
  let complete = true;
  for (const entry of entries) {
    if (ignoreDirs.has(entry)) continue;
    if (skipDotEntries && entry.startsWith('.') && !(keepDot && keepDot(entry))) continue;
    const full = joinPath(dir, entry);
    let stat;
    try { stat = statSync(full); } catch (err) {
      if (onError) onError(err, full);
      complete = false;
      continue;
    }
    if (stat.isDirectory()) {
      if (!walkFiles(full, callback, opts)) complete = false;
    } else if (stat.isFile()) {
      callback(full);
    }
  }
  return complete;
}

/**
 * Count files under `projectDir` matching an anchored glob (project-relative).
 * The code-truth side of `config.collections` (metrics-consistency).
 *
 * Walks only from the glob's literal prefix — never the whole repo for a deep
 * pattern. FAIL-SAFE BY CONTRACT:
 *   - returns 0 when the base path doesn't exist (unresolved glob — caller skips);
 *   - returns -1 when the walk was INCOMPLETE (permission-denied subtree, bad
 *     pattern). Previously a partial walk silently under-counted, so a doc
 *     saying "19 extractors" could be "corrected" to a wrong lower number.
 * Callers must treat any value <= 0 as "don't assert".
 *
 * @param {string} projectDir
 * @param {string} pattern - e.g. "src/extractors/*.py"
 * @returns {number} match count, 0 = unresolved, -1 = unreliable
 */
export function countGlobFiles(projectDir, pattern) {
  const norm = String(pattern).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!norm) return -1;
  const baseSegs = [];
  for (const seg of norm.split('/')) {
    if (/[*?{]/.test(seg)) break;
    baseSegs.push(seg);
  }
  const baseDir = resolvePath(projectDir, baseSegs.join('/') || '.');
  if (!existsSync(baseDir)) return 0;
  let re;
  try { re = compileGlob(norm); } catch { return -1; }
  try {
    if (statSync(baseDir).isFile()) return re.test(norm) ? 1 : 0; // literal file pattern
  } catch { return -1; }
  let n = 0;
  const complete = walkFiles(baseDir, (full) => {
    if (re.test(relPosix(projectDir, full))) n++;
  });
  return complete ? n : -1;
}
