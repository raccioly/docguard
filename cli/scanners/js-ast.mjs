/**
 * JS/TS AST helpers — the "full support" parsing tier for JavaScript and
 * TypeScript, backed by @babel/parser (the project's single runtime dependency).
 *
 * Why a real parser here: regex schema/route extraction across the codebase
 * used `{([^}]+)}` to capture an object body, which stops at the FIRST `}` and
 * therefore silently truncates any definition containing a nested object
 * (`z.object({ a: z.object({...}) })`, a Mongoose `{ type: String }` field,
 * a Drizzle composite key). A truncated body yields missing fields, and a
 * scanner that returns *too few* fields makes the doc validators falsely pass.
 * An AST tracks brace depth for free, so the extracted body is always balanced.
 *
 * This module is intentionally small: it parses once and exposes the few
 * structural extractions the scanners need. Non-JS/TS languages stay on the
 * regex (beta) tier; Python uses the interpreter's own `ast` module.
 *
 * No @babel/traverse — we ship a tiny depth-first walker so the dependency
 * footprint stays at exactly one package (+ its @babel/types tree).
 */

import { createRequire } from 'node:module';
import { extname } from 'node:path';

// @babel/parser is a declared runtime dependency, so a normal `npm i` / `npx`
// install always has it. But we load it OPTIONALLY (sync require in a try) so
// the CLI never hard-crashes if it's somehow absent — a broken install, a
// files-only vendoring, or the npm-pack smoke test that unpacks without deps.
// When it's missing, parseJsTs reports ok:false and the scanners transparently
// fall back to the regex (beta) tier. The parser enhances; it is never load-
// bearing for the tool to boot.
let _babelParse = null;
try {
  const require = createRequire(import.meta.url);
  _babelParse = require('@babel/parser').parse;
} catch {
  _babelParse = null;
}

/** True when the AST (full-support) tier is available in this install. */
export function astTierAvailable() {
  return typeof _babelParse === 'function';
}

/**
 * Babel plugins to enable per file extension. Errors are recovered (not
 * thrown) so a single unsupported syntax form degrades to a partial parse
 * instead of losing the whole file.
 */
function pluginsFor(filename) {
  const ext = extname(filename || '').toLowerCase();
  const base = ['decorators-legacy', 'classProperties', 'classPrivateProperties', 'topLevelAwait'];
  if (ext === '.ts') return ['typescript', ...base];
  if (ext === '.tsx') return ['typescript', 'jsx', ...base];
  if (ext === '.mts' || ext === '.cts') return ['typescript', ...base];
  // .js/.jsx/.mjs/.cjs and anything else: allow JSX + Flow-free modern JS.
  return ['jsx', ...base];
}

/**
 * Parse JS/TS source into a Babel AST.
 * @returns {{ ast: object|null, ok: boolean, error: string|null }}
 *   ok=false means the file could not be parsed — callers should treat that as
 *   "couldn't scan" (a surfaced warning), NOT as "scanned and found nothing".
 */
export function parseJsTs(content, filename = 'file.ts') {
  if (!_babelParse) return { ast: null, ok: false, error: '@babel/parser unavailable (regex fallback in effect)' };
  try {
    const ast = _babelParse(String(content), {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: pluginsFor(filename),
    });
    return { ast, ok: true, error: null };
  } catch (err) {
    return { ast: null, ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Minimal depth-first AST walker. Visits every node object (anything with a
 * string `.type`), calling `visit(node)`. No parent tracking — callers that
 * need names inspect the node's own children (e.g. a VariableDeclarator's id).
 */
export function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' || key === 'leadingComments' || key === 'trailingComments') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walk(c, visit);
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      walk(child, visit);
    }
  }
}

/**
 * Split source text at top-level `sep` (outside brackets, strings and
 * comments). Pure text, so both parser tiers read object bodies the same way.
 * @returns {string[]}
 */
export function splitTopLevel(text, sep = ',') {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Strip `//` and block comments outside strings. */
export function stripComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const start = i;
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; out += ' '; continue; }
    out += ch;
  }
  return out;
}

/** Index of the bracket that closes the one at `open` (strings and comments skipped); -1 if none. */
export function matchingBracket(text, open) {
  const close = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); if (end < 0) return -1; i = end + 1; continue; }
    if (close[ch]) stack.push(close[ch]);
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Inner source text of an ObjectExpression node, i.e. between its `{` and `}`. */
function objectInner(content, objNode) {
  if (!objNode || objNode.type !== 'ObjectExpression') return '';
  // node.start points at `{`, node.end just past `}`. Strip the braces so the
  // result matches what the old `{([^}]+)}` capture group used to yield — but
  // balanced, so nested objects survive.
  return String(content).slice(objNode.start + 1, objNode.end - 1);
}

