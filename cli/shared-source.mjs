/**
 * Shared Source Resolution — Monorepo-aware source discovery.
 *
 * Single source of truth for "where is the code?" so validators and
 * scanners stop assuming a single package rooted at projectDir.
 *
 * Honors:
 *   - config.sourceRoot           (string | string[], e.g. "backend/src")
 *   - root package.json workspaces ("packages/*", { packages: [...] })
 *   - pnpm-workspace.yaml          (packages:)
 *   - turbo.json                   (presence → trust package.json workspaces)
 *
 * Zero NPM dependencies — pure Node.js built-ins only.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname, relative, extname } from 'node:path';
import { shouldIgnore, isNonProductDir, isNonProductPath } from './shared-ignore.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor', '.turbo',
  'cdk.out',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.rb', '.php',
]);

/** Normalize config.sourceRoot into an array of relative paths. */
function sourceRootList(config) {
  const sr = config?.sourceRoot;
  if (!sr) return [];
  return Array.isArray(sr) ? sr : [sr];
}

function safeReadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

/**
 * Files DocGuard reads WHOLE and regex/AST-scans. A bundle, minified vendor
 * file, or generated client checked into source is slow to read, hostile to
 * regex, expensive to AST-parse, and is never the project's authored truth.
 * 1.5 MB sits far above any hand-written module yet below typical bundles.
 */
export const MAX_SCAN_BYTES = 1_500_000;

/** True for build artifacts / minified / generated / declaration files. */
export function isGeneratedPath(p) {
  const b = String(p);
  return /\.min\.[cm]?js$/i.test(b)
      || /\.(bundle|chunk)\.[cm]?jsx?$/i.test(b)
      || /[.-]generated\.[a-z0-9]+$/i.test(b)
      || /\.d\.ts$/i.test(b);
}

/**
 * Read a source file for scanning, or return null when it should be skipped:
 * unreadable, a generated/minified artifact, or larger than `maxBytes`. This is
 * the single guard that keeps every scanner from choking on a checked-in
 * bundle. Skipping is logged by callers that care (most just see "no match").
 */
