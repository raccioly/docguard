/**
 * Warp and Tide route readers.
 *
 * DocGuard has no Rust parser. Axum, Actix and Rocket declare a route on one
 * line and are matched by pattern in routes.mjs; Warp and Tide do not.
 *
 * - **Warp** composes filters: a route's path, method and prefix are usually
 *   in different expressions, often in different functions
 *   (`warp::path("api").and(todos(db))`, where `todos` returns
 *   `list.or(create)`). A filter is evaluated here to a set of alternatives
 *   `{ segments, method, end }`: `a.and(b)` is their product, `a.or(b)` their
 *   union, `let` bindings and project functions (by name, across files) are
 *   followed, and the routes are the alternatives of what `warp::serve` runs.
 * - **Tide** builds a tree: `app.at("/posts")` is a route under the server,
 *   `.at("/:id")` a route under that, `.nest(server)` mounts a server. As in
 *   the Go reader, servers, routes and function parameters are nodes, and
 *   prefixes are resolved once every file is read.
 *
 * Comments and string bodies are masked first (`lexCLike`). A segment or
 * prefix that is not literal text (or, for Warp, a `const` string) makes its
 * route unreadable: it is omitted and recorded in `omitted`, never guessed.
 *
 * @implements docguard.more-route-frameworks#FR-003
 * @implements docguard.more-route-frameworks#FR-004
 * @implements docguard.more-route-frameworks#FR-005
 */

import { lexCLike, matchPairs, splitTopLevel, trimRange, literalIn, joinRoutePath } from './route-lexing.mjs';

const WARP_METHODS = new Map([
  ['get', 'GET'], ['post', 'POST'], ['put', 'PUT'], ['delete', 'DELETE'], ['patch', 'PATCH'],
  ['head', 'HEAD'], ['options', 'OPTIONS'],
]);
const TIDE_VERBS = new Map([
  ['get', 'GET'], ['post', 'POST'], ['put', 'PUT'], ['delete', 'DELETE'], ['patch', 'PATCH'],
  ['head', 'HEAD'], ['options', 'OPTIONS'], ['connect', 'CONNECT'], ['trace', 'TRACE'], ['all', 'ANY'],
]);
const ALT_LIMIT = 256;
const MAX_DEPTH = 48;
const AUTH_NAME = /auth|jwt|bearer|token|session|login|guard|protect/i;

// ── Shared: files, functions, bindings, chains ───────────────────────────────

function readFiles(sources) {
  const files = [];
  for (const s of sources || []) {
    if (!s || typeof s.content !== 'string') continue;
    const { code, lits } = lexCLike(s.content, { nestedComments: true });
    files.push({ file: s.file, code, lits, pairs: matchPairs(code), stem: moduleNames(s.file) });
  }
  return files;
}

/** The module names a file can be reached by: `src/api/users.rs` → users; `src/api/mod.rs` → api. */
function moduleNames(file) {
  const parts = String(file).replace(/\\/g, '/').replace(/\.rs$/, '').split('/');
  const last = parts.pop();
  return new Set(last === 'mod' || last === 'lib' || last === 'main' ? [parts.pop()].filter(Boolean) : [last]);
}

function skipWs(code, i) {
  while (i < code.length && /\s/.test(code[i])) i++;
  return i;
}

/** Past the `>` that closes the `<` at i; -1 when it does not close before e. */
function skipAngles(code, i, e = code.length) {
  let depth = 0;
  for (; i < e; i++) {
    if (code[i] === '<') depth++;
    else if (code[i] === '>' && code[i - 1] !== '-' && --depth === 0) return i + 1;
  }
  return -1;
}

