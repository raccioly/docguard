/**
 * Cloudflare Pages Functions route extraction (docguard.js-route-shapes#FR-003).
 *
 * A Pages project routes by file. Each file under `functions/` serves the path
 * its location names (`functions/api/users/[id].ts` → `/api/users/:id`,
 * `index` serving its directory, `[[path]]` the catch-all `:path*`, as the
 * Next.js reader renders catch-alls), for each `onRequest<Method>` it exports
 * (`onRequest` is every method). A `_middleware` file is not a route: it runs
 * before every route in its directory and below, so one that checks
 * credentials marks those routes auth. An export that hands the request to a
 * router (`handle(app)` from `hono/cloudflare-pages`, `router.fetch`) is not a
 * route either; the router reader reports that router's routes.
 *
 * A file name the reader cannot map to a path (`user-[id].ts`) and an
 * `export *` (whose methods are unknown) are recorded as limitations, never
 * guessed.
 *
 * Advanced mode and `_routes.json` (docguard.js-route-shapes#FR-008): a
 * `_worker.js` in the output directory replaces Functions entirely (Cloudflare:
 * "the entire `/functions` directory is ignored"), so the caller reads it with
 * the Worker dispatch reader instead. `_routes.json` decides which requests
 * invoke Functions at all — `include` rules invoke them, `exclude` rules (which
 * win) serve static assets instead — so a Function no rule lets through is not
 * served and is not reported.
 *
 * @implements docguard.js-route-shapes#FR-003
 * @implements docguard.js-route-shapes#FR-005
 * @implements docguard.js-route-shapes#FR-008
 */

import { functionBodies, isAuthMiddlewareNode, AUTH_CHECK_RE } from './js-ast.mjs';
import { parseWithTier, lineAt, joinSegments, lexJs } from './js-route-support.mjs';

const FRAMEWORK = 'Cloudflare Pages';
const SOURCE = 'cloudflare-pages';
const HANDLER = /^onRequest(Get|Post|Put|Patch|Delete|Head|Options)?$/;
const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration']);
const TS_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'ParenthesizedExpression']);
/** Modules whose `handle(app)` serves a whole router from one Pages Function. */
const ROUTER_ADAPTERS = /^hono\/cloudflare-pages$/;
/** A plugin whose module is an authentication product (Cloudflare Access, a JWT or session library). */
const AUTH_PLUGIN_MODULE = /cloudflare-access|auth|jwt|clerk|session/i;

const unwrap = (node) => { let n = node; while (n && TS_WRAPPERS.has(n.type)) n = n.expression; return n; };
const methodOf = name => (HANDLER.exec(name)?.[1] || 'ALL').toUpperCase();

/**
 * Where a file sits in a Functions tree: the tree's root (`functions`, or
 * `apps/site/functions` in a monorepo) and the segments below it.
 * @returns {{ root: string, dirs: string[], stem: string }|null}
 */
export function functionsLocation(rel) {
  const parts = rel.split('/');
  const at = parts.indexOf('functions');
  if (at < 0 || at === parts.length - 1) return null;
  const name = parts[parts.length - 1];
  return { root: parts.slice(0, at + 1).join('/'), dirs: parts.slice(at + 1, -1), stem: name.replace(/\.[^.]+$/, '') };
}

/** `[id]` → `:id`, `[[rest]]` → `:rest*`, a literal segment as is; null when the segment mixes the two. */
function segmentOf(seg) {
  let m = /^\[\[([\w$-]+)\]\]$/.exec(seg);
  if (m) return `:${m[1]}*`;
  m = /^\[([\w$-]+)\]$/.exec(seg);
  if (m) return `:${m[1]}`;
  return /[[\]]/.test(seg) ? null : seg;
}

/**
 * Pages Functions routes of a set of files (only files under a `functions/`
 * directory are read).
 * @param {Array<{ file: string, abs: string, content: string }>} sources
 * @returns {Array<object>} routes, with non-enumerable `limitations` and `fileTiers`
 */
