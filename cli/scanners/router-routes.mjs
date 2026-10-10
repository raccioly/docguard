/**
 * Hono and itty-router route extraction (docguard.js-framework-routes#FR-005).
 *
 * Both libraries register routes with method shorthand on a router value
 * (`app.get('/x', h)`, `router.post('/x', h)`), and both give that value a
 * prefix the call does not show: itty-router's `Router({ base: '/api' })`,
 * Hono's `new Hono().basePath('/api')` and `parent.route('/books', books)`,
 * which mounts a sub-app that usually lives in another file. Each router is a
 * node; `basePath()` and `route()` are edges carrying a prefix; a route's
 * served path is every chain of prefixes down to its router. Imports are
 * followed through relative and `tsconfig`-aliased specifiers, so
 * `import books from './books'` reaches the router `books.ts` exports.
 *
 * Receivers named like routers (`app`, `router`, `routes`, `server`) are read
 * even when their creation is not visible (a router passed as a parameter),
 * as the shorthand scanner did. A path that is not literal is recorded as a
 * limitation, never reported with a placeholder.
 *
 * Koa reads the same way (docguard.js-route-shapes#FR-001): a `@koa/router`
 * or `koa-router` router is a node whose base is its `prefix` option or
 * `router.prefix()`; `router.use('/x', sub.routes())`, `app.use(sub.routes())`
 * on a Koa application and koa-mount's `mount('/x', subApp)` are edges. A Koa
 * `use()` path covers everything under it, where a Hono `use()` pattern needs
 * `/*`. CommonJS `require()` and `module.exports` are followed like `import`
 * and `export`.
 *
 * `@hono/zod-openapi` routes (docguard.js-route-shapes#FR-004) are
 * `openapi(createRoute({ method, path }), handler)` calls on a router; a route
 * definition bound to a variable is followed across files like a router, and
 * its OpenAPI `{param}` path segments become `:param`, as OpenAPIHono serves
 * them. A router below a prefix that cannot be resolved reports nothing: its
 * served path is unknown, and the prefix is recorded once as a limitation.
 *
 * @implements docguard.js-framework-routes#FR-005
 * @implements docguard.js-framework-routes#FR-006
 * @implements docguard.js-route-shapes#FR-001
 * @implements docguard.js-route-shapes#FR-004
 * @implements docguard.js-route-shapes#FR-005
 * @implements docguard.js-route-shapes#FR-009
 */

import { walk, isAuthMiddlewareNode, isAuthMiddlewareName, functionBodies, topLevelStaticStrings, pathArgValue, AUTH_CHECK_RE } from './js-ast.mjs';
import { matchPairs, splitTopLevel, literalIn } from './route-lexing.mjs';
import { parseWithTier, lineAt, joinSegments, nodeText, lexJs } from './js-route-support.mjs';

const VERBS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all', 'del']);
/** koa-router's `del()` is `delete()`. */
const METHOD_OF = { del: 'DELETE' };
const HONO_MODULES = new Set(['hono', 'hono/tiny', 'hono/quick', '@hono/zod-openapi']);
const HONO_CLASSES = new Set(['Hono', 'OpenAPIHono']);
const ITTY_FACTORIES = new Set(['Router', 'AutoRouter', 'IttyRouter']);
/** The shorthand scanner's receiver heuristic (js-ast.mjs `looksLikeRouteReceiver`). */
const ROUTER_NAME = /(?:app|server|router|routes)$/i;
const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression']);
const KOA_ROUTER_MODULES = new Set(['@koa/router', 'koa-router']);
const ZOD_OPENAPI = '@hono/zod-openapi';
/** Calls a `use()` hands a router or application to (koa-router's `routes()` and its alias). */
const MOUNT_METHODS = new Set(['routes', 'middleware']);
/** A `use()` argument that names a path through a value this reader cannot read. */
const PATH_LIKE_NAME = /^(?:process\.env\.|[A-Z][A-Z0-9_]*\b)|(?:path|prefix|base|url)$/i;
const SOURCE_OF_KIND = { hono: 'hono', itty: 'itty-router', koa: 'koa' };
const TS_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'ParenthesizedExpression']);
/** The expression under TypeScript `as const`, `satisfies` and parentheses. */
const unwrap = (node) => { let n = node; while (n && TS_WRAPPERS.has(n.type)) n = n.expression; return n; };
/** OpenAPIHono serves `/users/{id}` as `/users/:id`. */
const openapiPath = p => p.replace(/\/\{([^}]+?)\}/g, '/:$1');

