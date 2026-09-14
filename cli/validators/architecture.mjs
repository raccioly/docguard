/**
 * Architecture Validator — Enhanced with automatic import analysis
 * 
 * Two modes:
 * 1. Config-driven: Uses `layers` from .docguard.json (existing behavior)
 * 2. Auto-detect: Scans ARCHITECTURE.md for layer boundary declarations,
 *    then validates imports across the codebase.
 * 
 * Import violations detected:
 * - Circular dependencies (A → B → A)
 * - Layer boundary violations (routes importing from routes, etc.)
 * - Orphan modules (code files with 0 inbound imports)
 *
 * Respects config.ignore (global) for file filtering.
 * Uses shared-ignore.mjs for consistent filtering (Constitution IV, v1.1.0).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, relative, dirname, basename } from 'node:path';
import { shouldIgnore, isNonProductPath, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { resolveDocRole } from '../shared-doc-roles.mjs';
import { getWorkspaceDirs } from '../shared-source.mjs';
import { extractPythonFiles } from '../scanners/py-ast.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'templates', 'configs', 'Research', 'docs-canonical', 'docs-implementation',
]);

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']);

// v0.29: migrated to structured findings (ARC001–ARC003). Messages are
// byte-identical to the legacy strings — resultFromFindings derives the
// errors/warnings arrays from the same findings array (acc), which the
// helpers below mutate in place.
export function validateArchitecture(projectDir, config = {}) {
  const acc = { findings: [], passed: 0, total: 0 };
  let applicability = { status: 'checked', reason: 'Repository-local JS/TS and Python static import graphs inspected; runtime dependency resolution is outside scope' };
  const compose = () => ({
    name: 'architecture',
    applicability,
    ...resultFromFindings(acc.findings, { passed: acc.passed, total: acc.total }),
  });

  // ── 1. Config-driven layer validation ──
  const layers = config.layers;
  if (layers && Object.keys(layers).length > 0) {
    validateConfigLayers(projectDir, config, layers, acc);
  }

  // ── 2. Auto-detect import graph ──
  const importGraph = buildImportGraph(projectDir, config);
  if (importGraph.limitations.length > 0) {
    applicability = {
      status: importGraph.files.length > 0 ? 'partial' : 'unsupported',
      reason: `Static import findings are retained; incomplete evidence: ${summarizeLimitations(importGraph.limitations)}`,
    };
  } else if (importGraph.files.length === 0) {
    applicability = { status: 'not-applicable', reason: 'No supported JS/TS or Python source files found for import graph analysis' };
  }
  if (importGraph.files.length === 0) return compose();

  if (layers && Object.keys(layers).length > 0) {
    validatePythonConfigLayers(importGraph, layers, acc);
  }

  // ── 3. Detect circular dependencies ──
  const circles = detectCircularDeps(importGraph);
  for (const circle of circles) {
    acc.total++;
    acc.findings.push(mkFinding({
      code: 'ARC002',
      validator: 'architecture',
      severity: 'warn',
      message: `Circular dependency: ${circle.join(' → ')}`,
      location: circle[0],
      suggestion: {
        kind: 'fix',
        text: 'Break the cycle — convert one edge to a dynamic import() or extract the shared code into a third module',
      },
    }));
  }

  // ── 4. Check layer boundaries from ARCHITECTURE.md ──
  const archPath = resolveDocRole(projectDir, config, 'architecture');
  if (archPath && existsSync(archPath)) {
    const archContent = readFileSync(archPath, 'utf-8');
    const declaredLayers = parseLayerBoundaries(archContent);

    if (declaredLayers.length > 0) {
      validateLayerBoundaries(projectDir, importGraph, declaredLayers, acc);
    }
  }

  // ── 5. No boundaries declared and no circular deps to check → not applicable.
  // (Previously this returned a fake 1/1 pass, rendering a confident green ✅
  // for projects that declared no layer boundaries — it validated nothing.)
  const results = compose();
  if (results.total === 0) {
    results.note = 'no layer boundaries declared in ARCHITECTURE.md';
  }

  return results;
}

// ── Config-driven validation (existing behavior) ────────────────────────────

function validateConfigLayers(projectDir, config, layers, acc) {
  const layerMap = {};
  for (const [layerName, layerConfig] of Object.entries(layers)) {
    if (layerConfig.dir && layerConfig.canImport) {
      layerMap[layerConfig.dir] = {
        name: layerName,
        canImport: layerConfig.canImport,
        forbidden: Object.entries(layers)
          .filter(([name]) => !layerConfig.canImport.includes(name) && name !== layerName)
          .map(([, cfg]) => cfg.dir)
          .filter(Boolean),
      };
    }
  }

  for (const [dir, layer] of Object.entries(layerMap)) {
    const layerDir = resolve(projectDir, dir);
    if (!existsSync(layerDir)) continue;

    const files = getFilesRecursive(layerDir, config, projectDir);
    for (const file of files) {
      if (!JS_EXTENSIONS.has(extname(file))) continue;

      const content = readFileSync(file, 'utf-8');
      const relPath = relative(projectDir, file);
      const imports = extractImports(content);

      for (const { spec } of imports) {
        if (!spec.startsWith('.') && !spec.startsWith('/')) continue;

        for (const forbiddenDir of layer.forbidden) {
          if (spec.includes(forbiddenDir) || spec.includes(`/${forbiddenDir}/`)) {
            acc.total++;
            acc.findings.push(mkFinding({
              code: 'ARC001',
              validator: 'architecture',
              severity: 'error',
              message: `${relPath}: ${layer.name} layer imports from forbidden layer (${forbiddenDir})`,
              location: relPath,
              suggestion: {
                kind: 'fix',
                text: 'Remove the import or route it through an allowed layer (see the layers config in .docguard.json)',
              },
            }));
          }
        }
      }
    }
  }
}

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
  const graph = { files: [], edges: [], fileMap: new Map(), unsupportedFiles: [], limitations: [] };

  const allFiles = getFilesRecursive(projectDir, config, projectDir);
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
    } catch { /* skip binary or unreadable files */ }
  }

  addPythonImportGraph(projectDir, config || {}, pythonFiles, graph);

  return graph;
}

