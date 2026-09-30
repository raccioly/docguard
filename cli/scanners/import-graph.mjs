/**
 * Static import graph of a project's JS/TS and Python sources.
 *
 * Moved out of the Architecture validator (specs/035-code-derived-diagrams)
 * so the code-derived module diagram, `impact` and the validator share one
 * builder without a scanner or command importing a validator
 * (Constitution IV).
 *
 * @implements docguard.code-derived-diagrams#FR-001
 * @implements docguard.code-derived-diagrams#FR-008
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, extname, relative, dirname } from 'node:path';
import { shouldIgnore, isNonProductPath, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { getWorkspaceDirs } from '../shared-source.mjs';
import { extractPythonFiles } from './py-ast.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'templates', 'configs', 'Research', 'docs-canonical', 'docs-implementation',
]);

export const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']);

// ── Import Graph Builder ────────────────────────────────────────────────────

/**
 * Build the project's repository-local JS/TS and Python static import graph.
 * Exported for reuse by `impact`
 * (indirect code→doc analysis walks this graph's reverse edges) — one graph
 * builder, not two.
 *
 * @implements docguard.language-repository-coverage#FR-002
 * @implements docguard.language-repository-coverage#FR-003
 * @implements docguard.language-repository-coverage#FR-004
 * @implements docguard.language-repository-coverage#FR-005
 * @returns {{files: string[], edges: {from,to,dynamic,language}[], fileMap: Map<string,string[]>, unsupportedFiles: string[], limitations: object[]}}
 */
export function buildImportGraph(projectDir, config) {
  const allFiles = getFilesRecursive(projectDir, config, projectDir);
  const key = graphCacheKey(projectDir, config);
  const signature = key && treeSignature(allFiles);
  if (signature) {
    const cached = _graphCache.get(key);
    if (cached?.signature === signature) return cached.graph;
  }
  const graph = buildUncached(projectDir, config, allFiles);
  if (signature) {
    _graphCache.delete(key);
    while (_graphCache.size >= MAX_CACHED_GRAPHS) _graphCache.delete(_graphCache.keys().next().value);
    _graphCache.set(key, { signature, graph });
  }
  return graph;
}

// One graph per guard run (docguard.code-derived-diagrams#FR-008): the
// Architecture validator and the module-graph section both need it, and a build
// costs 150–300 ms on this repository. The cache is per process, so a
// long-lived MCP server must not serve a stale graph: every call re-walks the
// tree and compares each file's path, size, inode and times, which costs a
// few milliseconds. Callers treat the returned graph as read-only.
const _graphCache = new Map();
const MAX_CACHED_GRAPHS = 8;

/** Drop cached graphs (tests, `watch`). */
export function clearImportGraphCache() {
  _graphCache.clear();
}

/** How many graphs are cached: lets a test prove a graph was never built. */
export function cachedImportGraphCount() {
  return _graphCache.size;
}

function graphCacheKey(projectDir, config) {
  try {
    const { changedFiles, diskCache, ...rest } = config || {};
    return JSON.stringify([resolve(projectDir), stableJson(rest)]);
  } catch { return null; }
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Non-JSON configuration');
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stableJson(value[k])]));
  }
  if (typeof value === 'function' || typeof value === 'symbol') throw new Error('Non-JSON configuration');
  return value;
}

function treeSignature(files) {
  try {
    const hash = createHash('sha256');
    for (const file of files) {
      const st = statSync(file);
      hash.update(`${file}\0${st.size}\0${st.ino}\0${st.mtimeMs}\0${st.ctimeMs}\n`);
    }
    return hash.digest('hex');
  } catch { return null; }
}

