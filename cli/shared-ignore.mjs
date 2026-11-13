import { isExpired, isOwner, parseWaiverDate, splitWaiverMetadata } from './waiver-metadata.mjs';
import { resolveDocRole } from './shared-doc-roles.mjs';
import { compileGlob, fileKind, FIXTURE_DIRS, isPackageSegment, mayHoldOwnFiles } from './shared-file-kind.mjs';
// The glob compiler and the package-segment rule live with the file-kind vocabulary (specs/100-file-kinds):
// the module that classifies paths must not import this one back.
export { compileGlob, isPackageSegment };
export { FIXTURE_DIRS as DEFAULT_DETECTION_IGNORE_DIRS } from './shared-file-kind.mjs';
/**
 * Shared Ignore Utility — Unified file filtering for all validators.
 *
 * Provides consistent glob matching for config ignore arrays:
 *   - config.ignore        (global — all validators)
 *   - config.securityIgnore (security validator only)
 *   - config.todoIgnore     (TODO-tracking validator only)
 *   - config.documentLifecycle (Document-Lifecycle validator only)
 *   - .docguardignore       (merged into config.ignore at load)
 *
 * Supports exact paths AND glob patterns (full syntax at `globToRegex`):
 *   - "src/foo.ts"           → exact match, at any depth
 *   - "packages/cdk/**"      → match any file under packages/cdk/
 *   - "**\/fixtures/**"      → fixtures/ at the top level or below any directory
 *   - "*.test.ts"            → match files ending in .test.ts
 *   - "notes?.md", "[ab].md" → gitignore `?` and bracket expressions
 *   - "/build"               → anchored to the project root
 *
 * Zero NPM dependencies — pure Node.js built-ins only.
 */

/**
 * Canonical set of directory names that should never be scanned, regardless
 * of validator. Build outputs, VCS internals, package caches, framework synth
 * outputs. Validators MAY extend this with their own additions but SHOULD
 * start from this base so behavior is consistent across the tool.
 *
 * Only names that are build output wherever they appear belong here. `bin` is
 * not one of them: it is source in a Node CLI, Ruby binstubs or a shell
 * project, and .NET output only beside a project file — see
 * `isIgnoredDirEntry` (docguard.coverage-followups#FR-002).
 *
 * @implements docguard.coverage-followups#FR-002
 */
export const DEFAULT_IGNORE_DIRS = new Set([
  // Package managers
  'node_modules', 'vendor', '.venv', '__pycache__',
  // VCS
  '.git', '.jj', '.hg', '.svn',
  // Build outputs — JS/TS, Rust/Java (target), .NET/C (obj), Mix/dune/Sphinx (_build), generic
  'dist', 'build', 'out', 'coverage', 'target', '.gradle', 'obj', '_build',
  // Framework synth/cache
  '.next', '.nuxt', '.turbo', '.vercel', '.cache', '.svelte-kit', 'cdk.out',
  // OS
  '.DS_Store',
]);

/** A .NET project file: the directory holding one keeps its build output in `bin/`. */
const DOTNET_PROJECT_FILE_RE = /\.(?:cs|fs|vb)proj$/i;
/** Directory names that are build output only in a particular context. */
const DOTNET_OUTPUT_DIRS = new Set(['bin']);

/**
 * Whether a directory entry is build output a walker must skip: a name in
 * `ignoreDirs` (default `DEFAULT_IGNORE_DIRS`), or `bin` when a sibling entry
 * is a .NET project file (`*.csproj`, `*.fsproj`, `*.vbproj`). Every other
 * `bin/` is read.
 *
 * @implements docguard.coverage-followups#FR-002
 * @param {string} name - the entry's name
 * @param {Array<string|{name: string}>} siblings - every entry of the same directory
 * @param {Set<string>} [ignoreDirs]
 * @returns {boolean}
 */