/** Callee name as a dotted string, e.g. `z.object`, `mongoose.Schema`, `pgTable`. */
function calleeName(callee) {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed) {
    const obj = callee.object && callee.object.type === 'Identifier' ? callee.object.name : '';
    const prop = callee.property && callee.property.type === 'Identifier' ? callee.property.name : '';
    return obj ? `${obj}.${prop}` : prop;
  }
  return '';
}

const DRIZZLE_TABLE_FNS = new Set(['pgTable', 'mysqlTable', 'sqliteTable']);

/**
 * Extract JS/TS schema declarations with BALANCED object bodies.
 *
 * Returns an array of `{ kind, name, table, body }` where `body` is the inner
 * text of the schema's object literal (nested objects intact). The scanners
 * feed `body` to their existing per-ORM field parsers, so only the extraction
 * mechanism changes — not the field interpretation.
 *
 * Returns `null` when the file cannot be parsed, so the caller can distinguish
 * "no schemas here" (—> []) from "couldn't read this file" (—> null).
 *
 * Kinds: 'zod' (z.object), 'drizzle' (pg/mysql/sqliteTable), 'mongoose'
 * (new Schema / new mongoose.Schema).
 */
export function extractJsSchemaBodies(content, filename = 'file.ts') {
  const { ast, ok } = parseJsTs(content, filename);
  if (!ok || !ast) return null;

  const out = [];

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || !node.id || node.id.type !== 'Identifier') return;
    const name = node.id.name;
    const init = node.init;
    if (!init) return;

    // Zod: const X = z.object({ ... })  (also z.object(...).strict() etc. —
    // we match the inner-most z.object call's object arg).
    if (init.type === 'CallExpression' && calleeName(init.callee) === 'z.object') {
      const arg = init.arguments[0];
      if (arg && arg.type === 'ObjectExpression') {
        out.push({ kind: 'zod', name, table: null, body: objectInner(content, arg) });
      }
      return;
    }

    // Drizzle: const X = pgTable('table', { ... })
    if (init.type === 'CallExpression' && DRIZZLE_TABLE_FNS.has(calleeName(init.callee))) {
      const tableArg = init.arguments[0];
      const colsArg = init.arguments[1];
      const table = tableArg && tableArg.type === 'StringLiteral' ? tableArg.value : name;
      if (colsArg && colsArg.type === 'ObjectExpression') {
        out.push({ kind: 'drizzle', name, table, body: objectInner(content, colsArg) });
      }
      return;
    }

    // Mongoose: const X = new Schema({ ... }) | new mongoose.Schema({ ... })
    if (init.type === 'NewExpression') {
      const cn = calleeName(init.callee);
      if (cn === 'Schema' || cn === 'mongoose.Schema') {
        const arg = init.arguments[0];
        if (arg && arg.type === 'ObjectExpression') {
          out.push({ kind: 'mongoose', name, table: null, body: objectInner(content, arg) });
        }
      }
    }
  });

  return out;
}

// HTTP route-registration methods (`app.get`, `router.post`, …). `use`/`all`
// are middleware-ish; `all` is included (it IS a route), `use` is not.
const HTTP_METHOD_NAMES = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all']);

function topLevelStaticStrings(ast) {
  const declarations = new Map();
  const body = ast?.program?.body || [];
  for (const statement of body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') continue;
    for (const item of declaration.declarations || []) {
      if (item.id?.type !== 'Identifier' || !item.init) continue;
      if (declarations.has(item.id.name)) declarations.set(item.id.name, null);
      else declarations.set(item.id.name, item.init);
    }
  }
  const resolved = new Map();
  const resolveNode = (node, visiting = new Set()) => {
    if (!node) return null;
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'Identifier') {
      if (resolved.has(node.name)) return resolved.get(node.name);
      const init = declarations.get(node.name);
      if (!init || visiting.has(node.name)) return null;
      const value = resolveNode(init, new Set(visiting).add(node.name));
      if (value !== null) resolved.set(node.name, value);
      return value;
    }
    if (node.type === 'TemplateLiteral') {
      let value = '';
      for (let i = 0; i < node.quasis.length; i++) {
        value += node.quasis[i]?.value?.cooked ?? '';
        if (i < node.expressions.length) {
          const expression = resolveNode(node.expressions[i], visiting);
          if (expression === null) return null;
          value += expression;
        }
      }
      return value;
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      const left = resolveNode(node.left, visiting);
      const right = resolveNode(node.right, visiting);
      return left === null || right === null ? null : left + right;
    }
    return null;
  };
  for (const name of declarations.keys()) resolveNode({ type: 'Identifier', name });
  return resolved;
}