function buildUncached(projectDir, config, allFiles) {
  const graph = { files: [], edges: [], fileMap: new Map(), unsupportedFiles: [], limitations: [] };

  const pythonFiles = allFiles
    .filter(f => extname(f) === '.py' && !isNonProductPath(relative(projectDir, f).replace(/\\/g, '/'), config))
    .filter(f => !(config && shouldIgnore(relative(projectDir, f), config)));
  const codeFiles = allFiles.filter(f => JS_EXTENSIONS.has(extname(f)));

  for (const file of codeFiles) {
    const relPath = relative(projectDir, file);

    // Skip files in ignored directories (config.ignore)
    if (config && shouldIgnore(relPath, config)) continue;

    graph.files.push(relPath);

    try {
      const content = readFileSync(file, 'utf-8');
      const imports = extractImports(content);

      const resolvedImports = [];
      for (const imp of imports) {
        if (!imp.spec.startsWith('.') && !imp.spec.startsWith('/')) continue;

        // Resolve relative imports
        const fromDir = dirname(file);
        const resolved = resolveImport(fromDir, imp.spec, projectDir);
        if (resolved) {
          graph.edges.push({ from: relPath, to: resolved, dynamic: imp.dynamic, language: 'javascript' });
          // v0.28 (field report #2): a dynamic `await import()` does NOT create a
          // load-time edge — it's the canonical way to BREAK an import cycle. So
          // it's excluded from the cycle-detection adjacency (fileMap) while still
          // recorded in graph.edges for layer-boundary checks (an import is still
          // an import for layering).
          if (!imp.dynamic) resolvedImports.push(resolved);
        }
      }

      graph.fileMap.set(relPath, resolvedImports);
    } catch {
      // An unreadable file's imports are unknown, so the graph is incomplete.
      graph.limitations.push({ code: 'source-unreadable', file: posixPath(relPath) });
    }
  }

  addPythonImportGraph(projectDir, config || {}, pythonFiles, graph);

  return graph;
}

export function posixPath(path) {
  return path.replace(/\\/g, '/');
}

function pythonImportRoots(projectDir, config, pythonFiles) {
  const candidates = [];
  const add = (path, priority) => {
    const absolute = resolve(path);
    if (!existsSync(absolute) || candidates.some(item => item.path === absolute)) return;
    if (!pythonFiles.some(file => file === absolute || !relative(absolute, file).startsWith('..'))) return;
    candidates.push({ path: absolute, priority });
  };
  const configured = config.sourceRoot ? (Array.isArray(config.sourceRoot) ? config.sourceRoot : [config.sourceRoot]) : [];
  for (const root of configured) {
    const absolute = resolve(projectDir, root);
    if (existsSync(join(absolute, 'src'))) add(join(absolute, 'src'), 0);
    add(absolute, 1);
    if (existsSync(join(absolute, '__init__.py'))) add(dirname(absolute), 2);
  }
  for (const workspace of getWorkspaceDirs(projectDir)) {
    if (existsSync(join(workspace, 'src'))) add(join(workspace, 'src'), 3);
    add(workspace, 4);
  }
  if (existsSync(join(projectDir, 'src'))) add(join(projectDir, 'src'), 5);
  add(projectDir, 6);
  return candidates.sort((a, b) => a.priority - b.priority || b.path.length - a.path.length);
}

function pythonModuleForFile(file, roots) {
  const containing = roots.filter(root => {
    const rel = relative(root.path, file);
    return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');
  });
  if (containing.length === 0) return null;
  const selected = containing[0];
  const rel = posixPath(relative(selected.path, file));
  const parts = rel.replace(/\.py$/, '').split('/');
  const isPackage = parts.at(-1) === '__init__';
  if (isPackage) parts.pop();
  if (parts.length === 0) return null;
  let cursor = selected.path;
  let namespace = false;
  const packageParts = isPackage ? parts : parts.slice(0, -1);
  for (const part of packageParts) {
    cursor = join(cursor, part);
    if (!existsSync(join(cursor, '__init__.py'))) namespace = true;
  }
  return { name: parts.join('.'), packageName: (isPackage ? parts : parts.slice(0, -1)).join('.'), namespace, root: selected.path };
}

function pythonImportCandidates(imp, owner) {
  let base = imp.module || '';
  if (imp.level > 0) {
    const pkg = owner.packageName ? owner.packageName.split('.') : [];
    const remove = imp.level - 1;
    if (remove >= pkg.length && !(remove === 0 && pkg.length > 0)) return { candidates: [], outside: true };
    const prefix = pkg.slice(0, pkg.length - remove);
    base = [...prefix, ...(base ? base.split('.') : [])].join('.');
  }
  if (imp.kind === 'import') return { candidates: base ? [base] : [], outside: false };
  const names = Array.isArray(imp.names) ? imp.names.filter(name => name && name !== '*') : [];
  if (names.length === 0) return { candidates: base ? [base] : [], outside: false };
  return { candidates: names.map(name => [base, name].filter(Boolean).join('.')), fallback: base || null, outside: false };
}

