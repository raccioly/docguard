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
 * Source discovery uses Node.js built-ins; Worker binding analysis optionally
 * loads the existing @babel/parser dependency, with a lexical fallback.
 */

import { createRequire } from 'node:module';
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
  const conventional = ['src', 'app', 'lib', 'server', 'api', 'functions', 'backend/src', 'backend', 'cli'];
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
/**
 * v0.27 (field report #7): env vars injected by the test runner / CI / cloud
 * SDK are READ in code (e.g. `if (process.env.VITEST)` as a test guard) but no
 * application documents them as config — flagging them "undocumented" is a
 * false positive. This is the env equivalent of the SYSTEM allowlist already
 * applied on the docs side in environment.mjs.
 *
 * Deliberately conservative — NODE_ENV is intentionally NOT here: this project
 * already decided NODE_ENV is legitimate app config (see environment.mjs).
 */
const RUNNER_ENV_VARS = new Set([
  'VITEST', 'CI', 'JEST_WORKER_ID', 'AWS_SESSION_TOKEN', 'AWS_EXECUTION_ENV',
]);
const RUNNER_ENV_PREFIXES = ['GITHUB_', 'RUNNER_', 'VITEST_', 'JEST_', 'CIRCLE_', 'GITLAB_CI'];

/** True when `name` is a runner/CI/SDK-injected var, not product config. */
export function isRunnerEnvVar(name) {
  if (RUNNER_ENV_VARS.has(name)) return true;
  return RUNNER_ENV_PREFIXES.some((p) => name.startsWith(p));
}


/** Wrangler is static evidence only: never load or execute project config. */
/**
 * Does the project ship an end-to-end suite? Project-type defaults are a guess;
 * a Playwright/Cypress config or an e2e test directory is direct evidence, and
 * an API that has one should not have its E2E checks silently disabled.
 */
export function hasE2ESuite(dir) {
  const files = [
    'playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs',
    'cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs', 'cypress.json',
  ];
  for (const name of files) {
    try { if (statSync(join(dir, name)).isFile()) return true; } catch { /* absent */ }
  }
  for (const name of ['e2e', join('tests', 'e2e'), join('test', 'e2e'), join('src', 'e2e')]) {
    try { if (statSync(join(dir, name)).isDirectory()) return true; } catch { /* absent */ }
  }
  return false;
}

export function hasWorkerConfig(dir) {
  return ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'].some(name => {
    try { return statSync(join(dir, name)).isFile(); } catch { return false; }
  });
}

function workerConfigForFile(projectDir, file) {
  const root = resolve(projectDir);
  let dir = dirname(file);
  while (dir === root || (!relative(root, dir).startsWith('..') && !relative(root, dir).startsWith('/'))) {
    if (hasWorkerConfig(dir)) return true;
    if (dir === root) break;
    dir = dirname(dir);
  }
  return false;
}

// Optional-load the existing parser directly: shared helpers must not depend
// on the scanner layer. No project modules or configuration are executed.
let workerParse = null;
try { workerParse = createRequire(import.meta.url)('@babel/parser').parse; } catch { /* lexical fallback */ }

function workerType(param) {
  const type = param?.typeAnnotation?.typeAnnotation;
  return type?.type === 'TSTypeReference' && type.typeName?.type === 'Identifier' ? type.typeName.name : '';
}

const WORKER_ENTRYPOINTS = new Set(['WorkerEntrypoint', 'DurableObject', 'WorkflowEntrypoint']);
const WORKER_HANDLER_KEYS = new Set(['fetch', 'scheduled', 'queue', 'email', 'tail', 'trace', 'alarm', 'test']);
const PAGES_HANDLER_RE = /^onRequest(?:Get|Post|Put|Patch|Delete|Head|Options)?$/;

/**
 * Static lexical binding analysis; collect declarations before resolving reads.
 * @implements docguard.language-repository-coverage#FR-006
 * @implements docguard.language-repository-coverage#FR-007
 */