/** Every `fn` with a body: name, file, parameters, result type text, body range. */
function indexFunctions(files) {
  const fns = new Map();
  for (const f of files) {
    const { code, pairs } = f;
    const re = /\bfn\s+([A-Za-z_]\w*)\s*/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      let k = m.index + m[0].length;
      if (code[k] === '<') { k = skipAngles(code, k); if (k < 0) continue; k = skipWs(code, k); }
      if (code[k] !== '(' || !pairs.has(k)) continue;
      const pClose = pairs.get(k);
      let body = -1;
      for (let j = pClose + 1; j < code.length; j++) {
        const c = code[j];
        if (c === '(' || c === '[') { if (!pairs.has(j)) break; j = pairs.get(j); continue; }
        if (c === ';' || c === '}') break;
        if (c === '{') { body = j; break; }
      }
      if (body < 0 || !pairs.has(body)) continue;
      const params = splitTopLevel(code, pairs, k + 1, pClose).map(([a, b]) => {
        const text = code.slice(a, b);
        const pm = /^(?:mut\s+)?([A-Za-z_]\w*)\s*:\s*([\s\S]*)$/.exec(text);
        return pm ? { name: pm[1], type: pm[2] } : { name: null, type: text };
      });
      const entry = {
        name: m[1], f, params, result: code.slice(pClose + 1, body), bodyOpen: body, bodyClose: pairs.get(body), start: m.index,
      };
      if (!fns.has(entry.name)) fns.set(entry.name, []);
      fns.get(entry.name).push(entry);
      (f.fnList ||= []).push(entry);
    }
  }
  return fns;
}

/** The innermost function whose body contains `pos` in file `f`. */
function enclosingFn(fns, f, pos) {
  let best = null;
  for (const fn of f.fnList || []) {
    if (pos <= fn.bodyOpen || pos >= fn.bodyClose) continue;
    if (!best || fn.bodyOpen > best.bodyOpen) best = fn;
  }
  return best;
}

/** `let [mut] name[: T] = value;` bindings of a file, with their value ranges. */
function indexLets(f) {
  const lets = [];
  const { code, pairs } = f;
  const re = /\blet\s+(?:mut\s+)?([A-Za-z_]\w*)\s*(?::[^=;]+)?=(?![=>])\s*/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const s = m.index + m[0].length;
    let e = s;
    for (; e < code.length; e++) {
      const c = code[e];
      if ((c === '(' || c === '[' || c === '{') && pairs.has(e)) { e = pairs.get(e); continue; }
      if (c === ';' || c === '}' || c === ')') break;
    }
    lets.push({ name: m[1], pos: m.index, s, e });
  }
  return lets;
}

/** The nearest earlier `let name` in the same function body. */
function letBefore(f, fn, name, pos) {
  let best = null;
  for (const l of f.lets) {
    if (l.name !== name || l.pos >= pos) continue;
    if (fn && (l.pos < fn.bodyOpen || l.pos > fn.bodyClose)) continue;
    if (!best || l.pos > best.pos) best = l;
  }
  return best;
}

/**
 * Parse `[&[mut]] a::b::<T>::c!(…)` followed by `.m::<T>(…)` calls, `?` and
 * `.await`. Returns null when `[s, e)` is not exactly such a chain.
 */