function addPythonImportGraph(projectDir, config, pythonFiles, graph) {
  if (pythonFiles.length === 0) return;
  const extracted = extractPythonFiles(pythonFiles);
  if (extracted === null) {
    graph.unsupportedFiles.push(...pythonFiles.map(file => posixPath(relative(projectDir, file))));
    graph.limitations.push({ code: 'python-interpreter-unavailable', files: graph.unsupportedFiles.length });
    return;
  }
  const roots = pythonImportRoots(projectDir, config, pythonFiles);
  const moduleByFile = new Map();
  const modules = new Map();
  for (const file of pythonFiles) {
    const owner = pythonModuleForFile(file, roots);
    if (!owner) continue;
    moduleByFile.set(file, owner);
    if (!modules.has(owner.name)) modules.set(owner.name, []);
    modules.get(owner.name).push({ file, ...owner });
  }

  for (const file of pythonFiles) {
    const relPath = posixPath(relative(projectDir, file));
    const parsed = extracted[file];
    const owner = moduleByFile.get(file);
    if (!parsed?.ok || !owner) {
      graph.unsupportedFiles.push(relPath);
      graph.limitations.push({ code: 'python-parse-failed', file: relPath });
      continue;
    }
    graph.files.push(relPath);
    const resolvedImports = [];
    if (parsed.dynamicImports) graph.limitations.push({ code: 'python-dynamic-import', file: relPath });
    if (parsed.pathMutation) graph.limitations.push({ code: 'python-path-mutation', file: relPath });
    for (const imp of parsed.imports || []) {
      const request = pythonImportCandidates(imp, owner);
      if (request.outside) {
        graph.limitations.push({ code: 'python-relative-outside-package', file: relPath });
        continue;
      }
      const selected = [];
      for (const candidate of request.candidates) {
        const matches = modules.get(candidate) || [];
        if (matches.length > 1) {
          graph.limitations.push({ code: 'python-ambiguous-module', file: relPath, module: candidate });
        } else if (matches.length === 1) {
          selected.push(matches[0]);
        }
      }
      if (selected.length === 0 && request.fallback) {
        const matches = modules.get(request.fallback) || [];
        if (matches.length > 1) graph.limitations.push({ code: 'python-ambiguous-module', file: relPath, module: request.fallback });
        else if (matches.length === 1) selected.push(matches[0]);
      }
      for (const target of selected) {
        const to = posixPath(relative(projectDir, target.file));
        if (to === relPath || resolvedImports.includes(to)) continue;
        graph.edges.push({ from: relPath, to, dynamic: false, language: 'python' });
        resolvedImports.push(to);
      }
    }
    graph.fileMap.set(relPath, resolvedImports);
  }
}

/**
 * Extract a file's imports as `{ spec, dynamic }`. `dynamic:true` marks a
 * runtime `import('…')` — which does NOT create a load-time dependency edge and
 * is the canonical way to break an import cycle (field report #2). ES `import …
 * from` and CommonJS `require()` are load-time (static).
 */
export function extractImports(content) {
  const imports = [];

  // ES module imports (static, load-time). `import\s+` requires whitespace after
  // `import`, so it never matches a dynamic `import(` call.
  const esImportRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = esImportRegex.exec(content)) !== null) {
    imports.push({ spec: match[1], dynamic: false });
  }

  // Dynamic imports (runtime — NOT a load-time cycle edge)
  const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicRegex.exec(content)) !== null) {
    imports.push({ spec: match[1], dynamic: true });
  }

  // CommonJS require (static, load-time)
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push({ spec: match[1], dynamic: false });
  }

  return imports;
}

function resolveImport(fromDir, importPath, projectDir) {
  // Try to resolve the import to an actual file
  const extensions = ['.ts', '.tsx', '.js', '.mjs', '.jsx', '.cjs'];
  const basePath = resolve(fromDir, importPath);

  // Direct file match
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) {
      return relative(projectDir, candidate);
    }
  }

  // Exact match (has extension already)
  if (existsSync(basePath)) {
    return relative(projectDir, basePath);
  }

  // Index file match
  for (const ext of extensions) {
    const candidate = join(basePath, `index${ext}`);
    if (existsSync(candidate)) {
      return relative(projectDir, candidate);
    }
  }

  return null;
}

// ── Utilities ───────────────────────────────────────────────────────────────

// v0.29 consolidation: traversal delegates to the shared canonical walker.
// The old version pruned config-ignored DIRECTORIES before descending; the
// per-file check below yields the same result set (ignore-glob semantics match
// any path under the dir — see globToRegex's `^pattern/` alternation), at the
// cost of descending then filtering. Correctness-equivalent, verified by the
// ignore-validator specs.
export function getFilesRecursive(dir, config, projectDir) {
  const results = [];
  sharedWalkFiles(dir, (fullPath) => {
    if (config && projectDir) {
      const relPath = relative(projectDir, fullPath);
      if (shouldIgnore(relPath, config)) return;
    }
    results.push(fullPath);
  }, { ignoreDirs: IGNORE_DIRS });
  return results;
}