export function isIgnoredDirEntry(name, siblings, ignoreDirs = DEFAULT_IGNORE_DIRS) {
  if (ignoreDirs.has(name)) return true;
  if (!DOTNET_OUTPUT_DIRS.has(name)) return false;
  return (siblings || []).some(e => DOTNET_PROJECT_FILE_RE.test(typeof e === 'string' ? e : e?.name || ''));
}

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
 * Override via `config.detection.includeNonProduct = true`.
 *
 * What callers do with a signal found ONLY under these dirs: the API-surface
 * validator counts the routes it dropped and, when none remain, reports
 * `partial` with that count and the override, so an empty surface never reads
 * as "no routes" (docguard.fallback-language-coverage#FR-007). The env scan
 * prunes these dirs without reading them, so it cannot count what it skipped;
 * the other detectors drop such files silently.
 *
 * A segment that is a PACKAGE name is not a directory of examples:
 * Spring Initializr's default package is `com.example`, so
 * `src/main/java/com/example/…` is the product, and so is a Go
 * `internal/example` package (see `isPackageSegment`).
 */
// DEFAULT_DETECTION_IGNORE_DIRS is the fixture vocabulary of cli/shared-file-kind.mjs (re-exported above).

/**
 * True for a directory DocGuard itself writes: the canonical and implementation
 * doc homes, and a Spec Kit `specs/` directory (one whose child directory holds
 * a `spec.md`). These hold documentation, never product code, so the component
 * map and DCV003 must not list them — generate created them moments earlier.
 * A `specs/` without Spec Kit features (an RSpec-style test dir) stays code.
 * `relDir` is project-relative, POSIX.
 * @implements docguard.generated-docs-consistency#FR-005
 */
export function isDocguardOwnedDir(projectDir, relDir) {
  const rel = String(relDir || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (rel === 'docs-canonical' || rel === 'docs-implementation') return true;
  if (rel !== 'specs') return false;
  try {
    return readdirSync(joinPath(projectDir, rel), { withFileTypes: true })
      .some(e => e.isDirectory() && existsSync(joinPath(projectDir, rel, e.name, 'spec.md')));
  } catch { return false; }
}

/**
 * True if `dirName` is a non-product dir detection should skip by default.
 * Pass `parentRel` (the POSIX project-relative path of the directory that
 * contains it) so a package segment is recognised the way `isNonProductPath`
 * recognises it; without it, only the name is judged.
 */
export function isNonProductDir(dirName, config = {}, parentRel = null) {
  if (config?.detection?.includeNonProduct) return false;
  if (!FIXTURE_DIRS.has(String(dirName).toLowerCase())) return false;
  const segments = [...(parentRel ? String(parentRel).split('/').filter(s => s && s !== '.') : []), dirName];
  if (parentRel && isPackageSegment(segments, segments.length - 1)) return false;
  // A walker that prunes this directory would never reach what `fileKinds.own` rescues below it.
  return !mayHoldOwnFiles(segments.join('/'), config);
}

/**
 * True if ANY path segment of `relPath` (POSIX, project-relative) is a
 * non-product detection dir — for filtering file-level detection results.
 * Package segments (`src/main/java/com/example/…`) do not count. A view of
 * `fileKind` (specs/100-file-kinds FR-006): the `fixture` vocabulary, matched
 * without regard to case, every segment (also after a dot-directory) and the
 * last one too; `fileKinds.own` rescues a path.
 */
export function isNonProductPath(relPath, config = {}) {
  if (config?.detection?.includeNonProduct) return false;
  if (!relPath) return false;
  return fileKind(relPath, config, { asDirectory: true, kinds: ['fixture'], harnessFolders: 'all' }).kind === 'fixture';
}

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

/** Today's date in UTC as `YYYY-MM-DD`: the clock `.docguardignore` expiries are read against. */
export function utcToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** True when `day` is `YYYY-MM-DD` and names a real calendar day (no 2026-02-30). */
export function isCalendarDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

const EXPIRES_PREFIX = 'expires:';

/**
 * Parse `.docguardignore` text into entries, one per pattern line.
 *
 * Grammar (gitignore-style, plus websec-validator's `.websec-ignore` tail):
 *
 *   pattern  [expires:YYYY-MM-DD]  [# reason]
 *
 *   - A line whose first non-blank character is `#` is a comment; blank lines
 *     are skipped. Lines are trimmed, as before.
 *   - `#` starts a trailing reason only when whitespace precedes it, so a `#`
 *     inside a pattern (`C#/`, `notes#1.md`) stays part of the pattern.
 *   - `expires:` is read only as the LAST whitespace-separated token before the
 *     reason. Internal whitespace in the pattern is kept as written.
 *
 * A line with neither whitespace-then-`#` nor a trailing `expires:` token
 * yields exactly the pattern the pre-057 parser returned
 * (docguard.ignore-reasons#FR-002).
 *
 * `state`:
 *   - `active`  — applies. An expiry applies through the end of its UTC day.
 *   - `expired` — `today` is after the expiry day; excludes nothing (FR-003).
 *   - `invalid` — the expiry is not a calendar day, or there is no pattern;
 *                 excludes nothing, because its lifetime is unknown (FR-004).
 *
 * @param {string} raw - file contents
 * @param {{ today?: string }} [opts] - `YYYY-MM-DD` (UTC); defaults to now
 * @returns {Array<{pattern: string|null, reason: string|null, expires: string|null,
 *   expiryText: string|null, state: 'active'|'expired'|'invalid',
 *   problem: 'no-pattern'|'unreadable-expiry'|null, line: number, raw: string}>}
 * @implements docguard.ignore-reasons#FR-001
 * @implements docguard.ignore-reasons#FR-002
 * @implements docguard.ignore-reasons#FR-003
 * @implements docguard.ignore-reasons#FR-004
 */
export function parseDocguardIgnore(raw, { today = utcToday() } = {}) {
  const entries = [];
  String(raw ?? '').split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    let body = line;
    let reason = null;
    const hash = line.search(/\s#/);
    if (hash >= 0) {
      body = line.slice(0, hash).trim();
      reason = line.slice(hash).trim().slice(1).trim() || null;
    }
    let expiryText = null;
    const tokens = body.split(/\s+/);
    const last = tokens[tokens.length - 1];
    if (last.startsWith(EXPIRES_PREFIX)) {
      expiryText = last.slice(EXPIRES_PREFIX.length);
      body = body.slice(0, body.length - last.length).trim();
    }
    // docguard.accountable-suppressions#FR-002: `owner:` (and an `expires:`
    // written in the comment) trail the reason. Without them the reason is
    // exactly what spec 057 read.
    let owner = null;
    let metaProblem = null;
    if (reason && /(?:owner|expires):/.test(reason)) {
      const meta = splitWaiverMetadata(reason);
      reason = meta.reason;
      owner = meta.owner;
      metaProblem = meta.problem;
      if (meta.expires) {
        if (expiryText !== null) metaProblem = 'duplicate expires: token';
        else expiryText = meta.expires;
      }
    }
    const pattern = body || null;
    const expiryReadable = expiryText === null || isCalendarDay(expiryText);
    const problem = !pattern ? 'no-pattern' : !expiryReadable ? 'unreadable-expiry' : metaProblem ? 'unreadable-metadata' : null;
    const expires = expiryText !== null && expiryReadable ? expiryText : null;
    const state = problem ? 'invalid' : expires && today > expires ? 'expired' : 'active';
    entries.push({ pattern, reason, owner, expires, expiryText, state, problem, ...(metaProblem ? { metadataProblem: metaProblem } : {}), line: index + 1, raw: rawLine });
  });
  return entries;
}

/**
 * Read `.docguardignore` and return every entry, including expired and
 * invalid ones (`parseDocguardIgnore`). Returns [] if the file is missing or
 * unreadable — never throws.
 */
export function loadDocguardIgnoreEntries(projectDir, opts = {}) {
  const p = resolvePath(projectDir, '.docguardignore');
  if (!existsSync(p)) return [];
  try {
    return parseDocguardIgnore(readFileSync(p, 'utf-8'), opts);
  } catch {
    return [];
  }
}

/**
 * Read `.docguardignore` from a project directory and return the patterns that
 * APPLY today: expired and invalid entries are left out, so every caller
 * (config merge, watch, scanners) honours expiry the same way.
 *
 * Returned patterns are normalized but not transformed (callers decide whether
 * to expand directory globs). Returns [] if the file is missing or unreadable —
 * never throws.
 */
export function loadDocguardIgnore(projectDir, opts = {}) {
  return loadDocguardIgnoreEntries(projectDir, opts)
    .filter(entry => entry.state === 'active')
    .map(entry => entry.pattern);
}

/**
 * Return a predicate for paths Git currently classifies as ignored.
 *
 * This deliberately delegates pattern semantics (including nested
 * `.gitignore` files and negation) to Git instead of maintaining a second,
 * incomplete gitignore parser. `--directory` lets callers prune a wholly
 * ignored directory before reading its descendants. A missing Git repository
 * or an unreadable/overflowing result returns null so callers can retain their
 * existing conservative traversal behavior.
 *
 * Only untracked ignored paths are returned by Git, which is intentional:
 * tracked source remains part of the repository even if a later ignore rule
 * happens to mention its name.
 *
 * @param {string} projectDir
 * @returns {((relPath: string) => boolean)|null}
 */
export function loadGitIgnoredFilter(projectDir) {
  let result;
  try {
    result = spawnSync('git', [
      'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z',
    ], {
      cwd: projectDir,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
  } catch {
    return null;
  }
  if (result.status !== 0 || result.error || typeof result.stdout !== 'string') return null;

  const exact = new Set();
  const directories = [];
  for (const raw of result.stdout.split('\0')) {
    const path = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!path) continue;
    if (path.endsWith('/')) directories.push(path);
    else exact.add(path);
  }
  if (exact.size === 0 && directories.length === 0) return () => false;
  return relPath => {
    const path = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
    return exact.has(path) || directories.some(directory => path.startsWith(directory));
  };
}

/**
 * Merge `.docguardignore` patterns into a config object's `ignore` array.
 *
 * Used at config-load time so every validator sees the combined set without
 * having to know about the file. Mutates and returns the config for ergonomics.
 *
 * Idempotent — calling twice produces the same result. Skips duplicates.
 */
/**
 * One `.docguard.json` ignore-array item — a plain pattern string, or an
 * object `{ pattern, reason?, owner?, expires? }` — as a suppression entry.
 * A string reads exactly as before. Returns null for an item with no pattern.
 * @implements docguard.accountable-suppressions#FR-003
 */
export function configIgnoreEntry(item, today = utcToday()) {
  if (typeof item === 'string') return item ? { pattern: item, reason: null, owner: null, expires: null, state: 'active' } : null;
  if (!item || typeof item !== 'object' || typeof item.pattern !== 'string' || !item.pattern) return null;
  const reason = typeof item.reason === 'string' && item.reason.trim() ? item.reason.trim() : null;
  let metadataProblem = null;
  let owner = null;
  if (item.owner != null) {
    if (isOwner(item.owner)) owner = item.owner;
    else metadataProblem = `owner "${item.owner}" is not @handle, team/name or an email`;
  }
  let expires = null;
  if (item.expires != null) {
    expires = parseWaiverDate(String(item.expires));
    if (!expires) metadataProblem = `expires "${item.expires}" is not a real YYYY-MM-DD date`;
  }
  const state = metadataProblem ? 'invalid' : isExpired(expires, today) ? 'expired' : 'active';
  return { pattern: item.pattern, reason, owner, expires, state, ...(metadataProblem ? { problem: 'unreadable-metadata', metadataProblem } : {}) };
}

/** The `.docguard.json` arrays that may hold object entries. */
const OBJECT_IGNORE_KEYS = ['ignore', 'securityIgnore', 'todoIgnore'];

/**
 * Turn object entries in the config's ignore arrays into the pattern strings
 * every reader expects, keeping only those that apply today. Idempotent: an
 * array of strings is returned unchanged, so in-process callers that pass a
 * raw config and `loadConfig` agree.
 * @implements docguard.accountable-suppressions#FR-003
 * @implements docguard.accountable-suppressions#FR-004
 */
export function normalizeIgnoreConfig(config, today = utcToday()) {
  if (!config || typeof config !== 'object') return config;
  for (const key of OBJECT_IGNORE_KEYS) {
    const arr = config[key];
    if (!Array.isArray(arr) || arr.every(x => typeof x === 'string')) continue;
    config[key] = arr.map(x => configIgnoreEntry(x, today)).filter(e => e && e.state === 'active').map(e => e.pattern);
  }
  return config;
}

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

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/g;
const escapeRegex = ch => ch.replace(REGEX_SPECIAL, '\\$&');

/**
 * A gitignore bracket expression starting at `pattern[start]` (`[`), or null
 * when it never closes (the `[` is then literal). `!` or `^` first negates; a
 * `]` first is a member; `a-z` is a range; `\x` is a literal `x`. Like every
 * gitignore wildcard it never matches `/`. POSIX classes (`[[:alpha:]]`) are
 * not supported: their characters are read as members.
 */
function bracketExpression(pattern, start) {
  let i = start + 1;
  let negate = false;
  if (pattern[i] === '!' || pattern[i] === '^') { negate = true; i++; }
  let body = '';
  let first = true;
  for (; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === ']' && !first) {
      return { source: `(?:(?!/)[${negate ? '^' : ''}${body}])`, end: i };
    }
    first = false;
    if (ch === '\\' && i + 1 < pattern.length) { body += escapeRegex(pattern[++i]); continue; }
    if (ch === '-' && body && pattern[i + 1] !== ']') { body += '-'; continue; }
    body += escapeRegex(ch);
  }
  return null;
}

/**
 * Translate one ignore pattern (trailing `/` and leading `/` already removed)
 * into a regex source, gitignore-style:
 *   `*`   any characters except `/`        `?`  one character except `/`
 *   `[…]` bracket expression (above)        `\x` the literal character x
 *   `**\/` at the start or after `/`: zero or more directories
 *   any other run of `**`: any characters, `/` included (unchanged since v0.11)
 * Everything else is literal — `( ) + ^ $ | { } .` included.
 *
 * @implements docguard.ignore-reasons#FR-010
 */
function globBody(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      re += i + 1 < pattern.length ? escapeRegex(pattern[++i]) : '\\\\';
    } else if (ch === '*') {
      let j = i;
      while (pattern[j] === '*') j++;
      if (j - i === 1) {
        re += '[^/]*';
      } else if (j - i === 2 && (i === 0 || pattern[i - 1] === '/') && pattern[j] === '/') {
        re += '(?:.*/)?';
        j++; // the slash belongs to the zero-or-more-directories group
      } else {
        re += '.*';
      }
      i = j - 1;
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '[') {
      const bracket = bracketExpression(pattern, i);
      if (bracket) { re += bracket.source; i = bracket.end; } else re += '\\[';
    } else {
      re += escapeRegex(ch);
    }
  }
  return re;
}