function expressRouteBindings(ast) {
  const bindings = new Set(['app', 'router', 'server', 'fastify', 'hono']);
  const factories = new Set(['express', 'express.Router', 'Router', 'createRouter', 'Fastify', 'Hono']);
  walk(ast, node => {
    if (node.type !== 'ImportDeclaration' || node.source?.value !== 'express') return;
    for (const spec of node.specifiers || []) {
      if (spec.type === 'ImportDefaultSpecifier') factories.add(spec.local.name);
      if (spec.type === 'ImportSpecifier' && (spec.imported?.name || spec.imported?.value) === 'Router') {
        factories.add(spec.local.name);
      }
    }
  });
  walk(ast, node => {
    if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier' || node.init?.type !== 'CallExpression') return;
    const factory = calleeName(node.init.callee);
    if (factories.has(factory)) bindings.add(node.id.name);
  });
  return bindings;
}

function looksLikeRouteReceiver(name, bindings) {
  return bindings.has(name) || /(?:app|server|router|routes)$/i.test(name);
}

// ── Auth evidence (docguard.js-ts-extraction#FR-002) ────────────────────────
//
// Auth is a property of ONE route. It is read from that route's own middleware
// arguments, its own handler body, an earlier `use(auth)` on its receiver, or a
// mount above it — never from text elsewhere in the file, which marked public
// `login`/`register` routes as protected whenever a sibling read `req.user`.

const AUTH_WORDS = new Set([
  'auth', 'authn', 'authz', 'authenticate', 'authenticated', 'authentication',
  'authorize', 'authorized', 'authorization', 'authed', 'jwt', 'protect',
  'protected', 'passport', 'guard', 'clerk',
]);
const AUTH_VERBS = new Set(['require', 'requires', 'ensure', 'verify', 'check', 'is', 'has', 'restrict', 'must']);
const AUTH_OBJECTS = new Set([
  'user', 'login', 'logged', 'session', 'role', 'roles', 'admin', 'scope', 'scopes',
  'permission', 'permissions', 'token', 'signed', 'member', 'owner',
]);
const NOT_MIDDLEWARE_TAIL = new Set(['router', 'routes', 'route', 'controller', 'controllers', 'handler', 'handlers', 'service', 'services']);

/**
 * True when an identifier names auth middleware: `requireAuth`, `authenticate`,
 * `verifyToken`, `ensureLoggedIn`, `checkJwt`, `requireRole`, `authGuard`, ...
 * Words are split on camelCase and `_`, so `authorsList` or `oauthCallback`
 * are not auth, and `authRouter` (a router) is not middleware.
 */
export function isAuthMiddlewareName(name) {
  if (!name || typeof name !== 'string') return false;
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_\-.$]+/).filter(Boolean).map(w => w.toLowerCase());
  if (words.length === 0 || NOT_MIDDLEWARE_TAIL.has(words[words.length - 1])) return false;
  if (words.some(w => AUTH_WORDS.has(w))) return true;
  if (AUTH_VERBS.has(words[0]) && words.slice(1).some(w => AUTH_OBJECTS.has(w))) return true;
  return /^(?:adminOnly|loggedIn|restrictTo|expressjwt)$/i.test(name);
}

/** An auth check inside a handler body (a guard, not a bare `req.user` read). */
export const AUTH_CHECK_RE = new RegExp([
  String.raw`\b(?:getServerSession|getSession|getToken|currentUser|verifyIdToken|getAuth|validateRequest)\s*\(`,
  String.raw`\bauth\s*\(\s*\)`,
  String.raw`\bjwt\s*\.\s*verify\s*\(`,
  String.raw`\bverify(?:Token|Jwt|JWT|Session|Auth)\s*\(`,
  String.raw`\b(?:requireAuth|requireUser|requireSession|ensureAuthenticated|isAuthenticated)\s*\(`,
  String.raw`\bif\s*\(\s*!\s*(?:(?:req|request|ctx|c)\s*\.\s*)?(?:user|session|auth|token|userId)\b`,
  String.raw`\bstatus\s*\(\s*40[13]\s*\)`,
  String.raw`\bstatus\s*:\s*40[13]\b`,
  String.raw`\bUnauthori[sz]ed(?:Error|Exception)\b`,
].join('|'));