function workerAstBindings(ast, configured) {
  const root = { parent: null, functionScope: true, bindings: new Map(), thisEnv: false };
  const reads = [];
  const exportedHandlers = new Set();
  const bind = (pattern, scope, value = false, objectSource = null) => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') scope.bindings.set(pattern.name, value);
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope, value, objectSource);
    else if (pattern.type === 'RestElement') bind(pattern.argument, scope, value, objectSource);
    else if (pattern.type === 'ArrayPattern') for (const element of pattern.elements) bind(element, scope, false);
    else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') bind(property.argument, scope, false);
        else {
          const key = property.computed ? property.key?.value : (property.key?.name || property.key?.value);
          bind(property.value, scope, objectSource === 'pages-context' && key === 'env' ? 'worker-env' : false);
        }
      }
    }
  };
  const lookup = (name, scope) => {
    while (scope) {
      if (scope.bindings.has(name)) return scope.bindings.get(name);
      scope = scope.parent;
    }
    return undefined;
  };
  const propertyName = node => node?.computed
    ? (node.property?.type === 'StringLiteral' ? node.property.value : null)
    : (node?.property?.name || null);
  const valueKind = (node, scope) => {
    if (!node) return false;
    if (node.type === 'Identifier') return lookup(node.name, scope) || false;
    if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return false;
    const property = propertyName(node);
    if (property !== 'env') return false;
    if (node.object?.type === 'Identifier' && lookup(node.object.name, scope) === 'pages-context') return 'worker-env';
    if (node.object?.type === 'ThisExpression' && scope.thisEnv) return 'worker-env';
    return false;
  };

  // Module imports and direct named exports are instantiated before execution,
  // so collect their identity before walking source-order declarations.
  for (const statement of ast.program.body || []) {
    if (statement.type === 'ImportDeclaration') {
      const trusted = statement.source?.value === 'cloudflare:workers';
      for (const specifier of statement.specifiers || []) {
        const imported = specifier.imported?.name || specifier.imported?.value;
        const kind = trusted && imported === 'env' ? 'worker-env'
          : trusted && WORKER_ENTRYPOINTS.has(imported) ? 'worker-entrypoint-class' : false;
        if (specifier.local?.name) root.bindings.set(specifier.local.name, kind);
      }
    }
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : null;
    if (declaration?.type === 'FunctionDeclaration') exportedHandlers.add(declaration);
    if (declaration?.type === 'VariableDeclaration') {
      for (const item of declaration.declarations || []) if (item.init) exportedHandlers.add(item.init);
    }
  }

  const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);
  function visit(node, scope, parent) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') bind(node.id, scope);
    if (functionTypes.has(node.type)) {
      const inheritedThis = node.type === 'ArrowFunctionExpression' ? scope.thisEnv
        : ['ClassMethod', 'ClassPrivateMethod'].includes(node.type) ? scope.thisEnv : false;
      scope = { parent: scope, functionScope: true, bindings: new Map(), thisEnv: inheritedThis };
      if (node.type === 'FunctionExpression') bind(node.id, scope);
      const key = node.key?.name || node.key?.value || node.id?.name ||
        (parent?.type === 'ObjectProperty' ? parent.key?.name || parent.key?.value : parent?.type === 'VariableDeclarator' ? parent.id?.name : '');
      const request = workerType(node.params[0]) === 'Request';
      for (const param of node.params) bind(param, scope, false);
      if (exportedHandlers.has(node) && PAGES_HANDLER_RE.test(key) && node.params[0]) {
        const target = node.params[0].type === 'AssignmentPattern' ? node.params[0].left : node.params[0];
        if (target.type === 'Identifier') bind(target, scope, 'pages-context');
        else bind(target, scope, false, 'pages-context');
      } else for (const param of node.params) {
        const target = param.type === 'AssignmentPattern' ? param.left : param;
        const typed = /^(?:Env|[\w$]*Env|[\w$]*Bindings)$/.test(workerType(target));
        const worker = target.type === 'Identifier' && target.name === 'env' &&
          ((configured && WORKER_HANDLER_KEYS.has(key)) || (typed && (configured || (key === 'fetch' && request))));
        if (worker) bind(target, scope, 'worker-env');
      }
    } else if (['BlockStatement', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'CatchClause', 'SwitchStatement', 'ClassExpression', 'ClassDeclaration', 'StaticBlock'].includes(node.type)) {
      const workerClass = ['ClassExpression', 'ClassDeclaration'].includes(node.type)
        && node.superClass?.type === 'Identifier' && lookup(node.superClass.name, scope) === 'worker-entrypoint-class';
      scope = { parent: scope, functionScope: node.type === 'StaticBlock', bindings: new Map(), thisEnv: workerClass || scope.thisEnv };
      if (node.type === 'CatchClause') bind(node.param, scope);
      if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') bind(node.id, scope);
    }
    if (node.type === 'VariableDeclaration') {
      let declarationScope = scope;
      if (node.kind === 'var') while (!declarationScope.functionScope && declarationScope.parent) declarationScope = declarationScope.parent;
      for (const declaration of node.declarations) {
        const kind = valueKind(declaration.init, scope);
        bind(declaration.id, declarationScope, kind, kind);
      }
    }
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) if (!scope.bindings.has(spec.local?.name)) bind(spec.local, scope);
    }
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      const name = propertyName(node);
      if (name) reads.push({ scope, name, object: node.object });
    }
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(child)) for (const item of child) visit(item, scope, node);
      else if (child && typeof child === 'object') visit(child, scope, node);
    }
  }
  visit(ast.program, root, null);
  return new Set(reads.filter(read => valueKind(read.object, read.scope) === 'worker-env').map(read => read.name));
}

