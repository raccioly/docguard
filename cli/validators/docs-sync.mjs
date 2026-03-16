/**
 * Docs-Sync Validator — Checks that source files have matching canonical doc entries
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
]);

export function validateDocsSync(projectDir, config) {
  const results = { name: 'docs-sync', errors: [], warnings: [], passed: 0, total: 0 };

  // Find route/API files and check they're mentioned in canonical docs
  const routePatterns = [
    { dir: 'src/routes', label: 'route' },
    { dir: 'src/app/api', label: 'API route' },
    { dir: 'api', label: 'API route' },
    { dir: 'routes', label: 'route' },
  ];

  // Load all canonical doc content for checking
  const canonicalDir = resolve(projectDir, 'docs-canonical');
  let canonicalContent = '';
  if (existsSync(canonicalDir)) {
    try {
      const files = readdirSync(canonicalDir).filter(f => f.endsWith('.md'));
      for (const f of files) {
        canonicalContent += readFileSync(resolve(canonicalDir, f), 'utf-8') + '\n';
      }
    } catch {
      // Skip if can't read
    }
  }

  if (!canonicalContent) {
    return results; // No canonical docs to check against
  }

  for (const { dir, label } of routePatterns) {
    const routeDir = resolve(projectDir, dir);
    if (!existsSync(routeDir)) continue;

    const files = getFilesRecursive(routeDir);
    for (const file of files) {
      const ext = extname(file);
      if (!['.ts', '.js', '.mjs', '.py', '.java', '.go'].includes(ext)) continue;

      results.total++;
      const relPath = file.replace(projectDir + '/', '');
      const name = basename(file, ext);

      // Check if the file path or name is mentioned in any canonical doc
      if (canonicalContent.includes(relPath) || canonicalContent.includes(name)) {
        results.passed++;
      } else {
        results.warnings.push(`${label} ${relPath} not referenced in any canonical doc`);
      }
    }
  }

  // Find service files and check they're documented
  const serviceDirs = ['src/services', 'services', 'src/lib'];
  for (const dir of serviceDirs) {
    const serviceDir = resolve(projectDir, dir);
    if (!existsSync(serviceDir)) continue;

    const files = getFilesRecursive(serviceDir);
    for (const file of files) {
      const ext = extname(file);
      if (!['.ts', '.js', '.mjs', '.py', '.java', '.go'].includes(ext)) continue;

      results.total++;
      const relPath = file.replace(projectDir + '/', '');
      const name = basename(file, ext);

      if (canonicalContent.includes(relPath) || canonicalContent.includes(name)) {
        results.passed++;
      } else {
        results.warnings.push(`Service ${relPath} not referenced in any canonical doc`);
      }
    }
  }

  // ── Cross-check route files against OpenAPI spec ──
  // If an OpenAPI spec exists AND route files exist, verify routes have matching paths
  const openapiPatterns = [
    'openapi.yaml', 'openapi.yml', 'openapi.json',
    'swagger.yaml', 'swagger.yml', 'swagger.json',
    'api/openapi.yaml', 'api/openapi.yml', 'api/openapi.json',
    'docs/openapi.yaml', 'docs/openapi.yml',
  ];

  let openapiContent = '';
  let openapiFile = null;
  for (const pattern of openapiPatterns) {
    const specPath = resolve(projectDir, pattern);
    if (existsSync(specPath)) {
      try {
        openapiContent = readFileSync(specPath, 'utf-8').toLowerCase();
        openapiFile = pattern;
      } catch { /* ignore */ }
      break;
    }
  }

  if (openapiContent && openapiFile) {
    // Check that route files have corresponding paths in OpenAPI spec
    for (const { dir } of routePatterns) {
      const routeDir = resolve(projectDir, dir);
      if (!existsSync(routeDir)) continue;

      const files = getFilesRecursive(routeDir);
      for (const file of files) {
        const ext = extname(file);
        if (!['.ts', '.js', '.mjs'].includes(ext)) continue;

        // Skip index/middleware files
        const rawName = basename(file, ext).toLowerCase();
        if (rawName === 'index' || rawName === 'middleware' || rawName.startsWith('_')) continue;

        results.total++;

        // Strategy 1: Parse the route file for actual route paths
        // Look for router.get('/path'), app.post('/path'), etc.
        let routeFileContent = '';
        try { routeFileContent = readFileSync(file, 'utf-8').toLowerCase(); } catch { /* skip */ }

        const actualRoutes = [];
        const routeDefRegex = /(?:router|app|route)\s*\.\s*(?:get|post|put|delete|patch|all|use)\s*\(\s*['"`](\/[^'"`]*)['"`]/gi;
        let routeMatch;
        while ((routeMatch = routeDefRegex.exec(routeFileContent)) !== null) {
          actualRoutes.push(routeMatch[1]);
        }

        let matched = false;

        if (actualRoutes.length > 0) {
          // Check if ANY of the actual route paths appear in the OpenAPI spec
          matched = actualRoutes.some(route => {
            // Normalize: /api/conversations/:id → /api/conversations
            const basePath = route.replace(/\/:[^/]+/g, '').replace(/\/{[^}]+}/g, '');
            return openapiContent.includes(basePath) || openapiContent.includes(route);
          });
        } else {
          // Strategy 2 (fallback): Strip common suffixes and check filename
          // userRoutes.ts → 'user', conversationRoutes.ts → 'conversation'
          const cleanName = rawName
            .replace(/routes?$/i, '')
            .replace(/controllers?$/i, '')
            .replace(/handlers?$/i, '')
            .replace(/router$/i, '');

          if (cleanName.length > 0) {
            matched = openapiContent.includes(`/${cleanName}`) ||
                      openapiContent.includes(`"${cleanName}"`) ||
                      openapiContent.includes(`'${cleanName}'`);
          }
        }

        if (matched) {
          results.passed++;
        } else {
          results.warnings.push(
            `Route file ${basename(file)} exists but no matching paths found in ${openapiFile}. ` +
            `Run your spec generator (e.g., zod-to-openapi) to update the API spec`
          );
        }
      }
    }
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
