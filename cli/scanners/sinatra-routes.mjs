/**
 * Sinatra route reader: classic and modular apps, sinatra-contrib namespaces,
 * extensions, and the prefixes `config.ru` mounts each app under.
 *
 * A Sinatra route is a verb call with a block (`get '/x' do … end`). Where it
 * is served depends on what surrounds it: the app it belongs to (the top level
 * of a classic app, or a class whose superclass chain reaches
 * `Sinatra::Base`), the `namespace` blocks around it, an extension module
 * whose `self.registered(app)` hook adds it, and the `map` block of
 * `config.ru` (or the `Rack::URLMap`) that mounts the app, or the host app
 * that `use`s it. Classes inherit across files, so apps are resolved once
 * every file is read.
 *
 * The reader tokenizes Ruby (strings with interpolation, `%` literals, regex
 * literals, heredocs, symbols, comments) and walks statements and blocks. A
 * path or prefix that is not literal text (an interpolated string, a regex, a
 * constant) is omitted and recorded in `omitted`, never guessed.
 *
 * @implements docguard.more-route-frameworks#FR-001
 * @implements docguard.more-route-frameworks#FR-005
 */

import { joinRoutePath } from './route-lexing.mjs';

const VERBS = new Map([
  ['get', 'GET'], ['post', 'POST'], ['put', 'PUT'], ['patch', 'PATCH'], ['delete', 'DELETE'],
  ['head', 'HEAD'], ['options', 'OPTIONS'], ['link', 'LINK'], ['unlink', 'UNLINK'],
]);
const KEYWORDS = new Set([
  'do', 'end', 'if', 'unless', 'while', 'until', 'for', 'case', 'begin', 'def', 'class', 'module',
  'then', 'else', 'elsif', 'when', 'in', 'rescue', 'ensure', 'return', 'yield', 'and', 'or', 'not',
]);
/** Keywords that open a block closed by `end` when they start an expression. */
const OPENERS = new Set(['if', 'unless', 'while', 'until', 'for', 'case', 'begin', 'def', 'class', 'module']);
const SINATRA_BASES = new Set(['Sinatra::Base', 'Sinatra::Application']);
const AUTH = /\b(?:authenticate\w*|authoriz\w*|protected!|require_(?:login|user|auth)\w*|login_required|warden|current_user!|halt\s*\(?\s*40[13])/;
const MAX_DEPTH = 64;

/**
 * Read the Sinatra routes of a project.
 * @param {Array<{ file: string, content: string }>} sources  `.rb` files and `config.ru`, project-relative paths
 * @returns {Array<{ method: string, path: string, handler: string, file: string, line: number, auth: boolean }> & { omitted: Array<{ file: string, line: number, reason: string }> }}
 */
export function extractSinatraRoutes(sources) {
  const model = {
    classes: new Map(), // full name → { name, superRef, file, items: [] }
    modules: new Map(), // full name → { items: [] } (extension routes from self.registered)
    classic: { items: [] }, // top-level routes
    mounts: [], // { ref, prefix } from config.ru / Rack::URLMap
    unknownMount: false,
  };
  for (const s of sources || []) {
    if (!s || typeof s.content !== 'string') continue;
    try {
      const w = new Walker(tokenize(s.content), s.file, model);
      w.body({ kind: 'top', owner: model.classic, prefix: [], recv: null, ns: [] });
    } catch { /* an unreadable file yields no routes */ }
  }
  return resolve(model);
}

// ── Tokens ───────────────────────────────────────────────────────────────────

const PAIRS = { '[': ']', '(': ')', '{': '}', '<': '>' };

function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const heredocs = [];
  const push = (t, v, extra = {}) => toks.push({ t, v, line, sp: i > 0 && /\s/.test(src[i - 1]), ...extra });
  const prev = () => toks[toks.length - 1];
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      push('nl');
      i++;
      line++;
      // Heredoc bodies start on the line after their opener.
      while (heredocs.length) {
        const { id, squiggly } = heredocs.shift();
        while (i < n) {
          const end = src.indexOf('\n', i);
          const text = src.slice(i, end < 0 ? n : end);
          i = end < 0 ? n : end + 1;
          line++;
          if ((squiggly ? text.trim() : text) === id) break;
        }
      }
      continue;
    }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    // `__END__` ends the program; what follows (often inline templates) is data.
    if (c === '_' && (i === 0 || src[i - 1] === '\n') && /^__END__\s*(?:\n|$)/.test(src.slice(i, i + 9))) break;
    if (c === '=' && src.startsWith('=begin', i) && (i === 0 || src[i - 1] === '\n')) {
      const end = src.indexOf('\n=end', i);
      const stop = end < 0 ? n : end + 5;
      line += (src.slice(i, stop).match(/\n/g) || []).length;
      i = stop;
      continue;
    }
    const hd = /^<<([~-]?)(["'`]?)([A-Za-z_]\w*)\2/.exec(src.slice(i, i + 80));
    if (hd && (!prev() || ['(', ',', 'op', 'nl', 'ident'].includes(prev().t) || prev().t === 'kw')) {
      heredocs.push({ id: hd[3], squiggly: hd[1] !== '' });
      push('str', null);
      i += hd[0].length;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const r = readQuoted(src, i + 1, c, c, c !== "'");
      push('str', r.value);
      line += r.lines;
      i = r.end;
      continue;
    }
    if (c === '%' && /[qQwWiIr]?[[({<|!/]/.test(src.slice(i + 1, i + 3)) && valueContext(prev(), src, i)) {
      let k = i + 1;
      let kind = 'Q';
      if (/[qQwWiIr]/.test(src[k])) kind = src[k++];
      const open = src[k];
      const close = PAIRS[open] || open;
      const r = readQuoted(src, k + 1, open, close, /[QWIr]/.test(kind));
      line += r.lines;
      i = r.end;
      if (kind === 'r') push('regex');
      else if (/[wWiI]/.test(kind)) push('words', r.value === null ? [] : r.value.split(/\s+/).filter(Boolean));
      else push('str', r.value);
      continue;
    }
    if (c === '/' && valueContext(prev(), src, i)) {
      const r = readQuoted(src, i + 1, '/', '/', true);
      line += r.lines;
      i = r.end;
      while (/[a-z]/.test(src[i] || '')) i++;
      push('regex');
      continue;
    }
    if (c === ':' && (src[i + 1] === '"' || src[i + 1] === "'")) {
      const r = readQuoted(src, i + 2, src[i + 1], src[i + 1], src[i + 1] === '"');
      push('sym', r.value);
      i = r.end;
      continue;
    }
    if (c === ':' && /[A-Za-z_]/.test(src[i + 1] || '') && src[i - 1] !== ':') {
      const m = /^[A-Za-z_]\w*[?!=]?/.exec(src.slice(i + 1, i + 130));
      push('sym', m[0]);
      i += 1 + m[0].length;
      continue;
    }
    if (/[A-Za-z_@$]/.test(c)) {
      let m = /^[@$]*[A-Za-z_]\w*[?!]?/.exec(src.slice(i, i + 130))[0];
      let j = i + m.length;
      if (src[j] === ':' && src[j + 1] !== ':' && !/[@$]/.test(m[0])) { push('label', m.replace(/[?!]$/, '')); i = j + 1; continue; }
      while (src[j] === ':' && src[j + 1] === ':' && /[A-Za-z_]/.test(src[j + 2] || '')) {
        const more = /^[A-Za-z_]\w*/.exec(src.slice(j + 2, j + 130))[0];
        m += '::' + more;
        j += 2 + more.length;
      }
      const isKw = KEYWORDS.has(m) && !(prev() && prev().t === '.');
      push(isKw ? 'kw' : 'ident', m);
      i = j;
      continue;
    }
    if (c === ':' && src[i + 1] === ':') { i += 2; continue; } // `::Const`
    if (c === '=' && src[i + 1] === '>') { push('arrow'); i += 2; continue; }
    if (c === '-' && src[i + 1] === '>') { push('lambda'); i += 2; continue; }
    if (c === '&' && src[i + 1] === '.') { push('.'); i += 2; continue; }
    if ('()[]{},.|;'.includes(c)) { push(c); i++; continue; }
    if (/[0-9]/.test(c)) { const m = /^[0-9][\w.]*/.exec(src.slice(i, i + 64))[0]; push('num', m); i += m.length; continue; }
    const op = /^(?:\*\*|&&|\|\||<=>|===?|!=|<=|>=|<<|>>|\+=|-=|\|\|=|&&=|[-+*%=<>!&^~?:])/.exec(src.slice(i, i + 4));
    push('op', op ? op[0] : c);
    i += op ? op[0].length : 1;
  }
  push('nl');
  push('eof');
  return toks;
}

/** A `/` or `%` starts a literal (not division or modulo) where a value is expected. */
function valueContext(p, src, i) {
  if (!p) return true;
  if (['(', ',', '[', '{', '|', 'nl', ';', 'arrow', 'op', 'label', 'kw'].includes(p.t)) return true;
  // `get /x/ do` vs `a / b`: a value follows an identifier when the operator
  // is spaced before and not after.
  if (p.t === 'ident') return /\s/.test(src[i - 1] || '') && !/\s/.test(src[i + 1] || '');
  return false;
}

/** A quoted body from `i` (just past the opener) to its closer; `value` is null when it interpolates. */
function readQuoted(src, i, open, close, interpolates) {
  let j = i;
  let value = '';
  let depth = 1;
  let dynamic = false;
  let lines = 0;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') { value += src[j + 1] || ''; if (src[j + 1] === '\n') lines++; j += 2; continue; }
    if (ch === '\n') lines++;
    if (interpolates && ch === '#' && src[j + 1] === '{') {
      dynamic = true;
      let d = 0;
      for (; j < src.length; j++) {
        if (src[j] === '{') d++;
        else if (src[j] === '}' && --d === 0) { j++; break; }
        else if (src[j] === '\n') lines++;
      }
      continue;
    }
    if (open !== close && ch === open) depth++;
    else if (ch === close && --depth === 0) break;
    value += ch;
    j++;
  }
  return { value: dynamic ? null : value, end: j + 1, lines };
}

// ── Statements ───────────────────────────────────────────────────────────────

class Walker {
  constructor(toks, file, model) {
    this.toks = toks;
    this.file = file;
    this.model = model;
    this.i = 0;
    this.limit = toks.length - 1;
    this.depth = 0;
  }

  peek(k = 0) { return this.toks[Math.min(this.i + k, this.limit)]; }
  atEnd() { return this.i >= this.limit; }
  next() { const t = this.peek(); if (!this.atEnd()) this.i++; return t; }
  is(t, v) { const tok = this.peek(); return tok.t === t && (v === undefined || tok.v === v); }

  /** Statements until the `end` (or `}`) closing this body, which is consumed. */
  body(scope, closer = 'end') {
    if (++this.depth > MAX_DEPTH) { this.depth--; this.skipBlock(closer); return; }
    while (!this.atEnd()) {
      const tok = this.peek();
      if (tok.t === 'nl' || tok.t === ';') { this.next(); continue; }
      if (closer === 'end' && tok.t === 'kw' && tok.v === 'end') { this.next(); break; }
      if (closer === '}' && tok.t === '}') { this.next(); break; }
      this.statement(scope);
    }
    this.depth--;
  }

  statement(scope) {
    const tok = this.peek();
    if (tok.t === 'kw') {
      if (tok.v === 'class') return this.classDef(scope);
      if (tok.v === 'module') return this.moduleDef(scope);
      if (tok.v === 'def') return this.def(scope);
      if (['if', 'unless', 'while', 'until', 'case', 'begin', 'for'].includes(tok.v)) {
        // A conditional's branches are routes like any other.
        this.next();
        this.skipLine(true);
        this.body(scope);
        return;
      }
      if (['else', 'elsif', 'when', 'in', 'rescue', 'ensure', 'then'].includes(tok.v)) { this.next(); this.skipLine(true); return; }
      this.skipStatement();
      return;
    }
    if (tok.t === 'ident') {
      // `Name = Sinatra.new do` / `Name = Class.new(Sinatra::Base) do`
      if (/^[A-Z]/.test(tok.v) && this.peek(1).t === 'op' && this.peek(1).v === '=') return this.constAssign(scope);
      return this.call(scope);
    }
    this.skipStatement();
  }

  qualify(scope, name) {
    if (name.includes('::') || !scope.ns.length) return name;
    return [...scope.ns, name].join('::');
  }

  classDef(scope) {
    const kw = this.next();
    if (this.is('op', '<<')) { this.skipStatement(true); return; } // class << self … end
    const name = this.peek().t === 'ident' ? this.next().v : null;
    let superRef = null;
    if (this.is('op', '<')) {
      this.next();
      if (this.peek().t === 'ident') superRef = this.next().v;
    }
    this.skipLine(false);
    if (!name) { this.body({ ...scope, kind: 'skip', owner: null }); return; }
    const full = this.qualify(scope, name);
    const cls = this.model.classes.get(full) || { name: full, superRef: null, file: this.file, line: kw.line, items: [], ns: scope.ns };
    if (superRef) { cls.superRef = superRef; cls.ns = scope.ns; }
    this.model.classes.set(full, cls);
    this.body({ kind: 'class', owner: cls, prefix: [], recv: null, ns: [...scope.ns, ...name.split('::')] });
  }

  moduleDef(scope) {
    this.next();
    const name = this.peek().t === 'ident' ? this.next().v : null;
    this.skipLine(false);
    const ns = name ? [...scope.ns, ...name.split('::')] : scope.ns;
    this.body({ kind: 'module', owner: null, prefix: [], recv: null, ns, module: name ? ns.join('::') : null });
  }

  def(scope) {
    this.next();
    // `def self.registered(app)` in a module is an extension hook.
    const parts = [];
    while (this.peek().t === 'ident' || this.peek().t === '.' || this.peek().t === 'kw') {
      if (this.peek().t === 'nl') break;
      parts.push(this.next().v ?? '.');
      if (this.peek().t === '(' || this.peek().t === 'nl' || this.peek().t === ';' || this.peek().t === 'op') break;
    }
    let params = [];
    if (this.is('(')) {
      this.next();
      while (!this.atEnd() && !this.is(')')) { const t = this.next(); if (t.t === 'ident') params.push(t.v); }
      this.next();
    } else {
      while (!this.atEnd() && !this.is('nl') && !this.is(';') && !this.is('op', '=')) { const t = this.next(); if (t.t === 'ident') params.push(t.v); }
    }
    if (this.is('op', '=')) { this.skipStatement(); return; } // an endless method has no `end`
    const sig = parts.join('');
    if (scope.kind === 'module' && scope.module && /^self\.?registered$/.test(sig) && params.length) {
      if (!this.model.modules.has(scope.module)) this.model.modules.set(scope.module, { items: [] });
      this.body({ kind: 'ext', owner: this.model.modules.get(scope.module), prefix: [], recv: params[0], ns: scope.ns });
      return;
    }
    this.body({ ...scope, kind: 'skip', owner: null });
  }

  constAssign(scope) {
    const name = this.next().v;
    this.next(); // =
    const start = this.i;
    const head = this.peek();
    let isApp = false;
    if (head.t === 'ident' && head.v === 'Sinatra' && this.peek(1).t === '.' && this.peek(2).v === 'new') isApp = true;
    if (head.t === 'ident' && head.v === 'Class' && this.peek(1).t === '.' && this.peek(2).v === 'new' && this.peek(3).t === '(' && this.peek(4).t === 'ident') {
      isApp = SINATRA_BASES.has(this.peek(4).v) ? true : this.peek(4).v;
    }
    if (!isApp) { this.i = start; this.skipStatement(); return; }
    // Find the block on this statement.
    while (!this.atEnd() && !this.is('nl') && !this.is('kw', 'do') && !this.is('{')) {
      if (this.is('(')) this.skipBracket(); else this.next();
    }
    const full = this.qualify(scope, name);
    const cls = { name: full, superRef: isApp === true ? 'Sinatra::Base' : isApp, file: this.file, line: head.line, items: [], ns: scope.ns };
    this.model.classes.set(full, cls);
    const inner = { kind: 'class', owner: cls, prefix: [], recv: null, ns: scope.ns };
    if (this.is('kw', 'do')) { this.next(); this.skipLine(false); this.body(inner); } else if (this.is('{')) { this.next(); this.body(inner, '}'); }
  }

  /** A method call statement: a route, a namespace, a filter, `register`, `use`, `map`, `run`. */
  call(scope) {
    const first = this.peek();
    // Receiver: `app.get` inside an extension hook, `self.get`.
    let recv = null;
    let name = first.v;
    if (this.peek(1).t === '.' && this.peek(2).t === 'ident') {
      recv = first.v;
      name = this.peek(2).v;
      const ok = recv === 'self' || (scope.recv && recv === scope.recv);
      if (!ok) { this.skipStatement(); return; }
      this.i += 3;
    } else {
      this.next();
    }
    const routing = scope.kind !== 'skip' && scope.kind !== 'module';
    if (routing && (VERBS.has(name) || name === 'route')) return this.route(scope, name, first.line);
    if (routing && name === 'namespace') return this.namespace(scope);
    if (routing && (name === 'before' || name === 'after')) return this.filter(scope, name);
    if (routing && (name === 'register' || name === 'use')) return this.relation(scope, name);
    if (scope.kind === 'top' && name === 'map') return this.map(scope);
    if (scope.kind === 'top' && name === 'run') return this.run(scope);
    this.i--; // re-read the name as part of the statement
    this.skipStatement();
  }

  /** Arguments up to the block or end of line: [{ t, v }] at depth 0, plus where the block starts. */
  args() {
    const out = [];
    let paren = false;
    if (this.is('(') && !this.peek().sp) { paren = true; this.next(); }
    while (!this.atEnd()) {
      const t = this.peek();
      if (paren && t.t === ')') { this.next(); break; }
      if (!paren && (t.t === 'nl' || t.t === ';' || (t.t === 'kw' && t.v === 'do') || t.t === '{')) break;
      if (paren && t.t === 'nl') { this.next(); continue; }
      if (t.t === '(' || t.t === '[' || (t.t === '{' && paren)) { out.push({ t: 'complex' }); this.skipBracket(); continue; }
      if (t.t === 'kw' && OPENERS.has(t.v)) { this.skipStatement(); return { list: out, block: null }; }
      out.push(this.next());
    }
    const block = this.is('kw', 'do') ? 'do' : this.is('{') ? '{' : null;
    return { list: out, block };
  }

  /** The literal text of an argument list's first positional value; null when it is not literal. */
  static pathOf(list) {
    const first = list.find(t => t.t !== ',');
    if (!first) return { path: null, present: false };
    if (first.t === 'str' && typeof first.v === 'string') {
      const next = list[list.indexOf(first) + 1];
      // `"/a" + x` or `'/a' % x` builds the path at runtime.
      if (next && next.t === 'op') return { path: null, present: true };
      return { path: first.v, present: true };
    }
    return { path: null, present: first.t !== 'label' };
  }

  route(scope, name, line) {
    const { list, block } = this.args();
    if (!block) { this.skipStatement(); return; } // `get '/x'` without a block is a test request, not a route
    let verbs;
    let pathInfo;
    if (name === 'route') {
      // sinatra-contrib MultiRoute: route :get, :post, '/x'
      verbs = [];
      const rest = [];
      for (const t of list) {
        if (t.t === ',') continue;
        if ((t.t === 'sym' || t.t === 'str') && typeof t.v === 'string' && VERBS.has(t.v.toLowerCase()) && !rest.length) verbs.push(VERBS.get(t.v.toLowerCase()));
        else rest.push(t);
      }
      pathInfo = Walker.pathOf(rest);
      if (!verbs.length) { this.skipBlockAt(block); return; }
    } else {
      verbs = [VERBS.get(name)];
      pathInfo = Walker.pathOf(list);
    }
    const bodyText = this.skipBlockAt(block);
    scope.owner?.items.push({
      kind: 'route', verbs, path: pathInfo.present ? pathInfo.path : '', prefix: scope.prefix, file: this.file, line, auth: AUTH.test(bodyText),
    });
  }

  namespace(scope) {
    const { list, block } = this.args();
    if (!block) { this.skipStatement(); return; }
    const { path } = Walker.pathOf(list);
    const inner = { ...scope, prefix: scope.prefix === null || path === null ? null : [...scope.prefix, path] };
    if (block === 'do') { this.next(); this.skipLine(false); this.body(inner); } else { this.next(); this.body(inner, '}'); }
  }

  filter(scope, name) {
    const { list, block } = this.args();
    if (!block) { this.skipStatement(); return; }
    const text = this.skipBlockAt(block);
    if (name !== 'before' || !AUTH.test(text)) return;
    const { path, present } = Walker.pathOf(list);
    if (present && path === null) return;
    scope.owner?.items.push({ kind: 'auth', path: present ? path : null, prefix: scope.prefix });
  }

  relation(scope, name) {
    const { list, block } = this.args();
    if (block) this.skipBlockAt(block);
    for (const t of list) {
      if (t.t === 'ident' && /^[A-Z]/.test(t.v)) scope.owner?.items.push({ kind: name, ref: t.v, ns: scope.ns, prefix: scope.prefix });
    }
  }

  map(scope) {
    const { list, block } = this.args();
    if (!block) { this.skipStatement(); return; }
    const { path } = Walker.pathOf(list);
    const inner = { ...scope, prefix: scope.prefix === null || path === null ? null : [...scope.prefix, path] };
    if (block === 'do') { this.next(); this.skipLine(false); this.body(inner); } else { this.next(); this.body(inner, '}'); }
  }

  run(scope) {
    // run App / run App.new / run Rack::URLMap.new('/a' => A, '/b' => B)
    const start = this.i;
    const head = this.peek();
    if (head.t === 'ident' && head.v === 'Rack::URLMap' && this.peek(1).t === '.' && this.peek(2).v === 'new' && this.peek(3).t === '(') {
      this.i += 4;
      while (!this.atEnd() && !this.is(')')) {
        const k = this.next();
        if ((k.t === 'str') && this.is('arrow')) {
          this.next();
          const target = this.peek();
          if (target.t === 'ident' && /^[A-Z]/.test(target.v)) {
            this.model.mounts.push({ ref: target.v, prefix: scope.prefix === null || k.v === null ? null : [...scope.prefix, k.v] });
          }
        }
      }
      this.i = start;
      this.skipStatement();
      return;
    }
    if (head.t === 'ident' && /^[A-Z]/.test(head.v)) this.model.mounts.push({ ref: head.v, prefix: scope.prefix });
    this.skipStatement();
  }

  // ── Skipping ──

  /** Skip a bracketed group starting at the current `(`, `[` or `{`. */
  skipBracket() {
    const open = this.next().t;
    const close = { '(': ')', '[': ']', '{': '}' }[open];
    let depth = 1;
    while (!this.atEnd() && depth > 0) {
      const t = this.next();
      if (t.t === open) depth++;
      else if (t.t === close) depth--;
      else if (t.t === 'kw' && t.v === 'do') this.skipBlock('end');
    }
  }

  /** Skip the rest of a block whose opener was consumed; returns its token text. */
  skipBlock(closer) {
    const start = this.i;
    let depth = 1;
    let lineStart = false;
    while (!this.atEnd()) {
      const t = this.next();
      if (closer === '}') {
        if (t.t === '{') depth++;
        else if (t.t === '}' && --depth === 0) break;
        continue;
      }
      if (t.t === 'kw' && t.v === 'end') { if (--depth === 0) break; }
      else if (t.t === 'kw' && t.v === 'do') depth++;
      else if (t.t === 'kw' && OPENERS.has(t.v) && (lineStart || this.opensBlock(this.i - 1))) {
        if (t.v === 'def' && this.endlessDef(this.i)) { /* no end */ } else {
          depth++;
          if (['while', 'until', 'for'].includes(t.v)) this.skipLoopDo();
        }
      }
      lineStart = t.t === 'nl' || t.t === ';';
    }
    return this.toks.slice(start, this.i).map(t => (typeof t.v === 'string' ? t.v : t.t)).join(' ');
  }

  /** Skip a block starting at the current `do` or `{`; returns its text. */
  skipBlockAt(block) {
    if (!block) return '';
    this.next();
    return this.skipBlock(block === 'do' ? 'end' : '}');
  }

  /** `while x do` — the `do` belongs to the loop, not a block. */
  skipLoopDo() {
    let k = this.i;
    while (k < this.limit && this.toks[k].t !== 'nl' && this.toks[k].t !== ';') {
      if (this.toks[k].t === 'kw' && this.toks[k].v === 'do') { this.toks[k] = { ...this.toks[k], t: 'loopdo' }; break; }
      k++;
    }
  }

  endlessDef(i) {
    for (let k = i; k < this.limit && this.toks[k].t !== 'nl'; k++) {
      if (this.toks[k].t === '(') { let d = 0; for (; k < this.limit; k++) { if (this.toks[k].t === '(') d++; else if (this.toks[k].t === ')' && --d === 0) break; } continue; }
      if (this.toks[k].t === 'op' && this.toks[k].v === '=') return true;
    }
    return false;
  }

  /** Whether the opener keyword at index k starts an expression (not a trailing modifier). */
  opensBlock(k) {
    const p = this.toks[k - 1];
    if (!p) return true;
    if (['nl', ';', '(', ',', '[', '{', '|', 'arrow'].includes(p.t)) return true;
    if (p.t === 'op' && ['=', '||=', '&&=', '+=', '-=', '||', '&&', '!'].includes(p.v)) return true;
    if (p.t === 'kw' && ['then', 'else', 'do', 'begin', 'and', 'or', 'not'].includes(p.v)) return true;
    const v = this.toks[k].v;
    return v === 'def' || v === 'class' || v === 'module' || v === 'begin' || v === 'case';
  }

  /** Skip the rest of the current line (to a newline at bracket depth 0). */
  skipLine(consumeNl) {
    while (!this.atEnd() && !this.is('nl') && !this.is(';')) {
      if (this.is('(') || this.is('[') || this.is('{')) this.skipBracket(); else this.next();
    }
    if (consumeNl && !this.atEnd()) this.next();
  }

  /** Skip one statement, including any blocks it opens. */
  skipStatement(open = false) {
    if (open) { this.skipBlock('end'); return; }
    let first = true;
    while (!this.atEnd() && !this.is('nl') && !this.is(';')) {
      const t = this.peek();
      if (t.t === '(' || t.t === '[') { this.skipBracket(); first = false; continue; }
      if (t.t === '{') { this.next(); this.skipBlock('}'); first = false; continue; }
      if (t.t === 'kw' && t.v === 'end' && first) { this.next(); return; }
      if (t.t === 'kw' && t.v === 'do') { this.next(); this.skipBlock('end'); first = false; continue; }
      if (t.t === 'kw' && OPENERS.has(t.v) && (first || this.opensBlock(this.i))) {
        this.next();
        if (!(t.v === 'def' && this.endlessDef(this.i))) {
          if (['while', 'until', 'for'].includes(t.v)) this.skipLoopDo();
          this.skipBlock('end');
        }
        first = false;
        continue;
      }
      this.next();
      first = false;
    }
  }
}

// ── Resolution ───────────────────────────────────────────────────────────────

function resolve(model) {
  const routes = [];
  const omitted = [];
  const classes = model.classes;
  const lookup = (ref, ns = []) => {
    if (!ref) return null;
    for (let k = ns.length; k >= 0; k--) {
      const name = [...ns.slice(0, k), ref].join('::');
      if (classes.has(name)) return classes.get(name);
    }
    const tail = ref.split('::').pop();
    const hits = [...classes.values()].filter(c => c.name.split('::').pop() === tail);
    return hits.length === 1 ? hits[0] : null;
  };
  const isApp = (cls, seen = new Set()) => {
    if (!cls || seen.has(cls)) return false;
    seen.add(cls);
    if (SINATRA_BASES.has(cls.superRef)) return true;
    return isApp(lookup(cls.superRef, cls.ns), seen);
  };
  const lookupModule = (ref, ns = []) => {
    for (let k = ns.length; k >= 0; k--) {
      const name = [...ns.slice(0, k), ref].join('::');
      if (model.modules.has(name)) return model.modules.get(name);
    }
    const tail = ref.split('::').pop();
    const hits = [...model.modules.entries()].filter(([n]) => n.split('::').pop() === tail);
    return hits.length === 1 ? hits[0][1] : null;
  };

  const apps = [...classes.values()].filter(c => isApp(c));
  const classic = { name: 'Sinatra::Application', items: model.classic.items };

  // Mount prefixes: config.ru maps an app; `use` serves an app under its host.
  const appByRef = ref => (ref === 'Sinatra::Application' ? classic : lookup(ref));
  const mountsOf = new Map();
  for (const m of model.mounts) {
    const app = appByRef(m.ref);
    if (!app) continue;
    if (!mountsOf.has(app)) mountsOf.set(app, []);
    mountsOf.get(app).push({ prefix: m.prefix });
  }
  for (const host of [...apps, classic]) {
    for (const item of host.items) {
      if (item.kind !== 'use') continue;
      const app = lookup(item.ref, item.ns);
      if (!app || !isApp(app)) continue;
      if (!mountsOf.has(app)) mountsOf.set(app, []);
      mountsOf.get(app).push({ host, prefix: item.prefix });
    }
  }
  const prefixesOf = (app, visiting = new Set()) => {
    const mounts = mountsOf.get(app);
    if (!mounts) return [[]];
    if (visiting.has(app)) return [];
    visiting.add(app);
    const out = [];
    for (const m of mounts) {
      if (m.prefix === null) { out.push(null); continue; }
      if (m.host) for (const p of prefixesOf(m.host, visiting)) out.push(p === null ? null : [...p, ...m.prefix]);
      else out.push(m.prefix);
    }
    visiting.delete(app);
    return out;
  };

  const seen = new Set();
  const emit = (app, items, extraPrefix) => {
    const auths = items.filter(i => i.kind === 'auth');
    const coveredByFilter = (full, item) => auths.some(a => {
      if (a.prefix === null || item.prefix === null) return false;
      const base = joinAll(a.prefix);
      if (a.path === null) return full === base || full.startsWith(base === '/' ? '/' : base + '/') || base === '';
      const pattern = joinRoutePath(base, a.path);
      const stem = pattern.replace(/\*.*$/, '').replace(/\/+$/, '');
      return pattern.includes('*') ? full === stem || full.startsWith(stem + '/') : full === pattern;
    });
    const register = items.filter(i => i.kind === 'register');
    const all = [...items.filter(i => i.kind === 'route').map(i => ({ item: i, ext: [] }))];
    for (const r of register) {
      const mod = lookupModule(r.ref, r.ns);
      if (!mod) continue;
      for (const i of mod.items) if (i.kind === 'route') all.push({ item: i, ext: r.prefix });
    }
    for (const mountPrefix of prefixesOf(app)) {
      for (const { item, ext } of all) {
        const parts = mountPrefix === null || ext === null || item.prefix === null ? null : [...extraPrefix, ...mountPrefix, ...ext, ...item.prefix];
        if (parts === null || item.path === null) {
          omitted.push({ file: item.file, line: item.line, reason: item.path === null ? 'route path is not literal text' : 'prefix is not literal text' });
          continue;
        }
        const full = joinRoutePath(joinAll(parts), item.path) || '/';
        const local = joinRoutePath(joinAll([...ext, ...item.prefix]), item.path) || '/';
        for (const method of item.verbs) {
          const key = `${method} ${full}`;
          if (seen.has(key)) continue;
          seen.add(key);
          routes.push({ method, path: full, handler: '', file: item.file, line: item.line, auth: Boolean(item.auth || coveredByFilter(local, item)) });
        }
      }
    }
  };
  for (const app of apps) emit(app, app.items, []);
  emit(classic, classic.items, []);
  Object.defineProperty(routes, 'omitted', { value: dedupe(omitted), enumerable: false });
  return routes;
}

function joinAll(parts) {
  let out = '';
  for (const p of parts) out = joinRoutePath(out, p);
  return out;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(o => { const k = `${o.file}:${o.line}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
