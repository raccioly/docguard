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
 * @implements docguard.js-framework-routes#FR-005
 * @implements docguard.js-framework-routes#FR-006
 */

import { walk, isAuthMiddlewareNode, isAuthMiddlewareName, functionBodies, topLevelStaticStrings, pathArgValue, AUTH_CHECK_RE } from './js-ast.mjs';
import { matchPairs, splitTopLevel, literalIn } from './route-lexing.mjs';
import { parseWithTier, lineAt, joinSegments, nodeText, lexJs } from './js-route-support.mjs';

const VERBS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all']);
const HONO_MODULES = new Set(['hono', 'hono/tiny', 'hono/quick', '@hono/zod-openapi']);
const HONO_CLASSES = new Set(['Hono', 'OpenAPIHono']);
const ITTY_FACTORIES = new Set(['Router', 'AutoRouter', 'IttyRouter']);
/** The shorthand scanner's receiver heuristic (js-ast.mjs `looksLikeRouteReceiver`). */
const ROUTER_NAME = /(?:app|server|router|routes)$/i;
const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression']);
const SOURCE_OF_KIND = { hono: 'hono', itty: 'itty-router' };

/**
 * Hono and itty-router routes of a set of files.
 * @param {Array<{ file: string, abs: string, content: string }>} sources
 * @param {(fromAbs: string, spec: string) => string|null} resolveImport
 * @param {{ framework?: string, defaultSource?: string }} [opts]
 * @returns {Array<object>} routes, with non-enumerable `limitations` and `fileTiers`
 */
