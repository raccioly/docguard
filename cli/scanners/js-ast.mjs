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

/** Extract a string path from a call's first arg: StringLiteral or TemplateLiteral. */
function pathArgValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral') {
    if (node.expressions.length === 0) return node.quasis[0]?.value?.cooked ?? null;
    // `/users/${id}` → `/users/:param` so a dynamic segment still looks like a path.
    return node.quasis
      .map((q, i) => (q.value.cooked ?? '') + (i < node.expressions.length ? ':param' : ''))
      .join('');
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
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed) return;
    const prop = callee.property;
    if (!prop || prop.type !== 'Identifier') return;
    const method = prop.name.toLowerCase();
    if (!HTTP_METHOD_NAMES.has(method)) return;
    const path = pathArgValue(node.arguments && node.arguments[0]);
    if (!path || !(path.startsWith('/') || path === '*')) return;
    // `receiver` is the object the method was called on (`router` in
    // `router.get(...)`, `app` in `app.get(...)`). Mount-prefix resolution uses
    // it to apply a same-file `app.use('/api', router)` prefix ONLY to that
    // router's routes — never to sibling `app.get(...)` calls in the same file.
    const receiver = callee.object && callee.object.type === 'Identifier' ? callee.object.name : null;
    out.push({ method: method.toUpperCase(), path, start: node.start ?? 0, receiver });
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
    for (const m of methods) {
      out.push({ method: String(m).toUpperCase(), path, start: node.start ?? 0, receiver });
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
  const mounts = [];

  walk(ast, (node) => {
    // import X from 'spec' | import { X } from 'spec' | import * as X from 'spec'
    if (node.type === 'ImportDeclaration' && node.source && node.source.type === 'StringLiteral') {
      for (const spec of node.specifiers || []) {
        if (spec.local && spec.local.name) imports[spec.local.name] = node.source.value;
      }
      return;
    }
    // const X = require('spec')
    if (node.type === 'VariableDeclarator' && node.id && node.id.type === 'Identifier'
        && node.init && node.init.type === 'CallExpression'
        && calleeName(node.init.callee) === 'require'
        && node.init.arguments[0] && node.init.arguments[0].type === 'StringLiteral') {
      imports[node.id.name] = node.init.arguments[0].value;
      return;
    }
    // <x>.use('/prefix', …, <routerIdent>) — the prefix is the first string-literal
    // arg; the mounted router is the LAST identifier arg (skips middleware).
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'MemberExpression'
        && !node.callee.computed && node.callee.property && node.callee.property.name === 'use') {
      const args = node.arguments || [];
      const first = args[0];
      const prefix = first && first.type === 'StringLiteral' ? first.value : null;
      if (!prefix || !prefix.startsWith('/')) return;
      let ident = null;
      for (let i = args.length - 1; i >= 1; i--) {
        if (args[i] && args[i].type === 'Identifier') { ident = args[i].name; break; }
      }
      if (ident) mounts.push({ prefix, ident });
    }
  });

  return { imports, mounts };
}
