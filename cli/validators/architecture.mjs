/**
 * Architecture Validator — Checks that imports follow declared layer boundaries
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, relative } from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
]);

export function validateArchitecture(projectDir, config) {
  const results = { name: 'architecture', errors: [], warnings: [], passed: 0, total: 0 };

  // Layer rules from config
  const layers = config.layers;
  if (!layers || Object.keys(layers).length === 0) {
    // No layer rules configured — skip
    return results;
  }

  // Build the layer map: directory → allowed imports
  const layerMap = {};
  for (const [layerName, layerConfig] of Object.entries(layers)) {
    if (layerConfig.dir && layerConfig.canImport) {
      layerMap[layerConfig.dir] = {
        name: layerName,
        canImport: layerConfig.canImport,
        // Build list of forbidden directories
        forbidden: Object.entries(layers)
          .filter(([name]) => !layerConfig.canImport.includes(name) && name !== layerName)
          .map(([, cfg]) => cfg.dir)
          .filter(Boolean),
      };
    }
  }

  // Check each layer's files for forbidden imports
  for (const [dir, layer] of Object.entries(layerMap)) {
    const layerDir = resolve(projectDir, dir);
    if (!existsSync(layerDir)) continue;

    const files = getFilesRecursive(layerDir);
    for (const file of files) {
      const ext = extname(file);
      if (!['.ts', '.js', '.mjs', '.jsx', '.tsx'].includes(ext)) continue;

      const content = readFileSync(file, 'utf-8');
      const relPath = relative(projectDir, file);

      // Find import/require statements
      const importRegex = /(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1] || match[2];

        // Only check relative imports (not npm packages)
        if (!importPath.startsWith('.') && !importPath.startsWith('/')) continue;

        // Check if this import resolves to a forbidden layer
        for (const forbiddenDir of layer.forbidden) {
          if (importPath.includes(forbiddenDir) || importPath.includes(`/${forbiddenDir}/`)) {
            results.total++;
            results.errors.push(
              `${relPath}: ${layer.name} layer imports from forbidden layer (${forbiddenDir})`
            );
          }
        }
      }
    }
  }

  if (results.total === 0) {
    results.total = 1;
    results.passed = 1;
  }

  return results;
}

function getFilesRecursive(dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
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
    } catch {
      // Skip
    }
  }
  return results;
}