/**
 * Hono and itty-router routes of a set of files.
 * @param {Array<{ file: string, abs: string, content: string }>} sources
 * @param {(fromAbs: string, spec: string) => string|null} resolveImport
 * @param {{ framework?: string, defaultSource?: string }} [opts]
 * @returns {Array<object>} routes, with non-enumerable `limitations` and `fileTiers`
 */
export function extractRouterRoutes(sources, resolveImport, { framework = 'Hono', defaultSource = 'hono' } = {}) {
  const nodes = new Map();        // id -> { kind, base, auth, unresolved, openapi }
  const aliases = new Map();      // local import id -> { target, imported }
  const exportsByFile = new Map(); // abs -> Map(exported -> local)
  const edges = [];               // { from, to, prefix, start, file, auth, unresolved }
  const uses = [];                // { node, pattern, start, file }
  const records = [];             // route records before prefixes
  const prefixOps = [];           // Koa `router.prefix(p)`: { node, base, file, line, target }
  const routeDefs = new Map();    // id -> zod-openapi route definition
  const limitations = [];
  const fileTiers = [];
  const limit = (code, file, line, target = '') => limitations.push({ framework, code, file, line, target });

  for (const src of sources) {
    const { ast, tier, tierReason } = parseWithTier(src.content, src.abs);
    fileTiers.push({ file: src.file, tier, tierReason });
    const ctx = { src, tier, tierReason, nodes, aliases, exportsByFile, edges, uses, records, prefixOps, routeDefs, limit, resolveImport, defaultSource };
    if (ast) readAst(ast, ctx);
    else readByPattern(ctx);
  }

  const canonical = (id) => {
    const seen = new Set();
    while (aliases.has(id) && !seen.has(id)) {
      seen.add(id);
      const { target, imported } = aliases.get(id);
      const local = exportsByFile.get(target)?.get(imported);
      if (!local) break;
      id = `${target}#${local}`;
    }
    return id;
  };

  // Koa's `router.prefix(p)` replaces the router's prefix.
  const isKoa = node => Boolean(node) && (node.kind === 'koa' || (!node.kind && defaultSource === 'koa'));
  for (const op of prefixOps) {
    const node = nodes.get(canonical(op.node));
    if (!isKoa(node)) continue;
    if (op.base === null) { node.unresolved = true; limit('router-unresolved-base', op.file, op.line, op.target); } else node.base = op.base;
  }

  // Every chain of prefixes to a router, with whether auth middleware covers
  // it. A router with an unresolved prefix, or reached only through mounts
  // whose path is unresolved, has no chain: its served paths are unknown.
  const memo = new Map();
  const effective = (id, visiting = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const node = nodes.get(id) || { base: '', auth: false };
    if (visiting.has(id) || visiting.size > 32) return [];
    const incoming = edges.filter(e => canonical(e.to) === id);
    let out;
    if (node.unresolved) out = [];
    else if (!incoming.length) out = [{ prefix: joinSegments(node.base), auth: Boolean(node.auth) }];
    else {
      out = [];
      const next = new Set(visiting).add(id);
      for (const e of incoming) {
        if (e.unresolved) continue;
        const from = canonical(e.from);
        for (const p of effective(from, next)) {
          out.push({ prefix: joinSegments(p.prefix, e.prefix, node.base), auth: Boolean(p.auth || node.auth || e.auth || covered(from, e.prefix, e.start, e.file)) });
        }
      }
    }
    memo.set(id, out);
    return out;
  };
  const covered = (id, path, start, file) => {
    const prefixMode = isKoa(nodes.get(id));
    return uses.some(u => canonical(u.node) === id && u.file === file && u.start < start && patternCovers(u.pattern, path, prefixMode));
  };

  // zod-openapi routes registered through a variable: resolve the definition.
  const resolved = [];
  const reported = new Set();
  for (const r of records) {
    // koa-router's `redirect()` exists only on Koa routers.
    if (r.koaOnly) {
      if (!isKoa(nodes.get(canonical(r.node)))) continue;
      if (r.unresolvedAt) { limit('router-unresolved-path', r.file, r.unresolvedAt.line, r.unresolvedAt.target); continue; }
    }
    if (!r.defRef) { resolved.push(r); continue; }
    const def = routeDefs.get(canonical(r.defRef));
    if (!def) { limit('router-unresolved-route', r.file, r.line, r.target); continue; }
    if (def.unresolved) {
      const at = `${def.file}:${def.line}`;
      if (!reported.has(at)) { reported.add(at); limit(def.code, def.file, def.line, def.target); }
      continue;
    }
    resolved.push({ ...r, method: def.method, path: def.path, auth: Boolean(r.auth || def.auth) });
  }

  const routes = [];
  for (const r of resolved) {
    const id = canonical(r.node);
    const node = nodes.get(id);
    if (!node) continue;
    for (const eff of effective(id)) {
      routes.push({
        method: r.method,
        path: joinSegments(eff.prefix, r.path),
        handler: r.handler,
        file: r.file,
        line: r.line,
        source: SOURCE_OF_KIND[node.kind] || defaultSource,
        auth: Boolean(r.auth || eff.auth || covered(id, r.path, r.start, r.abs)),
        description: '',
        tier: r.tier,
        tierReason: r.tierReason,
      });
    }
  }
  Object.defineProperty(routes, 'limitations', { value: limitations, enumerable: false });
  Object.defineProperty(routes, 'fileTiers', { value: fileTiers, enumerable: false });
  return routes;
}

