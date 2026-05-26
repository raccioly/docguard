/**
 * Docs-Sync Validator — Checks that source files have matching canonical doc entries
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { resolveSourceRoots } from '../shared-source.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  // Co-located test dirs — these are not the source under documentation.
  '__tests__', '__test__',
]);

// Files that are tests, not source. Matched against the relative path AND
// the basename. Covers Jest/Vitest/Mocha/Jasmine/pytest/Go/Java conventions.
const TEST_PATH_RE = /(^|\/)__tests?__\//;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|java|go)$/;

// Next.js App Router uses a strict filename convention for route handlers.
// Other files in the app/api/ tree (helpers, types) are NOT routes.
const NEXTJS_ROUTE_FILE_RE = /(^|\/)route\.(ts|tsx|js|jsx|mjs)$/;
const NEXTJS_API_DIR_RE = /(^|\/)app\/api(\/|$)/;

function isTestFile(relPath) {
  return TEST_PATH_RE.test(relPath) || TEST_FILE_RE.test(relPath);
}

/**
 * For Next.js App Router directories (app/api/...), only `route.{ts,js}` files
 * are actual route handlers. Helpers and types in the same tree should not be
 * treated as routes.
 */
function isValidRouteFile(relPath) {
  if (NEXTJS_API_DIR_RE.test(relPath)) {
    return NEXTJS_ROUTE_FILE_RE.test(relPath);
  }
  return true;
}

/**
 * Expand sub-path patterns (e.g. 'routes', 'src/routes') against the project
 * root AND every configured source root, returning de-duplicated existing dirs.
 * Makes route/service discovery monorepo-aware (e.g. backend/src/routes).
 */
function expandDirs(projectDir, config, subPaths) {
  const bases = [resolve(projectDir), ...resolveSourceRoots(projectDir, config)];
  const out = [];
  const seen = new Set();
  for (const base of bases) {
    for (const sub of subPaths) {
      const dir = resolve(base, sub);
      if (seen.has(dir) || !existsSync(dir)) continue;
      seen.add(dir);
      out.push(dir);
    }
  }
  return out;
}

export function validateDocsSync(projectDir, config) {
  const results = { name: 'docs-sync', errors: [], warnings: [], passed: 0, total: 0 };

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

  // N-1: When the guard runs in --changed-only mode, config.changedFiles is
  // populated with paths that changed since the given ref. We use it to scope
  // route/service checks to ONLY the files actually changed — turning a
  // whole-tree scan into a surgical check. If the list is empty (no changes,
  // or git unavailable), we fall back to scanning everything.
  const changedSet = config && Array.isArray(config.changedFiles) && config.changedFiles.length > 0
    ? new Set(config.changedFiles)
    : null;
  // Closure: true if the given relative path should be considered.
  const inScope = (relPath) => !changedSet || changedSet.has(relPath);

  // Find route/API files (monorepo-aware) and check they're mentioned in docs.
  // Note: bare 'api' is intentionally excluded — it collides with frontend
  // API client conventions (src/api/client.ts). Backend routes use
  // src/routes/ or routes/ (Express). Next.js App Router uses src/app/api/
  // or app/api/ with strict route.{ts,js} filename matching applied below.
  const routeDirs = expandDirs(projectDir, config, ['src/routes', 'src/app/api', 'routes', 'app/api']);
  for (const routeDir of routeDirs) {
    const files = getFilesRecursive(routeDir);
    for (const file of files) {
      const ext = extname(file);
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.java', '.go'].includes(ext)) continue;

      const relPath = file.replace(projectDir + '/', '');
      if (isTestFile(relPath)) continue;
      if (!isValidRouteFile(relPath)) continue;
      // N-1: skip files outside the --changed-only scope.
      if (!inScope(relPath)) continue;

      results.total++;
      const name = basename(file, ext);

      // Check if the file path or name is mentioned in any canonical doc
      if (canonicalContent.includes(relPath) || canonicalContent.includes(name)) {
        results.passed++;
      } else {
        results.warnings.push(`route ${relPath} not referenced in any canonical doc`);
      }
    }
  }

  // Find service files (monorepo-aware) and check they're documented.
  const serviceDirs = expandDirs(projectDir, config, ['src/services', 'services', 'src/lib']);
  for (const serviceDir of serviceDirs) {
    const files = getFilesRecursive(serviceDir);
    for (const file of files) {
      const ext = extname(file);
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.java', '.go'].includes(ext)) continue;

      const relPath = file.replace(projectDir + '/', '');
      if (isTestFile(relPath)) continue;
      // N-1: skip files outside the --changed-only scope.
      if (!inScope(relPath)) continue;

      results.total++;
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
    // Check that route files have corresponding paths in OpenAPI spec (monorepo-aware)
    for (const routeDir of expandDirs(projectDir, config, ['src/routes', 'src/app/api', 'routes', 'app/api'])) {
      const files = getFilesRecursive(routeDir);
      for (const file of files) {
        const ext = extname(file);
        if (!['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) continue;

        const relPathForFilter = file.replace(projectDir + '/', '');
        if (isTestFile(relPathForFilter)) continue;
        if (!isValidRouteFile(relPathForFilter)) continue;

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