/** Is this call argument auth middleware (`requireAuth`, `passport.authenticate(...)`, `[auth, admin]`)? */
function isAuthMiddlewareNode(node) {
  if (!node) return false;
  if (node.type === 'Identifier') return isAuthMiddlewareName(node.name);
  if (node.type === 'MemberExpression' && !node.computed) {
    return isAuthMiddlewareName(node.property?.name) || (node.object?.type === 'Identifier' && isAuthMiddlewareName(node.object.name));
  }
  if (node.type === 'CallExpression') {
    const callee = node.callee;
    if (callee?.type === 'Identifier') return isAuthMiddlewareName(callee.name);
    if (callee?.type === 'MemberExpression' && !callee.computed) {
      return isAuthMiddlewareName(callee.property?.name) || (callee.object?.type === 'Identifier' && isAuthMiddlewareName(callee.object.name));
    }
    return false;
  }
  if (node.type === 'ArrayExpression') return (node.elements || []).some(isAuthMiddlewareNode);
  // Fastify route options: `{ preHandler: [fastify.authenticate] }`, `onRequest`, ...
  if (node.type === 'ObjectExpression') {
    return (node.properties || []).some(p => HOOK_KEYS.has(propKeyName(p)) && isAuthMiddlewareNode(p.value));
  }
  return false;
}

const HOOK_KEYS = new Set(['preHandler', 'onRequest', 'preValidation', 'preParsing', 'beforeHandler', 'middleware', 'middlewares']);

const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration']);

/** Same-file function bodies by name: `function x(){}` and `const x = () => {}`. */
function functionBodies(ast) {
  const bodies = new Map();
  walk(ast, node => {
    if (node.type === 'FunctionDeclaration' && node.id?.name) bodies.set(node.id.name, node);
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && FUNCTION_TYPES.has(node.init?.type)) bodies.set(node.id.name, node.init);
  });
  return bodies;
}

/**
 * The route's own auth evidence: middleware among `middleware`, or an auth
 * check in the handler (an inline function, or a same-file named function).
 */
function ownAuth(content, middleware, handler, bodies) {
  if (middleware.some(isAuthMiddlewareNode)) return true;
  let fn = null;
  if (handler && FUNCTION_TYPES.has(handler.type)) fn = handler;
  else if (handler?.type === 'Identifier') fn = bodies.get(handler.name) || null;
  else if (handler?.type === 'CallExpression' && isAuthMiddlewareNode(handler)) return true; // withAuth(handler)
  if (!fn) return false;
  return AUTH_CHECK_RE.test(String(content).slice(fn.start, fn.end));
}

/** `<receiver>.use([path,] …auth…)` calls: auth applied to later routes. */
function authUses(ast, constants) {
  const uses = [];
  walk(ast, node => {
    if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression' || node.callee.computed) return;
    if (node.callee.property?.name !== 'use' || node.callee.object?.type !== 'Identifier') return;
    const args = node.arguments || [];
    const prefix = pathArgValue(args[0], constants, false);
    const hasPrefix = typeof prefix === 'string' && (prefix.startsWith('/') || prefix === '*');
    const rest = hasPrefix ? args.slice(1) : args;
    if (rest.some(isAuthMiddlewareNode)) {
      uses.push({ receiver: node.callee.object.name, prefix: hasPrefix && prefix !== '*' ? prefix : '', start: node.start ?? 0 });
    }
  });
  return uses;
}

function prefixCovers(prefix, path) {
  if (!prefix || prefix === '/') return true;
  const p = prefix.replace(/\/+$/, '');
  return path === p || path.startsWith(`${p}/`);
}

