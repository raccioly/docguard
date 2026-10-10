/**
 * Cloudflare Worker fetch-handler dispatch (docguard.js-framework-routes#FR-004).
 *
 * A Worker without a router library routes inside its `fetch` handler by
 * testing the request URL: `url.pathname === '/x'`, `switch (url.pathname)`,
 * a table keyed by pathname, or a `URLPattern`. This reader starts at the
 * public entry (`export default { fetch }`, a default-exported class with a
 * `fetch` method, or `addEventListener('fetch', …)`), follows the modules it
 * imports, and reports each tested path with the methods the surrounding code
 * checks (`request.method`), or `ALL` when nothing narrows it.
 *
 * What it does not report: paths inside any other class (a Durable Object's
 * `fetch` answers stub calls, not public HTTP), `location.pathname` (browser
 * code), and modules the entry never imports. A dispatch it cannot enumerate
 * (`startsWith`, a regular expression, a comparison with a variable) is
 * recorded as a limitation, never turned into an invented route.
 *
 * @implements docguard.js-framework-routes#FR-004
 * @implements docguard.js-framework-routes#FR-006
 */

import { isAuthMiddlewareName, topLevelStaticStrings, pathArgValue, functionBodies, AUTH_CHECK_RE } from './js-ast.mjs';
import { matchPairs } from './route-lexing.mjs';
import { parseWithTier, lineAt, nodeText, lexJs } from './js-route-support.mjs';

const FRAMEWORK = 'Cloudflare Workers';
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const ENTRY_HINT = /\bfetch\b|addEventListener/;
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);
const CLASS_TYPES = new Set(['ClassDeclaration', 'ClassExpression']);
const NORMALIZERS = new Set(['toLowerCase', 'toUpperCase', 'trim', 'normalize', 'replace', 'replaceAll']);
const UNENUMERABLE = new Set(['startsWith', 'endsWith', 'includes', 'match', 'matchAll', 'split', 'slice', 'substring', 'substr', 'search', 'indexOf']);
const AUTH_HEADER_RE = /headers\s*\.\s*get\s*\(\s*['"`]authorization['"`]/i;
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'typeAnnotation', 'returnType', 'typeParameters']);

/**
 * Routes a Worker's fetch entry dispatches on.
 * @param {Array<{ file: string, abs: string, content: string }>} sources
 * @param {(fromAbs: string, spec: string) => string|null} resolveImport
 * @param {{ isEntry?: (src: object) => boolean, framework?: string, source?: string }} [opts]
 *   `isEntry` limits which files may be the public entry (a Pages project's
 *   advanced-mode `_worker.js`, docguard.js-route-shapes#FR-008); `framework`
 *   and `source` label what is found.
 * @returns {Array<object>} routes, with non-enumerable `limitations` and `fileTiers`
 */
export function extractWorkerRoutes(sources, resolveImport, { isEntry = null, framework = FRAMEWORK, source = 'cloudflare-workers' } = {}) {
  const byAbs = new Map(sources.map(s => [s.abs, s]));
  const parsed = new Map();
  const parse = src => {
    if (!parsed.has(src.abs)) parsed.set(src.abs, parseWithTier(src.content, src.abs));
    return parsed.get(src.abs);
  };

  // The public entries.
  const entries = new Map(); // abs -> entry class node (or null)
  for (const src of sources) {
    if (!ENTRY_HINT.test(src.content) || (isEntry && !isEntry(src))) continue;
    const { ast } = parse(src);
    const entry = ast ? fetchEntry(ast) : patternEntry(src.content);
    if (entry) entries.set(src.abs, entry.cls || null);
  }

  // Everything the entries import, transitively.
  const reach = [];
  const seen = new Set();
  const queue = [...entries.keys()].map(abs => byAbs.get(abs));
  while (queue.length && reach.length < 2000) {
    const src = queue.shift();
    if (!src || seen.has(src.abs)) continue;
    seen.add(src.abs);
    reach.push(src);
    const { ast } = parse(src);
    for (const spec of importSpecs(ast, src.content)) {
      const target = resolveImport(src.abs, spec);
      if (target && byAbs.has(target) && !seen.has(target)) queue.push(byAbs.get(target));
    }
  }

  const routes = [];
  const limitations = [];
  const fileTiers = [];
  for (const src of reach) {
    const { ast, tier, tierReason } = parse(src);
    fileTiers.push({ file: src.file, tier, tierReason });
    const out = ast ? readDispatch(ast, src, entries.get(src.abs) || null) : readDispatchByPattern(src);
    for (const r of out.routes) routes.push({ ...r, file: src.file, source, description: '', tier, tierReason });
    for (const l of out.limitations) limitations.push({ framework, file: src.file, ...l });
  }
  Object.defineProperty(routes, 'limitations', { value: limitations, enumerable: false });
  Object.defineProperty(routes, 'fileTiers', { value: fileTiers, enumerable: false });
  return routes;
}

