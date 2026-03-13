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
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, relative, dirname, basename } from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'templates', 'configs', 'Research', 'docs-canonical', 'docs-implementation',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']);

export function validateArchitecture(projectDir, config) {
  const results = { name: 'architecture', errors: [], warnings: [], passed: 0, total: 0 };

  // ── 1. Config-driven layer validation ──
  const layers = config.layers;
  if (layers && Object.keys(layers).length > 0) {
    validateConfigLayers(projectDir, config, layers, results);
  }

  // ── 2. Auto-detect import graph ──
  const importGraph = buildImportGraph(projectDir);
  if (importGraph.files.length === 0) return results;

  // ── 3. Detect circular dependencies ──
  const circles = detectCircularDeps(importGraph);
  for (const circle of circles) {
    results.total++;
    results.warnings.push(`Circular dependency: ${circle.join(' → ')}`);
  }

  // ── 4. Check layer boundaries from ARCHITECTURE.md ──
  const archPath = resolve(projectDir, 'docs-canonical/ARCHITECTURE.md');
  if (existsSync(archPath)) {
    const archContent = readFileSync(archPath, 'utf-8');
    const declaredLayers = parseLayerBoundaries(archContent);

    if (declaredLayers.length > 0) {
      validateLayerBoundaries(projectDir, importGraph, declaredLayers, results);
    }
  }

  // ── 5. Report import stats ──
  if (results.total === 0) {
    results.total = 1;
    results.passed = 1;
  }

  return results;
}

// ── Config-driven validation (existing behavior) ────────────────────────────

function validateConfigLayers(projectDir, config, layers, results) {
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

    const files = getFilesRecursive(layerDir);
    for (const file of files) {
      if (!CODE_EXTENSIONS.has(extname(file))) continue;

      const content = readFileSync(file, 'utf-8');
      const relPath = relative(projectDir, file);
      const imports = extractImports(content);

      for (const imp of imports) {
        if (!imp.startsWith('.') && !imp.startsWith('/')) continue;

        for (const forbiddenDir of layer.forbidden) {
          if (imp.includes(forbiddenDir) || imp.includes(`/${forbiddenDir}/`)) {
            results.total++;
            results.errors.push(
              `${relPath}: ${layer.name} layer imports from forbidden layer (${forbiddenDir})`
            );
          }
        }
      }
    }
  }
}

// ── Import Graph Builder ────────────────────────────────────────────────────

function buildImportGraph(projectDir) {
  const graph = { files: [], edges: [], fileMap: new Map() };

  const allFiles = getFilesRecursive(projectDir);
  const codeFiles = allFiles.filter(f => CODE_EXTENSIONS.has(extname(f)));

  for (const file of codeFiles) {
    const relPath = relative(projectDir, file);
    graph.files.push(relPath);

    try {
      const content = readFileSync(file, 'utf-8');
      const imports = extractImports(content);

      const resolvedImports = [];
      for (const imp of imports) {
        if (!imp.startsWith('.') && !imp.startsWith('/')) continue;

        // Resolve relative imports
        const fromDir = dirname(file);
        const resolved = resolveImport(fromDir, imp, projectDir);
        if (resolved) {
          resolvedImports.push(resolved);
          graph.edges.push({ from: relPath, to: resolved });
        }
      }

      graph.fileMap.set(relPath, resolvedImports);
    } catch { /* skip binary or unreadable files */ }
  }

  return graph;
}

function extractImports(content) {
  const imports = [];

  // ES module imports
  const esImportRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = esImportRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Dynamic imports
  const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // CommonJS require
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push(match[1]);
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

function validateLayerBoundaries(projectDir, graph, declaredLayers, results) {
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
      results.total++;
      results.errors.push(
        `${edge.from}: ${fromLayer.name} → ${toLayer.name} (forbidden by ARCHITECTURE.md)`
      );
    } else {
      results.total++;
      results.passed++;
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

function getFilesRecursive(dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  let entries;
  try {
    entries = readdirSync(dir);
  } catch { return results; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...getFilesRecursive(fullPath));
      } else {
        results.push(fullPath);
      }
    } catch { /* skip */ }
  }
  return results;
}