/** Extract a statically knowable string path from a call argument. */
function pathArgValue(node, constants = new Map(), dynamicPlaceholder = true) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'Identifier') return constants.get(node.name) ?? null;
  if (node.type === 'TemplateLiteral') {
    if (node.expressions.length === 0) return node.quasis[0]?.value?.cooked ?? null;
    let value = '';
    for (let i = 0; i < node.quasis.length; i++) {
      value += node.quasis[i]?.value?.cooked ?? '';
      if (i < node.expressions.length) {
        const expression = node.expressions[i];
        const staticValue = expression.type === 'Identifier' ? constants.get(expression.name) : null;
        if (staticValue === undefined || staticValue === null) {
          if (!dynamicPlaceholder) return null;
          value += ':param';
        } else {
          value += staticValue;
        }
      }
    }
    return value;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = pathArgValue(node.left, constants, false);
    const right = pathArgValue(node.right, constants, false);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

/**
 * Extract HTTP route registrations (`<router>.<method>('/path', …)`) from JS/TS
 * via AST. More accurate than regex: it matches ANY receiver identifier (so
 * `userRouter.get`, `v1.post`, `r.delete` are all caught — not just app/router/
 * server), survives multi-line calls and arbitrary whitespace, and reads
 * template-literal paths. The `/`-or-`*` path requirement keeps non-route
 * `.get()` calls (e.g. `map.get('key')`, `headers.get('x')`) out.
 *
 * Returns `null` when the file can't be parsed (caller falls back to regex);
 * otherwise an array of `{ method, path, start }` (start = call node offset, for
 * the caller's comment/handler/auth context lookups).
 */
export function extractJsRouteCalls(content, filename = 'file.ts') {
  const { ast, ok } = parseJsTs(content, filename);
  if (!ok || !ast) return null;

  const out = [];
  const constants = topLevelStaticStrings(ast);
  const routeBindings = expressRouteBindings(ast);
  const bodies = functionBodies(ast);
  const uses = authUses(ast, constants);
  const usedAuth = (receiver, path, start) =>
    uses.some(u => u.receiver === receiver && u.start < start && prefixCovers(u.prefix, path));
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed) return;
    const prop = callee.property;
    if (!prop || prop.type !== 'Identifier') return;
    const method = prop.name.toLowerCase();
    if (!HTTP_METHOD_NAMES.has(method)) return;
    const args = node.arguments || [];
    // `<receiver>.route('/path').get(h).post(h)` (docguard.js-ts-extraction#FR-001):
    // the method call's object is a chain that bottoms out in `.route(path)` on
    // a route binding. Each method carries only handlers, no path.
    const chain = routeChainBase(callee.object, routeBindings, constants);
    if (chain) {
      const handler = args[args.length - 1];
      out.push({
        method: method.toUpperCase(), path: chain.path, start: chain.start, receiver: chain.receiver,
        line: prop.loc?.start.line ?? null,
        handler: handlerName(handler),
        auth: ownAuth(content, args.slice(0, -1), handler, bodies) || usedAuth(chain.receiver, chain.path, chain.start),
      });
      return;
    }
    // A route receiver must be a stable binding (`app.get`, `router.post`, …).
    // Chained HTTP clients such as `request(app).get('/api/items')` also accept
    // URL-shaped first arguments, but they issue requests rather than register
    // routes. Treating their CallExpression receiver as a route used to let test
    // calls contaminate the product API inventory.
    if (!callee.object || callee.object.type !== 'Identifier') return;
    if (!looksLikeRouteReceiver(callee.object.name, routeBindings)) return;
    const path = pathArgValue(args[0], constants);
    if (!path || !(path.startsWith('/') || path === '*')) return;
    // `receiver` is the object the method was called on (`router` in
    // `router.get(...)`, `app` in `app.get(...)`). Mount-prefix resolution uses
    // it to apply a same-file `app.use('/api', router)` prefix ONLY to that
    // router's routes — never to sibling `app.get(...)` calls in the same file.
    const receiver = callee.object.name;
    const start = node.start ?? 0;
    const handler = args.length > 1 ? args[args.length - 1] : null;
    out.push({
      method: method.toUpperCase(), path, start, receiver,
      line: node.loc?.start.line ?? null,
      auth: ownAuth(content, args.slice(1, -1), handler, bodies) || usedAuth(receiver, path, start),
    });
  });
  return out;
}

/** `{ path, receiver, start }` when `node` is `<route binding>.route(path)[.method(...)]*`. */
function routeChainBase(node, routeBindings, constants) {
  let cur = node;
  while (cur?.type === 'CallExpression' && cur.callee?.type === 'MemberExpression' && !cur.callee.computed
      && HTTP_METHOD_NAMES.has(String(cur.callee.property?.name).toLowerCase())) {
    cur = cur.callee.object;
  }
  if (cur?.type !== 'CallExpression' || cur.callee?.type !== 'MemberExpression' || cur.callee.computed) return null;
  if (cur.callee.property?.name !== 'route' || cur.callee.object?.type !== 'Identifier') return null;
  const receiver = cur.callee.object.name;
  if (!looksLikeRouteReceiver(receiver, routeBindings)) return null;
  const path = pathArgValue(cur.arguments?.[0], constants);
  if (!path || !(path.startsWith('/') || path === '*')) return null;
  return { path, receiver, start: cur.start ?? 0 };
}

function handlerName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (FUNCTION_TYPES.has(node.type)) return node.id?.name || 'inline';
  if (node.type === 'MemberExpression' && !node.computed) return node.property?.name || '';
  return '';
}

/**
 * Per-handler auth of a Next.js App Router `route.ts` (docguard.js-ts-extraction#FR-002):
 * each exported HTTP method is judged by its own body, or by an auth wrapper
 * (`export const GET = withAuth(async () => …)`). `null` on parse failure.
 * @returns {Map<string, { line: number|null, auth: boolean }>|null}
 */
