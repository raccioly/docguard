/**
 * Deep Route Scanner
 * @req docguard.adoption-workflow-integrity#FR-013
 * Parses actual route definitions from source code across frameworks.
 * Supports: Next.js (App Router + Pages), Express, Fastify, Hono, Django, FastAPI,
 * Flask, Spring Boot, Rails, Gin/Echo/Chi/Fiber, Axum/Actix/Rocket
 *
 * Priority: OpenAPI spec > Code scanning
 *
 * Spring, Rails, Go and Rust have no syntax tree in DocGuard: their routes are
 * matched by pattern, and each carries `tier: 'fallback-language'` so a finding
 * drawn from them says so (docguard.fallback-language-coverage#FR-002).
 *
 * @implements docguard.fallback-language-coverage#FR-002
 * @implements docguard.fallback-language-coverage#FR-007
 * @implements docguard.fallback-language-coverage#FR-008
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, basename, extname, dirname } from 'node:path';
import { resolveSourceRoots, readScannable, tierFor, summarizeTiers } from '../shared-source.mjs';
import { DEFAULT_IGNORE_DIRS as IGNORE_DIRS, shouldIgnore, relPosix, isNonProductPath } from '../shared-ignore.mjs';
import { extractJsRouteCalls, extractJsRouteObjects, extractJsMountsAndImports } from './js-ast.mjs';
import { scanPythonWebRoutes } from './python-routes.mjs';
import { extractGoRoutes } from './go-routes.mjs';
import { extractSpringRoutes } from './spring-routes.mjs';
import { extractRailsRoutes } from './rails-routes.mjs';

/**
 * Scan routes from source code with framework-aware parsing.
 * @param {string} dir - Project root
 * @param {object} stack - Detected tech stack
 * @param {object} docTools - Detected doc tools (may include OpenAPI)
 * @param {object} [opts] - { config } — config enables monorepo-aware source roots
 * @returns {Array} Array of route objects { method, path, handler, file, auth, description }
 */
