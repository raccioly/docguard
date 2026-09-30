/**
 * Go route reader: gin, echo, chi, fiber, gorilla/mux and net/http.
 *
 * A Go route is registered on a router value, and the path it is served under
 * is that value's prefix joined to the literal in the call. The prefix comes
 * from how the value was made — `r.Group("/api")`, `r.Route("/x", func(r
 * chi.Router) {…})`, `r.Mount("/admin", adminRouter())`,
 * `api := r.PathPrefix("/api").Subrouter()` — often in another block, another
 * function, or another file. Reading one call at a time loses it.
 *
 * So each router expression becomes a symbolic node: a constructor
 * (`gin.Default()`), a child of another node with a literal prefix, a
 * router-typed function parameter, a function's return value, or a struct
 * field. Routes attach to nodes; function calls, returns and mounts are edges.
 * Prefixes are resolved once every file is read, so neither order nor file
 * matters.
 *
 * A call is matched to the function it invokes by name, narrowed by package
 * (`users.Register(v1)`) or by the receiver's type when it can be read
 * (`h := users.NewHandler(db); h.Register(v1)`). When several functions could
 * be the callee, or a prefix is not literal, the routes it would place are
 * omitted rather than reported at a guessed path.
 *
 * @implements docguard.go-spring-rails-routes#FR-001
 * @implements docguard.go-spring-rails-routes#FR-002
 * @implements docguard.go-spring-rails-routes#FR-006
 */

import { dirname } from 'node:path';
import { lexCLike, matchPairs, splitTopLevel, trimRange, literalIn, joinRoutePath } from './route-lexing.mjs';

const UPPER_VERBS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE']);
const CAP_VERBS = new Map([
  ['Get', 'GET'], ['Post', 'POST'], ['Put', 'PUT'], ['Delete', 'DELETE'], ['Patch', 'PATCH'],
  ['Head', 'HEAD'], ['Options', 'OPTIONS'], ['Connect', 'CONNECT'], ['Trace', 'TRACE'],
]);
const METHOD_CONSTANTS = new Map([...UPPER_VERBS].map(m => [`Method${m[0]}${m.slice(1).toLowerCase()}`, m]));
const ROOT_CONSTRUCTORS = new Set([
  'gin.Default', 'gin.New', 'echo.New', 'chi.NewRouter', 'chi.NewMux', 'fiber.New', 'mux.NewRouter', 'http.NewServeMux',
]);
const ROUTER_TYPE = /\b(?:gin\.(?:Engine|RouterGroup|IRouter|IRoutes)|echo\.(?:Echo|Group)|chi\.(?:Router|Mux)|fiber\.(?:App|Router|Group)|mux\.Router|http\.ServeMux)\b/;
/** Chain calls that return the same router (middleware, host matching). */
const PASS_THROUGH = new Set(['With', 'Use', 'Subrouter', 'Host', 'Schemes', 'Headers', 'Name']);
const ROUTE_CALLS = new Set([...UPPER_VERBS, ...CAP_VERBS.keys(), 'Any', 'All', 'Handle', 'HandleFunc',
  'Match', 'Add', 'Method', 'MethodFunc', 'Mount', 'Route', 'Group']);
const MAX_PREFIXES = 64;
const AUTH = /Authorization|jwt\.|middleware\.Auth/;

/** A router held somewhere this reader cannot see (a package variable, an untracked field). Served at the root. */
const UNKNOWN = { kind: 'unknown' };
/** A router whose prefix cannot be known (a non-literal prefix, an ambiguous callee). Its routes are omitted. */
const UNRESOLVED = { kind: 'unresolved' };
const AMBIGUOUS = Symbol('ambiguous');

/**
 * Read the routes of a Go project.
 * @param {Array<{ file: string, content: string }>} sources  `.go` files, project-relative paths
 * @returns {Array<{ method: string, path: string, handler: string, file: string, auth: boolean }>}
 */
export function extractGoRoutes(sources) {
  const files = [];
  for (const s of sources || []) {
    if (!s || typeof s.content !== 'string' || /_test\.go$/.test(s.file)) continue;
    const { code, lits } = lexCLike(s.content, { backtickRaw: true });
    const pkg = /^\s*package\s+([A-Za-z_]\w*)/m.exec(code);
    files.push({
      file: s.file, dir: dirname(s.file), pkg: pkg ? pkg[1] : '', src: s.content, code, lits, pairs: matchPairs(code),
    });
  }
  const packages = new Set(files.map(f => f.pkg).filter(Boolean));
  const consts = collectConstants(files);
  const funcs = new Map();
  for (const f of files) indexFunctions(f, funcs);
  const state = {
    records: [], edges: new Map(), rets: new Map(), mounts: [], fields: new Map(),
    defaultMux: { kind: 'root' },
  };
  for (const f of files) walkFile(f, { funcs, consts, packages, state });
  return resolve(state);
}

