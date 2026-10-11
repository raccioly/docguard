/**
 * Rust route readers: Warp, Tide, and the Actix, Axum and Rocket builders.
 *
 * DocGuard has no Rust parser. Each reader evaluates the masked source:
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
 * - **Actix, Axum and Rocket** build the same kind of tree: `web::scope`,
 *   `web::resource`, `Router::new()` and `rocket::build()` are nodes, and
 *   `.service()`, `.configure()`, `.nest()`, `.merge()` and `.mount()` mount
 *   one on another (`extractRustBuilderRoutes`).
 *
 * Comments and string bodies are masked first (`lexCLike`). A segment or
 * prefix that is not literal text (or, for Warp, a `const` string) makes its
 * route unreadable: it is omitted and recorded (Warp and Tide in `omitted`,
 * the builder reader in `unresolved`), never guessed.
 *
 * @implements docguard.more-route-frameworks#FR-003
 * @implements docguard.more-route-frameworks#FR-004
 * @implements docguard.more-route-frameworks#FR-005
 * @implements docguard.real-project-route-gaps#FR-001
 * @implements docguard.real-project-route-gaps#FR-002
 * @implements docguard.real-project-route-gaps#FR-005
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

// ── Actix, Axum and Rocket builders ──────────────────────────────────────────
//
// The three builder APIs share Tide's shape: a router, scope or resource is a
// node; `.service()`, `.configure()`, `.nest()`, `.merge()` and `.mount()` are
// edges; a registration's served path is every chain of prefixes down to its
// node (docguard.real-project-route-gaps#FR-001, FR-002).

const BUILDER_VERBS = new Map([
  ['get', 'GET'], ['post', 'POST'], ['put', 'PUT'], ['delete', 'DELETE'], ['patch', 'PATCH'],
  ['head', 'HEAD'], ['options', 'OPTIONS'], ['trace', 'TRACE'], ['connect', 'CONNECT'],
]);
const MACRO_VERBS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);
/** Parameter types that hand a function a builder to register on. */
const BUILDER_PARAM = /\b(?:Router|ServiceConfig|Scope|Resource|App|Rocket)\b/;
/** Result types of a function that returns a builder. */
const BUILDER_RESULT = /\b(?:Router|Scope|Resource|App|Rocket|HttpServiceFactory)\b/;
const FRAMEWORK_OF = { actix: 'Actix Web', axum: 'Axum', rocket: 'Rocket' };
const BUILDER_CALL = /\.\s*(route|service|configure|nest|merge|mount|to|to_async|route_service)\s*\(/g;
const ROUTE_MACRO = /#\[\s*(get|post|put|delete|patch|head|options)\s*\(/g;

/** `/x`, `x` → normalised served path. */
const servedPath = p => (p.startsWith('/') ? p : '/' + p).replace(/\/{2,}/g, '/');
const joinPrefix = (a, b) => (a === null || b === null ? null : b === '' ? a : joinRoutePath(a, b));

/**
 * Read the Actix Web, Axum and Rocket routes of a project.
 *
 * - **Actix**: `App::new()`, `web::scope(p)` and `web::resource(p)` are nodes;
 *   `.route(p, web::get().to(h))` on an app, scope or `ServiceConfig`,
 *   `.route(web::post().to(h))` and `.to(h)` on a resource register routes;
 *   `.service(x)` mounts a scope, a resource, a tuple of them or a handler
 *   macro; `.configure(f)` mounts `f`'s `ServiceConfig` parameter (or a
 *   closure's).
 * - **Axum**: `Router::new()` is a node; `.route(p, get(a).put(b))` registers
 *   every method of the method router (`on(MethodFilter::…)`, `any`,
 *   `*_service`); `.nest(p, r)` and `.merge(r)` mount another router.
 * - **Rocket**: `rocket::build().mount(p, routes![a, b])` mounts handler macros.
 *
 * A handler macro (`#[get("/p")]`) takes the prefix of every node that
 * registers it; one nothing registers keeps its own path. A registration on a
 * receiver the reader cannot evaluate keeps its literal path, as the one-line
 * patterns did. A recognised declaration that yields no route is recorded in
 * `unresolved`, never guessed (FR-005).
 *
 * @implements docguard.real-project-route-gaps#FR-001
 * @implements docguard.real-project-route-gaps#FR-002
 * @implements docguard.real-project-route-gaps#FR-005
 * @param {Array<{ file: string, content: string }>} sources  `.rs` files, project-relative paths
 * @returns {Array<{ method, path, handler, file, line, auth, source }> & { unresolved: Array<{ framework, code, file, line, target }> }}
 */
export function extractRustBuilderRoutes(sources) {
  const routes = [];
  const unresolved = [];
  Object.defineProperty(routes, 'unresolved', { value: unresolved, enumerable: false });
  const marker = /\.\s*(?:route|service|configure|nest|merge|mount)\s*\(|#\[\s*(?:get|post|put|delete|patch|head|options)\s*\(/;
  if (!(sources || []).some(s => typeof s?.content === 'string' && marker.test(s.content))) return routes;
  const files = readFiles(sources);
  for (const f of files) f.lets = indexLets(f);
  const fns = indexFunctions(files);
  const consts = collectConsts(files);

  const missed = new Set();
  const miss = (fw, code, file, line, target = '') => {
    const k = `${code}|${file}|${line}`;
    if (missed.has(k)) return;
    missed.add(k);
    unresolved.push({ framework: FRAMEWORK_OF[fw] || 'Rust', code, file, line, target: String(target).replace(/\s+/g, ' ').slice(0, 120) });
  };
  const text = (f, [a, b]) => f.code.slice(a, b).trim();
  /** Source text of a range, with literals restored, for `target`. */
  const original = (f, [a, b]) => {
    let out = '';
    for (let k = a; k < b; k++) {
      const lit = f.lits.get(k);
      if (lit && typeof lit.value === 'string') { out += JSON.stringify(lit.value); k = lit.end - 1; continue; }
      out += f.code[k];
    }
    return out.trim();
  };
  /** A string argument: a literal, `&"x"`, or a `const` string; null otherwise. */
  const strValue = (f, range) => {
    let [a, b] = trimRange(f.code, ...range);
    while (a < b && f.code[a] === '&') a++;
    const lit = literalIn(f.code, f.lits, a, b);
    if (typeof lit === 'string') return lit;
    const id = /^(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)$/.exec(f.code.slice(a, b).trim());
    const v = id ? consts.get(id[1]) : null;
    return typeof v === 'string' ? v : null;
  };
  const lastIdent = t => (/(?:^|::)([A-Za-z_]\w*)\s*$/.exec(t) || [])[1] || '';

  // ── Nodes ──
  const nodes = new Map();
  const made = [];
  const mk = (f, pos, kind, fw, path = '') => {
    const key = `${f.file}:${pos}`;
    if (!nodes.has(key)) {
      const node = { kind, fw, path, file: f.file, line: lineOf(f.code, pos), touched: false };
      nodes.set(key, node);
      made.push(node);
      if (path === null) miss(fw, kind === 'scope' ? 'route-unresolved-prefix' : 'route-unresolved-path', f.file, node.line, kind === 'scope' ? 'web::scope' : 'web::resource');
    }
    return nodes.get(key);
  };
  const paramNodes = new Map();
  const paramNode = (fn, index) => {
    const key = `${fn.f.file}:${fn.start}:${index}`;
    if (!paramNodes.has(key)) paramNodes.set(key, { kind: 'param', fw: null, path: '', key });
    return paramNodes.get(key);
  };
  const retNodes = new Map();
  const retNode = fn => {
    if (!retNodes.has(fn)) retNodes.set(fn, { kind: 'ret', fn });
    return retNodes.get(fn);
  };
  // `.configure(|cfg| …)`: the closure parameter is a node mounted on the receiver.
  const closures = [];
  for (const f of files) {
    const re = /\.\s*configure\s*\(\s*(?:move\s+)?\|\s*(?:mut\s+)?([A-Za-z_]\w*)\s*(?::[^|]*)?\|/g;
    let m;
    while ((m = re.exec(f.code)) !== null) {
      const open = f.code.indexOf('(', m.index);
      const close = f.pairs.get(open);
      if (close == null) continue;
      closures.push({ f, name: m[1], s: m.index + m[0].length, e: close, node: { kind: 'param', fw: 'actix', path: '', key: `${f.file}:${m.index}` }, at: m.index });
    }
  }
  const closureParam = (f, name, pos) => {
    let best = null;
    for (const c of closures) if (c.f === f && c.name === name && pos >= c.s && pos < c.e && (!best || c.s > best.s)) best = c;
    return best;
  };
  const letFor = (f, fn, name, pos) => {
    let best = null;
    for (const l of f.lets) {
      if (l.name !== name || l.pos >= pos || (pos >= l.s && pos <= l.e)) continue;
      if (fn && (l.pos < fn.bodyOpen || l.pos > fn.bodyClose)) continue;
      if (!best || l.pos > best.pos) best = l;
    }
    return best;
  };
  const memo = new Map();
  const visiting = new Set();

  /** The node an expression denotes, or null when it is not a builder this reader models. */
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
    const p = chain.path;
    const joined = p.join('::');
    const last = p[p.length - 1];
    if (chain.macro) return null;
    if (chain.args) {
      const arg0 = () => splitTopLevel(code, pairs, ...chain.args)[0];
      if (/(?:^|::)App::new$/.test(joined)) return mk(f, chain.start, 'root', 'actix');
      if (/(?:^|::)Router::new$/.test(joined)) return mk(f, chain.start, 'root', 'axum');
      if (p[0] === 'rocket' && p.length === 2 && ['build', 'ignite', 'custom'].includes(last)) return mk(f, chain.start, 'root', 'rocket');
      if (/(?:^|::)(?:web::scope|Scope::new)$/.test(joined)) { const a = arg0(); return mk(f, chain.start, 'scope', 'actix', a ? strValue(f, a) : null); }
      if (/(?:^|::)(?:web::resource|Resource::new)$/.test(joined)) { const a = arg0(); return mk(f, chain.start, 'resource', 'actix', a ? strValue(f, a) : null); }
      if (p[0] === 'web' || p[0] === 'axum' || p[0] === 'routing') return null; // a framework call, never a project function
      const targets = calleesOf(fns, p, f);
      if (targets.length === 1 && BUILDER_RESULT.test(targets[0].result)) return retNode(targets[0]);
      return null;
    }
    if (p.length !== 1) return null;
    const l = letFor(f, fn, p[0], chain.start);
    if (l) {
      if (memo.has(l)) return memo.get(l);
      if (visiting.has(l)) return null;
      visiting.add(l);
      const node = evalNode(f, fn, l.s, l.e, depth + 1);
      visiting.delete(l);
      memo.set(l, node);
      return node;
    }
    const c = closureParam(f, p[0], chain.start);
    if (c) return c.node;
    if (fn) {
      const index = fn.params.findIndex(q => q.name === p[0]);
      if (index >= 0 && BUILDER_PARAM.test(fn.params[index].type)) return paramNode(fn, index);
    }
    return null;
  };

  // ── Method readers ──
  /** `web::get().to(h)`, `web::route().guard(guard::Post()).to(h)`, `web::method(Method::PUT)`. */
  const isActixRoute = (f, range) => {
    const chain = parseChain(f.code, f.pairs, ...range);
    if (!chain?.path) return false;
    const j = chain.path.join('::');
    return /(?:^|::)web::\w+$/.test(j) || /(?:^|::)Route::new$/.test(j);
  };
  const actixMethods = (f, range) => {
    const chain = parseChain(f.code, f.pairs, ...range);
    if (!chain?.path || !chain.args) return null;
    const j = chain.path.join('::');
    const last = chain.path[chain.path.length - 1];
    let method;
    if (/(?:^|::)web::\w+$/.test(j) && BUILDER_VERBS.has(last)) method = BUILDER_VERBS.get(last);
    else if (/(?:^|::)(?:web::route|Route::new)$/.test(j)) method = 'ANY';
    else if (/(?:^|::)web::method$/.test(j)) {
      const m = /(?:^|::)Method::([A-Z]+)$/.exec(text(f, chain.args));
      if (!m) return null;
      method = m[1];
    } else return null;
    let handler = '';
    for (const c of chain.calls) {
      if (!c.args) continue;
      const t = text(f, c.args);
      if (c.name === 'to' || c.name === 'to_async') handler = lastIdent(t);
      else if (c.name === 'method') {
        const m = /(?:^|::)Method::([A-Z]+)$/.exec(t);
        if (!m) return null;
        method = m[1];
      } else if (c.name === 'guard') {
        const m = /(?:^|::)guard::(Get|Post|Put|Delete|Patch|Head|Options|Trace|Connect)\s*\(\s*\)$/.exec(t);
        if (m) method = m[1].toUpperCase();
      }
    }
    return { methods: [method], handler };
  };
  /** `get(a).post(b)`, `routing::any(h)`, `on(MethodFilter::GET | MethodFilter::POST, h)`, `get_service(svc)`. */
  const axumMethods = (f, range) => {
    const chain = parseChain(f.code, f.pairs, ...range);
    if (!chain?.path || !chain.args || chain.macro) return null;
    if (chain.path.length > 1 && !chain.path.slice(0, -1).every(s => s === 'axum' || s === 'routing' || s === 'method_routing')) return null;
    const methods = [];
    let handler = '';
    const add = (name, args) => {
      const base = name.replace(/_service$/, '');
      if (base === 'any') { methods.push('ANY'); }
      else if (BUILDER_VERBS.has(base)) methods.push(BUILDER_VERBS.get(base));
      else if (base === 'on') {
        const parts = args ? splitTopLevel(f.code, f.pairs, ...args) : [];
        if (!parts[0]) return false;
        for (const piece of text(f, parts[0]).split('|')) {
          const m = /^(?:[A-Za-z_]\w*::)*MethodFilter::([A-Z]+)$/.exec(piece.trim());
          if (!m) return false;
          methods.push(m[1]);
        }
        if (parts[1] && !handler) handler = lastIdent(text(f, parts[1]));
        return true;
      } else return false;
      const first = args ? splitTopLevel(f.code, f.pairs, ...args)[0] : null;
      if (first && !handler) handler = lastIdent(text(f, first));
      return true;
    };
    if (!add(chain.path[chain.path.length - 1], chain.args)) return null;
    for (const c of chain.calls) {
      const base = c.name.replace(/_service$/, '');
      if (base === 'any' || base === 'on' || BUILDER_VERBS.has(base)) {
        if (!add(c.name, c.args)) return null;
      }
      // layer, route_layer, with_state, fallback, … pass through.
    }
    return { methods: [...new Set(methods)], handler };
  };

  // ── Handler macros ──
  const macros = [];
  for (const f of files) {
    const actix = /\bactix_web\b/.test(f.code);
    ROUTE_MACRO.lastIndex = 0;
    let m;
    while ((m = ROUTE_MACRO.exec(f.code)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = f.pairs.get(open);
      if (close == null) continue;
      const bracket = f.code.lastIndexOf('[', open);
      const end = f.pairs.get(bracket);
      if (end == null) continue;
      const after = /^(?:\s*#\s*\[[^\]]*\])*\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/.exec(f.code.slice(end + 1, end + 400));
      if (!after) continue;
      const first = splitTopLevel(f.code, f.pairs, open + 1, close)[0];
      const raw = first ? literalIn(f.code, f.lits, ...first) : undefined;
      const fw = actix ? 'actix' : 'rocket';
      const line = lineOf(f.code, m.index);
      if (typeof raw !== 'string') { miss(fw, 'route-unresolved-path', f.file, line, first ? original(f, first) : ''); continue; }
      macros.push({ name: after[1], method: m[1].toUpperCase(), path: raw.replace(/\?.*$/, '') || '/', f, file: f.file, line, fw, regs: [] });
    }
  }
  const registerHandler = (f, ref, parent, path, fw) => {
    const segs = ref.split('::').map(s => s.trim()).filter(Boolean);
    const name = segs[segs.length - 1];
    let hits = macros.filter(x => x.name === name);
    const qual = segs.length > 1 ? segs[segs.length - 2] : null;
    if (hits.length > 1 && qual && !['self', 'super', 'crate'].includes(qual)) {
      const narrowed = hits.filter(x => x.f.stem.has(qual));
      if (narrowed.length) hits = narrowed;
    } else if (hits.length > 1) {
      const local = hits.filter(x => x.f === f);
      if (local.length) hits = local;
    }
    for (const x of hits) x.regs.push({ parent, path, fw });
    return hits.length > 0;
  };

  // ── Registrations ──
  const UNKNOWN = { kind: 'root', fw: null, path: '' };
  const mounts = [];  // { target, parent, path }
  const records = []; // { node, path, methods, handler, file, line, fw }
  for (const f of files) {
    const { code, pairs } = f;
    BUILDER_CALL.lastIndex = 0;
    let m;
    while ((m = BUILDER_CALL.exec(code)) !== null) {
      const dot = m.index;
      const open = m.index + m[0].length - 1;
      const close = pairs.get(open);
      if (close == null) continue;
      const start = chainStart(code, pairs, dot);
      if (start < 0) continue;
      const fn = enclosingFn(fns, f, dot);
      const recv = evalNode(f, fn, start, dot);
      const args = splitTopLevel(code, pairs, open + 1, close);
      const line = lineOf(code, dot);
      const name = m[1];
      if (name === 'route') {
        if (args.length === 1 && recv?.kind === 'resource') {
          recv.touched = true;
          const r = actixMethods(f, args[0]);
          if (!r) { miss('actix', 'route-unresolved-method', f.file, line, original(f, args[0])); continue; }
          records.push({ node: recv, path: '', ...r, file: f.file, line, fw: 'actix' });
          continue;
        }
        if (args.length !== 2) continue;
        const path = strValue(f, args[0]);
        const actix = recv?.fw === 'actix' || recv?.kind === 'scope' || isActixRoute(f, args[1]);
        const r = actix ? actixMethods(f, args[1]) : axumMethods(f, args[1]);
        const fw = actix ? 'actix' : 'axum';
        if (!recv) {
          // A receiver this reader cannot evaluate: the literal path, as before.
          if (typeof path === 'string' && r) records.push({ node: UNKNOWN, path, ...r, file: f.file, line, fw });
          continue;
        }
        if (recv.kind === 'resource') continue;
        if (path === null) { miss(fw, 'route-unresolved-path', f.file, line, original(f, args[0])); continue; }
        if (!r) { miss(fw, 'route-unresolved-method', f.file, line, original(f, args[1])); continue; }
        records.push({ node: recv, path, ...r, file: f.file, line, fw });
      } else if (name === 'to' || name === 'to_async') {
        if (recv?.kind !== 'resource' || args.length !== 1) continue;
        recv.touched = true;
        records.push({ node: recv, path: '', methods: ['ANY'], handler: lastIdent(text(f, args[0])), file: f.file, line, fw: 'actix' });
      } else if (name === 'route_service') {
        if (!recv || recv.fw === 'actix' || args.length !== 2) continue;
        const path = strValue(f, args[0]);
        if (path === null) { miss('axum', 'route-unresolved-path', f.file, line, original(f, args[0])); continue; }
        records.push({ node: recv, path, methods: ['ANY'], handler: '', file: f.file, line, fw: 'axum' });
      } else if (name === 'service') {
        if (args.length !== 1) continue;
        let items = [args[0]];
        const [a, b] = args[0];
        if (code[a] === '(' && pairs.get(a) === b - 1) items = splitTopLevel(code, pairs, a + 1, b - 1);
        for (const item of items) {
          const target = evalNode(f, fn, ...item);
          if (target) { mounts.push({ target, parent: recv || UNKNOWN, path: '' }); continue; }
          const t = text(f, item);
          if (/^(?:[A-Za-z_]\w*::)*[A-Za-z_]\w*$/.test(t)) registerHandler(f, t, recv || UNKNOWN, '', 'actix');
        }
      } else if (name === 'configure') {
        if (!recv || args.length !== 1) continue;
        const c = closures.find(x => x.f === f && x.at === dot);
        if (c) { mounts.push({ target: c.node, parent: recv, path: '' }); continue; }
        const t = text(f, args[0]);
        if (!/^(?:[A-Za-z_]\w*::)*[A-Za-z_]\w*$/.test(t)) continue;
        for (const target of calleesOf(fns, t.split('::'), f)) {
          const index = Math.max(0, target.params.findIndex(q => /\bServiceConfig\b/.test(q.type)));
          mounts.push({ target: paramNode(target, index), parent: recv, path: '' });
        }
      } else if (name === 'nest' || name === 'merge') {
        const want = name === 'nest' ? 2 : 1;
        if (args.length !== want || (recv && recv.fw === 'actix')) continue;
        const path = name === 'nest' ? strValue(f, args[0]) : '';
        const target = evalNode(f, fn, ...args[want - 1]);
        if (path === null) miss('axum', 'route-unresolved-prefix', f.file, line, original(f, args[0]));
        if (target) mounts.push({ target, parent: recv || UNKNOWN, path });
      } else if (name === 'mount') {
        if (args.length !== 2) continue;
        const chain = parseChain(code, pairs, ...args[1]);
        if (!chain?.macro || chain.path.join('::') !== 'routes' || !chain.args) continue;
        const path = strValue(f, args[0]);
        if (path === null) miss('rocket', 'route-unresolved-prefix', f.file, line, original(f, args[0]));
        for (const item of splitTopLevel(code, pairs, ...chain.args)) registerHandler(f, text(f, item), recv || UNKNOWN, path, 'rocket');
      }
    }
    // A builder handed to a project function (`routes(cfg)`, `add_api(router)`).
    const call = /\b([A-Za-z_]\w*)\s*\(/g;
    while ((m = call.exec(code)) !== null) {
      const list = fns.get(m[1]);
      if (!list || /\bfn\s+$/.test(code.slice(Math.max(0, m.index - 8), m.index))) continue;
      if (/\.\s*$/.test(code.slice(Math.max(0, m.index - 2), m.index))) continue;
      const qual = /([A-Za-z_]\w*)\s*::\s*$/.exec(code.slice(Math.max(0, m.index - 64), m.index));
      const targets = calleesOf(fns, qual ? [qual[1], m[1]] : [m[1]], f);
      const open = m.index + m[0].length - 1;
      if (!pairs.has(open)) continue;
      const args = splitTopLevel(code, pairs, open + 1, pairs.get(open));
      const fn = enclosingFn(fns, f, m.index);
      for (const target of targets) {
        target.params.forEach((q, index) => {
          if (!args[index] || !BUILDER_PARAM.test(q.type)) return;
          const node = evalNode(f, fn, ...args[index]);
          if (node) mounts.push({ target: paramNode(target, index), parent: node, path: '' });
        });
      }
    }
  }

  // ── Resolution ──
  const derefMemo = new Map();
  const deref = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return [];
    seen.add(node);
    if (node.kind !== 'ret') return [node];
    if (!derefMemo.has(node.fn)) {
      derefMemo.set(node.fn, []);
      const fn = node.fn;
      const t = tailRange(fn.f.code, fn.f.pairs, fn.bodyOpen + 1, fn.bodyClose);
      derefMemo.set(node.fn, t ? [evalNode(fn.f, fn, t[0], t[1])].filter(Boolean) : []);
    }
    return derefMemo.get(node.fn).flatMap(n => deref(n, seen));
  };
  const mountsOf = node => mounts.filter(mt => deref(mt.target).includes(node));
  const prefixMemo = new Map();
  const prefixes = (node, visiting = new Set()) => {
    if (prefixMemo.has(node)) return prefixMemo.get(node);
    if (visiting.has(node) || visiting.size > MAX_DEPTH) return [];
    visiting.add(node);
    let out;
    if (node.kind === 'ret') out = deref(node).flatMap(n => prefixes(n, visiting));
    else {
      const ms = node === UNKNOWN ? [] : mountsOf(node);
      const base = ms.length ? ms.flatMap(mt => prefixes(mt.parent, visiting).map(p => joinPrefix(p, mt.path))) : [''];
      out = base.map(p => joinPrefix(p, node.path));
    }
    visiting.delete(node);
    out = [...new Set(out)].slice(0, 64);
    if (!visiting.size) prefixMemo.set(node, out);
    return out;
  };

  const seen = new Set();
  const emit = (method, path, handler, file, line, source) => {
    const key = `${method} ${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    routes.push({ method, path, handler, file, line, auth: false, source });
  };
  for (const r of records) {
    for (const p of prefixes(r.node)) {
      const full = joinPrefix(p, r.path);
      if (full === null) continue; // its prefix is recorded where it is mounted
      for (const method of r.methods) emit(method, servedPath(full), r.handler, r.file, r.line, r.fw);
    }
  }
  for (const x of macros) {
    if (!x.regs.length) { emit(x.method, servedPath(x.path), x.name, x.file, x.line, x.fw); continue; }
    for (const reg of x.regs) {
      for (const p of prefixes(reg.parent)) {
        const full = joinPrefix(joinPrefix(p, reg.path), x.path);
        if (full === null) continue;
        emit(x.method, servedPath(full), x.name, x.file, x.line, reg.fw);
      }
    }
  }
  // A resource that registered no route (`web::resource("/x").name("x")`).
  for (const n of made) {
    if (n.kind === 'resource' && n.path !== null && !n.touched) miss('actix', 'route-unresolved-declaration', n.file, n.line, `web::resource("${n.path}")`);
  }
  return routes;
}