/**
 * Convert an ignore pattern to a RegExp over project-relative POSIX paths.
 *
 * DocGuard's ignore semantics, which every `config.ignore`, `securityIgnore`,
 * `todoIgnore`, `documentLifecycle` and `.docguardignore` pattern shares:
 *   - A pattern matches at a path-segment boundary at ANY depth, and
 *     everything below what it matches (`fixtures` matches `fixtures/x` and
 *     `a/fixtures/x`). Unlike gitignore, a slash in the middle does not anchor.
 *   - A leading `/` anchors the pattern to the project root, as in gitignore.
 *   - A trailing `/` is dropped, so `dir/` also matches a file named `dir`.
 *   - Wildcards, bracket expressions and escapes as in `globBody`.
 *   - A leading `!` is a literal character: negation is not supported.
 *
 * @param {string} pattern - Glob pattern
 * @returns {RegExp}
 * @implements docguard.ignore-reasons#FR-010
 */
function globToRegex(pattern) {
  // gitignore-style trailing slash ("dir/") means "this directory and everything
  // under it". Strip it so "dir/" matches identically to "dir".
  // `|| pattern` guards the degenerate all-slashes case (e.g. "/") from emptying.
  let normalized = pattern.replace(/\/+$/, '') || pattern;
  const anchored = normalized.length > 1 && normalized.startsWith('/');
  if (anchored) normalized = normalized.replace(/^\/+/, '');
  const body = globBody(normalized);
  return anchored
    ? new RegExp(`^${body}$|^${body}/`)
    : new RegExp(`^${body}$|/${body}$|^${body}/|/${body}/`);
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
 * @param {string} pattern - Glob pattern (e.g., "backend/**\/__tests__// Back-compat internal alias — globMatch below always used the anchored form.
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
    if (isIgnoredDirEntry(entry, entries, ignoreDirs)) continue;
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
 * Enumerate the project's canonical docs — RECURSIVELY.
 *
 * Five call sites used to do this by hand with a flat
 * `readdirSync('docs-canonical').filter(f => f.endsWith('.md'))`. That works
 * only for a flat tree; a project that groups its canonical docs in subfolders
 * (`docs-canonical/01-architecture/MODULE-MAP.md` — a common convention once a
 * repo has more than a handful) was invisible to ALL of them. The failure was
 * silent and pointed the wrong way: docs-sync flagged every service as
 * undocumented while the docs sat right there, `docguard:validator … n/a`
 * markers in nested docs were ignored, and readability/freshness scored an
 * empty set. This is the single shared implementation — same rule as
 * `walkFiles`: exactly one correct way to enumerate, so the answers can't drift.
 *
 * Contract:
 *   - Recursive; delegates traversal to `walkFiles`, so `ignoreDirs` and the
 *     skip-dot-directories rule apply. A dot-FILE ending in `.md` is kept, to
 *     preserve the flat behavior these call sites had.
 *   - `.md` matching is case-INSENSITIVE. Three of the five original call sites
 *     lowercased and two did not; one tool must not hold two opinions about
 *     what a canonical doc is. The inclusive reading wins.
 *   - Sorted by relative path, so output is deterministic across platforms.
 *   - NEVER throws. An unreadable subtree yields the files that were readable.
 *
 * @param {string} projectDir - Project root (absolute)
 * @param {{dirName?: string, isIgnored?: ((relPath: string) => boolean) | null}} [opts]
 *   `isIgnored` — optional `.docguardignore` predicate from the caller (see
 *   `loadIgnorePatterns` in shared.mjs). Passed in rather than imported so this
 *   module stays a leaf with no local imports.
 * @returns {Array<{abs: string, rel: string}>} `rel` is project-relative POSIX
 */
export function listCanonicalDocs(projectDir, opts = {}) {
  const { dirName = 'docs-canonical', isIgnored = null } = opts;
  const root = resolvePath(projectDir, dirName);
  // An explicit role may live outside the conventional canonical directory.

  const isMarkdown = (name) => name.toLowerCase().endsWith('.md');
  const out = [];
  if (existsSync(root)) walkFiles(root, (abs) => {
    if (!isMarkdown(abs)) return;
    const rel = relPosix(projectDir, abs);
    if (isIgnored && isIgnored(rel)) return;
    out.push({ abs, rel });
  }, {
    // Keep dot-FILES that are markdown (old flat behavior included them);
    // dot-DIRECTORIES still get skipped, since the predicate only matches `.md`.
    keepDot: isMarkdown,
  });

  let roleConfig = opts.config;
  if (!roleConfig) {
    const configFile = resolvePath(projectDir, '.docguard.json');
    try { if (existsSync(configFile)) roleConfig = JSON.parse(readFileSync(configFile, 'utf-8')); }
    catch { /* loadConfig owns malformed configuration errors */ }
  }
  for (const role of Object.keys(roleConfig?.docs?.roles || {})) {
    const abs = resolveDocRole(projectDir, roleConfig, role);
    const rel = relPosix(projectDir, abs);
    if (!existsSync(abs) || !isMarkdown(abs) || (isIgnored && isIgnored(rel))) continue;
    if (!out.some(doc => doc.abs === abs)) out.push({ abs, rel });
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
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