/** Optional parser argument makes the absent/failed-parser contract testable. */
export function extractWorkerEnvBindings(content, filename = 'file.ts', configured = false, parse = workerParse) {
  if (parse) {
    try {
      const plugins = ['decorators-legacy', 'classProperties', 'topLevelAwait'];
      if (/\.[cm]?tsx?$/.test(filename)) plugins.push('typescript');
      if (/\.[jt]sx?$/.test(filename) && !filename.endsWith('.ts')) plugins.push('jsx');
      const ast = parse(content, { sourceType: 'unambiguous', allowReturnOutsideFunction: true, plugins });
      return workerAstBindings(ast, configured);
    } catch { /* Failed parsing retains conservative lexical evidence. */ }
  }
  const result = workerEnvUsageFallback(content, classifyChars(content, extname(filename)), configured);
  const fallbackOnly = [];
  if (/cloudflare:workers/.test(content) && /\bimport\s*\{[^}]*\benv\b/.test(content)) fallbackOnly.push('worker-imported-env-needs-ast');
  if (/\bonRequest(?:Get|Post|Put|Patch|Delete|Head|Options)?\b/.test(content) && /\bcontext\s*\.\s*env\b/.test(content)) fallbackOnly.push('pages-context-needs-ast');
  if (/\bextends\s+(?:WorkerEntrypoint|DurableObject|WorkflowEntrypoint)\b/.test(content) && /\bthis\s*\.\s*env\b/.test(content)) fallbackOnly.push('worker-class-env-needs-ast');
  result.limitations = fallbackOnly;
  return result;
}

