/**
 * Rails route reader: `config/routes.rb` (and the `config/routes/*.rb` files
 * it `draw`s).
 *
 * A Rails route's path is built by the blocks around it: `namespace` and
 * `scope` add path segments, `resources` expands to up to seven actions that
 * `only:` / `except:` narrow, a nested `resources` sits under
 * `/parent/:parent_id`, and `member` / `collection` place custom routes. The
 * old pattern expanded every `resources` line to seven top-level routes and
 * ignored the blocks, so `namespace :admin do resources :users, only:
 * [:index, :show] end` became seven `/users` routes.
 *
 * The reader tokenizes Ruby (strings, symbols, `%i[]`, labels, `=>`,
 * brackets, `do`/`end`) and walks one DSL call and its block at a time,
 * carrying the path prefix and the enclosing resource. A path that is not
 * literal (an interpolated string, a variable) is omitted. The update action is
 * reported as PATCH and PUT, as `rails routes` lists it.
 *
 * @implements docguard.go-spring-rails-routes#FR-005
 * @implements docguard.go-spring-rails-routes#FR-006
 */

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const BLOCK_OPENERS = new Set(['if', 'unless', 'while', 'until', 'case', 'begin', 'def', 'class', 'module']);
const KEYWORDS = new Set([...BLOCK_OPENERS, 'do', 'end', 'then', 'else', 'elsif', 'when', 'rescue', 'ensure']);
const PLURAL_ACTIONS = ['index', 'create', 'new', 'edit', 'show', 'update', 'destroy'];
const SINGULAR_ACTIONS = ['create', 'new', 'edit', 'show', 'update', 'destroy'];
const MAX_EXPANSIONS = 8;
const MAX_DRAW_DEPTH = 8;

/**
 * Read a Rails routes file.
 * @param {string} content  the text of `config/routes.rb`
 * @param {object} [opts]
 * @param {string} [opts.file]  its project-relative path
 * @param {(name: string) => (string|null)} [opts.readDraw]  the text of `config/routes/<name>.rb`, for `draw :name`
 * @returns {Array<{ method: string, path: string, handler: string, file: string, auth: boolean }>}
 */
export function extractRailsRoutes(content, { file = 'config/routes.rb', readDraw = () => null } = {}) {
  const ctx = { routes: [], seen: new Set(), concerns: new Map(), readDraw, drawDepth: 0 };
  if (typeof content !== 'string') return ctx.routes;
  const scope = { path: '', outerPath: '', module: '', res: null, shallow: false, file, silent: false };
  new Parser(tokenize(content), ctx).body(scope);
  return ctx.routes;
}

// ── Tokens ───────────────────────────────────────────────────────────────────

const PAIRS = { '[': ']', '(': ')', '{': '}', '<': '>' };