function parseChain(code, pairs, s, e) {
  [s, e] = trimRange(code, s, e);
  let i = s;
  while (i < e && (code[i] === '&' || code[i] === '*')) {
    i = skipWs(code, i + 1);
    if (code.startsWith('mut', i) && /\s/.test(code[i + 3] || '')) i = skipWs(code, i + 3);
  }
  if (code[i] === '(' && pairs.get(i) === e - 1) return { group: [i + 1, e - 1] };
  if (code[i] === '{' && pairs.get(i) === e - 1) return { block: [i + 1, e - 1] };
  const path = [];
  let generic = null;
  for (;;) {
    const id = /^[A-Za-z_]\w*/.exec(code.slice(i, Math.min(e, i + 128)));
    if (!id) return null;
    path.push(id[0]);
    i = skipWs(code, i + id[0].length);
    if (!code.startsWith('::', i)) break;
    i = skipWs(code, i + 2);
    if (code[i] === '<') {
      const after = skipAngles(code, i, e);
      if (after < 0) return null;
      generic = code.slice(i + 1, after - 1).trim();
      i = skipWs(code, after);
      if (code.startsWith('::', i)) { i = skipWs(code, i + 2); continue; }
      break;
    }
  }
  let macro = false;
  if (code[i] === '!') { macro = true; i = skipWs(code, i + 1); }
  let args = null;
  if (i < e && (code[i] === '(' || (macro && (code[i] === '[' || code[i] === '{')))) {
    const close = pairs.get(i);
    if (close == null || close >= e) return null;
    args = [i + 1, close];
    i = skipWs(code, close + 1);
  }
  const calls = [];
  while (i < e) {
    if (code[i] === '?') { i = skipWs(code, i + 1); continue; }
    if (code[i] !== '.') return null;
    i = skipWs(code, i + 1);
    const id = /^[A-Za-z_]\w*/.exec(code.slice(i, Math.min(e, i + 128)));
    if (!id) return null;
    i = skipWs(code, i + id[0].length);
    if (code.startsWith('::', i)) {
      i = skipWs(code, i + 2);
      if (code[i] === '<') { const after = skipAngles(code, i, e); if (after < 0) return null; i = skipWs(code, after); }
    }
    let a = null;
    if (code[i] === '(') {
      const close = pairs.get(i);
      if (close == null || close >= e) return null;
      a = [i + 1, close];
      i = skipWs(code, close + 1);
    }
    if (id[0] === 'await' && !a) continue;
    calls.push({ name: id[0], args: a, at: i });
  }
  return { path, generic, macro, args, calls, start: s };
}

/** Where the receiver chain ending just before the `.` at `dot` starts (paths, calls, turbofish). */
function chainStart(code, pairs, dot) {
  let i = dot - 1;
  let start = -1;
  for (;;) {
    while (i >= 0 && /\s/.test(code[i])) i--;
    if (code[i] === '?') { i--; continue; }
    if (code[i] === ')' || code[i] === ']') {
      const open = pairs.get(i);
      if (open == null) return start;
      i = open - 1;
      while (i >= 0 && /\s/.test(code[i])) i--;
      if (code[i] === '!') i--;
    }
    let j = i;
    while (j >= 0 && /\w/.test(code[j])) j--;
    if (j === i) return start;
    start = j + 1;
    i = j;
    while (i >= 0 && /\s/.test(code[i])) i--;
    if (code[i] === '.') { i--; continue; }
    if (code[i] === ':' && code[i - 1] === ':') { i -= 2; continue; }
    return start;
  }
}

/** The value expression a function body (or block) ends with: its tail, or a final `return x;`. */
function tailRange(code, pairs, s, e) {
  const parts = splitTopLevel(code, pairs, s, e, ';');
  if (!parts.length) return null;
  const endsWithSemi = /;\s*$/.test(code.slice(s, e));
  let [a, b] = parts[parts.length - 1];
  if (endsWithSemi) {
    const r = /^return\b\s*/.exec(code.slice(a, b));
    if (!r) return null;
    a += r[0].length;
  }
  // Statements without a `;` (an `if … { }` block) can precede the tail.
  for (let k = a; k < b; k++) {
    if (code[k] === '{' && pairs.has(k) && pairs.get(k) < b && /^\s*\n/.test(code.slice(pairs.get(k) + 1, pairs.get(k) + 80))
      && /^\s*(?:if|for|while|loop|match|unsafe)\b/.test(code.slice(a, k))) {
      a = pairs.get(k) + 1;
      k = a - 1;
    }
  }
  [a, b] = trimRange(code, a, b);
  return b > a ? [a, b] : null;
}

function lineOf(code, pos) {
  let n = 1;
  for (let k = 0; k < pos && k < code.length; k++) if (code[k] === '\n') n++;
  return n;
}