export function extractPagesRoutes(sources) {
  const limitations = [];
  const fileTiers = [];
  const handlers = [];    // { root, dirs, method, path, auth, file, line, handler, tier, tierReason }
  const middleware = [];  // { root, dirs, method, auth }
  const limit = (code, file, line, target = '') => limitations.push({ framework: FRAMEWORK, code, file, line, target });

  for (const src of sources) {
    const loc = functionsLocation(src.file);
    if (!loc) continue;
    const { ast, tier, tierReason } = parseWithTier(src.content, src.abs);
    fileTiers.push({ file: src.file, tier, tierReason });
    const exported = ast ? exportsOf(ast, src, limit) : exportsByPattern(src, loc.stem === '_middleware');
    if (!exported.length) continue;
    if (loc.stem === '_middleware') {
      for (const e of exported) middleware.push({ root: loc.root, dirs: loc.dirs, method: methodOf(e.name), auth: e.auth });
      continue;
    }
    const segs = [...loc.dirs, ...(loc.stem === 'index' ? [] : [loc.stem])].map(segmentOf);
    if (segs.includes(null)) { limit('pages-unresolved-segment', src.file, exported[0].line, src.file); continue; }
    for (const e of exported) {
      if (e.delegates) continue;
      handlers.push({
        root: loc.root, dirs: loc.dirs, method: methodOf(e.name), path: joinSegments(...segs), auth: e.auth,
        file: src.file, line: e.line, handler: e.name, tier, tierReason,
      });
    }
  }

  const under = (mw, h) => mw.root === h.root && mw.dirs.length <= h.dirs.length && mw.dirs.every((d, i) => d === h.dirs[i]);
  const routes = handlers.map(h => ({
    method: h.method,
    path: h.path,
    handler: h.handler,
    file: h.file,
    line: h.line,
    source: SOURCE,
    auth: Boolean(h.auth || middleware.some(mw => mw.auth && under(mw, h) && (mw.method === 'ALL' || mw.method === h.method))),
    description: '',
    tier: h.tier,
    tierReason: h.tierReason,
  }));
  Object.defineProperty(routes, 'limitations', { value: limitations, enumerable: false });
  Object.defineProperty(routes, 'fileTiers', { value: fileTiers, enumerable: false });
  return routes;
}

// ── Syntax-tree tier ─────────────────────────────────────────────────────────

/** The `onRequest*` exports of a parsed file: `{ name, line, auth, delegates }`. */
function exportsOf(ast, src, limit) {
  const { content, file } = src;
  const bodies = functionBodies(ast);
  const locals = new Map();   // top-level name -> value node
  const imports = new Map();  // local -> module
  for (const st of ast.program?.body || []) {
    const decl = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
    if (decl?.type === 'FunctionDeclaration' && decl.id) locals.set(decl.id.name, decl);
    if (decl?.type === 'VariableDeclaration') for (const d of decl.declarations || []) if (d.id?.type === 'Identifier' && d.init) locals.set(d.id.name, d.init);
    if (st.type === 'ImportDeclaration') for (const sp of st.specifiers || []) imports.set(sp.local.name, st.source.value);
  }
  const lineOf = node => node?.loc?.start.line ?? lineAt(content, node?.start ?? 0);
  const fnAuth = fn => AUTH_CHECK_RE.test(content.slice(fn.start, fn.end));

  // Does this value show auth: its own check, auth middleware, or an auth plugin?
  const authOf = (raw, depth = 0) => {
    const v = unwrap(raw);
    if (!v || depth > 4) return false;
    if (FUNCTION_TYPES.has(v.type)) return fnAuth(v);
    if (v.type === 'ArrayExpression') return (v.elements || []).some(e => authOf(e, depth + 1));
    if (v.type === 'Identifier') {
      if (isAuthMiddlewareNode(v)) return true;
      if (bodies.has(v.name)) return fnAuth(bodies.get(v.name));
      return locals.has(v.name) ? authOf(locals.get(v.name), depth + 1) : false;
    }
    if (v.type === 'CallExpression') {
      if (isAuthMiddlewareNode(v)) return true;
      const callee = v.callee?.type === 'Identifier' ? v.callee.name : null;
      return Boolean(callee && imports.has(callee) && AUTH_PLUGIN_MODULE.test(imports.get(callee)));
    }
    return isAuthMiddlewareNode(v);
  };
  // Does this value hand the request to a router?
  const delegates = (raw) => {
    const v = unwrap(raw);
    if (!v) return false;
    if (v.type === 'CallExpression' && v.callee?.type === 'Identifier' && ROUTER_ADAPTERS.test(imports.get(v.callee.name) || '')) return true;
    if (v.type === 'MemberExpression' && !v.computed && ['fetch', 'handle'].includes(v.property?.name)) return true;
    if (FUNCTION_TYPES.has(v.type)) {
      let body = v.body;
      if (body?.type === 'BlockStatement' && body.body.length === 1 && body.body[0].type === 'ReturnStatement') body = body.body[0].argument;
      body = unwrap(body);
      return body?.type === 'CallExpression' && body.callee?.type === 'MemberExpression' && ['fetch', 'handle'].includes(body.callee.property?.name);
    }
    return false;
  };

  const out = [];
  const add = (name, value, at) => out.push({ name, line: lineOf(at), auth: value ? authOf(value) : false, delegates: value ? delegates(value) : false });
  for (const st of ast.program?.body || []) {
    if (st.type === 'ExportAllDeclaration') { limit('pages-unresolved-export', file, lineOf(st), `export * from '${st.source?.value ?? ''}'`); continue; }
    if (st.type !== 'ExportNamedDeclaration') continue;
    const decl = st.declaration;
    if (decl?.type === 'FunctionDeclaration' && HANDLER.test(decl.id?.name || '')) add(decl.id.name, decl, st);
    for (const d of decl?.type === 'VariableDeclaration' ? decl.declarations : []) {
      if (d.id?.type === 'Identifier' && HANDLER.test(d.id.name)) add(d.id.name, d.init, st);
    }
    for (const sp of st.specifiers || []) {
      const name = sp.exported?.name ?? sp.exported?.value;
      if (!HANDLER.test(name || '')) continue;
      // A re-export names its method; its body lives in another module.
      add(name, st.source ? null : locals.get(sp.local?.name) || null, st);
    }
  }
  return out;
}