function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  const push = (t, v) => toks.push({ t, v });
  while (i < n) {
    const c = src[i];
    if (c === '\n') { push('nl'); i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '=' && src.startsWith('=begin', i) && (i === 0 || src[i - 1] === '\n')) {
      const end = src.indexOf('\n=end', i);
      i = end < 0 ? n : end + 5;
      continue;
    }
    if (c === "'" || c === '"') {
      const r = readString(src, i, c);
      push('str', r.value);
      i = r.end;
      continue;
    }
    if (c === '%' && /[wWiIqQ]/.test(src[i + 1] || '') && /[[({<|!/]/.test(src[i + 2] || '')) {
      const kind = src[i + 1];
      const open = src[i + 2];
      const close = PAIRS[open] || open;
      const end = src.indexOf(close, i + 3);
      const body = src.slice(i + 3, end < 0 ? n : end);
      i = end < 0 ? n : end + 1;
      if (/[qQ]/.test(kind)) push('str', kind === 'Q' && body.includes('#{') ? null : body);
      else push('words', { sym: /[iI]/.test(kind), items: body.split(/\s+/).filter(Boolean) });
      continue;
    }
    if (c === ':' && src[i + 1] === '"') {
      const r = readString(src, i + 1, '"');
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
    if (/[A-Za-z_]/.test(c)) {
      let m = /^[A-Za-z_]\w*[?!]?/.exec(src.slice(i, i + 130))[0];
      let j = i + m.length;
      if (src[j] === ':' && src[j + 1] !== ':') { push('label', m.replace(/[?!]$/, '')); i = j + 1; continue; }
      while (src[j] === ':' && src[j + 1] === ':' && /[A-Za-z_]/.test(src[j + 2] || '')) {
        const more = /^[A-Za-z_]\w*/.exec(src.slice(j + 2, j + 130))[0];
        m += '::' + more;
        j += 2 + more.length;
      }
      push(KEYWORDS.has(m) ? 'kw' : 'ident', m);
      i = j;
      continue;
    }
    if (c === '=' && src[i + 1] === '>') { push('arrow'); i += 2; continue; }
    if (c === '-' && src[i + 1] === '>') { push('lambda'); i += 2; continue; }
    if ('()[]{},.|;'.includes(c)) { push(c); i++; continue; }
    push('other', c);
    i++;
  }
  push('eof');
  return toks;
}

/** A quoted string starting at `i`: its value (`null` when it interpolates) and end. */
function readString(src, i, q) {
  let j = i + 1;
  let value = '';
  let dynamic = false;
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') { value += src[j + 1] || ''; j += 2; continue; }
    if (q === '"' && src[j] === '#' && src[j + 1] === '{') {
      dynamic = true;
      let depth = 0;
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) { j++; break; }
      }
      continue;
    }
    value += src[j];
    j++;
  }
  return { value: dynamic ? null : value, end: j + 1 };
}

// ── Values ───────────────────────────────────────────────────────────────────

/** A string or symbol value's text; `null` for anything else (a variable, an interpolation). */
function text(v) {
  if (!v) return null;
  if (v.t === 'str' || v.t === 'sym') return v.v;
  return null;
}

/** A name list: `:a`, `[:a, :b]`, `%i[a b]`. */
function names(v) {
  if (!v) return [];
  if (v.t === 'arr') return v.items.map(text).filter(x => typeof x === 'string');
  if (v.t === 'words') return v.v.items;
  const t = text(v);
  return typeof t === 'string' ? [t] : [];
}

// ── Paths ────────────────────────────────────────────────────────────────────

