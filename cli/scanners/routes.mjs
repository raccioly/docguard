/**
 * Deep Route Scanner
 * Parses actual route definitions from source code across frameworks.
 * Supports: Next.js (App Router + Pages), Express, Fastify, Hono, Django, FastAPI
 * 
 * Priority: OpenAPI spec > Code scanning
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, basename, extname, dirname } from 'node:path';
import { resolveSourceRoots, readScannable } from '../shared-source.mjs';
import { DEFAULT_IGNORE_DIRS as IGNORE_DIRS, shouldIgnore, relPosix, isNonProductPath } from '../shared-ignore.mjs';
import { extractJsRouteCalls, extractJsRouteObjects, extractJsMountsAndImports } from './js-ast.mjs';
import { extractPythonFiles } from './py-ast.mjs';

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

  if (framework.includes('Django')) {
    routes.push(...scanDjangoRoutes(dir));
  }

  if (framework.includes('Spring') || framework.includes('Java')) {
    routes.push(...scanSpringBootRoutes(dir));
  }

  if (framework.includes('Rails') || framework.includes('Ruby')) {
    routes.push(...scanRailsRoutes(dir));
  }

  if (framework.includes('Gin') || framework.includes('Echo') || framework.includes('Chi') || framework.includes('Fiber') || framework.includes('Go')) {
    routes.push(...scanGoWebRoutes(dir));
  }

  if (framework.includes('Axum') || framework.includes('Actix') || framework.includes('Rocket') || framework.includes('Warp') || framework.includes('Rust')) {
    routes.push(...scanRustWebRoutes(dir));
  }

  if (framework.includes('FastAPI') || framework.includes('Flask')) {
    routes.push(...scanFastAPIRoutes(dir));
  }

  // Deduplicate by method+path, and drop routes that live in non-product dirs
  // (tests/fixtures/examples) so a fixtures dir with fake routes doesn't pollute
  // the API surface. Filtering the RESULTS (route.file → project-relative) keeps
  // the per-framework walkers as-is. v0.26 (Bug #1): isNonProductPath applies by
  // DEFAULT (no .docguardignore needed); shouldIgnore honors explicit config.
  const cfg = opts.config || {};
  const seen = new Set();
  return routes.filter(r => {
    const key = `${r.method}:${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (r.file) {
      const rel = relPosix(dir, resolve(dir, r.file));
      if (isNonProductPath(rel, cfg)) return false;
      if (shouldIgnore(rel, cfg)) return false;
    }
    return true;
  });
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
  // PERFORMANCE OPTIMIZATION: Hoist regex instantiation out of the file loop
  const routeRegex = new RegExp(routePattern.source, 'gi');
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
      routeRegex.lastIndex = 0;
      let match;
      while ((match = routeRegex.exec(content)) !== null) emit(match[1], match[2], match.index, null);
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
 * Known limitations (documented, not silently wrong): transitive composition
 * (`app.use('/api', api)` then `api.use('/x', x)` does NOT yield `/api/x`), and
 * dynamic mount paths (non-string-literal prefixes) are skipped. Unmounted
 * files keep their bare paths — exactly the pre-mount-map behavior.
 */
function buildExpressMountMap(files) {
  const map = new Map();
  const add = (absFile, receiver, prefix) => {
    if (!map.has(absFile)) map.set(absFile, []);
    map.get(absFile).push({ receiver, prefix });
  };
  for (const { content, filePath } of files) {
    const mi = extractJsMountsAndImports(content, filePath);
    if (!mi) continue;
    for (const { prefix, ident } of mi.mounts) {
      const spec = mi.imports[ident];
      if (spec) {
        const target = resolveLocalImport(filePath, spec);
        if (target) add(target, null, prefix);
      } else {
        add(filePath, ident, prefix);
      }
    }
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
  // PERFORMANCE OPTIMIZATION: Hoist regex instantiation out of the file loop
  const patternRegex = new RegExp(pattern.source, 'gi');

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
        patternRegex.lastIndex = 0;
        while ((match = patternRegex.exec(content)) !== null) emit(match[1], match[2], match.index);
      }
    });
  }

  return routes;
}

// ── Hono ────────────────────────────────────────────────────────────────────

function scanHonoRoutes(dir, roots = null) {
  const routes = [];
  const pattern = /(?:app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  // PERFORMANCE OPTIMIZATION: Hoist regex instantiation out of the file loop
  const patternRegex = new RegExp(pattern.source, 'gi');

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
        patternRegex.lastIndex = 0;
        while ((match = patternRegex.exec(content)) !== null) emit(match[1], match[2], match.index);
      }
    });
  }

  return routes;
}