/**
 * Does a `use()` path pattern (`*`, `/admin/*`, `/x`) cover `path`? In Koa
 * (`prefixMode`) a plain path covers itself and everything under it.
 */
function patternCovers(pattern, path, prefixMode = false) {
  const p = joinSegments(path);
  if (pattern === '*' || pattern === '/*') return true;
  if (prefixMode && !pattern.endsWith('/*')) {
    const base = joinSegments(pattern);
    return base === '/' || p === base || p.startsWith(`${base}/`);
  }
  if (pattern.endsWith('/*')) {
    const base = joinSegments(pattern.slice(0, -2));
    return base === '/' || p === base || p.startsWith(`${base}/`);
  }
  return joinSegments(pattern) === p;
}

// ── Syntax-tree tier ─────────────────────────────────────────────────────────

/** The module a `require('spec')` call names, else null. */
function requireSpec(node) {
  const n = unwrap(node);
  return n?.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'require'
    && n.arguments?.length === 1 && n.arguments[0].type === 'StringLiteral' ? n.arguments[0].value : null;
}

function readAst(ast, ctx) {
  const { src, nodes, aliases, exportsByFile, edges, uses, records, prefixOps, routeDefs, limit, resolveImport } = ctx;
  const { abs, file, content } = src;
  const constants = topLevelStaticStrings(ast);
  const bodies = functionBodies(ast);
  const honoLocals = new Set();
  const openapiLocals = new Set();
  const ittyLocals = new Set();
  const koaRouterLocals = new Set();
  const koaLocals = new Set();
  const mountLocals = new Set();
  const createRouteLocals = new Set(['createRoute']);
  const imports = new Map(); // local -> { spec, imported }
  const exportsMap = new Map();
  exportsByFile.set(abs, exportsMap);
  const bound = new Set();
  const idOf = name => `${abs}#${name}`;
  const lineOf = node => node?.loc?.start.line ?? lineAt(content, node?.start ?? 0);
  const literal = (node) => { const v = pathArgValue(unwrap(node), constants, false); return typeof v === 'string' ? v : null; };
  const propValue = (obj, key) => {
    const o = unwrap(obj);
    if (o?.type !== 'ObjectExpression') return undefined;
    return unwrap((o.properties || []).find(p => p.type === 'ObjectProperty' && !p.computed && (p.key?.name ?? p.key?.value) === key)?.value);
  };

  // ES module imports and CommonJS `require()` bind the same way.
  const bindImport = (local, spec, imported) => {
    if (HONO_MODULES.has(spec) && HONO_CLASSES.has(imported)) {
      honoLocals.add(local);
      if (imported === 'OpenAPIHono') openapiLocals.add(local);
    } else if (spec === 'itty-router' && ITTY_FACTORIES.has(imported)) ittyLocals.add(local);
    else if (KOA_ROUTER_MODULES.has(spec) && (imported === 'default' || imported === 'Router')) koaRouterLocals.add(local);
    else if (spec === 'koa' && (imported === 'default' || imported === 'Koa')) koaLocals.add(local);
    else if (spec === 'koa-mount' && imported === 'default') mountLocals.add(local);
    else if (spec === ZOD_OPENAPI && imported === 'createRoute') createRouteLocals.add(local);
    else imports.set(local, { spec, imported });
  };
  const exportName = (target) => (target?.type === 'MemberExpression' && !target.computed ? target.property?.name : null);
  const isModuleExports = (target) => target?.type === 'MemberExpression' && !target.computed
    && target.object?.type === 'Identifier' && target.object.name === 'module' && target.property?.name === 'exports';

  for (const st of ast.program?.body || []) {
    if (st.type === 'ImportDeclaration' && typeof st.source?.value === 'string') {
      const spec = st.source.value;
      for (const sp of st.specifiers || []) {
        const imported = sp.type === 'ImportDefaultSpecifier' ? 'default' : sp.type === 'ImportNamespaceSpecifier' ? '*' : (sp.imported?.name ?? sp.imported?.value);
        bindImport(sp.local.name, spec, imported);
      }
    } else if (st.type === 'VariableDeclaration') {
      // `const X = require('m')`, `const { a, b: c } = require('m')`.
      for (const d of st.declarations || []) {
        const spec = requireSpec(d.init);
        if (!spec) continue;
        if (d.id?.type === 'Identifier') bindImport(d.id.name, spec, 'default');
        else if (d.id?.type === 'ObjectPattern') {
          for (const p of d.id.properties || []) {
            if (p.type === 'ObjectProperty' && p.value?.type === 'Identifier') bindImport(p.value.name, spec, p.key?.name ?? p.key?.value);
          }
        }
      }
    } else if (st.type === 'ExportDefaultDeclaration' && st.declaration?.type === 'Identifier') {
      exportsMap.set('default', st.declaration.name);
    } else if (st.type === 'ExportNamedDeclaration') {
      for (const d of st.declaration?.declarations || []) if (d.id?.type === 'Identifier') exportsMap.set(d.id.name, d.id.name);
      for (const sp of st.specifiers || []) {
        const exported = sp.exported?.name ?? sp.exported?.value;
        const local = sp.local?.name ?? sp.local?.value;
        if (exported && local) exportsMap.set(exported, local);
      }
    } else if (st.type === 'ExpressionStatement' && st.expression?.type === 'AssignmentExpression' && st.expression.operator === '=') {
      // `module.exports = x`, `module.exports = { a, b: c }`, `module.exports.a = x`, `exports.a = x`.
      const { left, right } = st.expression;
      const value = unwrap(right);
      if (isModuleExports(left)) {
        if (value?.type === 'Identifier') exportsMap.set('default', value.name);
        else if (value?.type === 'ObjectExpression') {
          for (const p of value.properties || []) {
            if (p.type === 'ObjectProperty' && !p.computed && p.value?.type === 'Identifier') exportsMap.set(p.key?.name ?? p.key?.value, p.value.name);
          }
        }
      } else if (left?.type === 'MemberExpression' && (isModuleExports(left.object) || (left.object?.type === 'Identifier' && left.object.name === 'exports'))) {
        const name = exportName(left);
        if (name && value?.type === 'Identifier') exportsMap.set(name, value.name);
      }
    }
  }

  // An imported value, by the id its module gives it.
  const importedId = (name) => {
    if (!imports.has(name)) return null;
    const target = resolveImport(abs, imports.get(name).spec);
    if (!target) return null;
    aliases.set(idOf(name), { target, imported: imports.get(name).imported });
    return idOf(name);
  };
  // The node a receiver identifier names: a router made here, an imported
  // router, or a value named like one.
  const receiverId = (name) => {
    const id = idOf(name);
    if (bound.has(name)) return id;
    const imported = importedId(name);
    if (imported) return imported;
    if (ROUTER_NAME.test(name)) {
      if (!nodes.has(id)) nodes.set(id, { kind: null, base: '' });
      return id;
    }
    return null;
  };
  // A router or application named by an identifier or an inline `require('./x')`.
  const refOf = (expr) => {
    const e = unwrap(expr);
    if (e?.type === 'Identifier') return receiverId(e.name);
    const spec = requireSpec(e);
    if (!spec) return null;
    const target = resolveImport(abs, spec);
    if (!target) return null;
    const id = idOf(`require:${spec}`);
    aliases.set(id, { target, imported: 'default' });
    return id;
  };
  const calleeIn = (callee, locals, modules) => (callee?.type === 'Identifier' && locals.has(callee.name)) || modules.has(requireSpec(callee));
  // Router values created in this file.
  const routerFrom = (rawInit) => {
    const init = unwrap(rawInit);
    if (init?.type === 'NewExpression' && init.callee?.type === 'Identifier' && honoLocals.has(init.callee.name)) {
      return { kind: 'hono', base: '', openapi: openapiLocals.has(init.callee.name) };
    }
    if (init?.type === 'CallExpression' && init.callee?.type === 'Identifier' && ittyLocals.has(init.callee.name)) {
      const opts = init.arguments?.[0];
      const baseNode = propValue(opts, 'base');
      const base = baseNode === undefined ? '' : literal(baseNode);
      if (base === null) { limit('router-unresolved-base', file, lineOf(baseNode), nodeText(content, baseNode)); return { kind: 'itty', base: '', unresolved: true }; }
      return { kind: 'itty', base, auth: isAuthMiddlewareNode(propValue(opts, 'before')) };
    }
    // `new Router({ prefix })`, `Router()`, `require('koa-router')()`.
    if ((init?.type === 'NewExpression' || init?.type === 'CallExpression') && calleeIn(init.callee, koaRouterLocals, KOA_ROUTER_MODULES)) {
      const prefixNode = propValue(init.arguments?.[0], 'prefix');
      const base = prefixNode === undefined ? '' : literal(prefixNode);
      if (base === null) { limit('router-unresolved-base', file, lineOf(prefixNode), nodeText(content, prefixNode)); return { kind: 'koa', base: '', unresolved: true }; }
      return { kind: 'koa', base };
    }
    if (init?.type === 'NewExpression' && calleeIn(init.callee, koaLocals, new Set(['koa']))) return { kind: 'koa', base: '' };
    return null;
  };
  // A zod-openapi route definition: `{ method, path, middleware? }`.
  const isCreateRoute = callee => callee?.type === 'Identifier' && createRouteLocals.has(callee.name);
  const listAuth = (node) => {
    const n = unwrap(node);
    if (!n) return false;
    const items = n.type === 'ArrayExpression' ? n.elements : [n];
    return items.some(e => isAuthMiddlewareNode(unwrap(e)) || (FUNCTION_TYPES.has(e?.type) && AUTH_CHECK_RE.test(content.slice(e.start, e.end))));
  };
  const defOf = (obj, at) => {
    const where = { file, line: lineOf(at), target: nodeText(content, at) };
    if (unwrap(obj)?.type !== 'ObjectExpression') return { unresolved: true, code: 'router-unresolved-route', ...where };
    const method = literal(propValue(obj, 'method'));
    if (method === null) return { unresolved: true, code: 'router-unresolved-method', ...where };
    const path = literal(propValue(obj, 'path'));
    if (path === null) return { unresolved: true, code: 'router-unresolved-path', ...where };
    return { method: method.toUpperCase(), path: openapiPath(path), auth: listAuth(propValue(obj, 'middleware')), ...where };
  };

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier' || !node.init) return;
    const name = node.id.name;
    const init = unwrap(node.init);
    const direct = routerFrom(init);
    if (direct) { nodes.set(idOf(name), direct); bound.add(name); return; }
    if (init.type === 'CallExpression' && isCreateRoute(init.callee)) { routeDefs.set(idOf(name), defOf(init.arguments?.[0], init)); return; }
    // `x.basePath('/p')` on a new Hono or on another router; Koa's
    // `new Router().prefix('/p')`, which replaces the router's prefix.
    if (init.type === 'CallExpression' && init.callee?.type === 'MemberExpression' && !init.callee.computed && ['basePath', 'prefix'].includes(init.callee.property?.name)) {
      const prop = init.callee.property.name;
      const inner = routerFrom(init.callee.object);
      if (prop === 'prefix' && inner?.kind !== 'koa') return;
      const base = literal(init.arguments?.[0]);
      if (base === null) {
        limit('router-unresolved-base', file, lineOf(init), nodeText(content, init.arguments?.[0]));
        nodes.set(idOf(name), { ...(inner || { kind: 'hono' }), base: '', unresolved: true });
        bound.add(name);
        return;
      }
      if (inner) { nodes.set(idOf(name), { ...inner, base: prop === 'prefix' ? joinSegments(base) : joinSegments(inner.base, base) }); bound.add(name); return; }
      if (init.callee.object?.type === 'Identifier') {
        nodes.set(idOf(name), { kind: 'hono', base: '' });
        bound.add(name);
        edges.push({ from: receiverId(init.callee.object.name) || idOf(init.callee.object.name), to: idOf(name), prefix: base, start: init.start ?? 0, file: abs });
      }
    }
  });

  // A receiver through a chain: `app.get('/a', h).post(h)` → app, and the last path.
  const receiverOf = (expr) => {
    if (expr?.type === 'Identifier') { const id = receiverId(expr.name); return id ? { id, path: null } : null; }
    if (expr?.type === 'CallExpression' && expr.callee?.type === 'MemberExpression' && !expr.callee.computed) {
      const prop = expr.callee.property?.name;
      const inner = receiverOf(expr.callee.object);
      if (!inner) return null;
      if (VERBS.has(prop)) return { id: inner.id, path: pathOfCall(expr) ?? inner.path };
      if (prop === 'on') return { id: inner.id, path: literal(expr.arguments?.[1]) ?? inner.path };
      if (prop === 'route' && (expr.arguments || []).length === 1) return { id: inner.id, path: literal(expr.arguments[0]) };
      if (prop === 'use' || prop === 'openapi') return inner;
    }
    return null;
  };
  const isHandlerArg = node => FUNCTION_TYPES.has(node?.type) || (node?.type === 'Identifier' && bodies.has(node.name) && !constants.has(node.name));
  const pathOfCall = (call) => {
    const first = call.arguments?.[0];
    if (!first || isHandlerArg(first)) return null;
    return literal(first);
  };
  const handlerAuth = (handler) => {
    if (!handler) return false;
    if (handler.type === 'CallExpression' && isAuthMiddlewareNode(handler)) return true; // withAuth(handler)
    const fn = FUNCTION_TYPES.has(handler.type) ? handler : handler.type === 'Identifier' ? bodies.get(handler.name) : null;
    return Boolean(fn) && AUTH_CHECK_RE.test(content.slice(fn.start, fn.end));
  };
  const handlerName = (h) => (h?.type === 'Identifier' ? h.name : FUNCTION_TYPES.has(h?.type) ? (h.id?.name || 'inline') : h?.type === 'MemberExpression' ? (h.property?.name || '') : '');
  const pathLike = p => typeof p === 'string' && (p.startsWith('/') || p === '*');
  const middlewareAuth = (args) => args.some(a => isAuthMiddlewareNode(a) || (FUNCTION_TYPES.has(a?.type) && AUTH_CHECK_RE.test(content.slice(a.start, a.end))));
  // What a `use()` argument mounts: `sub.routes()`, `sub.middleware()`, or
  // koa-mount's `mount('/x', appOrRouter)`.
  const mountOf = (arg) => {
    const a = unwrap(arg);
    if (a?.type !== 'CallExpression') return null;
    const callee = a.callee;
    if (callee?.type === 'MemberExpression' && !callee.computed && MOUNT_METHODS.has(callee.property?.name) && !(a.arguments || []).length) {
      // `x.middleware()` is a koa-router mount only where Koa is in play;
      // elsewhere it is an ordinary middleware factory (`auth.middleware()`).
      if (callee.property.name === 'middleware' && ctx.defaultSource !== 'koa' && !koaLocalNode(callee.object)) return null;
      const child = refOf(callee.object);
      return child ? { child, prefix: '', unresolved: false } : null;
    }
    if (callee?.type === 'Identifier' && mountLocals.has(callee.name)) {
      const margs = a.arguments || [];
      const hasPath = margs.length >= 2;
      const prefix = hasPath ? literal(margs[0]) : '';
      const target = hasPath ? margs[1] : margs[0];
      const child = mountOf(target)?.child || refOf(target);
      if (!child) return null;
      return { child, prefix: prefix ?? '', unresolved: prefix === null, at: margs[0] };
    }
    return null;
  };
  const koaLocalNode = expr => expr?.type === 'Identifier' && bound.has(expr.name) && nodes.get(idOf(expr.name))?.kind === 'koa';
  // A first `use()` argument that is a path this reader cannot read (an
  // imported constant, `process.env.X`), rather than a middleware.
  const unreadablePath = (arg) => {
    const a = unwrap(arg);
    if (!a || FUNCTION_TYPES.has(a.type) || a.type === 'CallExpression' || isAuthMiddlewareNode(a)) return false;
    if (a.type === 'Identifier' && bodies.has(a.name)) return false;
    return ['TemplateLiteral', 'BinaryExpression', 'ArrayExpression'].includes(a.type) || PATH_LIKE_NAME.test(nodeText(content, a));
  };

  walk(ast, (node) => {
    if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression' || node.callee.computed) return;
    const prop = node.callee.property?.name;
    if (!VERBS.has(prop) && !['on', 'use', 'route', 'prefix', 'openapi', 'doc', 'doc31', 'redirect'].includes(prop)) return;
    const recv = receiverOf(node.callee.object);
    if (!recv) return;
    const args = node.arguments || [];
    const start = node.start ?? 0;

    if (prop === 'use') {
      const mounts = args.map(mountOf);
      if (mounts.some(Boolean)) {
        // Koa: `use(path?, ...middleware, sub.routes())`.
        let prefixes = [''];
        let skip = 0;
        const first = unwrap(args[0]);
        if (!mounts[0]) {
          if (first?.type === 'ArrayExpression') { prefixes = first.elements.map(e => literal(e)); skip = 1; }
          else if (literal(first) !== null) { prefixes = [literal(first)]; skip = 1; }
          else if (unreadablePath(first)) { prefixes = [null]; skip = 1; }
        }
        const pathUnresolved = prefixes.includes(null);
        if (pathUnresolved) limit('router-unresolved-path', file, lineOf(node), nodeText(content, args[0]));
        const auth = middlewareAuth(args.slice(skip).filter((a, i) => !mounts[i + skip]));
        for (const m of mounts) {
          if (!m) continue;
          if (m.unresolved) limit('router-unresolved-path', file, lineOf(node), nodeText(content, m.at));
          for (const p of prefixes) {
            edges.push({ from: recv.id, to: m.child, prefix: joinSegments(p ?? '', m.prefix), start, file: abs, auth, unresolved: pathUnresolved || m.unresolved });
          }
        }
        return;
      }
      const p = literal(args[0]);
      const hasPath = pathLike(p);
      if (middlewareAuth(hasPath ? args.slice(1) : args)) uses.push({ node: recv.id, pattern: hasPath ? p : '*', start, file: abs });
      return;
    }
    if (prop === 'route') {
      if (args.length !== 2) return;
      const child = args[1]?.type === 'Identifier' ? receiverId(args[1].name) : null;
      const prefix = literal(args[0]);
      if (prefix === null) {
        limit('router-unresolved-path', file, lineOf(node), nodeText(content, args[0]));
        if (child) edges.push({ from: recv.id, to: child, prefix: '', start, file: abs, unresolved: true });
        return;
      }
      if (child) edges.push({ from: recv.id, to: child, prefix, start, file: abs });
      return;
    }
    if (prop === 'prefix') {
      // Koa `router.prefix('/v1')`; applied once every router is known.
      if (args.length !== 1) return;
      prefixOps.push({ node: recv.id, base: literal(args[0]), file, line: lineOf(node), target: nodeText(content, args[0]) });
      return;
    }
    if (prop === 'redirect') {
      // koa-router `redirect(source, destination, code?)` registers `all(source)`
      // (docguard.js-route-shapes#FR-009). A source that is a route name is
      // resolved by koa-router at run time through `url()`, which already
      // carries the prefix the registration adds again; it is recorded, not guessed.
      if (args.length < 2) return;
      const source = literal(args[0]);
      if (source === null || !pathLike(source)) { records.push({ node: recv.id, koaOnly: true, unresolvedAt: { line: lineOf(node), target: nodeText(content, args[0]) }, file, abs, start }); return; }
      records.push({ node: recv.id, koaOnly: true, method: 'ALL', path: source, start, line: lineOf(node), file, abs, auth: false, handler: 'redirect', tier: ctx.tier, tierReason: ctx.tierReason });
      return;
    }
    if (prop === 'doc' || prop === 'doc31') {
      // OpenAPIHono serves its OpenAPI document at `doc(path, …)`.
      const local = node.callee.object?.type === 'Identifier' ? node.callee.object.name : null;
      if (!local || !bound.has(local) || !nodes.get(idOf(local))?.openapi) return;
      const path = literal(args[0]);
      if (path === null) { limit('router-unresolved-path', file, lineOf(node), nodeText(content, args[0])); return; }
      records.push({ node: recv.id, method: 'GET', path, start, line: lineOf(node), file, abs, auth: false, handler: prop, tier: ctx.tier, tierReason: ctx.tierReason });
      return;
    }
    if (prop === 'openapi') {
      // `openapi(createRoute({ method, path }), handler)`, a route variable, or a plain object.
      const arg = unwrap(args[0]);
      const handler = args[1];
      const base = { node: recv.id, start, line: lineOf(node), file, abs, handler: handlerName(handler), tier: ctx.tier, tierReason: ctx.tierReason, target: nodeText(content, args[0]) };
      let def = null;
      if (arg?.type === 'CallExpression' && isCreateRoute(arg.callee)) def = defOf(arg.arguments?.[0], arg);
      else if (arg?.type === 'ObjectExpression') def = defOf(arg, arg);
      else if (arg?.type === 'Identifier') {
        const ref = routeDefs.has(idOf(arg.name)) ? idOf(arg.name) : importedId(arg.name);
        if (ref) { records.push({ ...base, defRef: ref, auth: handlerAuth(handler) }); return; }
      }
      if (!def || def.unresolved) { limit(def?.code || 'router-unresolved-route', file, lineOf(node), base.target); return; }
      records.push({ ...base, method: def.method, path: def.path, auth: def.auth || handlerAuth(handler) });
      return;
    }

    let methods;
    let pathIndex;
    if (prop === 'on') {
      const m = args[0];
      const list = m?.type === 'ArrayExpression' ? m.elements : [m];
      methods = list.map(e => (e?.type === 'StringLiteral' ? e.value.toUpperCase() : null));
      if (methods.includes(null)) { limit('router-unresolved-method', file, lineOf(node), nodeText(content, m)); return; }
      pathIndex = 1;
    } else {
      methods = [METHOD_OF[prop] || prop.toUpperCase()];
      pathIndex = 0;
      // koa-router named route: `router.get('user', '/users/:id', h)`.
      if (args[0]?.type === 'StringLiteral' && !pathLike(args[0].value) && args.length >= 3 && pathLike(literal(args[1]))) pathIndex = 1;
    }
    const first = args[pathIndex];
    let path;
    let rest;
    if (prop !== 'on' && (!first || isHandlerArg(first))) {
      // Hono: a method without a path reuses the chain's last path.
      if (recv.path === null || recv.path === undefined) return;
      path = recv.path;
      rest = args;
    } else {
      path = literal(first);
      if (path === null) {
        if (args.length > pathIndex + 1) limit('router-unresolved-path', file, lineOf(node), nodeText(content, first));
        return;
      }
      rest = args.slice(pathIndex + 1);
    }
    if (!pathLike(path)) return;
    const handler = rest[rest.length - 1];
    // `router.all('/users/*', usersRouter.fetch)`: a delegation, not a route.
    if (rest.length === 1 && handler?.type === 'MemberExpression' && !handler.computed && ['fetch', 'handle'].includes(handler.property?.name)) return;
    // itty: `router.all('*', withAuth)` — middleware only, so it guards what follows.
    if (path === '*' && prop === 'all' && rest.length && rest.every(isAuthMiddlewareNode)) {
      uses.push({ node: recv.id, pattern: '*', start, file: abs });
      return;
    }
    const auth = middlewareAuth(rest.slice(0, -1)) || handlerAuth(handler);
    for (const method of methods) {
      records.push({ node: recv.id, method, path, start, line: lineOf(node), file, abs, auth, handler: handlerName(handler), tier: ctx.tier, tierReason: ctx.tierReason });
    }
  });
}

