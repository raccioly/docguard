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
 * @implements docguard.js-import-edges#FR-001
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, extname, relative, dirname } from 'node:path';
import { shouldIgnore, isNonProductPath, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { getWorkspaceDirs, languageOf } from '../shared-source.mjs';
import { astTierAvailable, parseJsTs, walk } from './js-ast.mjs';
import { extractPythonFiles } from './py-ast.mjs';
import { createAliasResolver } from './ts-paths.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'templates', 'configs', 'Research', 'docs-canonical', 'docs-implementation',
  'target', '.gradle',
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
 * `unanalysedFiles` lists product source files in languages this graph does
 * not read (Go, Java, Ruby, …), so its consumers can say a language is not
 * analysed instead of reporting "no imports"
 * (docguard.fallback-language-coverage#FR-010). They are not `limitations`:
 * the gap depends on the code, not on the machine, so the Architecture
 * validator's coverage is unchanged.
 *
 * @implements docguard.fallback-language-coverage#FR-010
 * @implements docguard.js-ts-extraction#FR-005
 * @returns {{files: string[], edges: {from,to,dynamic,language}[], fileMap: Map<string,string[]>, unsupportedFiles: string[], unanalysedFiles: string[], limitations: object[]}}
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
  const graph = { files: [], edges: [], fileMap: new Map(), unsupportedFiles: [], unanalysedFiles: [], limitations: [] };
  for (const file of allFiles) {
    if (!languageOf(file)) continue;
    const rel = posixPath(relative(projectDir, file));
    if (!isNonProductPath(rel, config)) graph.unanalysedFiles.push(rel);
  }

  const pythonFiles = allFiles
    .filter(f => extname(f) === '.py' && !isNonProductPath(relative(projectDir, f).replace(/\\/g, '/'), config))
    .filter(f => !(config && shouldIgnore(relative(projectDir, f), config)));
  const codeFiles = allFiles.filter(f => JS_EXTENSIONS.has(extname(f)));
  // `@/lib/x` and other tsconfig/jsconfig aliases name project files as surely
  // as `./lib/x` does (docguard.js-ts-extraction#FR-005).
  const resolveAlias = createAliasResolver(projectDir);

  // Without the parser every JS/TS file is read by the pattern fallback: one
  // limitation for all of them, as for a missing Python interpreter
  // (docguard.js-import-edges#FR-008).
  const parserAvailable = astTierAvailable();
  let fallbackFiles = 0;

  for (const file of codeFiles) {
    const relPath = relative(projectDir, file);

    // Skip files in ignored directories (config.ignore)
    if (config && shouldIgnore(relPath, config)) continue;

    graph.files.push(relPath);

    try {
      const content = readFileSync(file, 'utf-8');
      const { imports, namesBySpec, tier } = readImports(content, file);
      if (tier === 'regex-fallback') {
        fallbackFiles++;
        if (parserAvailable) graph.limitations.push({ code: 'js-parse-failed', file: posixPath(relPath) });
      }

      const resolvedImports = [];
      for (const imp of imports) {
        let resolved = null;
        if (imp.spec.startsWith('.') || imp.spec.startsWith('/')) {
          resolved = resolveImport(dirname(file), imp.spec, projectDir);
        } else {
          const aliased = resolveAlias(file, imp.spec);
          if (aliased) resolved = relative(projectDir, aliased);
        }
        if (resolved) {
          graph.edges.push({ from: relPath, to: resolved, dynamic: imp.dynamic, language: 'javascript', tier, names: namesBySpec.get(imp.spec) || null });
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

  if (!parserAvailable && fallbackFiles > 0) graph.limitations.push({ code: 'js-parser-unavailable', files: fallbackFiles });

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
        graph.edges.push({ from: relPath, to, dynamic: false, language: 'python', tier: 'py-ast', names: pythonImportNames(imp) });
        resolvedImports.push(to);
      }
    }
    graph.fileMap.set(relPath, resolvedImports);
  }
}

/**
 * A JS/TS file's imports as `{ spec, dynamic }`, the names each specifier
 * binds, and the tier that read them: the syntax tree when the file parses
 * (docguard.js-import-edges#FR-001, FR-004), else the text patterns (FR-003).
 * `dynamic: true` marks a runtime `import('…')` or a type reference, which
 * creates no load-time edge (field report #2); every other form is static.
 *
 * @implements docguard.js-import-edges#FR-001
 * @implements docguard.js-import-edges#FR-003
 * @implements docguard.js-import-edges#FR-004
 * @returns {{imports: {spec: string, dynamic: boolean}[], namesBySpec: Map<string, object>, tier: 'js-ast'|'regex-fallback'}}
 */
export function readImports(content, filename = 'file.ts') {
  const parsed = parseJsTs(content, filename);
  if (parsed.ok) return { ...importsFromSyntaxTree(parsed.ast), tier: 'js-ast' };
  return { imports: extractImportsFromText(content), namesBySpec: importNamesBySpec(content), tier: 'regex-fallback' };
}

/**
 * A file's imports, read as `readImports` reads them. The configured-layer
 * check uses this so it sees the graph's specifiers
 * (docguard.js-import-edges#FR-005).
 *
 * @implements docguard.js-import-edges#FR-005
 */
export function extractImports(content, filename = 'file.ts') {
  return readImports(content, filename).imports;
}

const staticSpecifier = node => {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
};
const requireSpecifier = node => (node?.type === 'CallExpression' && node.callee.type === 'Identifier'
  && node.callee.name === 'require' ? staticSpecifier(node.arguments[0]) : null);
const JSDOC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Imports and bound names from a Babel tree. Names come from the same nodes
 * as the edges; a specifier also reached by a form whose bindings cannot be
 * listed (`import()`, a `require()` bound to no name, a destructuring with a
 * rest element or a computed key) is dropped from the map, so its edges carry
 * `names: null` and ripple stays conservative.
 */
function importsFromSyntaxTree(ast) {
  const imports = [];
  const namesBySpec = new Map();
  const unknown = new Set();
  const bound = new Set();
  const entry = spec => { if (!namesBySpec.has(spec)) namesBySpec.set(spec, emptyNames()); return namesBySpec.get(spec); };
  const add = (spec, dynamic) => { imports.push({ spec, dynamic }); if (dynamic) unknown.add(spec); };

  // `walk` visits a node before its children, so a declarator marks its
  // `require()` before the call itself is visited.
  walk(ast.program, node => {
    switch (node.type) {
      case 'ImportDeclaration': {
        const spec = node.source.value;
        add(spec, false);
        const into = entry(spec);
        for (const s of node.specifiers) {
          if (s.type === 'ImportDefaultSpecifier') into.default = true;
          else if (s.type === 'ImportNamespaceSpecifier') into.namespace = s.local.name;
          else {
            const name = s.imported.type === 'StringLiteral' ? s.imported.value : s.imported.name;
            if (name === 'default') into.default = true;
            else into.named.push(name);
          }
        }
        break;
      }
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration':
        if (node.source) { add(node.source.value, false); entry(node.source.value).all = true; }
        break;
      case 'TSImportEqualsDeclaration': {
        const spec = node.moduleReference?.type === 'TSExternalModuleReference' ? staticSpecifier(node.moduleReference.expression) : null;
        if (spec !== null) { add(spec, false); entry(spec).namespace = node.id.name; }
        break;
      }
      case 'VariableDeclarator': {
        let call = node.init;
        let property = null;
        if (call?.type === 'MemberExpression' && !call.computed && call.property.type === 'Identifier') {
          property = call.property.name;
          call = call.object;
        }
        const spec = requireSpecifier(call);
        if (spec === null) break;
        bound.add(call);
        const into = entry(spec);
        const keys = node.id.type === 'ObjectPattern' ? node.id.properties.map(p => (p.type === 'ObjectProperty' && !p.computed
          ? (p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null) : null)) : [];
        if (property) into.named.push(property);
        else if (node.id.type === 'Identifier') into.namespace = node.id.name;
        else if (node.id.type === 'ObjectPattern' && !keys.includes(null)) into.named.push(...keys);
        else unknown.add(spec);
        break;
      }
      case 'CallExpression': {
        const spec = requireSpecifier(node);
        if (spec !== null) {
          add(spec, false);
          if (!bound.has(node)) unknown.add(spec);
        } else if (node.callee.type === 'Import') {
          const dyn = staticSpecifier(node.arguments[0]);
          if (dyn !== null) add(dyn, true);
        }
        break;
      }
      case 'ImportExpression': {
        const dyn = staticSpecifier(node.source);
        if (dyn !== null) add(dyn, true);
        break;
      }
      case 'TSImportType': {
        const dyn = staticSpecifier(node.argument?.type === 'TSLiteralType' ? node.argument.literal : node.argument);
        if (dyn !== null) add(dyn, true);
        break;
      }
    }
  });

  // A JSDoc type reference names a real dependency, as TypeScript's
  // `import('…')` type does; other comments are not code (FR-001).
  for (const comment of ast.comments || []) {
    if (comment.type !== 'CommentBlock' || !comment.value.startsWith('*')) continue;
    for (const m of comment.value.matchAll(JSDOC_IMPORT)) add(m[1], true);
  }

  for (const spec of unknown) namesBySpec.delete(spec);
  return { imports, namesBySpec };
}

/**
 * The pattern fallback, for a file the parser cannot read
 * (docguard.js-import-edges#FR-003). An import clause may span lines but
 * never a `;` or a quote, so a side-effect import cannot swallow the next
 * statement; `\b` keeps `reimport` from matching. Text in comments and
 * strings still matches here: only the syntax tree can tell code from text.
 */
export function extractImportsFromText(content) {
  const imports = [];
  const read = (regex, dynamic) => { for (const m of content.matchAll(regex)) imports.push({ spec: m[1], dynamic }); };

  // ES imports and re-exports (static, load-time). `import\s+` requires
  // whitespace after `import`, so it never matches a dynamic `import(` call.
  read(/\bimport\s+(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/g, false);
  read(/\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g, false);
  // Dynamic imports (runtime — NOT a load-time cycle edge)
  read(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, true);
  // CommonJS require (static, load-time)
  read(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, false);

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

// ── Imported names and the reverse walk (specs/070-requirement-anchors) ─────

const emptyNames = () => ({ named: [], default: false, namespace: null, all: false });

/**
 * What each module specifier's import binds, read from the whole clause
 * (which may span lines): named imports by their exported name, a default
 * import, a namespace binding (`* as ns`, a CommonJS `const m = require()`),
 * or `all` for a re-export. Requirement-anchor ripple keeps only importers
 * that bind the changed name (FR-031). The clause excludes quotes and `;` so
 * a side-effect import cannot swallow the next statement.
 * @returns {Map<string, {named: string[], default: boolean, namespace: string|null, all: boolean}>}
 */
export function importNamesBySpec(content) {
  const out = new Map();
  const entry = spec => { if (!out.has(spec)) out.set(spec, emptyNames()); return out.get(spec); };
  const named = (clause, into) => {
    for (const part of clause.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').split(',')) {
      const m = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*$/.exec(part);
      if (m) into.named.push(m[1].replace(/^['"]|['"]$/g, ''));
    }
  };
  for (const m of content.matchAll(/\bimport\s+(?:type\s+)?([^;'"]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const into = entry(m[2]);
    let clause = m[1].trim();
    const brace = /\{([^}]*)\}/.exec(clause);
    if (brace) { named(brace[1], into); clause = clause.replace(brace[0], ''); }
    const ns = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (ns) { into.namespace = ns[1]; clause = clause.replace(ns[0], ''); }
    if (/[A-Za-z_$]/.test(clause.replace(/,/g, ''))) into.default = true;
  }
  for (const m of content.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const into = entry(m[2]);
    if (m[1].startsWith('{')) {
      for (const part of m[1].slice(1, -1).split(',')) {
        const p = /^\s*([A-Za-z_$][\w$]*)/.exec(part);
        if (p) into.named.push(p[1]);
      }
    } else into.namespace = m[1];
  }
  for (const m of content.matchAll(/\bexport\s+(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g)) entry(m[1]).all = true;
  return out;
}

/** The names a Python import binds, in the same shape. */
function pythonImportNames(imp) {
  const out = emptyNames();
  if (imp.kind === 'import') { out.namespace = imp.module || null; return out; }
  for (const name of Array.isArray(imp.names) ? imp.names : []) {
    if (name === '*') out.all = true;
    else if (name) out.named.push(name);
  }
  return out;
}

/** A module importing more than this many others is a hub: an orchestrator, not a user of one module. */
export const HUB_OUT_DEGREE = 15;

/**
 * Reverse edges (`to → [from…]`), out-degree, and the hub test over a graph's
 * edges. Shared by `impact` / `diff --since` and requirement-anchor ripple.
 */
export function reverseImportIndex(graph) {
  const reverseEdges = new Map();
  const outDegree = new Map();
  for (const e of graph.edges) {
    if (!reverseEdges.has(e.to)) reverseEdges.set(e.to, []);
    reverseEdges.get(e.to).push(e.from);
    outDegree.set(e.from, (outDegree.get(e.from) || 0) + 1);
  }
  return { reverseEdges, outDegree, isHub: file => (outDegree.get(file) || 0) > HUB_OUT_DEGREE };
}

/**
 * Ancestors of `file` in the reverse import graph, capped at `maxHops`.
 * Returns Map<ancestorPath, hops>. Beyond two hops, hub modules connect
 * everything and the signal drowns.
 */
export function reverseImportAncestors(file, reverseEdges, maxHops = 2) {
  const seen = new Map();
  let frontier = [file];
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next = [];
    for (const cur of frontier) {
      for (const importer of reverseEdges.get(cur) || []) {
        if (importer === file || seen.has(importer)) continue;
        seen.set(importer, hop);
        next.push(importer);
      }
    }
    frontier = next;
  }
  return seen;
}

