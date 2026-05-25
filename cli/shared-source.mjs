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
import { shouldIgnore } from './shared-ignore.mjs';

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
  ];
  // Vite injects these at build time; they are not user-set env vars.
  const VITE_INTRINSICS = new Set(['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR']);

  const visit = (filePath) => {
    if (seen.has(filePath)) return;
    seen.add(filePath);
    if (!CODE_EXTENSIONS.has(extname(filePath))) return;
    const rel = relative(projectDir, filePath);
    if (shouldIgnore(rel, config)) return;
    let content;
    try { content = readFileSync(filePath, 'utf-8'); } catch { return; }
    if (!content.includes('env')) return;
    // patterns[2] is the import.meta.env one — its matches are Vite-injected
    // when the name is an intrinsic, and must not be reported as user env vars.
    for (let i = 0; i < patterns.length; i++) {
      let m;
      const rx = new RegExp(patterns[i].source, 'g');
      const isViteSource = i === 2;
      while ((m = rx.exec(content)) !== null) {
        if (isViteSource && VITE_INTRINSICS.has(m[1])) continue;
        names.add(m[1]);
      }
    }
  };

  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) visit(full);
    }
  };

  for (const root of roots) walk(root);
  return names;
}