// ── Constants ────────────────────────────────────────────────────────────────

/** `const X = "…"` / `var X = "…"` (and `const ( … )` blocks), by name, across the project. */
function collectConstants(files) {
  const raw = new Map();
  const add = (f, lineStart, line) => {
    const m = /^\s*([A-Za-z_]\w*)\s*(?:string\s*)?=\s*/.exec(line);
    if (!m || !line.includes('"')) return;
    const s = lineStart + m[0].length;
    const e = lineStart + line.replace(/\s+$/, '').length;
    if (!raw.has(m[1])) raw.set(m[1], []);
    raw.get(m[1]).push({ f, s, e });
  };
  for (const f of files) {
    const { code, pairs } = f;
    const decl = /\b(?:const|var)\b\s*(\()?/g;
    let m;
    while ((m = decl.exec(code)) !== null) {
      if (m[1]) {
        const open = m.index + m[0].length - 1;
        const close = pairs.get(open);
        if (close == null) continue;
        let lineStart = open + 1;
        for (const line of code.slice(open + 1, close).split('\n')) {
          add(f, lineStart, line);
          lineStart += line.length + 1;
        }
      } else {
        const start = m.index + m[0].length;
        const end = code.indexOf('\n', start);
        add(f, start, code.slice(start, end < 0 ? code.length : end));
      }
    }
  }
  const resolved = new Map();
  const lookup = (name, seen = new Set()) => {
    if (resolved.has(name)) return resolved.get(name);
    const defs = raw.get(name);
    if (!defs || seen.has(name)) return null;
    seen.add(name);
    const values = new Set(defs.map(d => evalString(d.f, d.s, d.e, n => lookup(n, seen))));
    const value = values.size === 1 ? [...values][0] : null;
    resolved.set(name, value);
    return value;
  };
  return { lookup };
}

/** A string expression: literals, constants (`pkg.Name` or `Name`) and `+`. `null` when any part is unknown. */
function evalString(f, s, e, lookupConst) {
  const parts = splitTopLevel(f.code, f.pairs, s, e, '+');
  if (!parts.length) return null;
  let out = '';
  for (const [a, b] of parts) {
    const lit = literalIn(f.code, f.lits, a, b);
    if (typeof lit === 'string') { out += lit; continue; }
    if (lit === null) return null;
    const id = /^(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)$/.exec(f.code.slice(a, b));
    const v = id ? lookupConst(id[1]) : null;
    if (typeof v !== 'string') return null;
    out += v;
  }
  return out;
}

// ── Functions ────────────────────────────────────────────────────────────────

/** `*users.Handler`, `(*Handler, error)`, `Handler[T]` → { pkg, name } of the first type. */
function typeName(text, pkg) {
  let first = String(text || '').trim().replace(/^\(/, '').split(',')[0].trim();
  const named = /^([A-Za-z_]\w*)\s+([*[\]A-Za-z_].*)$/s.exec(first); // a named result: `(r *gin.Engine)`
  if (named && !/^(?:chan|func|map)$/.test(named[1])) first = named[2];
  const m = /^[*&[\]\s]*(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)/.exec(first);
  if (!m) return null;
  return { pkg: m[1] || pkg, name: m[2] };
}

/** Index every named function and method: package, receiver type, parameters, result type, body. */
function indexFunctions(f, funcs) {
  const { code, pairs } = f;
  f.decls = new Set();
  f.literals = [];
  const re = /\bfunc\b/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const i = skipWs(code, m.index + 4);
    let name = null;
    let recvType = null;
    let paramsOpen;
    if (code[i] === '(') {
      // A method receiver, or a function literal's parameter list.
      const close = pairs.get(i);
      if (close == null) continue;
      const j = skipWs(code, close + 1);
      const id = /^[A-Za-z_]\w*/.exec(code.slice(j, j + 128));
      const k = id ? skipWs(code, j + id[0].length) : -1;
      if (id && (code[k] === '(' || code[k] === '[')) {
        name = id[0];
        f.decls.add(j);
        const recv = code.slice(i + 1, close).trim().split(/\s+/).pop();
        recvType = recv ? recv.replace(/^\*/, '').replace(/\[.*$/, '') : null;
        paramsOpen = code[k] === '[' ? skipWs(code, pairs.get(k) + 1) : k;
      } else {
        paramsOpen = i;
      }
    } else {
      const id = /^[A-Za-z_]\w*/.exec(code.slice(i, i + 128));
      if (!id) continue;
      name = id[0];
      f.decls.add(i);
      let k = skipWs(code, i + id[0].length);
      if (code[k] === '[' && pairs.has(k)) k = skipWs(code, pairs.get(k) + 1); // type parameters
      paramsOpen = k;
    }
    if (code[paramsOpen] !== '(' || !pairs.has(paramsOpen)) continue;
    const paramsClose = pairs.get(paramsOpen);
    const bodyOpen = findBodyOpen(code, pairs, paramsClose + 1);
    if (bodyOpen < 0) continue;
    const entry = {
      name, recvType, pkg: f.pkg, dir: f.dir, file: f.file,
      params: parseParams(code.slice(paramsOpen + 1, paramsClose), f.pkg),
      result: typeName(code.slice(paramsClose + 1, bodyOpen), f.pkg),
      bodyOpen,
    };
    if (name) {
      if (!funcs.has(name)) funcs.set(name, []);
      funcs.get(name).push(entry);
    } else {
      f.literals.push(entry);
    }
  }
}

/** The `{` that opens a function body, past a result type (`interface{}` / `struct{}` included). */
function findBodyOpen(code, pairs, i) {
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[') { if (!pairs.has(i)) return -1; i = pairs.get(i); continue; }
    if (c === '{') {
      if (/\b(?:interface|struct)\s*$/.test(code.slice(Math.max(0, i - 12), i))) { if (!pairs.has(i)) return -1; i = pairs.get(i); continue; }
      return pairs.has(i) ? i : -1;
    }
    if (c === '\n' || c === ';' || c === '}' || c === '=' || c === ')') return -1;
  }
  return -1;
}

/** `a, b *gin.RouterGroup, h *users.Handler` → [{ name, index, router, type }]. */
function parseParams(text, pkg) {
  const out = [];
  let pending = [];
  for (const part of text.split(',').map(p => p.trim()).filter(Boolean)) {
    const m = /^([A-Za-z_]\w*)\s+(.+)$/s.exec(part);
    if (m) {
      for (const n of [...pending, m[1]]) out.push({ name: n, router: ROUTER_TYPE.test(m[2]), type: typeName(m[2], pkg) });
      pending = [];
    } else if (/^[A-Za-z_]\w*$/.test(part)) {
      pending.push(part);
    } else {
      pending = []; // unnamed parameters: types only
    }
  }
  return out.map((p, index) => ({ ...p, index }));
}

// ── Walking one file ─────────────────────────────────────────────────────────

function walkFile(f, shared) {
  const { funcs, state } = shared;
  const { code, pairs } = f;

  // The bindings each block opens with: the parameters of declared functions
  // and of literals. A route closure (chi `Route`) later names its
  // parameter's router node.
  const opening = new Map();
  const fnOfBody = new Map();
  for (const list of funcs.values()) {
    for (const fn of list) {
      if (fn.file !== f.file) continue;
      opening.set(fn.bodyOpen, new Map(fn.params.map(p => [p.name, {
        node: p.router ? { kind: 'param', fn, index: p.index } : null, type: p.type,
      }])));
      fnOfBody.set(fn.bodyOpen, fn);
    }
  }
  for (const lit of f.literals) {
    opening.set(lit.bodyOpen, new Map(lit.params.map(p => [p.name, { node: null, type: p.type }])));
    fnOfBody.set(lit.bodyOpen, null);
  }

  const events = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{' || code[i] === '}') events.push({ pos: i, type: code[i] });
  }
  let m;
  const call = /\.\s*([A-Za-z_]\w*)\s*\(/g;
  while ((m = call.exec(code)) !== null) {
    if (ROUTE_CALLS.has(m[1])) events.push({ pos: m.index, type: 'route', name: m[1], open: m.index + m[0].length - 1 });
  }
  // `x := …`, `x = …`, `s.field = …`; not `a, b := …` (the first value is a's).
  const assign = /(?<![\w.])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*(:=|=)(?!=)/g;
  while ((m = assign.exec(code)) !== null) {
    if (/,\s*$/.test(code.slice(Math.max(0, m.index - 8), m.index))) continue;
    events.push({ pos: m.index, type: 'assign', target: m[1], op: m[2], rhs: m.index + m[0].length });
  }
  const varDecl = /\bvar\s+([A-Za-z_]\w*)\s+([^=\n;]+?)\s*=(?!=)/g;
  while ((m = varDecl.exec(code)) !== null) {
    events.push({ pos: m.index + 4, type: 'assign', target: m[1], op: ':=', rhs: m.index + m[0].length, declared: m[2] });
  }
  const callee = /\b([A-Za-z_]\w*)\s*\(/g;
  while ((m = callee.exec(code)) !== null) {
    if (funcs.has(m[1]) && !f.decls.has(m.index) && !ROUTE_CALLS.has(m[1])) {
      events.push({ pos: m.index, type: 'call', name: m[1], open: m.index + m[0].length - 1 });
    }
  }
  const ret = /\breturn\b/g;
  while ((m = ret.exec(code)) !== null) events.push({ pos: m.index, type: 'return', start: m.index + 6 });
  events.sort((a, b) => a.pos - b.pos);

  const frames = [{ vars: new Map(), fn: undefined }];
  const ctx = {
    f, shared,
    lookup(name) {
      for (let k = frames.length - 1; k >= 0; k--) {
        if (frames[k].vars.has(name)) return frames[k].vars.get(name);
      }
      return null;
    },
    strOf: ([s, e]) => evalString(f, s, e, shared.consts.lookup),
    opening,
  };

  for (const ev of events) {
    if (ev.type === '{') {
      frames.push({ vars: opening.get(ev.pos) || new Map(), fn: fnOfBody.has(ev.pos) ? fnOfBody.get(ev.pos) : undefined });
    } else if (ev.type === '}') {
      if (frames.length > 1) frames.pop();
    } else if (ev.type === 'assign') {
      const [s, e] = exprRange(code, pairs, ev.rhs);
      const node = s < e ? evalExpr(ctx, s, e) : null;
      if (ev.target.includes('.')) {
        if (node) {
          const field = ev.target.split('.')[1];
          if (!state.fields.has(field)) state.fields.set(field, []);
          state.fields.get(field).push(node);
        }
        continue;
      }
      const binding = { node, type: (ev.declared ? typeName(ev.declared, f.pkg) : null) || (s < e ? typeOfExpr(ctx, s, e) : null) };
      let frame = frames[frames.length - 1];
      if (ev.op === '=') {
        for (let k = frames.length - 1; k >= 0; k--) if (frames[k].vars.has(ev.target)) { frame = frames[k]; break; }
      }
      frame.vars.set(ev.target, binding);
    } else if (ev.type === 'return') {
      let fn;
      for (let k = frames.length - 1; k >= 0; k--) if (frames[k].fn !== undefined) { fn = frames[k].fn; break; }
      if (!fn) continue;
      const [s, e] = exprRange(code, pairs, ev.start);
      const node = s < e ? evalExpr(ctx, s, e) : null;
      if (node) {
        if (!state.rets.has(fn)) state.rets.set(fn, []);
        state.rets.get(fn).push(node);
      }
    } else if (ev.type === 'call') {
      const close = pairs.get(ev.open);
      if (close == null) continue;
      const dot = /\.\s*$/.exec(code.slice(Math.max(0, ev.pos - 16), ev.pos));
      const dotPos = dot ? ev.pos - dot[0].length : -1;
      const targets = calleesOf(ctx, ev.name, dotPos);
      if (targets === AMBIGUOUS) {
        for (const fn of funcs.get(ev.name)) for (const p of fn.params) if (p.router) addEdge(state, fn, p.index, UNRESOLVED);
        continue;
      }
      const args = splitTopLevel(code, pairs, ev.open + 1, close);
      for (const fn of targets) {
        for (const p of fn.params) {
          if (!p.router || !args[p.index]) continue;
          addEdge(state, fn, p.index, evalExpr(ctx, ...args[p.index]) || UNKNOWN);
        }
      }
    } else if (ev.type === 'route') {
      routeCall(ctx, ev);
    }
  }
}

function addEdge(state, fn, index, node) {
  if (!state.edges.has(fn)) state.edges.set(fn, new Map());
  const byIndex = state.edges.get(fn);
  if (!byIndex.has(index)) byIndex.set(index, []);
  byIndex.get(index).push(node);
}

/**
 * The functions a call `name(…)` (dotPos < 0) or `recv.name(…)` can invoke:
 * a bare call stays in its package (directory); `pkg.name` looks in that
 * package; a method call is narrowed by the receiver's type when it can be
 * read. More than one candidate left is AMBIGUOUS.
 */
function calleesOf(ctx, name, dotPos) {
  const { f, shared } = ctx;
  const all = shared.funcs.get(name) || [];
  const plain = all.filter(fn => !fn.recvType);
  const methods = all.filter(fn => fn.recvType);
  const one = list => (list.length <= 1 ? list : AMBIGUOUS);
  if (dotPos < 0) return one(plain.filter(fn => fn.dir === f.dir));
  const start = chainStart(f.code, f.pairs, dotPos);
  if (start < 0) return [];
  const recvText = f.code.slice(start, dotPos).trim();
  if (/^[A-Za-z_]\w*$/.test(recvText) && !ctx.lookup(recvText) && shared.packages.has(recvText)) {
    return one(plain.filter(fn => fn.pkg === recvText));
  }
  const type = typeOfExpr(ctx, start, dotPos);
  if (type) {
    const hit = methods.filter(fn => fn.recvType === type.name && (!type.pkg || fn.pkg === type.pkg));
    if (hit.length) return one(hit);
  }
  return one(methods);
}

/** The type of a receiver expression, when it can be read: a typed variable, a constructor call, a composite literal. */
function typeOfExpr(ctx, s, e) {
  const { f, shared } = ctx;
  [s, e] = trimRange(f.code, s, e);
  const text = f.code.slice(s, e);
  const lit = /^&?\s*(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\s*\{/.exec(text);
  if (lit && !/^(?:func|map|struct|interface)$/.test(lit[2])) return { pkg: lit[1] || f.pkg, name: lit[2] };
  const nw = /^new\s*\(\s*\*?(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\s*\)$/.exec(text);
  if (nw) return { pkg: nw[1] || f.pkg, name: nw[2] };
  const segs = parseChain(f.code, f.pairs, s, e);
  if (!segs) return null;
  if (segs.length === 1 && !segs[0].args) {
    const b = ctx.lookup(segs[0].name);
    return b ? b.type : null;
  }
  let fnName = null;
  let pkg = null;
  if (segs.length === 1 && segs[0].args) fnName = segs[0].name;
  else if (segs.length === 2 && !segs[0].args && segs[1].args && !ctx.lookup(segs[0].name) && shared.packages.has(segs[0].name)) {
    pkg = segs[0].name;
    fnName = segs[1].name;
  }
  if (!fnName) return null;
  const cands = (shared.funcs.get(fnName) || []).filter(fn => !fn.recvType && (pkg ? fn.pkg === pkg : fn.dir === f.dir));
  return cands.length === 1 ? cands[0].result : null;
}

/** The extent of the expression starting at `s`: to the end of its statement or its first top-level `,`. */
function exprRange(code, pairs, s) {
  let i = s;
  for (; i < code.length; i++) {
    const c = code[i];
    if ((c === '(' || c === '[' || c === '{') && pairs.has(i)) {
      // A `{` after a complete expression opens a block (`if x := …; ok {`),
      // except a composite literal's (`&T{…}`, `[]string{…}`).
      if (c === '{' && /[\w)\]]\s*$/.test(code.slice(s, i)) && !/^\s*&?\s*[\w.[\]*]+\s*$/.test(code.slice(s, i))) break;
      i = pairs.get(i);
      continue;
    }
    if (c === '\n') {
      if (/\.\s*$/.test(code.slice(s, i))) continue; // `r.\n  Group(…)`
      break;
    }
    if (c === ';' || c === ',' || c === '}' || c === ')' || c === ']') break;
  }
  return trimRange(code, s, i);
}

function skipWs(code, i) {
  while (i < code.length && /\s/.test(code[i])) i++;
  return i;
}

/** Parse `a.b(…).c` into segments; `null` when `[s, e)` is not exactly such a chain. */
function parseChain(code, pairs, s, e) {
  [s, e] = trimRange(code, s, e);
  const segs = [];
  let i = s;
  while (i < e) {
    const id = /^[A-Za-z_]\w*/.exec(code.slice(i, Math.min(e, i + 256)));
    if (!id) return null;
    const seg = { name: id[0], args: null, start: i };
    i = skipWs(code, i + id[0].length);
    if (i < e && code[i] === '(') {
      const close = pairs.get(i);
      if (close == null || close >= e) return null;
      seg.args = [i + 1, close];
      i = skipWs(code, close + 1);
    }
    segs.push(seg);
    if (i >= e) break;
    if (code[i] !== '.') return null;
    seg.dot = i;
    i = skipWs(code, i + 1);
  }
  return segs.length ? segs : null;
}

/** Where the receiver chain ending just before the `.` at `dot` starts; -1 when there is none. */
function chainStart(code, pairs, dot) {
  let i = dot - 1;
  let start = -1;
  for (;;) {
    while (i >= 0 && /\s/.test(code[i])) i--;
    if (code[i] === ')') {
      const open = pairs.get(i);
      if (open == null) return -1;
      i = open - 1;
      while (i >= 0 && /\s/.test(code[i])) i--;
    }
    let j = i;
    while (j >= 0 && /\w/.test(code[j])) j--;
    if (j === i) return start;
    start = j + 1;
    i = j;
    while (i >= 0 && /\s/.test(code[i])) i--;
    if (code[i] === '.') { i--; continue; }
    return start;
  }
}

/**
 * The router node an expression denotes, or `null` when it is not a router
 * expression.
 */
function evalExpr(ctx, s, e) {
  const { f, shared } = ctx;
  const segs = parseChain(f.code, f.pairs, s, e);
  if (!segs) return null;
  let node;
  let k = 1;
  const [a, b] = segs;
  const bound = !a.args ? ctx.lookup(a.name) : null;
  const callNode = (name, dotPos) => {
    const fns = calleesOf(ctx, name, dotPos);
    if (fns === AMBIGUOUS) return UNRESOLVED;
    return fns.length ? { kind: 'ret', fns } : null;
  };
  if (!a.args && b && b.args && ROOT_CONSTRUCTORS.has(`${a.name}.${b.name}`) && !bound) {
    node = { kind: 'root' };
    k = 2;
  } else if (!a.args && b && !b.args && a.name === 'http' && b.name === 'DefaultServeMux') {
    node = shared.state.defaultMux;
    k = 2;
  } else if (bound && bound.node) {
    node = bound.node;
  } else if (a.args && shared.funcs.has(a.name)) {
    node = callNode(a.name, -1);
  } else if (!a.args && b && b.args && shared.funcs.has(b.name)) {
    node = callNode(b.name, a.dot);
    k = 2;
  } else if (!a.args && b && !b.args) {
    node = { kind: 'field', name: b.name };
    k = 2;
  } else if (!a.args) {
    node = UNKNOWN;
  } else {
    return null;
  }
  if (!node) return null;
  for (; k < segs.length; k++) {
    const seg = segs[k];
    if (!seg.args) return null;
    const args = splitTopLevel(f.code, f.pairs, seg.args[0], seg.args[1]);
    if (seg.name === 'Group' || seg.name === 'PathPrefix' || seg.name === 'Route') {
      if (seg.name === 'Group' && args[0] && /^func\b/.test(f.code.slice(...args[0]))) continue; // chi Group(func…): same prefix
      const prefix = args[0] ? ctx.strOf(args[0]) : null;
      node = typeof prefix === 'string' ? { kind: 'child', parent: node, prefix } : UNRESOLVED;
    } else if (!PASS_THROUGH.has(seg.name)) {
      return null;
    }
  }
  return node;
}

/** The parameter name and body `{` of a `func(name T) {` literal. */
function closureOf(code, pairs, [s, e]) {
  const m = /^func\s*\(\s*([A-Za-z_]\w*)\s+[^)]*\)\s*/.exec(code.slice(s, e));
  if (!m) return null;
  const open = s + m[0].length;
  return code[open] === '{' && pairs.has(open) ? { name: m[1], open } : null;
}

/** An HTTP method from `"GET"` or `http.MethodGet`. */
function methodOf(ctx, range) {
  const lit = literalIn(ctx.f.code, ctx.f.lits, ...range);
  const m = typeof lit === 'string'
    ? lit.toUpperCase()
    : METHOD_CONSTANTS.get(ctx.f.code.slice(...range).trim().replace(/^http\./, ''));
  return UPPER_VERBS.has(m) ? m : null;
}

function handlerOf(code, range) {
  if (!range) return '';
  const t = code.slice(...range).trim();
  return /^[A-Za-z_][\w.]*$/.test(t) ? t : '';
}

/** A Go 1.22 ServeMux pattern: `[METHOD ][HOST]/path`, `{name...}`, `{$}`. */
function parseMuxPattern(pattern) {
  const m = /^([A-Z]+)\s+(.*)$/.exec(pattern);
  const method = m ? m[1] : 'ANY';
  if (m && !UPPER_VERBS.has(method)) return null;
  let rest = m ? m[2] : pattern;
  if (!rest.startsWith('/')) {
    const host = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|localhost|\{[A-Za-z_]\w*\})(?::\d+)?(?=\/)/.exec(rest);
    if (!host) return null;
    rest = rest.slice(host[0].length);
  }
  rest = rest.replace(/\{\$\}$/, '');
  return { method, path: rest || '/' };
}

function routeCall(ctx, ev) {
  const { f, shared } = ctx;
  const { state } = shared;
  const { code, pairs } = f;
  const close = pairs.get(ev.open);
  if (close == null) return;
  const start = chainStart(code, pairs, ev.pos);
  if (start < 0) return;
  const recvText = code.slice(start, ev.pos).trim();
  const args = splitTopLevel(code, pairs, ev.open + 1, close);
  const name = ev.name;
  const strOf = ctx.strOf;
  let recv;
  if (recvText === 'http' && !ctx.lookup('http')) {
    // net/http's package functions: HandleFunc/Handle register on the default
    // mux; Get/Post/Head are HTTP *client* calls.
    if (name !== 'HandleFunc' && name !== 'Handle') return;
    recv = state.defaultMux;
  } else {
    recv = evalExpr(ctx, start, ev.pos);
  }
  if (!recv) return;
  const last = args[args.length - 1];
  const add = (methods, path, handlerRange, extra = {}) => {
    if (typeof path !== 'string') return; // FR-006: not literal → omitted
    if (path !== '' && !path.startsWith('/')) return;
    state.records.push({
      node: recv, methods, path, handler: handlerOf(code, handlerRange), file: f.file, auth: AUTH.test(f.src), ...extra,
    });
  };

  if (UPPER_VERBS.has(name)) return add([name], args[0] && strOf(args[0]), last, { emptyNeedsKnown: true });
  if (CAP_VERBS.has(name)) return add([CAP_VERBS.get(name)], args[0] && strOf(args[0]), last, { requireKnown: true });
  if (name === 'Any') return add(['ANY'], args[0] && strOf(args[0]), last, { emptyNeedsKnown: true });
  if (name === 'All') return add(['ANY'], args[0] && strOf(args[0]), last, { requireKnown: true });
  if (name === 'Match') {
    if (args.length < 2) return;
    const brace = code.slice(...args[0]).search(/^\[\]string\s*\{/) === 0 ? args[0][0] + code.slice(...args[0]).indexOf('{') : -1;
    if (brace < 0 || !pairs.has(brace)) return;
    const methods = splitTopLevel(code, pairs, brace + 1, pairs.get(brace)).map(r => methodOf(ctx, r));
    if (!methods.length || !methods.every(Boolean)) return;
    return add(methods, strOf(args[1]), last, { requireKnown: true });
  }
  if (name === 'Add' || name === 'Method' || name === 'MethodFunc') {
    const method = args.length >= 2 ? methodOf(ctx, args[0]) : null;
    if (!method) return;
    return add([method], strOf(args[1]), last, { requireKnown: true });
  }
  if (name === 'Handle' || name === 'HandleFunc') {
    if (!args.length) return;
    // gin: Handle("GET", "/path", h)
    const method = args.length >= 3 ? methodOf(ctx, args[0]) : null;
    if (method) return add([method], strOf(args[1]), last);
    const pattern = strOf(args[0]);
    if (typeof pattern !== 'string') return;
    const parsed = parseMuxPattern(pattern);
    if (!parsed) return;
    const target = args[1];
    if (name === 'Handle' && target) {
      // mux.Handle("/api/", http.StripPrefix("/api", apiMux)) mounts apiMux at /api.
      const segs = parseChain(code, pairs, ...target);
      if (segs && segs.length === 2 && segs[0].name === 'http' && segs[1].name === 'StripPrefix' && segs[1].args) {
        const inner = splitTopLevel(code, pairs, ...segs[1].args);
        const sub = inner[1] ? evalExpr(ctx, ...inner[1]) : null;
        if (sub && sub !== UNKNOWN) {
          state.mounts.push({ target: sub, parent: recv, prefix: inner[0] ? strOf(inner[0]) : null });
          return;
        }
      }
      // A sub-mux handed the full path is not itself a route.
      return add([parsed.method], parsed.path, target, { unlessRouter: evalExpr(ctx, ...target) });
    }
    // gorilla: HandleFunc("/x", h).Methods("GET", …)
    const chained = /^\s*\.\s*Methods\s*\(/.exec(code.slice(close + 1, close + 64));
    if (chained) {
      const mOpen = close + chained[0].length;
      const list = splitTopLevel(code, pairs, mOpen + 1, pairs.get(mOpen)).map(r => methodOf(ctx, r));
      if (list.length && list.every(Boolean)) return add(list, parsed.path, target);
    }
    return add([parsed.method], parsed.path, target);
  }
  if (name === 'Mount') {
    if (args.length < 2) return;
    const sub = evalExpr(ctx, ...args[1]);
    if (sub && sub !== UNKNOWN) state.mounts.push({ target: sub, parent: recv, prefix: strOf(args[0]) });
    return;
  }
  // chi / fiber closures: Route("/x", func(r chi.Router) {…}), Group(func(r chi.Router) {…}).
  if (name === 'Group' && args[0] && literalIn(code, f.lits, ...args[0]) !== undefined) return; // Group("/x") is an expression
  const fnArg = name === 'Route' ? args[1] : args[0];
  if (!fnArg) return;
  let node = recv;
  if (name === 'Route') {
    const prefix = args[0] ? strOf(args[0]) : null;
    node = typeof prefix === 'string' ? { kind: 'child', parent: recv, prefix } : UNRESOLVED;
  }
  const closure = closureOf(code, pairs, fnArg);
  if (closure) {
    if (!ctx.opening.has(closure.open)) ctx.opening.set(closure.open, new Map());
    ctx.opening.get(closure.open).set(closure.name, { node, type: null });
    return;
  }
  const fnName = /^[A-Za-z_]\w*$/.exec(code.slice(...fnArg).trim());
  if (fnName) {
    const fns = calleesOf(ctx, fnName[0], -1);
    if (fns !== AMBIGUOUS) for (const fn of fns) addEdge(state, fn, 0, node);
  }
}

// ── Resolution ───────────────────────────────────────────────────────────────

function resolve(state) {
  const deref = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return [];
    seen.add(node);
    if (node.kind === 'ret') return node.fns.flatMap(fn => (state.rets.get(fn) || []).flatMap(n => deref(n, seen)));
    if (node.kind === 'field') return (state.fields.get(node.name) || []).flatMap(n => deref(n, seen));
    return [node];
  };
  const mountsOf = new Map();
  for (const mt of state.mounts) {
    for (const target of deref(mt.target)) {
      if (target.kind !== 'root') continue;
      if (!mountsOf.has(target)) mountsOf.set(target, []);
      mountsOf.get(target).push(mt);
    }
  }
  const memo = new Map();
  const prefixes = (node, visiting = new Set()) => {
    if (memo.has(node)) return memo.get(node);
    if (visiting.has(node)) return [''];
    visiting.add(node);
    let out;
    switch (node.kind) {
      case 'root': {
        const mounts = mountsOf.get(node);
        out = mounts
          ? mounts.flatMap(mt => (typeof mt.prefix === 'string' ? prefixes(mt.parent, visiting).map(p => joinRoutePath(p, mt.prefix)) : []))
          : [''];
        break;
      }
      case 'child':
        out = prefixes(node.parent, visiting).map(p => joinRoutePath(p, node.prefix));
        break;
      case 'param': {
        const callers = state.edges.get(node.fn)?.get(node.index) || [];
        out = callers.length ? callers.flatMap(n => prefixes(n, visiting)) : [''];
        break;
      }
      case 'ret':
      case 'field': {
        const targets = deref(node);
        out = targets.length ? targets.flatMap(n => prefixes(n, visiting)) : [''];
        break;
      }
      case 'unresolved':
        out = [];
        break;
      default:
        out = [''];
    }
    out = [...new Set(out)].slice(0, MAX_PREFIXES);
    visiting.delete(node);
    if (!visiting.size) memo.set(node, out);
    return out;
  };
  const known = node => deref(node).some(n => n.kind !== 'unknown');
  const isRouter = node => !!node && deref(node).some(n => n.kind === 'root' || n.kind === 'child');

  const routes = [];
  const seen = new Set();
  for (const r of state.records) {
    if (r.requireKnown && !known(r.node)) continue;
    if (r.emptyNeedsKnown && r.path === '' && !known(r.node)) continue;
    if (r.unlessRouter && isRouter(r.unlessRouter)) continue;
    for (const prefix of prefixes(r.node)) {
      const path = joinRoutePath(prefix, r.path) || '/';
      for (const method of r.methods) {
        const key = `${method} ${path} ${r.file}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ method, path, handler: r.handler, file: r.file, auth: r.auth });
      }
    }
  }
  return routes;
}