// ── Pattern tier (the file did not parse) ────────────────────────────────────

function readByPattern(ctx) {
  const { src, nodes, records, uses } = ctx;
  const { abs, file, content } = src;
  const { code, lits } = lexJs(content);
  const pairs = matchPairs(code);
  const literal = ([s, e]) => { const v = literalIn(code, lits, s, e); return typeof v === 'string' ? v : null; };
  const routers = new Map();
  // In a Koa project `new Router({ prefix })` is a koa-router router.
  const routerKind = ctx.defaultSource === 'koa' ? 'koa' : 'itty';
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(new\s+(?:Hono|OpenAPIHono)\b|(?:new\s+)?(?:Router|AutoRouter|IttyRouter)\s*\()/g)) {
    const kind = /Hono/.test(m[2]) ? 'hono' : routerKind;
    const open = m.index + m[0].length - 1;
    const base = kind !== 'hono' && pairs.has(open)
      ? (/\b(?:base|prefix)\s*:\s*(['"`])([^'"`]*)\1/.exec(content.slice(open, pairs.get(open))) || [])[2] || ''
      : '';
    routers.set(m[1], { kind, base });
  }
  const leading = ([s, e]) => (/^[A-Za-z_$][\w$.]*/.exec(content.slice(s, e).trim()) || [''])[0];
  const authWord = w => w.split('.').some(isAuthMiddlewareName);
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|delete|del|patch|head|options|all|use)\s*\(/g)) {
    const name = m[1];
    if (!routers.has(name) && !ROUTER_NAME.test(name)) continue;
    const open = m.index + m[0].length - 1;
    if (!pairs.has(open)) continue;
    const args = splitTopLevel(code, pairs, open + 1, pairs.get(open));
    if (!args.length) continue;
    const id = `${abs}#${name}`;
    if (!nodes.has(id)) nodes.set(id, routers.get(name) || { kind: null, base: '' });
    const words = args.map(leading);
    const path = literal(args[0]);
    const hasPath = typeof path === 'string' && (path.startsWith('/') || path === '*');
    if (m[2] === 'use') {
      if ((hasPath ? words.slice(1) : words).some(authWord)) uses.push({ node: id, pattern: hasPath ? path : '*', start: m.index, file: abs });
      continue;
    }
    if (!hasPath) continue;
    records.push({ node: id, method: METHOD_OF[m[2]] || m[2].toUpperCase(), path, start: m.index, line: lineAt(content, m.index), file, abs, auth: words.slice(1, -1).some(authWord), handler: words.length > 1 ? words[words.length - 1] : '', tier: ctx.tier, tierReason: ctx.tierReason });
  }
}