const unwrap = (node) => {
  let n = node;
  while (n && ['TSSatisfiesExpression', 'TSAsExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'TypeCastExpression'].includes(n.type)) n = n.expression;
  return n;
};
const keyName = p => (p.computed ? (p.key?.type === 'StringLiteral' ? p.key.value : null) : (p.key?.name ?? p.key?.value ?? null));
const hasFetchMember = obj => (obj?.properties || []).some(p => (p.type === 'ObjectMethod' || p.type === 'ObjectProperty') && keyName(p) === 'fetch');
const classHasFetch = cls => (cls?.body?.body || []).some(m => (m.type === 'ClassMethod' || m.type === 'ClassProperty') && keyName(m) === 'fetch');

/** `{ cls }` when the module is a Worker's public fetch entry; `cls` is its default-exported class. */
function fetchEntry(ast) {
  const topInit = new Map();
  for (const st of ast.program?.body || []) {
    const decl = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
    if (decl?.type === 'VariableDeclaration') for (const d of decl.declarations || []) if (d.id?.type === 'Identifier') topInit.set(d.id.name, d.init);
  }
  for (const st of ast.program?.body || []) {
    if (st.type === 'ExportDefaultDeclaration') {
      let decl = unwrap(st.declaration);
      if (decl?.type === 'Identifier') decl = unwrap(topInit.get(decl.name));
      if (decl?.type === 'ObjectExpression' && hasFetchMember(decl)) return { cls: null };
      if (CLASS_TYPES.has(decl?.type) && classHasFetch(decl)) return { cls: decl };
    }
    const expr = st.type === 'ExpressionStatement' ? st.expression : null;
    if (expr?.type === 'CallExpression') {
      const c = expr.callee;
      const name = c?.type === 'Identifier' ? c.name : c?.type === 'MemberExpression' && !c.computed ? c.property?.name : '';
      if (name === 'addEventListener' && expr.arguments?.[0]?.type === 'StringLiteral' && expr.arguments[0].value === 'fetch') return { cls: null };
    }
  }
  return null;
}

function patternEntry(content) {
  const { code } = lexJs(content);
  return /\bexport\s+default\s*\{[\s\S]*?\bfetch\b/.test(code) || /\baddEventListener\s*\(\s*['"`]fetch['"`]/.test(content) ? { cls: null } : null;
}

function importSpecs(ast, content) {
  const specs = [];
  if (ast) {
    for (const st of ast.program?.body || []) {
      if ((st.type === 'ImportDeclaration' || st.type === 'ExportNamedDeclaration' || st.type === 'ExportAllDeclaration') && typeof st.source?.value === 'string') specs.push(st.source.value);
    }
    walkWithAncestors(ast.program, (node) => {
      if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') specs.push(node.source.value);
      if (node.type === 'CallExpression' && node.arguments?.[0]?.type === 'StringLiteral'
          && (node.callee?.type === 'Import' || (node.callee?.type === 'Identifier' && node.callee.name === 'require'))) specs.push(node.arguments[0].value);
    }, { classes: true });
    return specs;
  }
  for (const m of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)) specs.push(m[1]);
  return specs;
}

/** Depth-first walk that hands each node its ancestors; skips class bodies unless asked. */
function walkWithAncestors(root, visit, { classes = false, entryClass = null } = {}) {
  const ancestors = [];
  const go = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (!classes && CLASS_TYPES.has(node.type) && node !== entryClass) return;
    visit(node, ancestors);
    ancestors.push(node);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) for (const c of child) go(c);
      else if (child && typeof child === 'object') go(child);
    }
    ancestors.pop();
  };
  go(root);
}

// ── Syntax-tree tier ─────────────────────────────────────────────────────────

function readDispatch(ast, src, entryClass) {
  const { content } = src;
  const constants = topLevelStaticStrings(ast);
  const bodies = functionBodies(ast);
  const inits = new Map();
  const pathAliases = new Set(['pathname']);
  const methodAliases = new Set(['method']);
  const patternUses = new Map(); // URLPattern binding -> number of .test()/.exec() sites
  const routes = [];
  const limitations = [];
  const lineOf = node => node?.loc?.start.line ?? lineAt(content, node?.start ?? 0);
  const limit = (code, node, target = '') => limitations.push({ code, line: lineOf(node), target });

  const isLocation = (obj) => {
    const o = unwrap(obj);
    if (o?.type === 'Identifier') return o.name === 'location';
    return (o?.type === 'MemberExpression' || o?.type === 'OptionalMemberExpression') && !o.computed && o.property?.name === 'location';
  };
  const isPathExpr = (node) => {
    const n = unwrap(node);
    if (!n) return false;
    if (n.type === 'Identifier') return pathAliases.has(n.name);
    if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && !n.computed && n.property?.name === 'pathname') return !isLocation(n.object);
    if ((n.type === 'CallExpression' || n.type === 'OptionalCallExpression') && (n.callee?.type === 'MemberExpression' || n.callee?.type === 'OptionalMemberExpression') && NORMALIZERS.has(n.callee.property?.name)) return isPathExpr(n.callee.object);
    return false;
  };
  const isMethodExpr = (node) => {
    const n = unwrap(node);
    if (n?.type === 'Identifier') return methodAliases.has(n.name);
    if ((n?.type === 'MemberExpression' || n?.type === 'OptionalMemberExpression') && !n.computed && n.property?.name === 'method') return true;
    if (n?.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && NORMALIZERS.has(n.callee.property?.name)) return isMethodExpr(n.callee.object);
    return false;
  };
  const literal = (node) => { const v = pathArgValue(unwrap(node), constants, false); return typeof v === 'string' ? v : null; };

  // Bindings: pathname and method aliases, initializers, URLPattern names.
  walkWithAncestors(ast.program, (node) => {
    if (node.type !== 'VariableDeclarator' || !node.init) return;
    if (node.id?.type === 'Identifier') {
      inits.set(node.id.name, node.init);
      if (isPathExpr(node.init)) pathAliases.add(node.id.name);
      if (isMethodExpr(node.init)) methodAliases.add(node.id.name);
    } else if (node.id?.type === 'ObjectPattern') {
      for (const p of node.id.properties || []) {
        if (p.type !== 'ObjectProperty') continue;
        const target = p.value?.type === 'AssignmentPattern' ? p.value.left : p.value;
        if (target?.type !== 'Identifier') continue;
        if (keyName(p) === 'pathname') pathAliases.add(target.name);
        if (keyName(p) === 'method') methodAliases.add(target.name);
      }
    }
  }, { entryClass });

  // `request.method === 'GET'` tests of one polarity inside a logical tree.
  const methodTests = (node, positive) => {
    const n = unwrap(node);
    if (n?.type === 'LogicalExpression') return [...methodTests(n.left, positive), ...methodTests(n.right, positive)];
    if (n?.type === 'BinaryExpression' && (positive ? ['===', '=='] : ['!==', '!=']).includes(n.operator)) {
      const [m, v] = isMethodExpr(n.left) ? [n.left, n.right] : isMethodExpr(n.right) ? [n.right, n.left] : [null, null];
      const value = m ? literal(v) : null;
      return value && HTTP_METHODS.has(value.toUpperCase()) ? [value.toUpperCase()] : [];
    }
    if (positive && n?.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && n.callee.property?.name === 'includes'
        && n.callee.object?.type === 'ArrayExpression' && isMethodExpr(n.arguments?.[0])) {
      return n.callee.object.elements.map(literal).filter(v => v && HTTP_METHODS.has(v.toUpperCase())).map(v => v.toUpperCase());
    }
    return [];
  };
  const hasPathTest = (node) => {
    let found = false;
    walkWithAncestors(node, (n) => { if (n.type === 'BinaryExpression' && (isPathExpr(n.left) || isPathExpr(n.right))) found = true; });
    return found;
  };
  const statementsOf = (stmts) => (Array.isArray(stmts) ? stmts : [stmts]).flatMap(s => (s?.type === 'BlockStatement' ? s.body : [s]));
  // Methods a branch dispatches on at its top level: `if (method === 'GET')` chains, `switch (method)`.
  const branchMethods = (stmts) => {
    const out = [];
    for (const s of statementsOf(stmts)) {
      for (let cur = s; cur?.type === 'IfStatement'; cur = cur.alternate) {
        if (!hasPathTest(cur.test)) out.push(...methodTests(cur.test, true));
      }
      if (s?.type === 'SwitchStatement' && isMethodExpr(s.discriminant)) {
        for (const c of s.cases || []) { const v = c.test ? literal(c.test) : null; if (v && HTTP_METHODS.has(v.toUpperCase())) out.push(v.toUpperCase()); }
      }
    }
    return out.length ? [...new Set(out)] : null;
  };
  // A method check around the site, inside the same function.
  const enclosingMethods = (ancestors, child) => {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const a = ancestors[i];
      const inner = i + 1 < ancestors.length ? ancestors[i + 1] : child;
      if (FUNCTION_TYPES.has(a.type)) return null;
      if (a.type === 'IfStatement' && a.consequent === inner && !hasPathTest(a.test)) {
        const m = methodTests(a.test, true);
        if (m.length) return m;
      }
      if (a.type === 'SwitchCase' && a.test && i > 0 && ancestors[i - 1].type === 'SwitchStatement' && isMethodExpr(ancestors[i - 1].discriminant)) {
        const v = literal(a.test);
        if (v && HTTP_METHODS.has(v.toUpperCase())) return [v.toUpperCase()];
      }
    }
    return null;
  };
  const branchAuth = (stmts) => statementsOf(stmts).some((s) => {
    if (!s || typeof s.start !== 'number') return false;
    const text = content.slice(s.start, s.end);
    if (AUTH_CHECK_RE.test(text) || AUTH_HEADER_RE.test(text)) return true;
    let auth = false;
    walkWithAncestors(s, (n) => {
      if (n.type !== 'CallExpression') return;
      const name = n.callee?.type === 'Identifier' ? n.callee.name : n.callee?.type === 'MemberExpression' && !n.callee.computed ? n.callee.property?.name : '';
      if (isAuthMiddlewareName(name)) auth = true;
    });
    return auth;
  });
  const fnAuth = (node) => {
    const fn = node?.type === 'Identifier' ? bodies.get(node.name) : FUNCTION_TYPES.has(node?.type) ? node : null;
    return Boolean(fn) && branchAuth([fn.body]);
  };
  const handlerOf = (stmts) => {
    for (const s of statementsOf(stmts)) {
      if (s?.type !== 'ReturnStatement') continue;
      let a = s.argument?.type === 'AwaitExpression' ? s.argument.argument : s.argument;
      if (a?.type !== 'CallExpression') return 'inline';
      a = a.callee;
      return a?.type === 'Identifier' ? a.name : a?.type === 'MemberExpression' && !a.computed ? (a.property?.name || 'inline') : 'inline';
    }
    return 'inline';
  };
  const emit = (path, methods, node, branch) => {
    for (const method of methods) {
      routes.push({ method, path, handler: branch ? handlerOf(branch) : 'inline', line: lineOf(node), auth: branch ? branchAuth(branch) : false });
    }
  };

  // A site is a test of the path (a comparison, or a URLPattern test): its
  // methods come from the same condition, the branch it guards, or the code around it.
  const site = (path, testNode, ancestors, positive) => {
    let top = testNode;
    let i = ancestors.length - 1;
    while (i >= 0 && ['LogicalExpression', 'ParenthesizedExpression'].includes(ancestors[i].type)) { top = ancestors[i]; i--; }
    const parent = ancestors[i];
    let branch = null;
    if (positive && ['IfStatement', 'ConditionalExpression'].includes(parent?.type) && parent.test === top) branch = parent.consequent;
    else if (positive && parent?.type === 'SwitchCase' && parent.test === top) branch = parent.consequent;
    else if (!positive && parent?.type === 'IfStatement' && parent.test === top) {
      const block = ancestors[i - 1];
      const list = Array.isArray(block?.body) ? block.body : null;
      if (list) branch = list.slice(list.indexOf(parent) + 1);
    }
    const methods = (() => {
      const own = methodTests(top, positive);
      if (own.length) return own;
      return (branch && positive ? branchMethods(branch) : null) || enclosingMethods(ancestors.slice(0, i + 1), top) || ['ALL'];
    })();
    emit(path, methods, testNode, branch);
  };

  const urlPatternPath = (node) => {
    const arg = unwrap(node.arguments?.[0]);
    let raw = null;
    if (arg?.type === 'ObjectExpression') {
      const p = (arg.properties || []).find(q => q.type === 'ObjectProperty' && keyName(q) === 'pathname');
      raw = p ? literal(p.value) : null;
    } else {
      const v = literal(arg);
      raw = v === null ? null : v.startsWith('/') ? v : (/^[a-z*][\w+.*-]*:\/\/[^/]+(\/.*)$/i.exec(v) || [])[1] ?? null;
    }
    if (raw === null) return null;
    return raw.replace(/(:[A-Za-z_$][\w$]*)\([^)]*\)/g, '$1').replace(/\(\.\*\)/g, '*');
  };

  walkWithAncestors(ast.program, (node, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    // pathname === '/x' (and the negated form)
    if (node.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(node.operator)) {
      const [, other] = isPathExpr(node.left) ? [node.left, node.right] : isPathExpr(node.right) ? [node.right, node.left] : [null, null];
      if (!other) return;
      const path = literal(other);
      if (path === null || !(path.startsWith('/') || path === '*')) { limit('worker-unresolved-path', node, nodeText(content, other)); return; }
      site(path, node, ancestors, node.operator.startsWith('='));
      return;
    }
    // switch (url.pathname) { case '/x': … }
    if (node.type === 'SwitchStatement' && isPathExpr(node.discriminant)) {
      let group = [];
      for (const c of node.cases || []) {
        if (!c.test) { group = []; continue; }
        const path = literal(c.test);
        if (path === null) { limit('worker-unresolved-path', c, nodeText(content, c.test)); continue; }
        group.push({ path, c });
        if (!c.consequent.length) continue;
        const methods = branchMethods(c.consequent) || enclosingMethods(ancestors, node) || ['ALL'];
        for (const g of group) emit(g.path, methods, g.c, c.consequent);
        group = [];
      }
      return;
    }
    // routes[url.pathname] / table.get(url.pathname)
    if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && node.computed && isPathExpr(node.property)) {
      tableRoutes(node.object, node);
      return;
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && !node.callee.computed) {
      const prop = node.callee.property?.name;
      if (prop === 'get' && isPathExpr(node.arguments?.[0])) { tableRoutes(node.callee.object, node); return; }
      if (UNENUMERABLE.has(prop) && isPathExpr(node.callee.object)) {
        limit(prop === 'startsWith' ? 'worker-prefix-dispatch' : 'worker-unresolved-dispatch', node, nodeText(content, node));
        return;
      }
      if ((prop === 'test' || prop === 'exec') && isPathExpr(node.arguments?.[0])) {
        limit('worker-regex-dispatch', node, nodeText(content, node));
        return;
      }
      // P.test(request.url) on a URLPattern binding.
      const obj = node.callee.object;
      if ((prop === 'test' || prop === 'exec') && obj?.type === 'Identifier' && isUrlPattern(inits.get(obj.name))) {
        patternUses.set(obj.name, (patternUses.get(obj.name) || 0) + 1);
        const path = urlPatternPath(unwrap(inits.get(obj.name)));
        if (path === null) limit('worker-unresolved-path', node, nodeText(content, inits.get(obj.name)));
        else site(path, node, ancestors, true);
        return;
      }
    }
    // new URLPattern(...) inline, in a route table, or declared and never tested.
    if (node.type === 'NewExpression' && isUrlPattern(node)) {
      const grand = ancestors[ancestors.length - 2];
      if (parent?.type === 'MemberExpression' && parent.object === node && grand?.type === 'CallExpression' && ['test', 'exec'].includes(parent.property?.name)) {
        const path = urlPatternPath(node);
        if (path === null) limit('worker-unresolved-path', node, nodeText(content, node));
        else site(path, grand, ancestors.slice(0, -2), true);
        return;
      }
      if (parent?.type === 'VariableDeclarator') return; // read at its test sites, or below
      const path = urlPatternPath(node);
      if (path === null) { limit('worker-unresolved-path', node, nodeText(content, node)); return; }
      let methods = ['ALL'];
      if (parent?.type === 'ObjectProperty' && grand?.type === 'ObjectExpression') {
        const m = (grand.properties || []).find(q => q.type === 'ObjectProperty' && ['method', 'methods'].includes(keyName(q)));
        const vals = m ? (m.value.type === 'ArrayExpression' ? m.value.elements : [m.value]).map(literal) : [];
        if (vals.length && vals.every(v => v && HTTP_METHODS.has(v.toUpperCase()))) methods = vals.map(v => v.toUpperCase());
        const handler = (grand.properties || []).find(q => q.type === 'ObjectProperty' && keyName(q) === 'handler')?.value;
        for (const method of methods) routes.push({ method, path, handler: handler?.type === 'Identifier' ? handler.name : 'inline', line: lineOf(node), auth: fnAuth(handler) });
        return;
      }
      emit(path, methods, node, null);
    }
  }, { entryClass });

  // A URLPattern declared and never tested here still names a served path.
  walkWithAncestors(ast.program, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier' || !isUrlPattern(node.init) || patternUses.get(node.id.name)) return;
    const path = urlPatternPath(unwrap(node.init));
    if (path === null) limit('worker-unresolved-path', node, nodeText(content, node.init));
    else emit(path, ['ALL'], node, null);
  }, { entryClass });

  function tableRoutes(objNode, at) {
    const init = objNode?.type === 'Identifier' ? unwrap(inits.get(objNode.name)) : null;
    if (init?.type === 'ObjectExpression') {
      for (const p of init.properties || []) {
        if (p.type !== 'ObjectProperty') continue;
        const path = keyName(p);
        if (typeof path !== 'string' || !(path.startsWith('/') || path === '*')) continue;
        const value = unwrap(p.value);
        const verbs = value?.type === 'ObjectExpression' ? (value.properties || []).map(keyName) : [];
        const methods = verbs.length && verbs.every(v => v && HTTP_METHODS.has(v.toUpperCase())) ? verbs.map(v => v.toUpperCase()) : ['ALL'];
        for (const method of methods) {
          const h = value?.type === 'ObjectExpression' ? (value.properties || []).find(q => keyName(q)?.toUpperCase() === method)?.value : value;
          routes.push({ method, path, handler: h?.type === 'Identifier' ? h.name : 'inline', line: lineOf(p), auth: fnAuth(h) });
        }
      }
      return;
    }
    if (init?.type === 'NewExpression' && init.callee?.type === 'Identifier' && init.callee.name === 'Map' && unwrap(init.arguments?.[0])?.type === 'ArrayExpression') {
      for (const pair of unwrap(init.arguments[0]).elements || []) {
        const [k, v] = pair?.type === 'ArrayExpression' ? pair.elements : [];
        const path = k ? literal(k) : null;
        if (path && (path.startsWith('/') || path === '*')) routes.push({ method: 'ALL', path, handler: v?.type === 'Identifier' ? v.name : 'inline', line: lineOf(pair), auth: fnAuth(v) });
      }
      return;
    }
    limit('worker-unresolved-dispatch', at, nodeText(content, at));
  }

  return { routes, limitations };
}

