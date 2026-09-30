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

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, extname, relative } from 'node:path';

import { mkFinding, resultFromFindings } from '../findings.mjs';
import { resolveDocRole } from '../shared-doc-roles.mjs';


import { buildImportGraph, JS_EXTENSIONS, extractImports, getFilesRecursive, posixPath } from '../scanners/import-graph.mjs';
// Re-exported so existing importers of the validator keep working.
export { buildImportGraph };

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