export function extractRouterRoutes(sources, resolveImport, { framework = 'Hono', defaultSource = 'hono' } = {}) {
  const nodes = new Map();        // id -> { kind, base, auth }
  const aliases = new Map();      // local import id -> { target, imported }
  const exportsByFile = new Map(); // abs -> Map(exported -> local)
  const edges = [];               // { from, to, prefix, start, file }
  const uses = [];                // { node, pattern, start, file }
  const records = [];             // route records before prefixes
  const limitations = [];
  const fileTiers = [];
  const limit = (code, file, line, target = '') => limitations.push({ framework, code, file, line, target });

  for (const src of sources) {
    const { ast, tier, tierReason } = parseWithTier(src.content, src.abs);
    fileTiers.push({ file: src.file, tier, tierReason });
    const ctx = { src, tier, tierReason, nodes, aliases, exportsByFile, edges, uses, records, limit, resolveImport };
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

  // Every chain of prefixes to a router, with whether auth middleware covers it.
  const memo = new Map();
  const effective = (id, visiting = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const node = nodes.get(id) || { base: '', auth: false };
    if (visiting.has(id) || visiting.size > 32) return [];
    const incoming = edges.filter(e => canonical(e.to) === id);
    let out;
    if (!incoming.length) out = [{ prefix: joinSegments(node.base), auth: Boolean(node.auth) }];
    else {
      out = [];
      const next = new Set(visiting).add(id);
      for (const e of incoming) {
        const from = canonical(e.from);
        for (const p of effective(from, next)) {
          out.push({ prefix: joinSegments(p.prefix, e.prefix, node.base), auth: Boolean(p.auth || node.auth || covered(from, e.prefix, e.start, e.file)) });
        }
      }
    }
    memo.set(id, out);
    return out;
  };
  const covered = (id, path, start, file) => uses.some(u => canonical(u.node) === id && u.file === file && u.start < start && patternCovers(u.pattern, path));

  const routes = [];
  for (const r of records) {
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

/** Does a `use()` path pattern (`*`, `/admin/*`, `/x`) cover `path`? */
function patternCovers(pattern, path) {
  const p = joinSegments(path);
  if (pattern === '*' || pattern === '/*') return true;
  if (pattern.endsWith('/*')) {
    const base = joinSegments(pattern.slice(0, -2));
    return base === '/' || p === base || p.startsWith(`${base}/`);
  }
  return joinSegments(pattern) === p;
}

// ── Syntax-tree tier ─────────────────────────────────────────────────────────

function readAst(ast, ctx) {
  const { src, nodes, aliases, exportsByFile, edges, uses, records, limit, resolveImport } = ctx;
  const { abs, file, content } = src;
  const constants = topLevelStaticStrings(ast);
  const bodies = functionBodies(ast);
  const honoLocals = new Set();
  const ittyLocals = new Set();
  const imports = new Map(); // local -> { spec, imported }
  const exportsMap = new Map();
  exportsByFile.set(abs, exportsMap);
  const bound = new Set();
  const idOf = name => `${abs}#${name}`;
  const lineOf = node => node?.loc?.start.line ?? lineAt(content, node?.start ?? 0);
  const literal = (node) => { const v = pathArgValue(node, constants, false); return typeof v === 'string' ? v : null; };
  const propValue = (obj, key) => (obj?.type === 'ObjectExpression'
    ? (obj.properties || []).find(p => p.type === 'ObjectProperty' && !p.computed && (p.key?.name ?? p.key?.value) === key)?.value
    : undefined);

  for (const st of ast.program?.body || []) {
    if (st.type === 'ImportDeclaration' && typeof st.source?.value === 'string') {
      const spec = st.source.value;
      for (const sp of st.specifiers || []) {
        const imported = sp.type === 'ImportDefaultSpecifier' ? 'default' : sp.type === 'ImportNamespaceSpecifier' ? '*' : (sp.imported?.name ?? sp.imported?.value);
        if (HONO_MODULES.has(spec) && HONO_CLASSES.has(imported)) honoLocals.add(sp.local.name);
        else if (spec === 'itty-router' && ITTY_FACTORIES.has(imported)) ittyLocals.add(sp.local.name);
        else imports.set(sp.local.name, { spec, imported });
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
    }
  }

  // The node a receiver identifier names: a router made here, an imported
  // router, or a value named like one.
  const receiverId = (name) => {
    const id = idOf(name);
    if (bound.has(name)) return id;
    if (imports.has(name)) {
      const target = resolveImport(abs, imports.get(name).spec);
      if (target) { aliases.set(id, { target, imported: imports.get(name).imported }); return id; }
    }
    if (ROUTER_NAME.test(name)) {
      if (!nodes.has(id)) nodes.set(id, { kind: null, base: '' });
      return id;
    }
    return null;
  };
  // Router values created in this file.
  const routerFrom = (init) => {
    if (init?.type === 'NewExpression' && init.callee?.type === 'Identifier' && honoLocals.has(init.callee.name)) return { kind: 'hono', base: '' };
    if (init?.type === 'CallExpression' && init.callee?.type === 'Identifier' && ittyLocals.has(init.callee.name)) {
      const opts = init.arguments?.[0];
      const baseNode = propValue(opts, 'base');
      const base = baseNode === undefined ? '' : literal(baseNode);
      if (base === null) { limit('router-unresolved-base', file, lineOf(baseNode), nodeText(content, baseNode)); return { kind: 'itty', base: '', unresolved: true }; }
      return { kind: 'itty', base, auth: isAuthMiddlewareNode(propValue(opts, 'before')) };
    }
    return null;
  };
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier' || !node.init) return;
    const name = node.id.name;
    const init = node.init;
    const direct = routerFrom(init);
    if (direct) { nodes.set(idOf(name), direct); bound.add(name); return; }
    // `x.basePath('/p')` on a new Hono or on another router.
    if (init.type === 'CallExpression' && init.callee?.type === 'MemberExpression' && !init.callee.computed && init.callee.property?.name === 'basePath') {
      const base = literal(init.arguments?.[0]);
      if (base === null) { limit('router-unresolved-base', file, lineOf(init), nodeText(content, init.arguments?.[0])); return; }
      const inner = routerFrom(init.callee.object);
      if (inner) { nodes.set(idOf(name), { ...inner, base: joinSegments(inner.base, base) }); bound.add(name); return; }
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
      if (prop === 'use') return inner;
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
    const fn = FUNCTION_TYPES.has(handler.type) ? handler : handler.type === 'Identifier' ? bodies.get(handler.name) : null;
    return Boolean(fn) && AUTH_CHECK_RE.test(content.slice(fn.start, fn.end));
  };
  const handlerName = (h) => (h?.type === 'Identifier' ? h.name : FUNCTION_TYPES.has(h?.type) ? (h.id?.name || 'inline') : h?.type === 'MemberExpression' ? (h.property?.name || '') : '');
  const pathLike = p => typeof p === 'string' && (p.startsWith('/') || p === '*');
  const middlewareAuth = (args) => args.some(a => isAuthMiddlewareNode(a) || (FUNCTION_TYPES.has(a?.type) && AUTH_CHECK_RE.test(content.slice(a.start, a.end))));

  walk(ast, (node) => {
    if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression' || node.callee.computed) return;
    const prop = node.callee.property?.name;
    if (!VERBS.has(prop) && prop !== 'on' && prop !== 'use' && prop !== 'route') return;
    const recv = receiverOf(node.callee.object);
    if (!recv) return;
    const args = node.arguments || [];
    const start = node.start ?? 0;

    if (prop === 'use') {
      const p = literal(args[0]);
      const hasPath = pathLike(p);
      if (middlewareAuth(hasPath ? args.slice(1) : args)) uses.push({ node: recv.id, pattern: hasPath ? p : '*', start, file: abs });
      return;
    }
    if (prop === 'route') {
      if (args.length !== 2) return;
      const prefix = literal(args[0]);
      if (prefix === null) { limit('router-unresolved-path', file, lineOf(node), nodeText(content, args[0])); return; }
      const child = args[1]?.type === 'Identifier' ? receiverId(args[1].name) : null;
      if (child) edges.push({ from: recv.id, to: child, prefix, start, file: abs });
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
      methods = [prop.toUpperCase()];
      pathIndex = 0;
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
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(new\s+(?:Hono|OpenAPIHono)\b|(?:Router|AutoRouter|IttyRouter)\s*\()/g)) {
    const kind = m[2].startsWith('new') ? 'hono' : 'itty';
    const open = m.index + m[0].length - 1;
    const base = kind === 'itty' && pairs.has(open)
      ? (/\bbase\s*:\s*(['"`])([^'"`]*)\1/.exec(content.slice(open, pairs.get(open))) || [])[2] || ''
      : '';
    routers.set(m[1], { kind, base });
  }
  const leading = ([s, e]) => (/^[A-Za-z_$][\w$.]*/.exec(content.slice(s, e).trim()) || [''])[0];
  const authWord = w => w.split('.').some(isAuthMiddlewareName);
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|delete|patch|head|options|all|use)\s*\(/g)) {
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
    records.push({ node: id, method: m[2].toUpperCase(), path, start: m.index, line: lineAt(content, m.index), file, abs, auth: words.slice(1, -1).some(authWord), handler: words.length > 1 ? words[words.length - 1] : '', tier: ctx.tier, tierReason: ctx.tierReason });
  }
}
