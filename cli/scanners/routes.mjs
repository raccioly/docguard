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
import { extractJsRouteCalls, extractJsRouteObjects, extractJsMountsAndImports, nextRouteHandlers, isAuthMiddlewareName, AUTH_CHECK_RE, matchingBracket } from './js-ast.mjs';
import { createAliasResolver } from './ts-paths.mjs';
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

  if (framework.includes('Django')) {
    routes.push(...scanDjangoRoutes(dir, ctx));
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

  if (framework.includes('FastAPI') || framework.includes('Flask')) {
    routes.push(...scanFastAPIRoutes(dir, ctx));
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
  const middlewareAuth = nextMiddlewareAuth(dir);

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

      // Extract exported HTTP methods. Each handler is judged by its own body
      // (AST), or by its own export's text when the file does not parse, plus
      // a `middleware` file whose matcher covers the path
      // (docguard.js-ts-extraction#FR-002).
      const handlers = nextRouteHandlers(content, filePath);
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      for (const method of methods) {
        // Match: export async function GET, export function GET, export const GET
        const patterns = [
          new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`),
          new RegExp(`export\\s+(?:const|let)\\s+${method}\\s*=`),
        ];
        for (const pattern of patterns) {
          const match = pattern.exec(content);
          const viaAst = handlers?.get(method);
          if (match || viaAst) {
            routes.push({
              method,
              path: apiPath,
              handler: method,
              file: relative(dir, filePath),
              line: viaAst?.line ?? (match ? lineAt(content, match.index) : null),
              source: 'nextjs-app-router',
              auth: (viaAst ? viaAst.auth : exportSegmentAuth(content, match.index)) || middlewareAuth(apiPath),
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

      const defaultExport = /export\s+default\b/.exec(content);
      for (const method of detectedMethods) {
        routes.push({
          method,
          path: apiPath || '/api',
          handler: `${name}Handler`,
          file: relative(dir, filePath),
          line: defaultExport ? lineAt(content, defaultExport.index) : null,
          source: 'nextjs-pages-router',
          auth: hasAuthCheck(content) || middlewareAuth(apiPath || '/api'),
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
  const mountMap = buildExpressMountMap(files, createAliasResolver(dir));

  // ── Phase 2: emit routes, prefixing by mount where known ────────────────────
  // Auth is per route (docguard.js-ts-extraction#FR-002): the route's own
  // evidence, or auth middleware on a mount above it.
  const routes = [];
  for (const { content, filePath, fileLabel } of files) {
    const mounts = mountMap.get(filePath) || [];
    const emit = (r) => {
      const applicable = mounts.filter(m => m.receiver === null || m.receiver === r.receiver);
      const targets = applicable.length
        ? applicable.map(m => ({ path: joinRoutePath(m.prefix, r.path), auth: m.auth }))
        : [{ path: r.path, auth: false }];
      for (const target of targets) {
        routes.push({
          method: r.method.toUpperCase(),
          path: target.path,
          handler: r.handler ?? extractHandlerName(content, r.start),
          file: fileLabel,
          line: r.line ?? lineAt(content, r.start),
          source: 'express',
          auth: Boolean(r.auth || target.auth),
          description: extractNearbyComment(content, r.start),
        });
      }
    };
    const ast = extractJsRouteCalls(content, filePath);
    if (ast) {
      for (const r of ast) emit({ ...r, receiver: r.receiver ?? null });
    } else {
      const regex = new RegExp(routePattern.source, 'gi');
      let match;
      while ((match = regex.exec(content)) !== null) {
        emit({ method: match[1], path: match[2], start: match.index, receiver: null, auth: statementAuth(content, match.index) });
      }
      for (const r of routeChainsByPattern(content)) emit(r);
    }
  }

  return routes;
}

// ── Pattern-tier route chains and auth (docguard.js-ts-extraction#FR-001/002) ─

/** Top-level comma-separated argument texts of the call whose `(` is at `open`. */
function callArgs(content, open) {
  const close = matchingBracket(content, open);
  if (close < 0) return null;
  const args = [];
  let depth = 0, start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === '`') { for (i++; i < close && content[i] !== ch; i++) if (content[i] === '\\') i++; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) { args.push(content.slice(start, i).trim()); start = i + 1; }
  }
  const last = content.slice(start, close).trim();
  if (last) args.push(last);
  return { args, close };
}

/** Pattern-tier auth of one call's arguments (middleware + handler), text only. */
function argsAuth(content, middleware, handler) {
  const isAuthArg = (text) => {
    const m = /^([A-Za-z_$][\w$]*)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/.exec(text || '');
    return Boolean(m) && (isAuthMiddlewareName(m[1]) || isAuthMiddlewareName(m[2]));
  };
  if (middleware.some(text => text.startsWith('[') ? text.slice(1, -1).split(',').some(t => isAuthArg(t.trim())) : isAuthArg(text))) return true;
  if (!handler) return false;
  if (/^[A-Za-z_$][\w$]*$/.test(handler)) {
    const decl = new RegExp(`(?:function\\s+${handler}\\s*\\(|(?:const|let|var)\\s+${handler}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>))`).exec(content);
    if (!decl) return false;
    const brace = content.indexOf('{', decl.index + decl[0].length);
    const end = brace < 0 ? -1 : matchingBracket(content, brace);
    return end > 0 && AUTH_CHECK_RE.test(content.slice(decl.index, end + 1));
  }
  return AUTH_CHECK_RE.test(handler);
}

/**
 * Auth of the `<receiver>.<method>('/path', …)` call starting at `index` (pattern tier).
 * @implements docguard.js-ts-extraction#FR-002
 */
function statementAuth(content, index) {
  const open = content.indexOf('(', index);
  const call = open < 0 ? null : callArgs(content, open);
  if (!call || call.args.length < 2) return false;
  return argsAuth(content, call.args.slice(1, -1), call.args[call.args.length - 1]);
}

/**
 * `<x>.route('/p').get(…).post(…)` chains read by pattern when the file does not parse.
 * @implements docguard.js-ts-extraction#FR-001
 */
function routeChainsByPattern(content) {
  const out = [];
  const re = /\b([A-Za-z_$][\w$]*)\s*\.\s*route\s*\(\s*(['"`])([^'"`]+)\2\s*\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!/(?:app|server|router|routes)$/i.test(m[1])) continue;
    const path = m[3];
    if (!(path.startsWith('/') || path === '*')) continue;
    let i = m.index + m[0].length;
    for (;;) {
      const next = /^\s*\.\s*(get|post|put|delete|patch|head|options|all)\s*\(/i.exec(content.slice(i));
      if (!next) break;
      const open = i + next[0].length - 1;
      const call = callArgs(content, open);
      if (!call) break;
      const handler = call.args[call.args.length - 1];
      out.push({
        method: next[1], path, start: m.index, receiver: null,
        line: lineAt(content, i + next[0].indexOf(next[1])),
        handler: /^[A-Za-z_$][\w$]*$/.test(handler || '') ? handler : 'inline',
        auth: argsAuth(content, call.args.slice(0, -1), handler),
      });
      i = call.close + 1;
    }
  }
  return out;
}

/** 1-based line of a character offset. */
function lineAt(content, index) {
  if (typeof index !== 'number' || index < 0) return null;
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') line++;
  return line;
}

/** Pattern-tier auth of one Next.js export: its text up to the next export. */
function exportSegmentAuth(content, index) {
  const rest = content.slice(index + 6);
  const next = rest.search(/\nexport\s/);
  return AUTH_CHECK_RE.test(content.slice(index, next < 0 ? content.length : index + 6 + next));
}

const NEXT_MIDDLEWARE_FILES = ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js'];
const MIDDLEWARE_AUTH_RE = /next-auth\/middleware|\bwithAuth\b|\bclerkMiddleware\b|\bauthMiddleware\b|\bgetToken\s*\(|\bauth\s*\(|\bauth\s+as\s+middleware\b|\bjwtVerify\s*\(|\bjwt\s*\.\s*verify\s*\(|\bverifyToken\s*\(|\bgetServerSession\s*\(|\bgetSession\s*\(/;

/**
 * A predicate for "a Next.js `middleware` file with auth covers this path"
 * (docguard.js-ts-extraction#FR-002). No auth in the middleware → never. Auth
 * with no literal matcher → every path. Matchers use Next's path syntax
 * (`/api/admin/:path*`); only string literals are read.
 * @implements docguard.js-ts-extraction#FR-002
 */
function nextMiddlewareAuth(dir) {
  for (const rel of NEXT_MIDDLEWARE_FILES) {
    const abs = resolve(dir, rel);
    if (!existsSync(abs)) continue;
    const content = readFileSafe(abs);
    if (!content || !MIDDLEWARE_AUTH_RE.test(content)) return () => false;
    const matcher = /\bmatcher\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|`[^`]*`)/.exec(content);
    if (!matcher) return () => true;
    const patterns = [...matcher[1].matchAll(/(['"`])([^'"`]+)\1/g)].map(m => matcherRegex(m[2])).filter(Boolean);
    return (path) => patterns.some(re => re.test(path));
  }
  return () => false;
}

function matcherRegex(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length;) {
    const param = /^\/:(\w+)([*+?]?)/.exec(pattern.slice(i));
    if (param) {
      source += param[2] === '*' ? '(?:/.*)?' : param[2] === '+' ? '/.+' : param[2] === '?' ? '(?:/[^/]+)?' : '/[^/]+';
      i += param[0].length;
      continue;
    }
    const ch = pattern[i];
    // A regex group such as `((?!_next).*)` is passed through as written.
    if (ch === '(') {
      const end = matchingBracket(pattern, i);
      if (end < 0) return null;
      source += pattern.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    source += /[.+?^${}|[\]\\]/.test(ch) ? `\\${ch}` : ch === '*' ? '.*' : ch;
    i++;
  }
  try { return new RegExp(`^${source}/?$`); } catch { return null; }
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
 * bare paths — exactly the pre-mount-map behavior. Each prefix carries whether
 * auth middleware guards every mount chain to it, and imports resolve through
 * tsconfig/jsconfig aliases.
 * @implements docguard.js-ts-extraction#FR-002
 * @implements docguard.js-ts-extraction#FR-005
 */
function buildExpressMountMap(files, resolveAlias = null) {
  const map = new Map();
  const add = (absFile, receiver, prefix, auth) => {
    if (!map.has(absFile)) map.set(absFile, []);
    map.get(absFile).push({ receiver, prefix, auth });
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
    for (const { prefix, ident, receiver, auth } of mi.mounts) {
      const spec = mi.imports[ident];
      if (spec) {
        const target = resolveLocalImport(filePath, spec, resolveAlias);
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
          auth: Boolean(auth),
        });
      } else {
        const routeReceivers = new Set(mi.routeReceivers || []);
        const mountReceivers = new Set((mi.mounts || []).map(mount => mount.receiver));
        if (!routeReceivers.has(ident) && !mountReceivers.has(ident)) continue;
        edges.push({
          from: { file: filePath, receiver },
          to: { file: filePath, receiver: ident },
          prefix,
          auth: Boolean(auth),
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
  // Each effective prefix carries whether auth middleware sits on EVERY mount
  // chain that reaches it: a router reachable at the same prefix without auth
  // is reachable without auth (docguard.js-ts-extraction#FR-002).
  const memo = new Map();
  const effectivePrefixes = (node, visiting = new Set(), depth = 0) => {
    const key = nodeKey(node);
    if (memo.has(key)) return memo.get(key);
    if (visiting.has(key) || depth > 32) return [];
    const nodeEdges = incoming.get(key) || [];
    if (nodeEdges.length === 0) return [];
    const nextVisiting = new Set(visiting).add(key);
    const prefixes = new Map(); // prefix -> auth
    for (const edge of nodeEdges) {
      const parentKey = nodeKey(edge.from);
      const parentHasIncoming = (incoming.get(parentKey) || []).length > 0;
      const parentPrefixes = parentHasIncoming
        ? effectivePrefixes(edge.from, nextVisiting, depth + 1)
        : [{ prefix: '', auth: false }];
      for (const parent of parentPrefixes) {
        const prefix = joinRoutePath(parent.prefix, edge.prefix);
        const auth = parent.auth || edge.auth;
        prefixes.set(prefix, prefixes.has(prefix) ? prefixes.get(prefix) && auth : auth);
        if (prefixes.size >= 256) break;
      }
      if (prefixes.size >= 256) break;
    }
    const resolved = [...prefixes].map(([prefix, auth]) => ({ prefix, auth }));
    memo.set(key, resolved);
    return resolved;
  };

  for (const node of nodes.values()) {
    for (const { prefix, auth } of effectivePrefixes(node)) add(node.file, node.receiver, prefix, auth);
  }
  return map;
}

/**
 * Resolve a relative, or tsconfig/jsconfig-aliased, import specifier to an
 * absolute file path (best effort). Bare package specifiers are not our routers.
 */
function resolveLocalImport(fromFile, spec, resolveAlias = null) {
  if (!spec.startsWith('.')) return resolveAlias ? resolveAlias(fromFile, spec) : null;
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

      const emit = (method, path, index, auth, line) => routes.push({
        method: method.toUpperCase(),
        path,
        handler: extractHandlerName(content, index),
        file: relative(dir, filePath),
        line: line ?? lineAt(content, index),
        source: 'fastify',
        auth: Boolean(auth),
        description: extractNearbyComment(content, index),
      });

      // AST-first: method shorthand (fastify.get('/x')) AND the declarative
      // object form (fastify.route({ method, url })) the regex never matched.
      // Both return null only on parse failure → regex fallback. Auth is the
      // route's own evidence (docguard.js-ts-extraction#FR-002).
      const calls = extractJsRouteCalls(content, filePath);
      const objs = extractJsRouteObjects(content, filePath);
      if (calls || objs) {
        for (const r of calls || []) emit(r.method, r.path, r.start, r.auth, r.line);
        for (const r of objs || []) emit(r.method, r.path, r.start, r.auth, r.line);
      } else {
        let match;
        const regex = new RegExp(pattern.source, 'gi');
        while ((match = regex.exec(content)) !== null) emit(match[1], match[2], match.index, statementAuth(content, match.index));
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

      const emit = (method, path, index, auth, line) => routes.push({
        method: method.toUpperCase(),
        path,
        handler: '',
        file: relative(dir, filePath),
        line: line ?? lineAt(content, index),
        source: 'hono',
        auth: Boolean(auth),
        description: extractNearbyComment(content, index),
      });

      // AST-first (any receiver, multi-line, template paths — Hono/Koa method
      // shorthand `app.get('/x')` / `router.get('/x')`); regex fallback. Auth
      // is the route's own evidence (docguard.js-ts-extraction#FR-002).
      const calls = extractJsRouteCalls(content, filePath);
      if (calls) {
        for (const r of calls) emit(r.method, r.path, r.start, r.auth, r.line);
      } else {
        let match;
        const regex = new RegExp(pattern.source, 'gi');
        while ((match = regex.exec(content)) !== null) emit(match[1], match[2], match.index, statementAuth(content, match.index));
      }
    });
  }

  return routes;
}

// ── Django ───────────────────────────────────────────────────────────────────

function scanDjangoRoutes(dir, ctx) {
  const routes = [];
  const urlsFiles = findRouteFiles(dir, /urls\.py$/, { maxFiles: ctx.maxFiles });
  if (urlsFiles.truncated) ctx.scan.truncated = true;

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

function scanFastAPIRoutes(dir, ctx) {
  const routes = [];
  const pattern = /@(?:app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi;

  const pyFiles = findRouteFiles(dir, /\.py$/, { maxFiles: ctx.maxFiles });
  if (pyFiles.truncated) ctx.scan.truncated = true;
  // AST-first: ONE python3 subprocess parses every file. `null` means Python is
  // unavailable or the subprocess failed → regex fallback for all files. A
  // per-file `ok:false` falls back for just that file. The AST form also reads
  // multi-line decorators and Flask `methods=[...]` arrays the regex misses.
  const astByFile = extractPythonFiles(pyFiles);
  // `null` means the whole batch fell back — no usable interpreter. Name that
  // once here so every route from this scan carries the same accurate reason
  // rather than a per-file guess. (calibrated-finding-channels#FR-010/011)
  const batchReason = astByFile === null ? 'No usable python3 interpreter; routes matched by pattern.' : null;

  for (const filePath of pyFiles) {
    const content = readFileSafe(filePath);
    if (!content) continue;

    const parsed = astByFile && astByFile[filePath];
    const { tier, tierReason } = tierFor(filePath, parsed, batchReason);
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
          tier,
          tierReason,
        });
      }
      continue;
    }

    // The pattern tier. It cannot see a multi-line decorator or a Flask
    // `methods=[...]` array, so a route may be missing entirely here — which
    // is exactly why the tier travels with the result instead of staying a
    // silent implementation detail.
    let match;
    const regex = new RegExp(pattern.source, 'gi');
    while ((match = regex.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        handler: extractPythonFunctionName(content, match.index),
        file: relative(dir, filePath),
        source: 'fastapi',
        auth: fileAuth,
        description: extractPythonDocstring(content, match.index),
        tier,
        tierReason,
      });
    }
  }

  // A Python file that yielded no route still carries coverage information:
  // if it was read by the pattern tier, the absence of a route from it is
  // weak evidence. Record every file's tier with the scan so a caller can
  // downgrade applicability even when the result list is empty.
  for (const f of pyFiles) ctx.scan.tierItems.push({ ...tierFor(f, astByFile && astByFile[f], batchReason), file: relative(dir, f) });
  return routes;
}

// ── Spring Boot (Java/Kotlin) ────────────────────────────────────────────────

function scanSpringBootRoutes(dir, ctx) {
  const routes = [];
  // Method-level verb annotations (NOT @RequestMapping — that's class-level base).
  // Optional path; bare `@PostMapping` means "base path only".
  const verbMap = /@(Get|Post|Put|Delete|Patch)Mapping(?:\s*\(\s*(?:value\s*=\s*)?["']([^"']*)["'])?/g;
  const classBase = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["'][^)]*\)\s*[\r\n][\s\S]*?(?:public\s+)?class\s+\w+/;

  const javaFiles = readPatternFiles(ctx, /\.(java|kt)$/);
  for (const filePath of javaFiles) {
    const content = readFileSafe(filePath);
    if (!content || !content.includes('Mapping')) continue;
    const { tier, tierReason } = tierFor(filePath, null);

    // Class-level base path, if any.
    const cb = classBase.exec(content);
    const basePath = cb ? cb[1] : '';
    const authPresent = /@PreAuthorize|@Secured|SecurityContext/.test(content);

    let match;
    const re = new RegExp(verbMap.source, 'g');
    while ((match = re.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const sub = match[2] || '';
      const path = (basePath + sub).replace(/\/+/g, '/') || '/';
      routes.push({
        method, path,
        handler: '', file: relative(dir, filePath), source: 'spring-boot',
        auth: authPresent, description: '', tier, tierReason,
      });
    }
  }
  return routes;
}

// ── Rails (Ruby) — config/routes.rb ──────────────────────────────────────────

function scanRailsRoutes(dir, ctx) {
  const routes = [];
  const routesFile = resolve(dir, 'config/routes.rb');
  if (!existsSync(routesFile)) return routes;
  recordPatternFiles(ctx, [routesFile]);
  const content = readFileSafe(routesFile);
  if (!content) return routes;
  const { tier, tierReason } = tierFor(routesFile, null);

  // Verb DSL: get '/x', post '/x', etc.  AND  resources :things (RESTful 7 actions)
  const verbDsl = /^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/gm;
  let m;
  while ((m = verbDsl.exec(content)) !== null) {
    routes.push({
      method: m[1].toUpperCase(),
      path: m[2].startsWith('/') ? m[2] : '/' + m[2],
      handler: '', file: 'config/routes.rb', source: 'rails', auth: false, description: '', tier, tierReason,
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
      routes.push({ method, path, handler: '', file: 'config/routes.rb', source: 'rails', auth: false, description: '', tier, tierReason });
    }
  }
  return routes;
}

// ── Go web frameworks (Gin / Echo / Chi / Fiber / std mux) ───────────────────

function scanGoWebRoutes(dir, ctx) {
  const routes = [];
  // Generic: <recv>.<METHOD>("/path", handler)  for Gin/Echo/Chi/Fiber/mux.Router
  const pattern = /\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|HandleFunc|Handle)\s*\(\s*["']([^"']+)["']/g;
  const goFiles = readPatternFiles(ctx, /\.go$/);
  for (const filePath of goFiles) {
    const content = readFileSafe(filePath);
    if (!content) continue;
    const { tier, tierReason } = tierFor(filePath, null);
    let m;
    const re = new RegExp(pattern.source, 'g');
    while ((m = re.exec(content)) !== null) {
      const verb = m[1];
      // HandleFunc / Handle are method-agnostic.
      const method = ['HandleFunc', 'Handle'].includes(verb) ? 'ANY' : verb;
      const path = m[2];
      if (!path.startsWith('/')) continue;
      routes.push({
        method, path,
        handler: '', file: relative(dir, filePath), source: 'go-web',
        auth: /Authorization|jwt\.|middleware\.Auth/.test(content),
        description: '', tier, tierReason,
      });
    }
  }
  return routes;
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