/** `const NAME: &str = "…";` and `static` strings, by name, across the project. */
function collectConsts(files) {
  const consts = new Map();
  for (const f of files) {
    const re = /\b(?:const|static)\s+([A-Za-z_]\w*)\s*:\s*&\s*(?:'static\s+)?str\s*=\s*/g;
    let m;
    while ((m = re.exec(f.code)) !== null) {
      const lit = f.lits.get(m.index + m[0].length);
      if (!lit || typeof lit.value !== 'string') continue;
      const prev = consts.get(m[1]);
      consts.set(m[1], prev === undefined || prev === lit.value ? lit.value : null);
    }
  }
  return consts;
}

/** The project functions a call names: by name, narrowed by a module qualifier when several share it. */
function calleesOf(fns, path, fromFile) {
  const name = path[path.length - 1];
  const all = fns.get(name) || [];
  if (all.length <= 1) return all;
  const qual = path.length > 1 ? path[path.length - 2] : null;
  let hit = qual && qual !== 'self' && qual !== 'super' && qual !== 'crate' ? all.filter(fn => fn.f.stem.has(qual)) : all.filter(fn => fn.f === fromFile);
  if (hit.length === 1) return hit;
  return [];
}

// ── Warp ─────────────────────────────────────────────────────────────────────

const IDENTITY = Object.freeze({ segs: [], method: null, end: false, auth: false, handler: '', at: null, bad: null });

function product(A, B) {
  const out = [];
  for (const a of A) {
    for (const b of B) {
      if (a.end && (b.segs.length || b.bad)) continue; // segments after path::end() never match
      if (a.method && b.method && a.method !== b.method) continue; // two different methods never match
      out.push({
        segs: [...a.segs, ...b.segs], method: a.method || b.method, end: a.end || b.end, auth: a.auth || b.auth,
        handler: a.handler || b.handler, at: (b.segs.length ? b.at : null) || a.at || b.at, bad: a.bad || b.bad,
      });
      if (out.length >= ALT_LIMIT) return out;
    }
  }
  return out;
}

/**
 * Read the Warp routes of a project.
 * @param {Array<{ file: string, content: string }>} sources  `.rs` files, project-relative paths
 * @returns {Array<{ method: string, path: string, handler: string, file: string, line: number, auth: boolean }> & { omitted: object[] }}
 */
export function extractWarpRoutes(sources) {
  const routes = [];
  const omitted = [];
  Object.defineProperty(routes, 'omitted', { value: omitted, enumerable: false });
  if (!(sources || []).some(s => typeof s?.content === 'string' && /\bwarp\b/.test(s.content))) return routes;
  const files = readFiles(sources);
  for (const f of files) {
    f.lets = indexLets(f);
    f.warp = /\bwarp\b/.test(f.code);
  }
  const fns = indexFunctions(files);
  const consts = collectConsts(files);
  const memo = new Map();
  const visiting = new Set();

  const evalFn = (fn, depth) => {
    if (memo.has(fn)) return memo.get(fn);
    if (visiting.has(fn)) return [IDENTITY];
    visiting.add(fn);
    const tail = tailRange(fn.f.code, fn.f.pairs, fn.bodyOpen + 1, fn.bodyClose);
    const alts = (tail && evalExpr(fn.f, fn, tail[0], tail[1], depth + 1)) || [IDENTITY];
    visiting.delete(fn);
    memo.set(fn, alts);
    return alts;
  };

  const evalLet = (f, fn, l, depth) => {
    if (memo.has(l)) return memo.get(l);
    if (visiting.has(l)) return [IDENTITY];
    visiting.add(l);
    const alts = evalExpr(f, fn, l.s, l.e, depth + 1) || [IDENTITY];
    visiting.delete(l);
    memo.set(l, alts);
    return alts;
  };

  /** Alternatives of a filter expression; null when it is not one this reader models. */
  const evalExpr = (f, fn, s, e, depth = 0) => {
    if (depth > MAX_DEPTH) return null;
    const { code, pairs } = f;
    const chain = parseChain(code, pairs, s, e);
    if (!chain) return null;
    if (chain.group) return evalExpr(f, fn, ...chain.group, depth + 1);
    if (chain.block) {
      const t = tailRange(code, pairs, ...chain.block);
      return t ? evalExpr(f, fn, t[0], t[1], depth + 1) : null;
    }
    let alts = primitive(f, fn, chain, depth);
    if (!alts) return null;
    for (const c of chain.calls) {
      if (c.name === 'and' && c.args) {
        alts = product(alts, evalExpr(f, fn, ...c.args, depth + 1) || [IDENTITY]);
      } else if (c.name === 'or' && c.args) {
        alts = [...alts, ...(evalExpr(f, fn, ...c.args, depth + 1) || [IDENTITY])].slice(0, ALT_LIMIT);
      } else if ((c.name === 'and_then' || c.name === 'map' || c.name === 'then') && c.args) {
        const h = /^(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)$/.exec(code.slice(...c.args).trim());
        if (h) alts = alts.map(a => (a.handler ? a : { ...a, handler: h[1] }));
      }
      // Every other combinator (with, recover, boxed, untuple_one, unify, …)
      // passes its filter's path and method through.
    }
    return alts;
  };

  const primitive = (f, fn, chain, depth) => {
    const { code } = f;
    const path = chain.path;
    const warpQualified = path[0] === 'warp';
    const local = path.filter(p => p !== 'warp' && p !== 'filters');
    const key = local.join('::').replace(/^method::/, '');
    const at = { file: f.file, pos: chain.start };
    const builtin = warpQualified || (f.warp && !fns.has(path[path.length - 1]) && /^(?:path|path::\w+|get|post|put|delete|patch|head|options|any|header|header::\w+|body::\w+|query|ws|fs::\w+)$/.test(key));
    if (builtin) {
      if (key === 'path' && chain.macro) return [macroPath(f, chain, at)];
      if (key === 'path' && chain.args) {
        const v = stringArg(f, chain.args);
        return [v === null ? { ...IDENTITY, bad: at } : { ...IDENTITY, segs: [v], at }];
      }
      if (key === 'path::end') return [{ ...IDENTITY, end: true, at }];
      if (key === 'path::param') return [{ ...IDENTITY, segs: [`{${chain.generic || 'param'}}`], at }];
      if (key === 'path::tail') return [{ ...IDENTITY, segs: ['{*tail}'], at }];
      if (WARP_METHODS.has(key) && chain.args && code.slice(...chain.args).trim() === '') return [{ ...IDENTITY, method: WARP_METHODS.get(key), at }];
      if (key === 'ws') return [{ ...IDENTITY, method: 'GET', at }];
      if (key === 'fs::dir') return [{ ...IDENTITY, method: 'GET', segs: ['{*path}'], at }];
      if (key === 'fs::file') return [{ ...IDENTITY, method: 'GET', at }];
      if (/^header/.test(key) && chain.args) {
        const first = splitTopLevel(code, f.pairs, ...chain.args)[0];
        const name = first ? literalIn(code, f.lits, ...first) : undefined;
        return [{ ...IDENTITY, auth: typeof name === 'string' && /^authorization$/i.test(name) }];
      }
      return [IDENTITY];
    }
    if (chain.macro) return [IDENTITY];
    if (chain.args) {
      const targets = calleesOf(fns, path, f);
      if (targets.length !== 1) return [IDENTITY]; // not a project filter function, or ambiguous
      const alts = evalFn(targets[0], depth);
      return AUTH_NAME.test(path[path.length - 1]) ? alts.map(a => ({ ...a, auth: true })) : alts;
    }
    if (path.length === 1) {
      const l = letBefore(f, fn, path[0], chain.start);
      if (l) return evalLet(f, fn, l, depth);
    }
    return [IDENTITY]; // a parameter or a value this reader cannot see: assumed to add no segment
  };

  const stringArg = (f, args) => {
    const parts = splitTopLevel(f.code, f.pairs, ...args);
    if (parts.length !== 1) return null;
    const lit = literalIn(f.code, f.lits, ...parts[0]);
    if (typeof lit === 'string') return lit.replace(/^\/+|\/+$/g, '');
    const id = /^&?\s*(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)$/.exec(f.code.slice(...parts[0]).trim());
    const v = id ? consts.get(id[1]) : null;
    return typeof v === 'string' ? v.replace(/^\/+|\/+$/g, '') : null;
  };

  const macroPath = (f, chain, at) => {
    const segs = [];
    let end = true;
    for (const [a, b] of splitTopLevel(f.code, f.pairs, ...chain.args, '/')) {
      const text = f.code.slice(a, b).trim();
      const lit = literalIn(f.code, f.lits, a, b);
      if (typeof lit === 'string') segs.push(lit);
      else if (text === '..') end = false;
      else if (lit === null) return { ...IDENTITY, bad: at };
      else segs.push(`{${text}}`);
    }
    return { ...IDENTITY, segs, end, at };
  };

  // Roots: what warp::serve / warp::service run; else filter functions nothing calls.
  const roots = [];
  for (const f of files) {
    const re = /\bwarp\s*::\s*(?:serve|service)\s*\(/g;
    let m;
    while ((m = re.exec(f.code)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = f.pairs.get(open);
      if (close == null) continue;
      const fn = enclosingFn(fns, f, m.index);
      const alts = evalExpr(f, fn, open + 1, close);
      if (alts) roots.push(...alts);
    }
  }
  if (!roots.length) {
    const called = new Set();
    for (const f of files) {
      const re = /\b([A-Za-z_]\w*)\s*(?:::\s*<[^>]*>\s*)?\(/g;
      let m;
      while ((m = re.exec(f.code)) !== null) {
        if (!/\bfn\s+$/.test(f.code.slice(Math.max(0, m.index - 8), m.index))) called.add(m[1]);
      }
    }
    for (const [name, list] of fns) {
      if (called.has(name)) continue;
      for (const fn of list) if (fn.f.warp && /\bFilter\b/.test(fn.result)) roots.push(...evalFn(fn, 0));
    }
  }

  const seen = new Set();
  const lines = new Map();
  const lineAt = at => {
    const f = files.find(x => x.file === at.file);
    const key = `${at.file}:${at.pos}`;
    if (!lines.has(key)) lines.set(key, f ? lineOf(f.code, at.pos) : null);
    return lines.get(key);
  };
  for (const a of roots) {
    if (a.bad) {
      const line = lineAt(a.bad);
      if (!omitted.some(o => o.file === a.bad.file && o.line === line)) omitted.push({ file: a.bad.file, line, reason: 'path segment is not literal text' });
      continue;
    }
    if (!a.segs.length && !a.end) continue; // no path: a catch-all, not a route
    const method = a.method || 'ANY';
    const path = '/' + a.segs.join('/');
    const k = `${method} ${path}`;
    if (seen.has(k)) continue;
    seen.add(k);
    routes.push({ method, path, handler: a.handler, file: a.at?.file || '', line: a.at ? lineAt(a.at) : null, auth: a.auth });
  }
  return routes;
}

// ── Tide ─────────────────────────────────────────────────────────────────────

const SERVER_TYPE = /\b(?:tide::)?Server\b/;
const ROUTE_TYPE = /\b(?:tide::)?Route\b/;

/**
 * Read the Tide routes of a project.
 * @param {Array<{ file: string, content: string }>} sources  `.rs` files, project-relative paths
 * @returns {Array<{ method: string, path: string, handler: string, file: string, line: number, auth: boolean }> & { omitted: object[] }}
 */
export function extractTideRoutes(sources) {
  const routes = [];
  const omitted = [];
  Object.defineProperty(routes, 'omitted', { value: omitted, enumerable: false });
  if (!(sources || []).some(s => typeof s?.content === 'string' && /\btide\b/.test(s.content))) return routes;
  const files = readFiles(sources);
  for (const f of files) f.lets = indexLets(f);
  const fns = indexFunctions(files);
  const memo = new Map();
  const visiting = new Set();
  const edges = new Map(); // fn → index → [node]
  const mounts = []; // { target, parent }
  const records = [];

  /** The node an expression denotes: a server, a route, a parameter, a returned server; null otherwise. */
  const evalNode = (f, fn, s, e, depth = 0) => {
    if (depth > MAX_DEPTH) return null;
    const { code, pairs } = f;
    const chain = parseChain(code, pairs, s, e);
    if (!chain) return null;
    if (chain.group) return evalNode(f, fn, ...chain.group, depth + 1);
    if (chain.block) {
      const t = tailRange(code, pairs, ...chain.block);
      return t ? evalNode(f, fn, t[0], t[1], depth + 1) : null;
    }
    let node = null;
    const p = chain.path;
    const joined = p.join('::');
    if (chain.args && /^(?:tide::)?(?:new|with_state)$|^(?:tide::)?Server::(?:new|with_state)$/.test(joined) && (p[0] === 'tide' || p[0] === 'Server')) {
      node = { kind: 'root' };
    } else if (!chain.args && !chain.macro && p.length === 1) {
      const l = letBefore(f, fn, p[0], chain.start);
      if (l) {
        if (memo.has(l)) node = memo.get(l);
        else if (!visiting.has(l)) {
          visiting.add(l);
          node = evalNode(f, fn, l.s, l.e, depth + 1);
          visiting.delete(l);
          memo.set(l, node);
        }
      } else if (fn) {
        const index = fn.params.findIndex(q => q.name === p[0]);
        if (index >= 0 && (SERVER_TYPE.test(fn.params[index].type) || ROUTE_TYPE.test(fn.params[index].type))) node = { kind: 'param', fn, index, key: `${fn.f.file}:${fn.start}:${index}` };
      }
    } else if (chain.args && !chain.macro) {
      const targets = calleesOf(fns, p, f);
      if (targets.length === 1 && SERVER_TYPE.test(targets[0].result)) node = { kind: 'ret', fn: targets[0] };
    }
    if (!node) return null;
    for (const c of chain.calls) {
      if (c.name === 'at' && c.args) {
        const parts = splitTopLevel(code, pairs, ...c.args);
        const lit = parts.length === 1 ? literalIn(code, f.lits, ...parts[0]) : undefined;
        node = { kind: 'child', parent: node, path: typeof lit === 'string' ? lit : null };
      } else if (!(TIDE_VERBS.has(c.name) || ['with', 'strip_prefix', 'reset_middleware', 'method'].includes(c.name))) {
        return null; // a call that does not return the route
      }
    }
    return node;
  };

  for (const f of files) {
    const { code, pairs } = f;
    // Only a file that names Tide, a Server or Route, or calls `.at(` can hold a registration.
    if (!/\btide\b|\bServer\b|\bRoute\b|\.\s*at\s*\(/.test(code)) continue;
    // Route registrations: `<route>.get(h)` and friends.
    const verb = /\.\s*(get|post|put|delete|patch|head|options|connect|trace|all|serve_dir|serve_file|method|nest)\s*\(/g;
    let m;
    while ((m = verb.exec(code)) !== null) {
      const dot = m.index;
      const open = m.index + m[0].length - 1;
      const close = pairs.get(open);
      if (close == null) continue;
      const start = chainStart(code, pairs, dot);
      if (start < 0) continue;
      const fn = enclosingFn(fns, f, dot);
      const node = evalNode(f, fn, start, dot);
      if (!node || node.kind === 'root' || node.kind === 'ret') continue;
      if (node.kind === 'param' && !ROUTE_TYPE.test(node.fn.params[node.index].type)) continue;
      const args = splitTopLevel(code, pairs, open + 1, close);
      const name = m[1];
      if (name === 'nest') {
        const target = args[0] ? evalNode(f, fn, ...args[0]) : null;
        if (target) mounts.push({ target, parent: node });
        continue;
      }
      let methods;
      let suffix = '';
      if (TIDE_VERBS.has(name)) methods = [TIDE_VERBS.get(name)];
      else if (name === 'serve_dir') { methods = ['GET']; suffix = '*'; }
      else if (name === 'serve_file') methods = ['GET'];
      else {
        const mm = args[0] ? /(?:^|::)Method::([A-Za-z]+)$/.exec(code.slice(...args[0]).trim()) : null;
        if (!mm) continue;
        methods = [mm[1].toUpperCase()];
      }
      const handlerRange = name === 'method' ? args[1] : args[0];
      const h = handlerRange ? /^(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)$/.exec(code.slice(...handlerRange).trim()) : null;
      records.push({ node, methods, suffix, handler: h ? h[1] : '', file: f.file, line: lineOf(code, dot), auth: false });
    }
    // Calls handing a server or route to a project function.
    const call = /\b([A-Za-z_]\w*)\s*\(/g;
    while ((m = call.exec(code)) !== null) {
      const list = fns.get(m[1]);
      if (!list || /\bfn\s+$/.test(code.slice(Math.max(0, m.index - 8), m.index))) continue;
      const before = code.slice(Math.max(0, m.index - 2), m.index);
      if (/\.\s*$/.test(before)) continue; // a method call
      const qual = /([A-Za-z_]\w*)\s*::\s*$/.exec(code.slice(Math.max(0, m.index - 64), m.index));
      const targets = calleesOf(fns, qual ? [qual[1], m[1]] : [m[1]], f);
      const open = m.index + m[0].length - 1;
      if (!pairs.has(open)) continue;
      const args = splitTopLevel(code, pairs, open + 1, pairs.get(open));
      const fn = enclosingFn(fns, f, m.index);
      for (const target of targets) {
        target.params.forEach((q, index) => {
          if (!args[index] || !(SERVER_TYPE.test(q.type) || ROUTE_TYPE.test(q.type))) return;
          const node = evalNode(f, fn, ...args[index]);
          if (!node) return;
          if (!edges.has(target)) edges.set(target, new Map());
          const byIndex = edges.get(target);
          if (!byIndex.has(index)) byIndex.set(index, []);
          byIndex.get(index).push(node);
        });
      }
    }
  }

  // ── Resolution: a server's prefixes come from the routes that nest it. ──
  const retMemo = new Map();
  const deref = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return [];
    seen.add(node);
    if (node.kind !== 'ret') return [node];
    if (!retMemo.has(node.fn)) {
      retMemo.set(node.fn, []);
      const fn = node.fn;
      const t = tailRange(fn.f.code, fn.f.pairs, fn.bodyOpen + 1, fn.bodyClose);
      retMemo.set(node.fn, t ? [evalNode(fn.f, fn, t[0], t[1])].filter(Boolean) : []);
    }
    return retMemo.get(node.fn).flatMap(n => deref(n, seen));
  };
  const sameNode = (a, b) => a === b || (a.kind === 'param' && b.kind === 'param' && a.key === b.key);
  const mountsOf = node => mounts.filter(mt => deref(mt.target).some(t => sameNode(t, node)));
  const prefixes = (node, visiting = new Set()) => {
    if (visiting.has(node) || visiting.size > MAX_DEPTH) return [];
    visiting.add(node);
    let out;
    switch (node.kind) {
      case 'root': {
        const ms = mountsOf(node);
        out = ms.length ? ms.flatMap(mt => prefixes(mt.parent, visiting)) : [''];
        break;
      }
      case 'child':
        out = prefixes(node.parent, visiting).map(p => (p === null || node.path === null ? null : joinRoutePath(p, node.path)));
        break;
      case 'param': {
        const key = node.key;
        const callers = [...edges].find(([fn]) => `${fn.f.file}:${fn.start}:${node.index}` === key)?.[1].get(node.index) || [];
        const ms = mountsOf(node);
        out = callers.length || ms.length
          ? [...callers.flatMap(n => prefixes(n, visiting)), ...ms.flatMap(mt => prefixes(mt.parent, visiting))]
          : [''];
        break;
      }
      case 'ret':
        out = deref(node).flatMap(n => prefixes(n, visiting));
        break;
      default:
        out = [];
    }
    visiting.delete(node);
    return [...new Set(out)].slice(0, 64);
  };

  const seen = new Set();
  for (const r of records) {
    for (const p of prefixes(r.node)) {
      if (p === null) {
        if (!omitted.some(o => o.file === r.file && o.line === r.line)) omitted.push({ file: r.file, line: r.line, reason: 'route path is not literal text' });
        continue;
      }
      const path = r.suffix ? joinRoutePath(p, r.suffix) : (p || '/');
      for (const method of r.methods) {
        const key = `${method} ${path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ method, path, handler: r.handler, file: r.file, line: r.line, auth: r.auth });
      }
    }
  }
  return routes;
}