// Resolve binding positions in simple lexical patterns, not property names.
// Defaults may refer to env without introducing a new local env binding.
function lexicalEnvBinding(pattern) {
  const split = (text, delimiter) => {
    const parts = []; let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
      if ('([{'.includes(text[i])) depth++;
      else if (')]}'.includes(text[i])) depth--;
      else if (text[i] === delimiter && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    return [...parts, text.slice(start)];
  };
  const binding = text => {
    text = split(text.trim().replace(/^\.\.\./, ''), '=')[0].trim();
    if (text.startsWith('{') && text.endsWith('}')) {
      return split(text.slice(1, -1), ',').some(property => {
        const pair = split(property, ':');
        return binding(pair.length > 1 ? pair.slice(1).join(':') : property);
      });
    }
    if (text.startsWith('[') && text.endsWith(']')) return split(text.slice(1, -1), ',').some(binding);
    return /^env\s*(?::[^]*)?$/.test(text);
  };
  return split(pattern, ',').some(binding);
}

/** Conservative, parser-independent support for ordinary typed function bodies. */
function workerEnvUsageFallback(content, kind, configured) {
  // Mask regex literals where an expression may start. Division remains code.
  for (let i = 0; i < content.length; i++) {
    if (kind[i] || content[i] !== '/') continue;
    const prefix = content.slice(0, i).trimEnd();
    if (prefix && !/[=(:,[!&|?{};]$/.test(prefix) && !/(?:\b(?:return|throw|yield|case)|=>)$/.test(prefix)) continue;
    let end = i + 1, bracket = false;
    for (; end < content.length && content[end] !== '\n'; end++) {
      if (content[end] === '\\') { end++; continue; }
      if (content[end] === '[') bracket = true;
      if (content[end] === ']') bracket = false;
      if (content[end] === '/' && !bracket) break;
    }
    if (content[end] === '/') { kind.fill(1, i, end + 1); i = end; }
  }
  const code = content.split('').map((ch, i) => kind[i] === 0 ? ch : (ch === '\n' ? '\n' : ' ')).join('');
  const braces = new Map(), parens = new Map();
  const stack = [], parentheses = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') stack.push(i);
    else if (code[i] === '}' && stack.length) braces.set(stack.pop(), i);
    else if (code[i] === '(') parentheses.push(i);
    else if (code[i] === ')' && parentheses.length) parens.set(parentheses.pop(), i);
  }
  const scopes = [], functionScopes = [], loops = [];
  const functions = /\(([^()]*)\)\s*(?::\s*[\w$.[\]<>| ,]+)?\s*(?:=>\s*)?\{/g;
  for (const match of code.matchAll(functions)) {
    const prefix = code.slice(Math.max(0, match.index - 80), match.index);
    if (/\b(?:if|for|while|switch|with)\s*$/.test(prefix)) continue;
    const start = match.index + match[0].length - 1, end = braces.get(start);
    if (end === undefined) continue;
    const scope = { start, end };
    if (!/\bcatch\s*$/.test(prefix)) functionScopes.push(scope);
    const params = match[1];
    if (!lexicalEnvBinding(params)) continue;
    const typed = /(?:^|,)\s*env\s*:\s*(?:Env|[\w$]*Env|[\w$]*Bindings)\s*(?=,|$)/.test(params);
    const fetch = /\bfetch\s*(?::|=)?\s*$/.test(prefix);
    const request = /^\s*[\w$]+\s*:\s*Request\s*,/.test(params);
    scopes.push({ ...scope, binding: typed && (configured || (fetch && request)) });
  }
  for (const match of code.matchAll(/(?:\(\s*env\s*\)|\benv)\s*=>\s*/g)) {
    const start = match.index + match[0].length;
    let end = braces.get(start);
    if (end === undefined) {
      end = start; let depth = 0;
      for (; end < code.length; end++) {
        const ch = code[end];
        if (depth === 0 && /[,;\n)}\]]/.test(ch)) break;
        if ('({['.includes(ch)) depth++;
        else if (')}]'.includes(ch)) depth--;
      }
    }
    scopes.push({ start: start - 1, end, binding: false });
  }
  for (const match of code.matchAll(/\bfor\s*(?:await\s*)?\(/g)) {
    const open = match.index + match[0].length - 1, close = parens.get(open);
    if (close === undefined) continue;
    let body = close + 1;
    while (/\s/.test(code[body] || '') && body < code.length) body++;
    const end = braces.get(body) ?? code.indexOf(';', body);
    if (end >= 0) loops.push({ start: match.index, end, headerEnd: close });
  }
  for (const match of code.matchAll(/\b(const|let|var)\s+(env\b|\{[^;]*?\}|\[[^;]*?\])/g)) {
    if (!lexicalEnvBinding(match[2])) continue;
    let scope;
    if (match[1] === 'var') {
      scope = functionScopes.filter(s => s.start < match.index && match.index < s.end).sort((a, b) => b.start - a.start)[0];
    } else {
      scope = loops.find(s => s.start < match.index && match.index < s.headerEnd);
      if (!scope) scope = [...braces].filter(([start, end]) => start < match.index && match.index < end)
        .sort(([a], [b]) => b - a).map(([start, end]) => ({ start, end }))[0];
    }
    scopes.push({ ...(scope || { start: -1, end: code.length }), binding: false });
  }
  const names = new Set();
  const access = /\benv\s*(?:(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)|(?:\?\.)?\s*\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\])/g;
  for (const match of content.matchAll(access)) {
    if (kind[match.index] !== 0) continue;
    if (/[\w$]$/.test(code.slice(0, match.index)) || /[.?]$/.test(code.slice(0, match.index).trimEnd())) continue;
    const scope = scopes.filter(s => s.start < match.index && match.index < s.end)
      .sort((a, b) => b.start - a.start || Number(a.binding) - Number(b.binding))[0];
    if (scope?.binding) names.add(match[1] || match[2]);
  }
  return names;
}

export function grepEnvUsage(projectDir, config = {}) {
  const names = new Set();
  names.limitations = [];
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
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extname(filePath))) {
      const workerBindings = extractWorkerEnvBindings(content, filePath, workerConfigForFile(projectDir, filePath));
      for (const name of workerBindings) names.add(name);
      for (const limitation of workerBindings.limitations || []) names.limitations.push({ code: limitation, file: rel.replace(/\\/g, '/') });
    }
    // patterns[2] is the import.meta.env one — its matches are Vite-injected
    // when the name is an intrinsic, and must not be reported as user env vars.
    for (let i = 0; i < patterns.length; i++) {
      let m;
      const rx = new RegExp(patterns[i].source, 'g');
      const isViteSource = i === 2;
      while ((m = rx.exec(content)) !== null) {
        if (kind[m.index] !== 0) continue; // keyword inside a string/comment → a mention, not a read
        if (isViteSource && VITE_INTRINSICS.has(m[1])) continue;
        if (isRunnerEnvVar(m[1])) continue; // v0.27 (#7): runner/CI/SDK var, not product config
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
        if (km[1].length >= 3 && !VITE_INTRINSICS.has(km[1]) && !isRunnerEnvVar(km[1])) names.add(km[1]);
      }
      // convict: the env var name is the `env:` property value, not the key.
      const convictRe = /\benv\s*:\s*['"]([A-Z][A-Z0-9_]*[A-Z0-9])['"]/g;
      while ((km = convictRe.exec(content)) !== null) {
        if (km[1].length >= 3 && !isRunnerEnvVar(km[1])) names.add(km[1]);
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