// ── Django ───────────────────────────────────────────────────────────────────

function scanDjangoRoutes(dir) {
  const routes = [];
  const urlsFiles = findFiles(dir, /urls\.py$/);

  for (const filePath of urlsFiles) {
    const content = readFileSafe(filePath);
    if (!content) continue;

    // Match: path('api/users/', views.user_list, name='user-list')
    const pathPattern = /path\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+[\w.]*)/g;
    let match;
    while ((match = pathPattern.exec(content)) !== null) {
      routes.push({
        method: 'ALL',
        path: '/' + match[1],
        handler: match[2],
        file: relative(dir, filePath),
        source: 'django',
        auth: false,
        description: '',
      });
    }
  }

  return routes;
}

// ── FastAPI / Flask ─────────────────────────────────────────────────────────

function scanFastAPIRoutes(dir) {
  const routes = [];
  const pattern = /@(?:app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi;
  // PERFORMANCE OPTIMIZATION: Hoist regex instantiation out of the file loop
  const patternRegex = new RegExp(pattern.source, 'gi');

  const pyFiles = findFiles(dir, /\.py$/);
  // AST-first: ONE python3 subprocess parses every file. `null` means Python is
  // unavailable or the subprocess failed → regex fallback for all files. A
  // per-file `ok:false` falls back for just that file. The AST form also reads
  // multi-line decorators and Flask `methods=[...]` arrays the regex misses.
  const astByFile = extractPythonFiles(pyFiles);

  for (const filePath of pyFiles) {
    const content = readFileSafe(filePath);
    if (!content) continue;

    const parsed = astByFile && astByFile[filePath];
    const fileAuth = content.includes('Depends(') && content.includes('auth');
    if (parsed && parsed.ok) {
      for (const r of parsed.routes || []) {
        routes.push({
          method: r.method,
          path: r.path,
          handler: r.func || '',
          file: relative(dir, filePath),
          source: 'fastapi',
          auth: fileAuth,
          description: r.desc || '',
        });
      }
      continue;
    }

    let match;
    patternRegex.lastIndex = 0;
    while ((match = patternRegex.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        handler: extractPythonFunctionName(content, match.index),
        file: relative(dir, filePath),
        source: 'fastapi',
        auth: fileAuth,
        description: extractPythonDocstring(content, match.index),
      });
    }
  }

  return routes;
}

// ── Spring Boot (Java/Kotlin) ────────────────────────────────────────────────