export function readScannable(absPath, { maxBytes = MAX_SCAN_BYTES } = {}) {
  try {
    if (isGeneratedPath(absPath)) return null;
    if (statSync(absPath).size > maxBytes) return null;
    return readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Expand a workspace glob (e.g. "packages/*") into concrete directories
 * that contain a package.json. Only the trailing single-level "/*" glob is
 * expanded — explicit paths are returned as-is when they exist.
 */
function expandWorkspaceGlob(projectDir, pattern) {
  const dirs = [];
  if (pattern.endsWith('/*')) {
    const base = resolve(projectDir, pattern.slice(0, -2));
    if (existsSync(base)) {
      let entries;
      try { entries = readdirSync(base, { withFileTypes: true }); } catch { return dirs; }
      for (const e of entries) {
        if (!e.isDirectory() || IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const full = join(base, e.name);
        if (existsSync(join(full, 'package.json'))) dirs.push(full);
      }
    }
  } else {
    const full = resolve(projectDir, pattern);
    if (existsSync(full)) dirs.push(full);
  }
  return dirs;
}

/**
 * Discover workspace package directories declared in the monorepo manifests.
 * @returns {string[]} absolute directories
 */
export function getWorkspaceDirs(projectDir) {
  const patterns = [];

  // 1. root package.json "workspaces"
  const rootPkg = safeReadJson(resolve(projectDir, 'package.json'));
  if (rootPkg?.workspaces) {
    const ws = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : (rootPkg.workspaces.packages || []);
    patterns.push(...ws);
  }

  // 2. pnpm-workspace.yaml — extract simple "  - 'packages/*'" entries
  const pnpmPath = resolve(projectDir, 'pnpm-workspace.yaml');
  if (existsSync(pnpmPath)) {
    const content = readFileSync(pnpmPath, 'utf-8');
    const re = /^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm;
    let m;
    let inPackages = false;
    for (const line of content.split('\n')) {
      if (/^packages:/.test(line.trim())) { inPackages = true; continue; }
      if (inPackages) {
        const mm = line.match(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/);
        if (mm) patterns.push(mm[1]);
        else if (line.trim() && !line.startsWith(' ')) inPackages = false;
      }
    }
    void re; void m;
  }

  const dirs = new Set();
  for (const p of patterns) {
    for (const d of expandWorkspaceGlob(projectDir, p)) dirs.add(d);
  }
  return [...dirs];
}

/** Walk up from a directory to find the nearest enclosing package.json dir. */
function nearestPackageDir(projectDir, startDir) {
  let cur = startDir;
  const root = resolve(projectDir);
  while (cur && cur.startsWith(root)) {
    if (existsSync(join(cur, 'package.json'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * Resolve the set of directories that should be treated as source roots
 * for scanning (routes, env usage, source files).
 *
 * Precedence: explicit config.sourceRoot → workspace packages → conventional
 * roots that exist on disk. projectDir is always included as a fallback so
 * single-package repos keep working.
 *
 * @returns {string[]} absolute directories, de-duplicated, existing only
 */
export function resolveSourceRoots(projectDir, config = {}) {
  const out = new Set();
  const add = (abs) => { if (abs && existsSync(abs)) out.add(abs); };

  // 1. explicit sourceRoot(s)
  for (const sr of sourceRootList(config)) add(resolve(projectDir, sr));

  // 2. workspace package dirs
  for (const d of getWorkspaceDirs(projectDir)) add(d);

  // 3. conventional roots (only those that exist)
  const conventional = ['src', 'app', 'lib', 'server', 'api', 'backend/src', 'backend', 'cli'];
  for (const cr of conventional) add(resolve(projectDir, cr));

  // 4. Fall back to the project root ONLY when nothing else resolved. Adding it
  // unconditionally would pull in examples/, scripts/, and fixtures, producing
  // false "in code" signals for env vars and routes.
  if (out.size === 0) out.add(resolve(projectDir));

  return [...out];
}

/**
 * Collect every relevant package.json across the monorepo:
 * root, the nearest package for each declared sourceRoot, and workspace packages.
 * @returns {Array<{ dir: string, pkg: object }>}
 */
export function collectPackageJsons(projectDir, config = {}) {
  const dirs = new Set([resolve(projectDir)]);

  for (const sr of sourceRootList(config)) {
    const npd = nearestPackageDir(projectDir, resolve(projectDir, sr));
    if (npd) dirs.add(npd);
  }
  for (const d of getWorkspaceDirs(projectDir)) dirs.add(d);

  const result = [];
  for (const dir of dirs) {
    const pkg = safeReadJson(join(dir, 'package.json'));
    if (pkg) result.push({ dir, pkg });
  }
  return result;
}

/** Detect whether the project ships a Docker setup. */
export function detectDocker(projectDir, config = {}) {
  const candidates = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'];
  const root = resolve(projectDir);
  const dirs = new Set([root]);

  // Walk every ancestor from each sourceRoot up to the project root — a
  // Dockerfile commonly sits at the package root (e.g. backend/Dockerfile).
  for (const sr of sourceRootList(config)) {
    let cur = resolve(projectDir, sr);
    while (cur && cur.startsWith(root)) {
      dirs.add(cur);
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  for (const d of getWorkspaceDirs(projectDir)) dirs.add(d);

  for (const dir of dirs) {
    for (const f of candidates) {
      if (existsSync(join(dir, f))) return true;
    }
  }
  return false;
}

const HASH_COMMENT_EXTS = new Set(['.py', '.rb', '.php', '.sh']);
const SLASH_COMMENT_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.go', '.rs', '.java', '.php', '.kt', '.scala']);

/**
 * Classify every character of `content` as code (0), string-literal (1), or
 * comment (2) with a single-pass, dependency-free lexer. Used by env detection
 * (Bug #7) so a variable is counted only when actually READ in code — not when
 * merely mentioned inside a string literal (e.g. a detection signature like
 * `r"os.environ.get('JWT_SECRET')"`) or a comment. Handles ' " ` quotes,
 * Python triple-quotes, `#` and `//` line comments, and `/_ _/` block comments.
 * Best-effort: on an unterminated single-line string it bails at the newline so
 * it never swallows the rest of the file (errs toward marking code, so a real
 * read is never dropped).
 */
function classifyChars(content, ext) {
  const n = content.length;
  const kind = new Uint8Array(n); // 0 = code, 1 = string, 2 = comment
  const hashC = HASH_COMMENT_EXTS.has(ext);
  const slashC = SLASH_COMMENT_EXTS.has(ext);
  const triple = ext === '.py';
  let i = 0;
  while (i < n) {
    const ch = content[i];
    if (hashC && ch === '#') { while (i < n && content[i] !== '\n') kind[i++] = 2; continue; }
    if (slashC && ch === '/' && content[i + 1] === '/') { while (i < n && content[i] !== '\n') kind[i++] = 2; continue; }
    if (slashC && ch === '/' && content[i + 1] === '*') {
      kind[i++] = 2; if (i < n) kind[i++] = 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) kind[i++] = 2;
      if (i < n) { kind[i++] = 2; if (i < n) kind[i++] = 2; }
      continue;
    }
    if (triple && (ch === '"' || ch === "'") && content[i + 1] === ch && content[i + 2] === ch) {
      const q = ch;
      kind[i++] = 1; kind[i++] = 1; kind[i++] = 1;
      while (i < n && !(content[i] === q && content[i + 1] === q && content[i + 2] === q)) {
        if (content[i] === '\\') { kind[i++] = 1; if (i < n) kind[i++] = 1; continue; }
        kind[i++] = 1;
      }
      if (i < n) { kind[i++] = 1; if (i < n) kind[i++] = 1; if (i < n) kind[i++] = 1; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      kind[i++] = 1; // opening quote
      while (i < n && content[i] !== q) {
        if (content[i] === '\\') { kind[i++] = 1; if (i < n) kind[i++] = 1; continue; }
        if (content[i] === '\n' && q !== '`') break; // unterminated single-line string — bail
        kind[i++] = 1;
      }
      if (i < n && content[i] === q) kind[i++] = 1; // closing quote
      continue;
    }
    kind[i++] = 0;
  }
  return kind;
}

/**
 * Grep source files under the resolved source roots for environment variable
 * usage in both the Node (process dot env) and Vite (import meta env) styles,
 * including bracket access.
 * @returns {Set<string>} variable names referenced in code
 */
export function grepEnvUsage(projectDir, config = {}) {
  const names = new Set();
  const roots = resolveSourceRoots(projectDir, config);
  const seen = new Set();

  // Require names to start with a letter and END with a letter/digit (NOT an
  // underscore) — fixes "VITE_" being captured as a literal env var name.
  const NAME = '([A-Z][A-Z0-9_]*[A-Z0-9])';
  const patterns = [
    new RegExp(`process\\.env\\.${NAME}`, 'g'),
    new RegExp(`process\\.env\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
    new RegExp(`import\\.meta\\.env\\.${NAME}`, 'g'),
    // Python: `os.environ["X"]`, `os.environ.get("X")`, `os.getenv("X")`. The
    // `explain` command and ENVIRONMENT.md templates have always told users
    // these forms are scanned, but the implementation only handled JS. On a
    // Python project this caused every documented env var to be reported as
    // "in docs, not in code" — a silent 0% accuracy. Patterns cover bracket
    // access, .get(), and the standalone os.getenv() function.
    new RegExp(`os\\.environ\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
    new RegExp(`os\\.environ\\.get\\s*\\(\\s*['"]${NAME}['"]`, 'g'),
    new RegExp(`os\\.getenv\\s*\\(\\s*['"]${NAME}['"]`, 'g'),
  ];
  // Vite injects these at build time; they are not user-set env vars.
  const VITE_INTRINSICS = new Set(['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR']);

  const visit = (filePath) => {
    if (seen.has(filePath)) return;
    seen.add(filePath);
    if (!CODE_EXTENSIONS.has(extname(filePath))) return;
    const rel = relative(projectDir, filePath);
    if (shouldIgnore(rel, config)) return;
    // v0.26 (Bug #7): a token that appears only in a test/fixture file is not a
    // product env read. Skip non-product paths by default (no .docguardignore).
    if (isNonProductPath(rel.replace(/\\/g, '/'), config)) return;
    const content = readScannable(filePath);
    if (content === null) return; // unreadable, generated, or too large to scan
    if (!content.includes('env')) return;
    // v0.26 (Bug #7): classify chars so we count env vars actually READ in code,
    // not ones MENTIONED inside a string literal (a detection signature like
    // `r"os.environ.get('JWT_SECRET')"`) or a comment. We test the position of
    // the access KEYWORD (process/os/import) — for a real read the keyword is
    // code while only the argument 'X' is a string, so the name is still caught.
    const kind = classifyChars(content, extname(filePath));
    // patterns[2] is the import.meta.env one — its matches are Vite-injected
    // when the name is an intrinsic, and must not be reported as user env vars.
    for (let i = 0; i < patterns.length; i++) {
      let m;
      const rx = new RegExp(patterns[i].source, 'g');
      const isViteSource = i === 2;
      while ((m = rx.exec(content)) !== null) {
        if (kind[m.index] !== 0) continue; // keyword inside a string/comment → a mention, not a read
        if (isViteSource && VITE_INTRINSICS.has(m[1])) continue;
        names.add(m[1]);
      }
    }

    // v0.24: env vars are increasingly declared in a validation schema
    // (Zod / envalid / convict) and read via a typed `config` object instead of
    // `process.env.X` — so the direct-access patterns above miss them and every
    // documented var looked "missing from code" (field report). Only harvest
    // when the file actually validates process.env through such a schema.
    const validatesEnv =
      /(?:safeParse|parse)\s*\(\s*process\.env\b/.test(content) || // zod: schema.parse(process.env)
      /\bcleanEnv\s*\(\s*process\.env\b/.test(content) ||          // envalid
      /\bconvict\s*\(/.test(content);                              // convict
    if (validatesEnv) {
      let km;
      // Zod / envalid: the schema KEYS are the env var names. Data schemas use
      // camelCase keys, so requiring UPPER_SNAKE keeps this env-specific.
      const keyRe = /^\s*['"]?([A-Z][A-Z0-9_]*[A-Z0-9])['"]?\s*:/gm;
      while ((km = keyRe.exec(content)) !== null) {
        if (km[1].length >= 3 && !VITE_INTRINSICS.has(km[1])) names.add(km[1]);
      }
      // convict: the env var name is the `env:` property value, not the key.
      const convictRe = /\benv\s*:\s*['"]([A-Z][A-Z0-9_]*[A-Z0-9])['"]/g;
      while ((km = convictRe.exec(content)) !== null) {
        if (km[1].length >= 3) names.add(km[1]);
      }
    }
  };

  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      if (e.isDirectory() && isNonProductDir(e.name, config)) continue; // v0.26: skip test/fixture dirs in env detection
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) visit(full);
    }
  };

  // v0.14-P2: when config.changedFiles is populated (by --changed-only),
  // restrict the scan to ONLY those paths. Skips the recursive tree walk
  // entirely — turns "scan 5000 files" into "scan 3 files" in pre-commit mode.
  if (Array.isArray(config.changedFiles) && config.changedFiles.length > 0) {
    for (const rel of config.changedFiles) {
      visit(resolve(projectDir, rel));
    }
    return names;
  }

  for (const root of roots) walk(root);
  return names;
}