export function nextRouteHandlers(content, filename = 'route.ts') {
  const { ast, ok } = parseJsTs(content, filename);
  if (!ok || !ast) return null;
  const bodies = functionBodies(ast);
  const text = String(content);
  const out = new Map();
  const judge = (fn) => {
    if (!fn) return false;
    if (fn.type === 'CallExpression') return isAuthMiddlewareNode(fn) || (fn.arguments || []).some(a => FUNCTION_TYPES.has(a.type) && AUTH_CHECK_RE.test(text.slice(a.start, a.end)));
    if (fn.type === 'Identifier') return judge(bodies.get(fn.name) || null);
    return AUTH_CHECK_RE.test(text.slice(fn.start, fn.end));
  };
  for (const statement of ast.program?.body || []) {
    if (statement.type !== 'ExportNamedDeclaration') continue;
    const d = statement.declaration;
    if (d?.type === 'FunctionDeclaration' && d.id?.name) out.set(d.id.name, { line: statement.loc?.start.line ?? null, auth: judge(d) });
    for (const item of d?.declarations || []) {
      if (item.id?.type === 'Identifier') out.set(item.id.name, { line: statement.loc?.start.line ?? null, auth: judge(item.init) });
    }
    for (const spec of statement.specifiers || []) {
      const exported = spec.exported?.name ?? spec.exported?.value;
      if (exported) out.set(exported, { line: statement.loc?.start.line ?? null, auth: judge(spec.local) });
    }
  }
  return out;
}

/** JSX element name as a string: `Route`, `router.Foo` → `Foo` (member tail). */
function jsxName(nameNode) {
  if (!nameNode) return null;
  if (nameNode.type === 'JSXIdentifier') return nameNode.name;
  if (nameNode.type === 'JSXMemberExpression') return jsxName(nameNode.property);
  return null;
}

/** Read a JSX attribute's string value: `path="/x"` or `path={"/x"}`. */
function jsxAttrString(valueNode) {
  if (!valueNode) return null; // valueless attr (e.g. `index`)
  if (valueNode.type === 'StringLiteral') return valueNode.value;
  if (valueNode.type === 'JSXExpressionContainer') {
    const e = valueNode.expression;
    if (e && e.type === 'StringLiteral') return e.value;
  }
  return null;
}

/**
 * Extract React Router screens — `<Route path="/x" element={<Wrapper><Screen/></Wrapper>} />`
 * and the route-object form `{ path: '/x', element: <Screen/> }` / `{ path, Component }`.
 * Returns `{ path, components }[]` where `components` is every capitalized JSX
 * element rendered for that route (the caller picks the real screen and skips
 * wrappers). `null` on parse failure → caller's regex fallback.
 *
 * Why AST: route JSX nests auth wrappers/layouts/suspense fallbacks across many
 * lines; the window-based regex truncates or grabs the wrong component. The AST
 * scopes "the element for THIS route" exactly.
 */
export function extractJsxRouteScreens(content, filename = 'file.tsx') {
  const { ast, ok } = parseJsTs(content, filename);
  if (!ok || !ast) return null;

  const componentsIn = (node) => {
    const names = [];
    walk(node, (n) => {
      if (n.type === 'JSXOpeningElement') {
        const nm = jsxName(n.name);
        if (nm && /^[A-Z]/.test(nm)) names.push(nm);
      }
    });
    return names;
  };

  const out = [];
  walk(ast, (node) => {
    // JSX form: <Route path="..." element={...} />
    if (node.type === 'JSXElement') {
      const open = node.openingElement;
      if (!open || jsxName(open.name) !== 'Route') return;
      let path = null;
      let elementNode = null;
      for (const attr of open.attributes || []) {
        if (attr.type !== 'JSXAttribute' || !attr.name) continue;
        if (attr.name.name === 'path') path = jsxAttrString(attr.value);
        else if (['element', 'component', 'Component'].includes(attr.name.name)) elementNode = attr.value;
      }
      if (path != null) out.push({ path, components: elementNode ? componentsIn(elementNode) : [] });
      return;
    }
    // Route-object form: { path: '...', element: <X/> } | { path, Component: X }
    if (node.type === 'ObjectExpression') {
      let path = null;
      let comps = [];
      for (const prop of node.properties || []) {
        if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
        const key = propKeyName(prop);
        if (key === 'path' && prop.value && prop.value.type === 'StringLiteral') {
          path = prop.value.value;
        } else if (key === 'element') {
          comps = componentsIn(prop.value);
        } else if (key === 'Component' || key === 'component') {
          if (prop.value && prop.value.type === 'Identifier') comps = [prop.value.name];
        }
      }
      if (path != null) out.push({ path, components: comps });
    }
  });
  return out;
}

/** Read an object-literal property's key name, whether `key:` or `'key':`. */
function propKeyName(prop) {
  if (!prop || !prop.key) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'StringLiteral') return prop.key.value;
  return null;
}