function posixPath(path) {
  return path.replace(/\\/g, '/');
}

function summarizeLimitations(limitations) {
  const labels = {
    'python-interpreter-unavailable': 'Python interpreter unavailable',
    'python-parse-failed': 'Python parse failure',
    'python-dynamic-import': 'dynamic Python import',
    'python-path-mutation': 'runtime sys.path mutation',
    'python-relative-outside-package': 'relative import outside a resolvable package',
    'python-ambiguous-module': 'ambiguous Python module across import roots',
  };
  const counts = new Map();
  for (const item of limitations) counts.set(item.code, (counts.get(item.code) || 0) + 1);
  return [...counts].map(([code, count]) => `${labels[code] || code}${count > 1 ? ` (${count})` : ''}`).join('; ');
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

function validatePythonConfigLayers(graph, layers, acc) {
  const layerEntries = Object.entries(layers)
    .filter(([, value]) => value?.dir && Array.isArray(value.canImport))
    .map(([name, value]) => ({ name, dir: posixPath(value.dir).replace(/\/$/, ''), canImport: value.canImport }));
  for (const edge of graph.edges.filter(item => item.language === 'python')) {
    const from = layerEntries.find(layer => edge.from === layer.dir || edge.from.startsWith(`${layer.dir}/`));
    const to = layerEntries.find(layer => edge.to === layer.dir || edge.to.startsWith(`${layer.dir}/`));
    if (!from || !to || from.name === to.name || from.canImport.includes(to.name)) continue;
    acc.total++;
    acc.findings.push(mkFinding({
      code: 'ARC001', validator: 'architecture', severity: 'error',
      message: `${edge.from}: ${from.name} layer imports from forbidden layer (${to.dir})`,
      location: edge.from,
      suggestion: { kind: 'fix', text: 'Remove the import or route it through an allowed layer (see the layers config in .docguard.json)' },
    }));
  }
}

/**
 * Extract a file's imports as `{ spec, dynamic }`. `dynamic:true` marks a
 * runtime `import('…')` — which does NOT create a load-time dependency edge and
 * is the canonical way to break an import cycle (field report #2). ES `import …
 * from` and CommonJS `require()` are load-time (static).
 */
function extractImports(content) {
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

// ── Circular Dependency Detection ───────────────────────────────────────────

function detectCircularDeps(graph) {
  const circles = [];
  const visited = new Set();
  const inStack = new Set();

  function dfs(file, path) {
    if (inStack.has(file)) {
      // Found a cycle — extract just the cycle portion
      const cycleStart = path.indexOf(file);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart);
        cycle.push(file); // complete the circle
        // Only report cycles of 2-5 files to avoid noise
        if (cycle.length >= 3 && cycle.length <= 6) {
          circles.push(cycle);
        }
      }
      return;
    }
    if (visited.has(file)) return;

    visited.add(file);
    inStack.add(file);

    const deps = graph.fileMap.get(file) || [];
    for (const dep of deps) {
      dfs(dep, [...path, file]);
    }

    inStack.delete(file);
  }

  for (const file of graph.files) {
    if (!visited.has(file)) {
      dfs(file, []);
    }
  }

  // Deduplicate cycles (same cycle can be detected starting from different nodes)
  const seen = new Set();
  return circles.filter(cycle => {
    const key = [...cycle].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Layer Boundary Parser ───────────────────────────────────────────────────

function parseLayerBoundaries(archContent) {
  const layers = [];

  // Parse "Layer Boundaries" table from ARCHITECTURE.md
  const tableRegex = /\|\s*(\S+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g;
  let match;
  let inBoundarySection = false;

  const lines = archContent.split('\n');
  for (const line of lines) {
    if (line.includes('Layer Boundaries') || line.includes('layer boundaries')) {
      inBoundarySection = true;
      continue;
    }
    if (inBoundarySection && line.startsWith('## ')) {
      break; // next section
    }
    if (!inBoundarySection) continue;
    if (line.includes('---') || line.includes('Layer') && line.includes('Can Import')) continue;

    match = line.match(/\|\s*(\S+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
    if (match) {
      const layerName = match[1].replace(/[`*]/g, '').toLowerCase();
      const canImport = match[2].trim().split(',').map(s => s.trim().replace(/[`*]/g, '').toLowerCase());
      const cannotImport = match[3].trim().split(',').map(s => s.trim().replace(/[`*]/g, '').toLowerCase());

      // Skip markdown noise
      if (layerName === '<!--' || layerName === 'layer' || layerName.length < 2) continue;

      layers.push({ name: layerName, canImport, cannotImport });
    }
  }

  return layers;
}

function validateLayerBoundaries(projectDir, graph, declaredLayers, acc) {
  // Map directory patterns to layer names
  const layerDirMap = new Map();
  for (const layer of declaredLayers) {
    // Common directory mappings
    const dirPatterns = getLayerDirPatterns(layer.name);
    for (const pattern of dirPatterns) {
      layerDirMap.set(pattern, layer);
    }
  }

  // Check each import edge
  for (const edge of graph.edges) {
    const fromLayer = getFileLayer(edge.from, layerDirMap);
    const toLayer = getFileLayer(edge.to, layerDirMap);

    if (!fromLayer || !toLayer || fromLayer.name === toLayer.name) continue;

    // Check if this import is forbidden
    if (fromLayer.cannotImport.some(l => l.includes(toLayer.name) || toLayer.name.includes(l))) {
      acc.total++;
      acc.findings.push(mkFinding({
        code: 'ARC003',
        validator: 'architecture',
        severity: 'error',
        message: `${edge.from}: ${fromLayer.name} → ${toLayer.name} (forbidden by ARCHITECTURE.md)`,
        location: edge.from,
        suggestion: {
          kind: 'review',
          text: 'Remove or invert the import — or update the Layer Boundaries table in ARCHITECTURE.md if the rule changed',
        },
      }));
    } else {
      acc.total++;
      acc.passed++;
    }
  }
}

function getLayerDirPatterns(layerName) {
  const patterns = [];
  const clean = layerName.replace(/\//g, '').replace(/\s/g, '').toLowerCase();

  // Standard patterns
  patterns.push(clean);
  patterns.push(`src/${clean}`);

  // Common aliases
  const aliases = {
    routes: ['routes', 'src/routes', 'src/app/api', 'api', 'handlers'],
    handlers: ['routes', 'src/routes', 'handlers'],
    services: ['services', 'src/services', 'src/lib'],
    models: ['models', 'src/models', 'entities', 'schema'],
    repositories: ['repositories', 'src/repositories', 'models', 'data'],
    middleware: ['middleware', 'src/middleware'],
    utils: ['utils', 'src/utils', 'helpers', 'src/helpers', 'lib'],
    components: ['components', 'src/components', 'ui'],
  };

  if (aliases[clean]) {
    patterns.push(...aliases[clean]);
  }

  return patterns;
}

function getFileLayer(filePath, layerDirMap) {
  for (const [pattern, layer] of layerDirMap) {
    if (filePath.startsWith(pattern + '/') || filePath.includes('/' + pattern + '/')) {
      return layer;
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
function getFilesRecursive(dir, config, projectDir) {
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