function scanSpringBootRoutes(dir) {
  const routes = [];
  // Method-level verb annotations (NOT @RequestMapping — that's class-level base).
  // Optional path; bare `@PostMapping` means "base path only".
  const verbMap = /@(Get|Post|Put|Delete|Patch)Mapping(?:\s*\(\s*(?:value\s*=\s*)?["']([^"']*)["'])?/g;
  const classBase = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["'][^)]*\)\s*[\r\n][\s\S]*?(?:public\s+)?class\s+\w+/;
  // PERFORMANCE OPTIMIZATION: Hoist regex instantiation out of the file loop
  const verbMapRegex = new RegExp(verbMap.source, 'g');

  const javaFiles = findFiles(dir, /\.(java|kt)$/);
  for (const filePath of javaFiles) {
    const content = readFileSafe(filePath);
    if (!content || !content.includes('Mapping')) continue;

    // Class-level base path, if any.
    const cb = classBase.exec(content);
    const basePath = cb ? cb[1] : '';
    const authPresent = /@PreAuthorize|@Secured|SecurityContext/.test(content);

    let match;
    verbMapRegex.lastIndex = 0;
    while ((match = verbMapRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const sub = match[2] || '';
      const path = (basePath + sub).replace(/\/+/g, '/') || '/';
      routes.push({
        method, path,
        handler: '', file: relative(dir, filePath), source: 'spring-boot',
        auth: authPresent, description: '',
      });
    }
  }
  return routes;
}

// ── Rails (Ruby) — config/routes.rb ──────────────────────────────────────────

function scanRailsRoutes(dir) {
  const routes = [];
  const routesFile = resolve(dir, 'config/routes.rb');
  if (!existsSync(routesFile)) return routes;
  const content = readFileSafe(routesFile);
  if (!content) return routes;

  // Verb DSL: get '/x', post '/x', etc.  AND  resources :things (RESTful 7 actions)
  const verbDsl = /^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/gm;
  let m;
  while ((m = verbDsl.exec(content)) !== null) {
    routes.push({
      method: m[1].toUpperCase(),
      path: m[2].startsWith('/') ? m[2] : '/' + m[2],
      handler: '', file: 'config/routes.rb', source: 'rails', auth: false, description: '',
    });
  }
  // resources :users → 7 standard RESTful routes.
  const resourcesRe = /^\s*resources\s+:([a-z_]+)/gm;
  while ((m = resourcesRe.exec(content)) !== null) {
    const r = m[1];
    const base = `/${r}`;
    const seven = [
      ['GET', base], ['GET', `${base}/new`], ['POST', base],
      ['GET', `${base}/:id`], ['GET', `${base}/:id/edit`],
      ['PATCH', `${base}/:id`], ['DELETE', `${base}/:id`],
    ];
    for (const [method, path] of seven) {
      routes.push({ method, path, handler: '', file: 'config/routes.rb', source: 'rails', auth: false, description: '' });
    }
  }
  return routes;
}

// ── Go web frameworks (Gin / Echo / Chi / Fiber / std mux) ───────────────────

function scanGoWebRoutes(dir) {
  const routes = [];
  // Generic: <recv>.<METHOD>("/path", handler)  for Gin/Echo/Chi/Fiber/mux.Router
  const pattern = /\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|HandleFunc|Handle)\s*\(\s*["']([^"']+)["']/g;
  // PERFORMANCE OPTIMIZATION: Hoist regex instantiation out of the file loop
  const patternRegex = new RegExp(pattern.source, 'g');
  const goFiles = findFiles(dir, /\.go$/);
  for (const filePath of goFiles) {
    const content = readFileSafe(filePath);
    if (!content) continue;
    let m;
    patternRegex.lastIndex = 0;
    while ((m = patternRegex.exec(content)) !== null) {
      const verb = m[1];
      // HandleFunc / Handle are method-agnostic.
      const method = ['HandleFunc', 'Handle'].includes(verb) ? 'ANY' : verb;
      const path = m[2];
      if (!path.startsWith('/')) continue;
      routes.push({
        method, path,
        handler: '', file: relative(dir, filePath), source: 'go-web',
        auth: /Authorization|jwt\.|middleware\.Auth/.test(content),
        description: '',
      });
    }
  }
  return routes;
}

// ── Rust web frameworks (Axum / Actix / Rocket / Warp) ───────────────────────

function scanRustWebRoutes(dir) {
  const routes = [];
  const rsFiles = findFiles(dir, /\.rs$/);
  for (const filePath of rsFiles) {
    const content = readFileSafe(filePath);
    if (!content) continue;

    // Axum: .route("/x", get(handler)) / .route("/x", post(handler).get(handler))
    const axum = /\.route\s*\(\s*"([^"]+)"\s*,\s*([a-z]+)\s*\(/g;
    let m;
    while ((m = axum.exec(content)) !== null) {
      const method = m[2].toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method)) continue;
      routes.push({ method, path: m[1], handler: '', file: relative(dir, filePath), source: 'axum', auth: false, description: '' });
    }

    // Actix-web: .route("/x", web::get().to(handler))
    const actix = /\.route\s*\(\s*"([^"]+)"\s*,\s*web::(get|post|put|delete|patch)\(\)/g;
    while ((m = actix.exec(content)) !== null) {
      routes.push({ method: m[2].toUpperCase(), path: m[1], handler: '', file: relative(dir, filePath), source: 'actix', auth: false, description: '' });
    }

    // Rocket: #[get("/x")] etc.
    const rocket = /#\[(get|post|put|delete|patch)\(\s*"([^"]+)"/g;
    while ((m = rocket.exec(content)) !== null) {
      routes.push({ method: m[1].toUpperCase(), path: m[2], handler: '', file: relative(dir, filePath), source: 'rocket', auth: false, description: '' });
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

function findFiles(dir, pattern, maxDepth = 5) {
  const results = [];
  function walk(d, depth) {
    if (depth > maxDepth || !existsSync(d)) return;
    try {
      const entries = readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        const fullPath = join(d, entry.name);
        if (entry.isDirectory()) walk(fullPath, depth + 1);
        else if (pattern.test(entry.name)) results.push(fullPath);
      }
    } catch { /* skip */ }
  }
  walk(dir, 0);
  return results;
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

function extractPythonFunctionName(content, index) {
  const after = content.substring(index, index + 300);
  const match = after.match(/def\s+(\w+)/);
  return match ? match[1] : '';
}

function extractPythonDocstring(content, index) {
  const after = content.substring(index, index + 500);
  const match = after.match(/"""([^"]+)"""/);
  return match ? match[1].trim().split('\n')[0] : '';
}