const isUrlPattern = node => {
  const n = unwrap(node);
  return n?.type === 'NewExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'URLPattern';
};

// ── Pattern tier (the file did not parse) ────────────────────────────────────

function readDispatchByPattern(src) {
  const { content } = src;
  const { code, lits } = lexJs(content);
  const pairs = matchPairs(code);
  const routes = [];
  const limitations = [];
  const value = at => lits.get(at)?.value;
  const add = (path, index) => {
    if (typeof path === 'string' && (path.startsWith('/') || path === '*')) routes.push({ method: 'ALL', path, handler: 'inline', line: lineAt(content, index), auth: false });
  };
  for (const m of code.matchAll(/\bpathname\s*[!=]==?\s*(?=")/g)) add(value(m.index + m[0].length), m.index);
  for (const m of code.matchAll(/"\u0001*"\s*[!=]==?\s*[\w$.]*\bpathname\b/g)) add(value(m.index), m.index);
  for (const m of code.matchAll(/\bswitch\s*\(\s*[\w$.]*\bpathname\s*\)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = pairs.get(open);
    if (!close) continue;
    for (const c of code.slice(open, close).matchAll(/\bcase\s+(?=")/g)) add(value(open + c.index + c[0].length), open + c.index);
  }
  for (const m of code.matchAll(/\bpathname\s*\.\s*(startsWith|endsWith|includes|match|split)\s*\(/g)) {
    limitations.push({ code: m[1] === 'startsWith' ? 'worker-prefix-dispatch' : 'worker-unresolved-dispatch', line: lineAt(content, m.index), target: '' });
  }
  return { routes, limitations };
}