/**
 * Extract OBJECT-FORM route registrations — Fastify's `fastify.route({ method,
 * url, handler })` (and `method: ['GET','POST']` arrays). The method-shorthand
 * form (`fastify.get('/x')`) is already covered by extractJsRouteCalls; this
 * adds the declarative form, which the old regex never matched at all.
 *
 * Returns `null` on parse failure; otherwise `{ method, path, start, receiver }[]`
 * (one entry per method when `method` is an array).
 */
export function extractJsRouteObjects(content, filename = 'file.ts') {
  const { ast, ok } = parseJsTs(content, filename);
  if (!ok || !ast) return null;

  const out = [];
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed) return;
    if (!callee.property || callee.property.type !== 'Identifier' || callee.property.name !== 'route') return;
    const arg = node.arguments && node.arguments[0];
    if (!arg || arg.type !== 'ObjectExpression') return;

    let methods = [];
    let path = null;
    for (const prop of arg.properties || []) {
      if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
      const key = propKeyName(prop);
      if (key === 'method') {
        const v = prop.value;
        if (v.type === 'StringLiteral') methods = [v.value];
        else if (v.type === 'ArrayExpression') {
          methods = (v.elements || []).filter(e => e && e.type === 'StringLiteral').map(e => e.value);
        }
      } else if (key === 'url' || key === 'path') {
        path = pathArgValue(prop.value);
      }
    }
    if (!path || !(path.startsWith('/') || path === '*') || !methods.length) return;
    const receiver = callee.object && callee.object.type === 'Identifier' ? callee.object.name : null;
    const handlerProp = (arg.properties || []).find(p => propKeyName(p) === 'handler');
    const auth = isAuthMiddlewareNode(arg) ||
      Boolean(handlerProp && FUNCTION_TYPES.has(handlerProp.value?.type) && AUTH_CHECK_RE.test(String(content).slice(handlerProp.value.start, handlerProp.value.end)));
    for (const m of methods) {
      out.push({ method: String(m).toUpperCase(), path, start: node.start ?? 0, receiver, line: node.loc?.start.line ?? null, auth });
    }
  });
  return out;
}

/**
 * Extract Express-style router MOUNTS and module IMPORTS from a JS/TS file, so a
 * caller can resolve the full path of a route declared in a sub-router file.
 *
 * The problem: `userRoutes.ts` declares `router.get('/:id')`, but the real URL
 * is `/api/users/:id` because `app.js` did `app.use('/api/users', userRoutes)`.
 * A per-file scan only sees `/:id` and the documented `/api/users/:id` never
 * matches — every mounted route then double-fires (documented-but-absent AND
 * undocumented). Resolving the mount prefix fixes that.
 *
 * Returns `null` when the file can't be parsed (caller keeps the bare path);
 * otherwise `{ imports, mounts }`:
 *   - imports: { localName -> module specifier string } from `import` / `require`
 *   - mounts:  [{ prefix, ident }] from `<x>.use('/prefix', …, <ident>)`
 * Resolving `ident` (local router vs imported specifier) is the caller's job —
 * it needs filesystem context this pure-AST module deliberately avoids.
 */