// ── Pattern tier (the file did not parse) ────────────────────────────────────

/**
 * Exports found by pattern. Without a tree, a route's own auth cannot be told
 * from text elsewhere in the file, so only a middleware file (whose whole text
 * guards the routes below it) is judged, by an auth check anywhere in it.
 */
function exportsByPattern(src, isMiddleware) {
  const { content } = src;
  const { code } = lexJs(content);
  const out = [];
  const auth = isMiddleware && AUTH_CHECK_RE.test(content);
  for (const m of code.matchAll(/\bexport\s+(?:async\s+)?(?:function\s*\*?\s*|(?:const|let|var)\s+)(onRequest\w*)\b/g)) {
    if (HANDLER.test(m[1])) out.push({ name: m[1], line: lineAt(content, m.index), auth, delegates: false });
  }
  return out;
}

// ── Advanced mode and _routes.json (docguard.js-route-shapes#FR-008) ────────

/**
 * Is this project-relative file an advanced-mode Worker: `_worker.js` (or the
 * `_worker.ts`/`_worker.mjs` source a build compiles into it), or the
 * `index` of a `_worker.js/` directory?
 */
export function isAdvancedWorkerFile(rel) {
  return /(?:^|\/)_worker\.(?:[cm]?js|ts)$/.test(rel) || /(?:^|\/)_worker\.js\/index\.(?:[cm]?js|ts)$/.test(rel);
}

/**
 * The rules of a `_routes.json` text: `{ include, exclude }`, or null when it
 * is not valid JSON or has no `include` list of strings.
 */
export function parseRoutesJson(text) {
  let json;
  try { json = JSON.parse(text); } catch { return null; }
  const strings = v => Array.isArray(v) && v.every(x => typeof x === 'string');
  if (!json || !strings(json.include) || !json.include.length) return null;
  if (json.exclude !== undefined && !strings(json.exclude)) return null;
  return { include: json.include, exclude: json.exclude || [] };
}

const escapeRe = t => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
/** A `_routes.json` rule as a pattern: `*` matches any characters, including `/`. */
const ruleRe = rule => new RegExp(`^${rule.split('*').map(escapeRe).join('.*')}$`);
/** A route path as a pattern over concrete paths: `:id` one segment, `:rest*` anything. */
const routeRe = path => new RegExp(`^${path.split('/').map(seg => (/^:[\w$-]+\*$/.test(seg) ? '.*' : /^:/.test(seg) ? '[^/]+' : escapeRe(seg))).join('/')}$`);
/** One concrete path a route serves: each parameter filled with a placeholder segment. */
const samplePath = path => path.split('/').map(seg => (seg.startsWith(':') ? 'x0' : seg)).join('/');

/**
 * Does `_routes.json` let requests for this route reach Functions? A route
 * is served when an `include` rule matches one of its concrete paths and no
 * `exclude` rule matches them generally (an exact `exclude` of `/users/42`
 * leaves `/users/:id` served for every other id).
 */
export function servedByRoutesJson(path, rules) {
  const sample = samplePath(path);
  const own = routeRe(path);
  const included = rules.include.some(rule => ruleRe(rule).test(sample) || (!rule.includes('*') && own.test(rule)));
  return included && !rules.exclude.some(rule => ruleRe(rule).test(sample));
}