export function scanRoutesDeep(dir, stack, docTools, opts = {}) {
  // Priority 1: Use OpenAPI spec if available (most accurate)
  if (docTools?.openapi?.found && docTools.openapi.endpoints?.length > 0) {
    return docTools.openapi.endpoints.map(ep => ({
      ...ep,
      source: 'openapi',
      file: docTools.openapi.path,
    }));
  }

  // Priority 2: Framework-specific code scanning.
  // Monorepo-aware: when a config is supplied, scan the resolved source roots
  // (honors config.sourceRoot + workspaces) instead of only root-relative dirs.
  const framework = stack?.framework || '';
  const routes = [];
  const roots = opts.config ? resolveSourceRoots(dir, opts.config) : null;
  // What the scan READ, kept apart from what it found: an empty result from a
  // pattern-only scanner, a truncated walk, or routes that exist only in
  // fixtures are exactly the cases a caller must be able to tell apart from
  // "this project registers no routes".
  const maxFiles = Number.isInteger(opts.maxFiles) && opts.maxFiles > 0 ? opts.maxFiles : ROUTE_SCAN_MAX_FILES;
  const scan = { tierItems: [], truncated: false, cap: maxFiles, patternFrameworks: [], excludedNonProduct: 0 };
  const ctx = { dir, maxFiles, scan };
  const named = (...names) => names.find(n => framework.includes(n));
  const patternScan = (name, sources, fn) => {
    const before = scan.tierItems.length;
    const found = fn(dir, ctx);
    scan.patternFrameworks.push({ name, sources, files: scan.tierItems.length - before, routes: found.length });
    routes.push(...found);
  };

  if (framework.includes('Next.js') || framework.includes('Next')) {
    routes.push(...scanNextJsRoutes(dir));
  }

  if (framework.includes('Express') || !framework) {
    routes.push(...scanExpressRoutes(dir, roots));
  }

  if (framework.includes('Fastify')) {
    routes.push(...scanFastifyRoutes(dir, roots));
  }

  if (framework.includes('Hono')) {
    routes.push(...scanHonoRoutes(dir, roots));
  }

  if (named('Spring', 'Java')) {
    patternScan(named('Spring Boot', 'Spring', 'Java'), ['spring-boot'], scanSpringBootRoutes);
  }

  if (named('Rails', 'Ruby')) {
    patternScan(named('Rails', 'Ruby'), ['rails'], scanRailsRoutes);
  }

  if (named('Gin', 'Echo', 'Chi', 'Fiber', 'Go')) {
    patternScan(named('Gin', 'Echo', 'Chi', 'Fiber', 'Go'), ['go-web'], scanGoWebRoutes);
  }

  if (named('Axum', 'Actix', 'Rocket', 'Warp', 'Rust')) {
    patternScan(named('Axum', 'Actix', 'Rocket', 'Warp', 'Rust'), ['axum', 'actix', 'rocket'], scanRustWebRoutes);
  }

  // Python: one scan resolves FastAPI/Flask routers and Django URL
  // configurations from the same module outlines (python-routes.mjs), and
  // records each file's parser tier with the scan.
  let limitations = null;
  const django = framework.includes('Django');
  const asgi = framework.includes('FastAPI') || framework.includes('Flask');
  if (django || asgi) {
    const pyFiles = findRouteFiles(dir, /\.py$/, { maxFiles });
    if (pyFiles.truncated) scan.truncated = true;
    const py = scanPythonWebRoutes(dir, { django, asgi }, { files: pyFiles });
    scan.tierItems.push(...py.fileTiers);
    limitations = py.limitations || null;
    routes.push(...py);
  }

  // Deduplicate by method+path, and drop routes that live in non-product dirs
  // (tests/fixtures/examples) so a fixtures dir with fake routes doesn't pollute
  // the API surface. Filtering the RESULTS (route.file → project-relative) keeps
  // the per-framework walkers as-is. v0.26 (Bug #1): isNonProductPath applies by
  // DEFAULT (no .docguardignore needed); shouldIgnore honors explicit config.
  const cfg = opts.config || {};
  const seen = new Set();
  const kept = routes.filter(r => {
    const key = `${r.method}:${r.path}`;
    if (r.file) {
      const rel = relPosix(dir, resolve(dir, r.file));
      if (isNonProductPath(rel, cfg)) { scan.excludedNonProduct++; return false; }
      if (shouldIgnore(rel, cfg)) return false;
    }
    // Filter non-product and ignored evidence before deduplication. Otherwise a
    // test request can reserve the same method/path key as a real route, get
    // filtered out, and silently remove the product route that appears later.
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Carry the scan's analyzer tier past the filter. It describes the SCAN, not
  // any single route, so it must survive even when the filter empties the list
  // — an empty result from a degraded tier is precisely the case a caller has
  // to know about. (calibrated-finding-channels#FR-011)
  const scanTier = scan.tierItems.length ? summarizeTiers(scan.tierItems) : null;
  if (scanTier) Object.defineProperty(kept, 'scanTier', { value: scanTier, enumerable: false });
  if (limitations?.length) Object.defineProperty(kept, 'limitations', { value: limitations, enumerable: false });
  for (const pf of scan.patternFrameworks) pf.kept = kept.filter(r => pf.sources.includes(r.source)).length;
  Object.defineProperty(kept, 'scan', {
    enumerable: false,
    value: {
      tier: scanTier,
      files: scan.tierItems.length,
      truncated: scan.truncated,
      cap: scan.cap,
      patternFrameworks: scan.patternFrameworks,
      excludedNonProduct: scan.excludedNonProduct,
    },
  });
  return kept;
}

// ── Next.js App Router ──────────────────────────────────────────────────────

function scanNextJsRoutes(dir) {
  const routes = [];

  // App Router: app/api/**/route.{ts,js}
  const appDirs = ['app/api', 'src/app/api'];
  for (const appDir of appDirs) {
    const fullDir = resolve(dir, appDir);
    if (!existsSync(fullDir)) continue;

    walkRouteDirs(fullDir, (filePath) => {
      const name = basename(filePath);
      if (!/^route\.(ts|tsx|js|jsx|mjs)$/.test(name)) return;

      const content = readFileSafe(filePath);
      if (!content) return;

      // Path from directory structure. The HTTP base in Next.js App Router is
      // `/api/...` — Next strips everything up to and including the `app/`
      // segment. Compute the relative path from the directory ABOVE `api/`
      // so both `app/api` (no src layout) and `src/app/api` (src layout)
      // produce `/api/<segments>`. Previously `appDir.split('/')[0]` stripped
      // only `src/` for the src layout, leaking `app/` into the emitted path.
      const apiBase = appDir.slice(0, appDir.lastIndexOf('/'));
      const relDir = relative(resolve(dir, apiBase), dirname(filePath));
      const apiPath = '/' + relDir
        .replace(/\\/g, '/')
        // Strip route-group segments like `(admin)` — they organize files but
        // do NOT appear in the URL. The frontend scanner already does this; the
        // route scanner used to leak them, e.g. `/api/(admin)/users`.
        .split('/')
        .filter(seg => seg && !/^\(.*\)$/.test(seg))
        .join('/')
        .replace(/\[\[\.\.\.(\w+)\]\]/g, ':$1*')  // Optional catch-all [[...slug]] — before [...slug]
        .replace(/\[\.\.\.(\w+)\]/g, ':$1*')        // Catch-all [...slug]
        .replace(/\[(\w+)\]/g, ':$1');               // Dynamic [id]

      // Extract exported HTTP methods
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      for (const method of methods) {
        // Match: export async function GET, export function GET, export const GET
        const patterns = [
          new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`),
          new RegExp(`export\\s+(?:const|let)\\s+${method}\\s*=`),
        ];
        for (const pattern of patterns) {
          if (pattern.test(content)) {
            routes.push({
              method,
              path: apiPath,
              handler: method,
              file: relative(dir, filePath),
              source: 'nextjs-app-router',
              auth: hasAuthCheck(content),
              description: extractJSDocDescription(content, method),
            });
            break;
          }
        }
      }
    });
  }

  // Pages Router: pages/api/**/*.{ts,js}
  const pagesDirs = ['pages/api', 'src/pages/api'];
  for (const pagesDir of pagesDirs) {
    const fullDir = resolve(dir, pagesDir);
    if (!existsSync(fullDir)) continue;

    walkRouteDirs(fullDir, (filePath) => {
      const ext = extname(filePath);
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) return;
      const name = basename(filePath, ext);
      if (name.startsWith('_')) return; // Skip _middleware, _document, etc.

      const content = readFileSafe(filePath);
      if (!content) return;

      // Path from file structure
      const relPath = relative(fullDir, filePath);
      const apiPath = '/api/' + relPath
        .replace(/\\/g, '/')
        .replace(extname(relPath), '')
        .replace(/index$/, '')
        .replace(/\[\.\.\.(\w+)\]/g, ':$1*')
        .replace(/\[(\w+)\]/g, ':$1')
        .replace(/\/$/, '');

      // Detect methods from req.method checks
      const detectedMethods = detectMethodsFromHandler(content);

      for (const method of detectedMethods) {
        routes.push({
          method,
          path: apiPath || '/api',
          handler: `${name}Handler`,
          file: relative(dir, filePath),
          source: 'nextjs-pages-router',
          auth: hasAuthCheck(content),
          description: extractJSDocDescription(content),
        });
      }
    });
  }

  return routes;
}

// ── Express / Generic Node.js ───────────────────────────────────────────────

function scanExpressRoutes(dir, roots = null) {
  // Regex is the FALLBACK (used only when @babel/parser can't parse a file).
  // It hardcodes app/router/server receivers; the AST path matches any receiver.
  const routePattern = /(?:app|router|server)\s*\.\s*(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  // ── Phase 0: collect every candidate file ONCE ──────────────────────────────
  // The mount map (phase 1) and the route emit (phase 2) must see the same set,
  // and we don't want to walk the tree twice.
  const files = [];                 // { content, filePath, fileLabel }
  const seenPaths = new Set();
  const addFile = (filePath, fileLabel) => {
    if (seenPaths.has(filePath)) return;
    const content = readFileSafe(filePath);
    if (!content) return;
    seenPaths.add(filePath);
    files.push({ content, filePath, fileLabel });
  };
  // Monorepo-aware: walk resolved absolute source roots when provided,
  // otherwise fall back to conventional root-relative directories.
  const searchTargets = roots && roots.length
    ? roots
    : ['src', 'routes', 'api', 'server', 'lib'].map(d => resolve(dir, d));
  for (const fullDir of searchTargets) {
    if (!existsSync(fullDir)) continue;
    walkRouteDirs(fullDir, (filePath) => {
      if (isJSFile(filePath)) addFile(filePath, relative(dir, filePath));
    });
  }
  for (const rootFile of ['app.js', 'app.mjs', 'app.ts', 'server.js', 'server.ts', 'index.js', 'index.ts']) {
    const filePath = resolve(dir, rootFile);
    if (existsSync(filePath)) addFile(filePath, rootFile);
  }

  // ── Phase 1: build the mount map ────────────────────────────────────────────
  // absFilePath -> [{ receiver|null, prefix }].  `receiver === null` means the
  // prefix applies to EVERY route in that file (an imported sub-router); a
  // non-null receiver means it applies only to routes whose receiver matches
  // (a same-file `const r = Router(); app.use('/api', r)` — so a sibling
  // `app.get('/health')` in the same file is NOT wrongly prefixed).
  const mountMap = buildExpressMountMap(files);

  // ── Phase 2: emit routes, prefixing by mount where known ────────────────────
  const routes = [];
  for (const { content, filePath, fileLabel } of files) {
    const mounts = mountMap.get(filePath) || [];
    const emit = (method, path, index, receiver) => {
      const prefixes = mounts
        .filter(m => m.receiver === null || m.receiver === receiver)
        .map(m => m.prefix);
      const finalPaths = prefixes.length ? prefixes.map(p => joinRoutePath(p, path)) : [path];
      for (const fullPath of finalPaths) {
        routes.push({
          method: method.toUpperCase(),
          path: fullPath,
          handler: extractHandlerName(content, index),
          file: fileLabel,
          source: 'express',
          auth: hasAuthMiddleware(content, path),
          description: extractNearbyComment(content, index),
        });
      }
    };
    const ast = extractJsRouteCalls(content, filePath);
    if (ast) {
      for (const r of ast) emit(r.method, r.path, r.start, r.receiver ?? null);
    } else {
      const regex = new RegExp(routePattern.source, 'gi');
      let match;
      while ((match = regex.exec(content)) !== null) emit(match[1], match[2], match.index, null);
    }
  }

  return routes;
}

/**
 * Build the Express mount map from the collected files (phase 1 above).
 * For each `<x>.use('/prefix', router)`:
 *   - router is an IMPORTED binding  → the prefix applies to ALL routes in the
 *     resolved target file (receiver: null). One router per file is the norm.
 *   - router is a LOCAL identifier    → the prefix applies only to that file's
 *     routes whose receiver matches (receiver: ident).
 *
 * Imported-router mounts are composed transitively, so
 * `app.use('/api', api)` plus `api.use('/x', x)` yields `/api/x`. Dynamic mount
 * paths (non-string-literal prefixes) are skipped. Unmounted files keep their
 * bare paths — exactly the pre-mount-map behavior.
 */
function buildExpressMountMap(files) {
  const map = new Map();
  const add = (absFile, receiver, prefix) => {
    if (!map.has(absFile)) map.set(absFile, []);
    map.get(absFile).push({ receiver, prefix });
  };
  const metadata = new Map();
  for (const { content, filePath } of files) {
    const mi = extractJsMountsAndImports(content, filePath);
    if (mi) metadata.set(filePath, mi);
  }

  const edges = [];
  for (const { filePath } of files) {
    const mi = metadata.get(filePath);
    if (!mi) continue;
    for (const { prefix, ident, receiver } of mi.mounts) {
      const spec = mi.imports[ident];
      if (spec) {
        const target = resolveLocalImport(filePath, spec);
        const targetMeta = target ? metadata.get(target) : null;
        if (!targetMeta) continue;
        const importedSymbol = mi.importSymbols?.[ident];
        const targetReceiver = importedSymbol === 'default'
          ? (targetMeta.exports?.default ?? null)
          : importedSymbol && importedSymbol !== '*'
            ? (targetMeta.exports?.[importedSymbol] ?? importedSymbol)
            : null;
        const targetRouteReceivers = new Set(targetMeta.routeReceivers || []);
        const targetMountReceivers = new Set((targetMeta.mounts || []).map(mount => mount.receiver));
        if (targetReceiver !== null &&
            !targetRouteReceivers.has(targetReceiver) &&
            !targetMountReceivers.has(targetReceiver)) continue;
        if (targetReceiver === null && targetRouteReceivers.size === 0 && targetMountReceivers.size === 0) continue;
        edges.push({
          from: { file: filePath, receiver },
          to: { file: target, receiver: targetReceiver },
          prefix,
        });
      } else {
        const routeReceivers = new Set(mi.routeReceivers || []);
        const mountReceivers = new Set((mi.mounts || []).map(mount => mount.receiver));
        if (!routeReceivers.has(ident) && !mountReceivers.has(ident)) continue;
        edges.push({
          from: { file: filePath, receiver },
          to: { file: filePath, receiver: ident },
          prefix,
        });
      }
    }
  }

  const nodeKey = node => `${node.file}\0${node.receiver ?? '*'}`;
  const incoming = new Map();
  const nodes = new Map();
  for (const edge of edges) {
    const key = nodeKey(edge.to);
    nodes.set(key, edge.to);
    if (!incoming.has(key)) incoming.set(key, []);
    incoming.get(key).push(edge);
  }
  const memo = new Map();
  const effectivePrefixes = (node, visiting = new Set(), depth = 0) => {
    const key = nodeKey(node);
    if (memo.has(key)) return memo.get(key);
    if (visiting.has(key) || depth > 32) return [];
    const nodeEdges = incoming.get(key) || [];
    if (nodeEdges.length === 0) return [];
    const nextVisiting = new Set(visiting).add(key);
    const prefixes = new Set();
    for (const edge of nodeEdges) {
      const parentKey = nodeKey(edge.from);
      const parentHasIncoming = (incoming.get(parentKey) || []).length > 0;
      const parentPrefixes = parentHasIncoming
        ? effectivePrefixes(edge.from, nextVisiting, depth + 1)
        : [''];
      for (const parentPrefix of parentPrefixes) {
        prefixes.add(joinRoutePath(parentPrefix, edge.prefix));
        if (prefixes.size >= 256) break;
      }
      if (prefixes.size >= 256) break;
    }
    const resolved = [...prefixes];
    memo.set(key, resolved);
    return resolved;
  };

  for (const node of nodes.values()) {
    for (const prefix of effectivePrefixes(node)) add(node.file, node.receiver, prefix);
  }
  return map;
}

/** Resolve a RELATIVE import specifier to an absolute file path (best effort). */
function resolveLocalImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // bare/node_modules specifiers aren't our routers
  const base = resolve(dirname(fromFile), spec);
  for (const ext of ['', '.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx']) {
    const cand = base + ext;
    try { if (existsSync(cand) && statSync(cand).isFile()) return cand; } catch { /* skip */ }
  }
  for (const idx of ['index.ts', 'index.js', 'index.mjs']) {
    const cand = join(base, idx);
    try { if (existsSync(cand) && statSync(cand).isFile()) return cand; } catch { /* skip */ }
  }
  return null;
}

/** Join a mount prefix and a route path into one normalized `/a/b` path. */
function joinRoutePath(prefix, p) {
  if (!prefix) return p;
  const left = prefix.replace(/\/+$/, '');        // drop trailing slash(es)
  const right = (p === '/' || p === '') ? '' : ('/' + p.replace(/^\/+/, '')); // single leading slash
  const joined = left + right;
  return joined || '/';
}

// ── Fastify ─────────────────────────────────────────────────────────────────

function scanFastifyRoutes(dir, roots = null) {
  const routes = [];
  const pattern = /(?:fastify|server|app)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  const searchTargets = roots && roots.length ? roots : [resolve(dir, 'src')];
  for (const fullDir of searchTargets) {
    if (!existsSync(fullDir)) continue;
    walkRouteDirs(fullDir, (filePath) => {
      if (!isJSFile(filePath)) return;
      const content = readFileSafe(filePath);
      if (!content) return;

      const emit = (method, path, index) => routes.push({
        method: method.toUpperCase(),
        path,
        handler: extractHandlerName(content, index),
        file: relative(dir, filePath),
        source: 'fastify',
        auth: hasAuthCheck(content),
        description: extractNearbyComment(content, index),
      });

      // AST-first: method shorthand (fastify.get('/x')) AND the declarative
      // object form (fastify.route({ method, url })) the regex never matched.
      // Both return null only on parse failure → regex fallback.
      const calls = extractJsRouteCalls(content, filePath);
      const objs = extractJsRouteObjects(content, filePath);
      if (calls || objs) {
        for (const r of calls || []) emit(r.method, r.path, r.start);
        for (const r of objs || []) emit(r.method, r.path, r.start);
      } else {
        let match;
        const regex = new RegExp(pattern.source, 'gi');
        while ((match = regex.exec(content)) !== null) emit(match[1], match[2], match.index);
      }
    });
  }

  return routes;
}

// ── Hono ────────────────────────────────────────────────────────────────────

function scanHonoRoutes(dir, roots = null) {
  const routes = [];
  const pattern = /(?:app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  const searchTargets = roots && roots.length
    ? roots
    : ['src', '.'].map(d => resolve(dir, d));
  for (const fullDir of searchTargets) {
    if (!existsSync(fullDir)) continue;

    walkRouteDirs(fullDir, (filePath) => {
      if (!isJSFile(filePath)) return;
      const content = readFileSafe(filePath);
      if (!content) return;

      const emit = (method, path, index) => routes.push({
        method: method.toUpperCase(),
        path,
        handler: '',
        file: relative(dir, filePath),
        source: 'hono',
        auth: hasAuthCheck(content),
        description: extractNearbyComment(content, index),
      });

      // AST-first (any receiver, multi-line, template paths — Hono/Koa method
      // shorthand `app.get('/x')` / `router.get('/x')`); regex fallback.
      const calls = extractJsRouteCalls(content, filePath);
      if (calls) {
        for (const r of calls) emit(r.method, r.path, r.start);
      } else {
        let match;
        const regex = new RegExp(pattern.source, 'gi');
        while ((match = regex.exec(content)) !== null) emit(match[1], match[2], match.index);
      }
    });
  }

  return routes;
}

// ── Spring Boot (Java/Kotlin) ────────────────────────────────────────────────
// What a Java/Kotlin file routes is read by spring-routes.mjs: class-level
// @RequestMapping bases in every form, method-level mappings and
// @RequestMapping(method = …), constants, Feign clients skipped
// (docguard.go-spring-rails-routes#FR-003/004). Constants may live in files
// without a mapping, so every file is handed over.

function scanSpringBootRoutes(dir, ctx) {
  // docguard.fallback-language-coverage: files are listed (and counted for
  // coverage) by readPatternFiles; each route carries its pattern tier.
  const files = readPatternFiles(ctx, /\.(java|kt)$/);
  const sources = files.map(f => ({ file: relative(dir, f), content: readFileSafe(f) }));
  return extractSpringRoutes(sources).map(r => ({ ...r, source: 'spring-boot', description: '', ...tierFor(resolve(dir, r.file), null) }));
}

// ── Rails (Ruby) — config/routes.rb ──────────────────────────────────────────
// rails-routes.mjs reads namespace/scope prefixes, resources/resource with
// only/except, nesting, member/collection, verbs, match, root, concerns and
// `draw` files (docguard.go-spring-rails-routes#FR-005).

function scanRailsRoutes(dir, ctx) {
  const routesFile = resolve(dir, 'config/routes.rb');
  if (!existsSync(routesFile)) return [];
  recordPatternFiles(ctx, [routesFile]);
  const { tier, tierReason } = tierFor(routesFile, null);
  // `draw :admin` loads config/routes/admin.rb; a name is never a path.
  const readDraw = name => {
    if (!/^[\w-]+$/.test(name)) return null;
    const drawFile = resolve(dir, 'config/routes', `${name}.rb`);
    if (existsSync(drawFile)) recordPatternFiles(ctx, [drawFile]);
    return readFileSafe(drawFile);
  };
  return extractRailsRoutes(readFileSafe(routesFile), { file: 'config/routes.rb', readDraw })
    .map(r => ({ ...r, source: 'rails', description: '', tier, tierReason }));
}

// ── Go web frameworks (Gin / Echo / Chi / Fiber / gorilla/mux / net/http) ────
// go-routes.mjs composes group, sub-router and mount prefixes across blocks,
// functions and files, and reads every registration form of those routers
// (docguard.go-spring-rails-routes#FR-001/002).

function scanGoWebRoutes(dir, ctx) {
  const files = readPatternFiles(ctx, /\.go$/);
  const sources = files.map(f => ({ file: relative(dir, f), content: readFileSafe(f) }));
  return extractGoRoutes(sources).map(r => ({ ...r, source: 'go-web', description: '', ...tierFor(resolve(dir, r.file), null) }));
}

// ── Rust web frameworks (Axum / Actix / Rocket / Warp) ───────────────────────

function scanRustWebRoutes(dir, ctx) {
  const routes = [];
  const rsFiles = readPatternFiles(ctx, /\.rs$/);
  for (const filePath of rsFiles) {
    const content = readFileSafe(filePath);
    if (!content) continue;
    const { tier, tierReason } = tierFor(filePath, null);

    // Axum: .route("/x", get(handler)) / .route("/x", post(handler).get(handler))
    const axum = /\.route\s*\(\s*"([^"]+)"\s*,\s*([a-z]+)\s*\(/g;
    let m;
    while ((m = axum.exec(content)) !== null) {
      const method = m[2].toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method)) continue;
      routes.push({ method, path: m[1], handler: '', file: relative(dir, filePath), source: 'axum', auth: false, description: '', tier, tierReason });
    }

    // Actix-web: .route("/x", web::get().to(handler))
    const actix = /\.route\s*\(\s*"([^"]+)"\s*,\s*web::(get|post|put|delete|patch)\(\)/g;
    while ((m = actix.exec(content)) !== null) {
      routes.push({ method: m[2].toUpperCase(), path: m[1], handler: '', file: relative(dir, filePath), source: 'actix', auth: false, description: '', tier, tierReason });
    }

    // Rocket: #[get("/x")] etc.
    const rocket = /#\[(get|post|put|delete|patch)\(\s*"([^"]+)"/g;
    while ((m = rocket.exec(content)) !== null) {
      routes.push({ method: m[1].toUpperCase(), path: m[2], handler: '', file: relative(dir, filePath), source: 'rocket', auth: false, description: '', tier, tierReason });
    }
  }
  return routes;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readFileSafe(path) {
  return readScannable(path); // size-capped; skips minified/generated bundles
}

function isJSFile(path) {
  return /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(path);
}

function walkRouteDirs(dir, callback) {
  if (!existsSync(dir)) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkRouteDirs(fullPath, callback);
      } else if (entry.isFile()) {
        callback(fullPath);
      }
    }
  } catch { /* skip */ }
}

/** Files one route scan may read; reaching it is disclosed, never silent. */
export const ROUTE_SCAN_MAX_FILES = 20000;
/** Directory depth bound for route discovery; far below any real limit, far above Maven's. */
export const ROUTE_SCAN_MAX_DEPTH = 32;

/**
 * Files under `dir` whose name matches `pattern`, for route scanning.
 *
 * This walk stopped at depth 5, and a Spring controller in a standard Maven
 * layout (`src/main/java/com/acme/shop/web/X.java`) sits at depth 7 or more, so
 * a Spring service had zero routes and its API surface read as empty. The
 * bounds now are the ignore rules (node_modules, vendor, target, build, …), a
 * depth of 32 and a file cap. `withFileTypes` never follows a symlinked
 * directory, so the walk cannot loop. The returned array carries `truncated`
 * when the cap stopped it, so the caller can report partial coverage.
 *
 * @implements docguard.fallback-language-coverage#FR-008
 * @returns {string[] & { truncated: boolean }}
 */
export function findRouteFiles(dir, pattern, { maxFiles = ROUTE_SCAN_MAX_FILES, maxDepth = ROUTE_SCAN_MAX_DEPTH } = {}) {
  const results = [];
  let truncated = false;
  function walk(d, depth) {
    if (truncated || depth > maxDepth || !existsSync(d)) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) walk(fullPath, depth + 1);
      else if (entry.isFile() && pattern.test(entry.name)) {
        if (results.length >= maxFiles) { truncated = true; return; }
        results.push(fullPath);
      }
      if (truncated) return;
    }
  }
  walk(dir, 0);
  Object.defineProperty(results, 'truncated', { value: truncated, enumerable: false });
  return results;
}

/** Read a pattern-only language's files and record each one's tier with the scan. */
function readPatternFiles(ctx, pattern) {
  const files = findRouteFiles(ctx.dir, pattern, { maxFiles: ctx.maxFiles });
  if (files.truncated) ctx.scan.truncated = true;
  recordPatternFiles(ctx, files);
  return files;
}

function recordPatternFiles(ctx, files) {
  for (const f of files) ctx.scan.tierItems.push({ ...tierFor(f, null), file: relative(ctx.dir, f) });
}

function hasAuthCheck(content) {
  const authPatterns = [
    /getServerSession/, /getSession/, /getToken/,
    /auth\(\)/, /authenticate/, /isAuthenticated/,
    /requireAuth/, /withAuth/, /protect/,
    /Authorization/, /Bearer/, /jwt\.verify/,
    /req\.user/, /req\.auth/,
  ];
  return authPatterns.some(p => p.test(content));
}

function hasAuthMiddleware(content, routePath) {
  // Check if route has auth middleware before handler
  const pattern = new RegExp(
    `['"\`]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]\\s*,\\s*(auth|protect|requireAuth|isAuthenticated|authenticate)`,
    'i'
  );
  return pattern.test(content) || hasAuthCheck(content);
}

function detectMethodsFromHandler(content) {
  const methods = new Set();
  if (/req\.method\s*===?\s*['"]GET['"]/i.test(content) || /case\s+['"]GET['"]/i.test(content)) methods.add('GET');
  if (/req\.method\s*===?\s*['"]POST['"]/i.test(content) || /case\s+['"]POST['"]/i.test(content)) methods.add('POST');
  if (/req\.method\s*===?\s*['"]PUT['"]/i.test(content) || /case\s+['"]PUT['"]/i.test(content)) methods.add('PUT');
  if (/req\.method\s*===?\s*['"]DELETE['"]/i.test(content) || /case\s+['"]DELETE['"]/i.test(content)) methods.add('DELETE');
  if (/req\.method\s*===?\s*['"]PATCH['"]/i.test(content) || /case\s+['"]PATCH['"]/i.test(content)) methods.add('PATCH');
  if (methods.size === 0) methods.add('ALL'); // Default handler
  return [...methods];
}

function extractHandlerName(content, matchIndex) {
  // Look for function name after the route path
  const after = content.substring(matchIndex, matchIndex + 200);
  const fnMatch = after.match(/,\s*(?:async\s+)?(\w+)/);
  return fnMatch ? fnMatch[1] : '';
}

function extractJSDocDescription(content, methodName) {
  // Look for JSDoc comment before the method export
  const pattern = new RegExp(`/\\*\\*\\s*\\n([^*]*(?:\\*[^/][^*]*)*?)\\*/\\s*\\n\\s*export\\s+(?:async\\s+)?function\\s+${methodName || ''}`, 'i');
  const match = pattern.exec(content);
  if (match) {
    return match[1].replace(/\s*\*\s*/g, ' ').trim().split('.')[0];
  }
  return '';
}

function extractNearbyComment(content, index) {
  // Look for comment on the line before the match
  const before = content.substring(Math.max(0, index - 200), index);
  const lines = before.split('\n');
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
    const line = lines[i].trim();
    if (line.startsWith('//')) return line.replace(/^\/\/\s*/, '');
    if (line.startsWith('*') && !line.startsWith('*/')) return line.replace(/^\*\s*/, '');
  }
  return '';
}
