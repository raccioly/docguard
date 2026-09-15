/**
 * Docs-Sync Validator — Checks that source files have matching canonical doc entries
 *
 * v0.29: migrated to structured findings (DSY001–DSY003). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { resolveSourceRoots } from '../shared-source.mjs';
import { relPosix, walkFiles as sharedWalkFiles, listCanonicalDocs } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { findAllOpenApiSpecs } from './api-surface.mjs';

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
 * `src/lib` is a generic utility convention in frontend and full-stack repos,
 * not evidence that every file beneath it is an architectural service. Keep
 * explicit service directories exhaustive; require a service-shaped filename
 * for the ambiguous `src/lib` fallback.
 */
function isServiceCandidate(file, serviceDir) {
  const normalizedDir = serviceDir.replace(/\\/g, '/').replace(/\/$/, '');
  if (!normalizedDir.endsWith('/src/lib')) return true;

  const name = basename(file, extname(file));
  return /(?:^|[-_.])services?$/i.test(name) || /Service$/i.test(name);
}

function normalizeApiPath(path) {
  const normalized = String(path || '')
    .trim()
    .toLowerCase()
    .replace(/:[a-z_][a-z0-9_]*/gi, '{}')
    .replace(/\{[^/{}]+\}/g, '{}')
    .replace(/\/+$/g, '');
  return normalized || '/';
}

function routeMatchesOpenApi(routePath, specPaths) {
  const route = normalizeApiPath(routePath);
  return specPaths.some(specPath => {
    const spec = normalizeApiPath(specPath);
    return spec === route || (route !== '/' && spec.endsWith(route));
  });
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
  const findings = [];
  let passed = 0;
  let total = 0;

  // Load all canonical doc content for checking. Recursive — docs grouped in
  // subfolders (docs-canonical/01-architecture/…) count as canonical too; a
  // flat read made every service they documented look undocumented.
  let canonicalContent = '';
  for (const doc of listCanonicalDocs(projectDir)) {
    try {
      canonicalContent += readFileSync(doc.abs, 'utf-8') + '\n';
    } catch {
      // Skip if can't read
    }
  }

  if (!canonicalContent) {
    // No canonical docs to check against
    return { name: 'docs-sync', ...resultFromFindings([], { passed: 0, total: 0 }) };
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

      const relPath = relPosix(projectDir, file);
      if (isTestFile(relPath)) continue;
      if (!isValidRouteFile(relPath)) continue;
      // N-1: skip files outside the --changed-only scope.
      if (!inScope(relPath)) continue;

      total++;
      const name = basename(file, ext);

      // Check if the file path or name is mentioned in any canonical doc
      if (canonicalContent.includes(relPath) || canonicalContent.includes(name)) {
        passed++;
      } else {
        findings.push(mkFinding({
          code: 'DSY001',
          validator: 'docsSync',
          severity: 'warn',
          message: `route ${relPath} not referenced in any canonical doc`,
          location: relPath,
          suggestion: { kind: 'fix', text: 'Reference this route (by path or name) in a canonical doc, e.g. ARCHITECTURE.md' },
        }));
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

      const relPath = relPosix(projectDir, file);
      if (isTestFile(relPath)) continue;
      if (!isServiceCandidate(file, serviceDir)) continue;
      // N-1: skip files outside the --changed-only scope.
      if (!inScope(relPath)) continue;

      total++;
      const name = basename(file, ext);

      if (canonicalContent.includes(relPath) || canonicalContent.includes(name)) {
        passed++;
      } else {
        findings.push(mkFinding({
          code: 'DSY002',
          validator: 'docsSync',
          severity: 'warn',
          message: `Service ${relPath} not referenced in any canonical doc`,
          location: relPath,
          suggestion: { kind: 'fix', text: 'Reference this service (by path or name) in a canonical doc, e.g. ARCHITECTURE.md' },
        }));
      }
    }
  }

  // ── Cross-check route files against OpenAPI spec ──
  // If an OpenAPI spec exists AND route files exist, verify routes have matching paths
  const authoritativeSpec = findAllOpenApiSpecs(projectDir, config)[0] || null;
  const openapiPaths = authoritativeSpec?.endpoints.map(endpoint => endpoint.path) || [];
  const openapiFile = authoritativeSpec?.relPath || null;

  if (openapiPaths.length > 0 && openapiFile) {
    // Check that route files have corresponding paths in OpenAPI spec (monorepo-aware)
    for (const routeDir of expandDirs(projectDir, config, ['src/routes', 'src/app/api', 'routes', 'app/api'])) {
      const files = getFilesRecursive(routeDir);
      for (const file of files) {
        const ext = extname(file);
        if (!['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) continue;

        const relPathForFilter = relPosix(projectDir, file);
        if (isTestFile(relPathForFilter)) continue;
        if (!isValidRouteFile(relPathForFilter)) continue;

        // Skip index/middleware files
        const rawName = basename(file, ext).toLowerCase();
        if (rawName === 'index' || rawName === 'middleware' || rawName.startsWith('_')) continue;

        total++;

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
          // Express :param and OpenAPI {param} are equivalent. Compare whole
          // path segments so `/users` cannot accidentally match `/superusers`.
          // A route-local path may omit an application mount prefix, so an
          // exact segment suffix is also accepted.
          matched = actualRoutes.some(route => routeMatchesOpenApi(route, openapiPaths));
        } else {
          // Strategy 2 (fallback): Strip common suffixes and check filename
          // userRoutes.ts → 'user', conversationRoutes.ts → 'conversation'
          const cleanName = rawName
            .replace(/routes?$/i, '')
            .replace(/controllers?$/i, '')
            .replace(/handlers?$/i, '')
            .replace(/router$/i, '');

          if (cleanName.length > 0) {
            matched = openapiPaths.some(path =>
              normalizeApiPath(path).split('/').some(segment => segment === cleanName));
          }
        }

        if (matched) {
          passed++;
        } else {
          findings.push(mkFinding({
            code: 'DSY003',
            validator: 'docsSync',
            severity: 'warn',
            message: `Route file ${basename(file)} exists but no matching paths found in ${openapiFile}. ` +
              `Run your spec generator (e.g., zod-to-openapi) to update the API spec`,
            location: relPathForFilter,
            suggestion: { kind: 'fix', text: `Regenerate ${openapiFile} (e.g. via zod-to-openapi) so it covers this route file's paths` },
          }));
        }
      }
    }
  }

  return { name: 'docs-sync', ...resultFromFindings(findings, { passed, total }) };
}

// v0.29 consolidation: traversal delegates to the shared canonical walker;
// IGNORE_DIRS stays local (its __tests__/__test__ entries are intentional —
// co-located test dirs are not the source under documentation).
function getFilesRecursive(dir) {
  const results = [];
  sharedWalkFiles(dir, (fullPath) => results.push(fullPath), { ignoreDirs: IGNORE_DIRS });
  return results;
}