function join(...parts) {
  const p = ('/' + parts.filter(x => x !== '' && x != null).join('/')).replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/** `photos(/:id)(.:format)` → `photos`, `photos/:id`. */
function expandOptional(path) {
  const base = path.replace(/\(\.:format\)/g, '');
  const out = [];
  const walk = (p) => {
    if (out.length >= MAX_EXPANSIONS) return;
    const m = /\(([^()]*)\)/.exec(p);
    if (!m) { if (!out.includes(p)) out.push(p); return; }
    walk(p.slice(0, m.index) + p.slice(m.index + m[0].length));
    walk(p.slice(0, m.index) + m[1] + p.slice(m.index + m[0].length));
  };
  walk(base);
  return out;
}

const IRREGULAR = new Map([
  ['people', 'person'], ['men', 'man'], ['women', 'woman'], ['children', 'child'], ['mice', 'mouse'],
  ['geese', 'goose'], ['feet', 'foot'], ['teeth', 'tooth'], ['oxen', 'ox'], ['data', 'datum'], ['media', 'medium'],
]);
const UNCOUNTABLE = new Set(['equipment', 'information', 'rice', 'money', 'species', 'series', 'fish', 'sheep', 'jeans', 'police', 'news']);
const SINGULAR_RULES = [
  [/(quiz)zes$/, '$1'], [/(matr)ices$/, '$1ix'], [/(vert|ind)ices$/, '$1ex'], [/(alias|status)(es)?$/, '$1'],
  [/(octop|vir)(us|i)$/, '$1us'], [/(cris|test)(is|es)$/, '$1is'], [/(shoe)s$/, '$1'], [/(o)es$/, '$1'],
  [/(bus)(es)?$/, '$1'], [/([ml])ice$/, '$1ouse'], [/(x|ch|ss|sh)es$/, '$1'], [/(m)ovies$/, '$1ovie'],
  [/([^aeiouy]|qu)ies$/, '$1y'], [/([lr])ves$/, '$1f'], [/(tive)s$/, '$1'], [/(hive)s$/, '$1'],
  [/([^f])ves$/, '$1fe'], [/((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)(sis|ses)$/, '$1sis'],
  [/([ti])a$/, '$1um'], [/(ss)$/, '$1'], [/s$/, ''],
];

const PLURAL_RULES = [
  [/(quiz)$/, '$1zes'], [/(matr|vert|ind)(?:ix|ex)$/, '$1ices'], [/(x|ch|ss|sh)$/, '$1es'],
  [/([^aeiouy]|qu)y$/, '$1ies'], [/(hive)$/, '$1s'], [/(?:([^f])fe|([lr])f)$/, '$1$2ves'], [/sis$/, 'ses'],
  [/([ti])um$/, '$1a'], [/(bu)s$/, '$1ses'], [/(alias|status)$/, '$1es'], [/(octop|vir)us$/, '$1i'],
  [/s$/, 's'], [/$/, 's'],
];

/** ActiveSupport's pluralize, for the common inflections (a singular `resource` maps to a plural controller). */
export function pluralize(word) {
  const w = String(word);
  if (UNCOUNTABLE.has(w)) return w;
  for (const [plural, singular] of IRREGULAR) if (singular === w) return plural;
  for (const [re, to] of PLURAL_RULES) if (re.test(w)) return w.replace(re, to);
  return w;
}

/** ActiveSupport's singularize, for the common inflections. */
export function singularize(word) {
  const w = String(word);
  if (UNCOUNTABLE.has(w)) return w;
  if (IRREGULAR.has(w)) return IRREGULAR.get(w);
  for (const [re, to] of SINGULAR_RULES) if (re.test(w)) return w.replace(re, to);
  return w;
}

// ── Statements ───────────────────────────────────────────────────────────────

class Parser {
  constructor(toks, ctx) {
    this.toks = toks;
    this.ctx = ctx;
    this.i = 0;
    this.limit = toks.length - 1; // the eof token
  }

  peek(k = 0) { return this.toks[Math.min(this.i + k, this.limit)]; }
  atEnd() { return this.i >= this.limit; }
  next() { const t = this.peek(); if (!this.atEnd()) this.i++; return t; }
  is(t, v) { const tok = this.peek(); return tok.t === t && (v === undefined || tok.v === v); }
  skipLine() { while (!this.atEnd() && !this.is('nl') && !this.is(';')) this.next(); }

  /** Statements until the parser's limit. */
  body(scope) {
    while (!this.atEnd()) {
      const tok = this.peek();
      if (tok.t === 'nl' || tok.t === ';') { this.next(); continue; }
      if (tok.t === 'kw' && BLOCK_OPENERS.has(tok.v)) {
        // `if … end` and friends: their bodies are routes like any other; a
        // `def`/`class`/`module` body is not.
        if (['def', 'class', 'module'].includes(tok.v)) { this.next(); this.skipTo('end'); this.next(); continue; }
        this.next();
        this.skipLine();
        continue;
      }
      if (tok.t === 'kw') { this.next(); if (tok.v !== 'end') this.skipLine(); continue; }
      if (tok.t === 'ident') { this.statement(scope); continue; }
      this.skipLine();
    }
  }

  /** Skip to the `end` / `}` closing the block just entered (not consumed). */
  skipTo(closer) {
    let depth = 0;
    let lineStart = true;
    while (!this.atEnd()) {
      const tok = this.peek();
      if (depth === 0 && ((closer === 'end' && tok.t === 'kw' && tok.v === 'end') || (closer === '}' && tok.t === '}'))) return;
      if (tok.t === 'kw' && (tok.v === 'do' || (lineStart && BLOCK_OPENERS.has(tok.v)))) depth++;
      else if (tok.t === 'kw' && tok.v === 'end') depth--;
      else if (tok.t === '{') depth++;
      else if (tok.t === '}') depth--;
      lineStart = tok.t === 'nl' || tok.t === ';';
      this.next();
    }
  }

  statement(scope) {
    let name = this.next().v;
    while (this.is('.') && this.peek(1).t === 'ident') { this.next(); name = this.next().v; }
    const args = this.args();
    let block = null;
    if (this.is('kw', 'do') || this.is('{')) {
      const closer = this.is('{') ? '}' : 'end';
      this.next();
      if (this.is('|')) { this.next(); while (!this.atEnd() && !this.is('|')) this.next(); this.next(); }
      const start = this.i;
      this.skipTo(closer);
      block = [start, this.i];
      this.next();
    }
    if (this.is('kw', 'if') || this.is('kw', 'unless')) this.skipLine();
    this.run(name, args, scope, block);
  }

  /** A call's arguments: `pos` values, `opt` labels, and `rocket` pairs. */
  args() {
    const out = [];
    const paren = this.is('(');
    if (paren) this.next();
    let expectValue = true;
    while (!this.atEnd()) {
      const tok = this.peek();
      if (paren && tok.t === ')') { this.next(); break; }
      if (tok.t === 'nl') {
        if (paren || !expectValue || out.length === 0) { if (!paren) break; this.next(); continue; }
        this.next();
        continue;
      }
      if (!paren && (tok.t === ';' || tok.t === '}' || (tok.t === 'kw' && ['do', 'end', 'if', 'unless'].includes(tok.v)))) break;
      if (!paren && tok.t === '{' && !expectValue) break; // a block
      if (!paren && tok.t === '{' && out.length === 0) break; // `member { … }`
      if (tok.t === ',') { this.next(); expectValue = true; continue; }
      if (tok.t === 'label') {
        this.next();
        out.push({ kind: 'opt', key: tok.v, value: this.value() });
        expectValue = false;
        continue;
      }
      const v = this.value();
      if (this.is('arrow')) {
        this.next();
        out.push({ kind: 'rocket', key: v, value: this.value() });
      } else {
        out.push({ kind: 'pos', value: v });
      }
      expectValue = false;
    }
    return out;
  }

  value() {
    const tok = this.next();
    if (tok.t === 'str' || tok.t === 'sym') return { t: tok.t, v: tok.v };
    if (tok.t === 'words') return { t: 'words', v: tok.v };
    if (tok.t === '[') {
      const items = [];
      while (!this.atEnd() && !this.is(']')) {
        if (this.is(',') || this.is('nl')) { this.next(); continue; }
        items.push(this.value());
      }
      this.next();
      return { t: 'arr', items };
    }
    if (tok.t === '{') {
      const map = {};
      while (!this.atEnd() && !this.is('}')) {
        if (this.is(',') || this.is('nl')) { this.next(); continue; }
        if (this.is('label')) { const k = this.next().v; map[k] = this.value(); continue; }
        const k = this.value();
        if (this.is('arrow')) { this.next(); const key = text(k); const v = this.value(); if (key) map[key] = v; }
      }
      this.next();
      return { t: 'hash', map };
    }
    if (tok.t === 'lambda') {
      if (this.is('(')) this.skipGroup('(', ')');
      if (this.is('{')) this.skipGroup('{', '}');
      else if (this.is('kw', 'do')) { this.next(); this.skipTo('end'); this.next(); }
      return { t: 'other' };
    }
    if (tok.t === 'ident') {
      // `redirect('/x')`, `Constraint.new(…)`, `lambda { … }`, `true`
      for (;;) {
        if (this.is('(')) this.skipGroup('(', ')');
        else if (this.is('.') && this.peek(1).t === 'ident') { this.next(); this.next(); continue; }
        break;
      }
      if (tok.v === 'lambda' || tok.v === 'proc') { if (this.is('{')) this.skipGroup('{', '}'); }
      return { t: 'ident', v: tok.v };
    }
    if (tok.t === '(') { this.i--; this.skipGroup('(', ')'); }
    return { t: 'other' };
  }

  skipGroup(open, close) {
    let depth = 0;
    while (!this.atEnd()) {
      const tok = this.next();
      if (tok.t === open) depth++;
      else if (tok.t === close && --depth === 0) return;
    }
  }

  /** Evaluate a captured block's tokens with `scope`. */
  block(range, scope) {
    if (!range) return;
    const sub = new Parser(this.toks, this.ctx);
    sub.i = range[0];
    sub.limit = range[1];
    sub.body(scope);
  }

  emit(scope, method, path, handler) {
    if (scope.silent) return;
    const key = `${method} ${path}`;
    if (this.ctx.seen.has(key)) return;
    this.ctx.seen.add(key);
    this.ctx.routes.push({ method, path, handler: handler || '', file: scope.file, auth: false });
  }

  run(name, args, scope, block) {
    const pos = args.filter(a => a.kind === 'pos').map(a => a.value);
    const opt = key => args.find(a => a.kind === 'opt' && a.key === key)?.value;
    const optText = key => text(opt(key));

    if (VERBS.has(name) || name === 'match') return this.verb(name, args, scope);
    switch (name) {
      case 'root': {
        const to = optText('to') ?? text(pos[0]);
        return this.emit(scope, 'GET', scope.path || '/', this.handler(scope, to));
      }
      case 'namespace': {
        const n = text(pos[0]);
        if (n == null) return this.block(block, { ...scope, silent: true });
        const segment = optText('path') ?? n;
        const path = join(scope.path, segment);
        const mod = optText('module') ?? n;
        return this.block(block, {
          ...scope, path, outerPath: path, module: `${scope.module}${mod}/`, res: null,
        });
      }
      case 'scope': {
        const first = pos[0];
        const raw = first ? text(first) : optText('path');
        if (first && raw == null) return this.block(block, { ...scope, silent: true }); // FR-006
        const segment = raw == null ? '' : raw.replace(/\([^)]*\)/g, '');
        const path = join(scope.path, segment);
        const mod = optText('module');
        return this.block(block, {
          ...scope, path, outerPath: scope.res ? scope.outerPath : path,
          module: mod ? `${scope.module}${mod}/` : scope.module,
        });
      }
      case 'resources':
      case 'resource':
        for (const n of pos.map(text)) {
          if (typeof n === 'string') this.resource(name === 'resources', n, opt, scope, block);
        }
        return undefined;
      case 'member':
      case 'collection':
      case 'nested':
      case 'new': {
        if (!scope.res) return this.block(block, scope);
        const path = name === 'member' ? scope.res.member
          : name === 'collection' ? scope.res.collection
            : name === 'new' ? join(scope.res.collection, 'new') : scope.res.nested;
        return this.block(block, { ...scope, path });
      }
      case 'shallow':
        return this.block(block, { ...scope, shallow: true });
      case 'concern': {
        const n = text(pos[0]);
        if (n != null && block) this.ctx.concerns.set(n, block);
        return undefined;
      }
      case 'concerns':
        for (const n of pos.flatMap(names)) this.block(this.ctx.concerns.get(n), scope);
        return undefined;
      case 'draw': {
        if (block && !pos.length) return this.block(block, scope); // Rails.application.routes.draw do
        const n = text(pos[0]);
        if (n == null || this.ctx.drawDepth >= MAX_DRAW_DEPTH) return undefined;
        const content = this.ctx.readDraw(n);
        if (typeof content !== 'string') return undefined;
        this.ctx.drawDepth++;
        new Parser(tokenize(content), this.ctx).body({ ...scope, file: `config/routes/${n}.rb` });
        this.ctx.drawDepth--;
        return undefined;
      }
      case 'mount':
      case 'devise_for':
      case 'direct':
      case 'resolve':
        return undefined; // not an enumerable route set (out of scope)
      default:
        // constraints, defaults, controller, with_options, devise_scope, …: same path.
        return this.block(block, scope);
    }
  }

  handler(scope, to) {
    if (typeof to !== 'string' || !to.includes('#')) return '';
    return to.startsWith('/') ? to.slice(1) : `${scope.module}${to}`;
  }

  verb(name, args, scope) {
    const rocket = args.find(a => a.kind === 'rocket');
    const posArgs = args.filter(a => a.kind === 'pos').map(a => a.value);
    const opt = key => args.find(a => a.kind === 'opt' && a.key === key)?.value;
    const pathValue = posArgs[0] || (rocket ? rocket.key : null);
    const raw = text(pathValue);
    if (raw == null) return; // FR-006: a path that is not literal is omitted
    let methods;
    if (name === 'match') {
      const via = opt('via');
      if (!via) return;
      methods = names(via).map(v => v.toUpperCase());
      if (methods.includes('ALL')) methods = ['ANY'];
      if (!methods.length) return;
    } else {
      methods = [name.toUpperCase()];
    }
    const on = text(opt('on'));
    let base = scope.path;
    if (scope.res && on === 'member') base = scope.res.member;
    else if (scope.res && on === 'collection') base = scope.res.collection;
    const to = text(opt('to')) ?? (rocket ? text(rocket.value) : null);
    const handler = to ? this.handler(scope, to)
      : (scope.res && pathValue.t === 'sym' ? `${scope.res.controller}#${raw}` : '');
    for (const p of expandOptional(raw)) {
      for (const m of methods) this.emit(scope, m, join(base, p), handler);
    }
  }

  resource(plural, n, opt, scope, block) {
    const segment = text(opt('path')) ?? n;
    const param = text(opt('param')) ?? 'id';
    const controller = `${scope.module}${text(opt('module')) ? `${text(opt('module'))}/` : ''}${text(opt('controller')) ?? (plural ? n : pluralize(n))}`;
    let actions = plural ? PLURAL_ACTIONS : SINGULAR_ACTIONS;
    if (opt('only')) { const only = new Set(names(opt('only'))); actions = actions.filter(a => only.has(a)); }
    if (opt('except')) { const except = new Set(names(opt('except'))); actions = actions.filter(a => !except.has(a)); }
    const shallowOpt = opt('shallow');
    const shallow = scope.shallow || (shallowOpt && shallowOpt.t === 'ident' && shallowOpt.v === 'true');
    const collection = join(scope.path, segment);
    let member = plural ? join(collection, `:${param}`) : collection;
    if (shallow && scope.res) member = plural ? join(scope.outerPath, segment, `:${param}`) : join(scope.outerPath, segment);
    let nested = plural ? join(collection, `:${singularize(n)}_${param}`) : collection;
    if (shallow && scope.res) nested = plural ? join(scope.outerPath, segment, `:${singularize(n)}_${param}`) : member;
    const routes = {
      index: [['GET', collection]],
      create: [['POST', collection]],
      new: [['GET', join(collection, 'new')]],
      edit: [['GET', join(member, 'edit')]],
      show: [['GET', member]],
      update: [['PATCH', member], ['PUT', member]],
      destroy: [['DELETE', member]],
    };
    for (const action of actions) {
      for (const [method, path] of routes[action]) this.emit(scope, method, path, `${controller}#${action}`);
    }
    const inner = {
      ...scope, path: nested, shallow, res: { member, collection, nested, controller },
    };
    for (const c of names(opt('concerns'))) this.block(this.ctx.concerns.get(c), inner);
    this.block(block, inner);
  }
}
