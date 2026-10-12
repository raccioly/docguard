/**
 * Docs-Sync Validator — Checks that source files have matching canonical doc entries
 *
 * v0.29: migrated to structured findings (DSY001–DSY003). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 *
 * Reads OpenAPI discovery from cli/shared-openapi.mjs, never from another
 * validator (Constitution IV).
 *
 * A route or service is documented by text a reader sees, or by a `covers`
 * declaration, that identifies it (specs/078-docs-sync-specific-evidence).
 * @implements docguard.spec-kit-artifact-coverage#FR-007
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { resolveSourceRoots } from '../shared-source.mjs';
import { relPosix, walkFiles as sharedWalkFiles, listCanonicalDocs } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { findAllOpenApiSpecs } from '../shared-openapi.mjs';
import { namesModule, namesDirectory, createUrlPathMatcher, treePaths } from '../scanners/doc-references.mjs';
import { coveredSections } from '../scanners/doc-deps.mjs';
import { appRouterPath } from '../scanners/routes.mjs';
import { visibleMarkdown } from '../shared-html-comments.mjs';

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
// A route handler's directory below `app/`: `src/app/api/users/[id]/route.ts` → `api/users/[id]`.
const NEXTJS_HANDLER_DIR_RE = /(?:^|\/)app\/(api(?:\/.+)?)\/route\.(?:ts|tsx|js|jsx|mjs)$/;
// Files that are their directory's module: Node.js resolves `./auth` to `auth/index.ts`.
const DIRECTORY_MODULES = new Set(['index', '__init__']);

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

/**
 * How a canonical doc names each checked file. A Next.js route handler is named
 * by the URL path it serves, never by its module name `route`. Any other file is
 * named by the shortest tail of its extension-less path that no other checked
 * file shares, so a unique module name is its own tail (`payments`) and a shared
 * one is qualified (`auth/types`). An `index` or `__init__` file is its
 * directory's module: its tail includes the directory (`auth/index`), and the
 * directory as a module path (`services/auth`) names it too.
 * @implements docguard.docs-sync-specific-evidence#FR-003
 * @implements docguard.docs-sync-specific-evidence#FR-004
 * @implements docguard.docs-sync-specific-evidence#FR-005
 * @param {string[]} relPaths every file Docs-Sync selects, whatever its scope
 * @returns {Map<string, { url?: string, tail?: string[], directory?: string[] }>}
 */
function identities(relPaths) {
  const segmentsOf = rel => rel.slice(0, rel.length - extname(rel).length).split('/');
  const unique = [...new Set(relPaths)];
  const shared = new Map();
  for (const rel of unique) {
    const segments = segmentsOf(rel);
    for (let k = 1; k <= segments.length; k++) {
      const tail = segments.slice(-k).join('/');
      shared.set(tail, (shared.get(tail) || 0) + 1);
    }
  }
  const out = new Map();
  for (const rel of unique) {
    const handler = NEXTJS_HANDLER_DIR_RE.exec(rel);
    if (handler) { out.set(rel, { url: appRouterPath(handler[1]) }); continue; }
    const segments = segmentsOf(rel);
    const directoryModule = DIRECTORY_MODULES.has(segments[segments.length - 1]);
    let k = Math.min(directoryModule ? 2 : 1, segments.length);
    while (k < segments.length && shared.get(segments.slice(-k).join('/')) > 1) k++;
    const tail = segments.slice(-k);
    let directory = null;
    if (directoryModule) {
      directory = tail.length > 2 ? tail.slice(0, -1) : segments.slice(-3, -1);
      if (directory.length < 2) directory = null;
    }
    out.set(rel, { tail, directory });
  }
  return out;
}

/** The name a suggestion asks for, in backticks. */
function expectedName(identity) {
  if (identity.url) return `its URL path \`${identity.url}\``;
  const tail = `\`${identity.tail.join('/')}\``;
  return identity.directory ? `\`${identity.directory.join('/')}\` or ${tail}` : tail;
}

/**
 * Is the file documented? By a `covers` declaration that lists it, or by its
 * identity in the visible text of the canonical docs.
 * @implements docguard.whole-token-sibling-matchers#FR-003
 * @implements docguard.docs-sync-specific-evidence#FR-002
 */
function isDocumented(evidence, relPath, identity) {
  if (evidence.covered.has(relPath)) return true;
  if (identity.url) return evidence.urlPaths()(identity.url);
  const { text } = evidence;
  const { tail, directory } = identity;
  if (tail.length === 1) return namesModule(text, tail[0]);
  if (namesModule(text, tail.join('/')) || namesModule(text, tail.join('.'))) return true;
  return Boolean(directory) && namesDirectory(text, directory);
}

/**
 * What the canonical docs say, as a reader sees it: every HTML comment removed
 * (a placeholder such as `<!-- e.g. users table -->` documents nothing), with
 * the path of every file a drawn tree lists, plus the files that a
 * `docguard:section` marker's `covers` lists, which DocGuard defines as the
 * code that section documents.
 * @implements docguard.docs-sync-specific-evidence#FR-001
 * @implements docguard.docs-sync-specific-evidence#FR-002
 * @implements docguard.docs-sync-specific-evidence#FR-008
 */
function readEvidence(contents) {
  const visible = contents.map(visibleMarkdown).join('\n');
  const text = `${visible}\n${treePaths(visible).join('\n')}`;
  const covered = new Set();
  for (const content of contents) {
    if (!content.includes('covers=')) continue;
    for (const section of coveredSections(content)) {
      for (const ref of section.covers) covered.add(ref.split('#')[0].replace(/^\.\//, ''));
    }
  }
  let matcher = null;
  return { text, covered, urlPaths: () => (matcher ??= createUrlPathMatcher(text)) };
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
  const contents = [];
  for (const doc of listCanonicalDocs(projectDir)) {
    try {
      contents.push(readFileSync(doc.abs, 'utf-8'));
    } catch {
      // Skip if can't read
    }
  }

  if (!contents.length) {
    // No canonical docs to check against
    return { name: 'docs-sync', ...resultFromFindings([], { passed: 0, total: 0 }) };
  }
  const evidence = readEvidence(contents);

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

  // Every route and service file is selected before scoping: whether a name is
  // shared by another file must not depend on which files changed
  // (docguard.docs-sync-specific-evidence#FR-006).
  const selected = [];

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
      selected.push({ relPath, code: 'DSY001', kind: 'route', message: `route ${relPath} not referenced in any canonical doc` });
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
      selected.push({ relPath, code: 'DSY002', kind: 'service', message: `Service ${relPath} not referenced in any canonical doc` });
    }
  }

  const named = identities(selected.map(entry => entry.relPath));
  for (const { relPath, code, kind, message } of selected) {
    // N-1: skip files outside the --changed-only scope.
    if (!inScope(relPath)) continue;

    total++;
    const identity = named.get(relPath);
    if (isDocumented(evidence, relPath, identity)) {
      passed++;
    } else {
      findings.push(mkFinding({
        code,
        validator: 'docsSync',
        severity: 'warn',
        message,
        location: relPath,
        suggestion: { kind: 'fix', text: `Name this ${kind} in a canonical doc (e.g. ARCHITECTURE.md) as ${expectedName(identity)}, or by its file path` },
      }));
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