export function extractJsMountsAndImports(content, filename = 'file.ts') {
  const { ast, ok } = parseJsTs(content, filename);
  if (!ok || !ast) return null;

  const imports = {};
  const importSymbols = {};
  const exports = {};
  const mounts = [];
  const constants = topLevelStaticStrings(ast);
  const routeBindings = expressRouteBindings(ast);
  const uses = authUses(ast, constants);

  walk(ast, (node) => {
    // import X from 'spec' | import { X } from 'spec' | import * as X from 'spec'
    if (node.type === 'ImportDeclaration' && node.source && node.source.type === 'StringLiteral') {
      for (const spec of node.specifiers || []) {
        if (spec.local && spec.local.name) {
          imports[spec.local.name] = node.source.value;
          importSymbols[spec.local.name] = spec.type === 'ImportDefaultSpecifier'
            ? 'default'
            : spec.type === 'ImportNamespaceSpecifier'
              ? '*'
              : (spec.imported?.name || spec.imported?.value || spec.local.name);
        }
      }
      return;
    }
    // const X = require('spec')
    if (node.type === 'VariableDeclarator' && node.id && node.id.type === 'Identifier'
        && node.init && node.init.type === 'CallExpression'
        && calleeName(node.init.callee) === 'require'
        && node.init.arguments[0] && node.init.arguments[0].type === 'StringLiteral') {
      imports[node.id.name] = node.init.arguments[0].value;
      importSymbols[node.id.name] = 'default';
      return;
    }
    if (node.type === 'ExportDefaultDeclaration' && node.declaration?.type === 'Identifier') {
      exports.default = node.declaration.name;
      return;
    }
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.type === 'VariableDeclaration') {
        for (const item of node.declaration.declarations || []) {
          if (item.id?.type === 'Identifier') {
            exports[item.id.name] = item.init?.type === 'Identifier' ? item.init.name : item.id.name;
          }
        }
      }
      for (const spec of node.specifiers || []) {
        const exported = spec.exported?.name || spec.exported?.value;
        const local = spec.local?.name || spec.local?.value;
        if (exported && local) exports[exported] = local;
      }
      return;
    }
    // <x>.use('/prefix', middleware, router) and pathless <x>.use(router).
    // Return every identifier candidate; the filesystem-aware caller keeps
    // only candidates whose target contains router registrations or mounts.
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'MemberExpression'
        && !node.callee.computed && node.callee.property && node.callee.property.name === 'use') {
      const args = node.arguments || [];
      const first = args[0];
      const receiver = node.callee.object?.type === 'Identifier'
        ? node.callee.object.name
        : null;
      if (!receiver || !looksLikeRouteReceiver(receiver, routeBindings)) return;
      const explicitPrefix = pathArgValue(first, constants, false);
      const hasPrefix = typeof explicitPrefix === 'string' && explicitPrefix.startsWith('/');
      if (!hasPrefix && (first?.type !== 'Identifier' || args.length !== 1)) return;
      const prefix = hasPrefix ? explicitPrefix : '';
      const start = hasPrefix ? 1 : 0;
      for (let i = start; i < args.length; i++) {
        if (args[i]?.type === 'Identifier' && args[i].name !== receiver &&
            (imports[args[i].name] || looksLikeRouteReceiver(args[i].name, routeBindings))) {
          // Auth middleware passed before the router, or an earlier `use(auth)`
          // on the same receiver, protects everything mounted here (FR-002).
          const auth = args.slice(start, i).some(isAuthMiddlewareNode) ||
            uses.some(u => u.receiver === receiver && u.start < (node.start ?? 0) && prefixCovers(u.prefix, prefix || '/'));
          mounts.push({ prefix, ident: args[i].name, receiver, auth });
        }
      }
    }
  });

  const routeReceivers = new Set(extractJsRouteCalls(content, filename)?.map(route => route.receiver) || []);
  return { imports, importSymbols, exports, mounts, routeReceivers: [...routeReceivers] };
}

/**
 * Names a JS/TS module exports (`default` for a default export), with the
 * line of each export statement. Shared by as-built specs and the symbol map.
 * @returns {{ name: string, line: number|undefined }[]}
 */
export function exportedNames(content, filename) {
  const { ast, ok } = parseJsTs(content, filename);
  if (!ok || !ast) return [];
  const names = [];
  walk(ast, node => {
    if (node.type === 'ExportDefaultDeclaration') names.push({ name: 'default', line: node.loc?.start.line });
    if (node.type !== 'ExportNamedDeclaration') return;
    const d = node.declaration;
    if (d?.id?.name) names.push({ name: d.id.name, line: node.loc?.start.line });
    for (const decl of d?.declarations || []) if (decl.id?.name) names.push({ name: decl.id.name, line: node.loc?.start.line });
    for (const s of node.specifiers || []) {
      const n = s.exported?.name ?? s.exported?.value;
      if (n) names.push({ name: n, line: node.loc?.start.line });
    }
  });
  return names;
}

/**
 * The names a module offers, for the symbol map (docguard.symbol-map#FR-001):
 * its exports in source order, or, for a module that exports nothing (a
 * script), its top-level function and class declarations.
 * @returns {{ ok: boolean, names: string[] }} `ok: false` when it did not parse
 */
export function moduleSymbols(content, filename) {
  const { ast, ok } = parseJsTs(content, filename);
  if (!ok || !ast) return { ok: false, names: [] };
  const exported = [];
  const topLevel = [];
  for (const stmt of ast.program?.body || []) {
    if (stmt.type === 'ExportDefaultDeclaration') exported.push('default');
    else if (stmt.type === 'ExportNamedDeclaration') {
      const d = stmt.declaration;
      if (d?.id?.name) exported.push(d.id.name);
      for (const decl of d?.declarations || []) if (decl.id?.name) exported.push(decl.id.name);
      for (const s of stmt.specifiers || []) {
        const n = s.exported?.name ?? s.exported?.value;
        if (n) exported.push(n);
      }
    } else if ((stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') && stmt.id?.name) {
      topLevel.push(stmt.id.name);
    }
  }
  return { ok: true, names: [...new Set(exported.length ? exported : topLevel)] };
}
