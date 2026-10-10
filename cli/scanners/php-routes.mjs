/**
 * PHP route readers: Laravel and Symfony.
 *
 * Laravel declares routes in PHP: `Route::get('/x', ...)`, chained group
 * attributes (`Route::prefix('v1')->middleware('auth')->group(...)`),
 * resource registrations that expand to up to seven routes, and route files
 * the application loads from `bootstrap/app.php` (Laravel 11+) or
 * `RouteServiceProvider` (Laravel 10 and earlier), with `routes/api.php`
 * served under `/api` by default. Symfony declares them as `#[Route]`
 * attributes (or `@Route` docblock annotations) on controller methods under a
 * class-level prefix, and in `config/routes.yaml`, whose imports can prefix a
 * whole controller directory.
 *
 * DocGuard has no PHP parser. `lexPhp` masks comments and string bodies
 * without moving offsets, so the bracket tools of `route-lexing.mjs` apply,
 * and each reader follows its framework's routing rules over the masked code.
 * A path or prefix that is not literal text is omitted and recorded in the
 * result's non-enumerable `omitted` list, never guessed.
 *
 * @implements docguard.php-dotnet-routes#FR-001
 * @implements docguard.php-dotnet-routes#FR-002
 * @implements docguard.php-dotnet-routes#FR-003
 * @implements docguard.php-dotnet-routes#FR-007
 */

import { posix } from 'node:path';
import { STRING_FILL, matchPairs, splitTopLevel, trimRange, literalIn } from './route-lexing.mjs';
import { singularize } from './rails-routes.mjs';

const STANDARD = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

// ── Lexing ───────────────────────────────────────────────────────────────────

/**
 * Mask PHP comments and string bodies, keeping every offset.
 *
 * Same contract as `lexCLike`: in `code` a comment is spaces and a literal is
 * `"` + STRING_FILL… + `"`; `lits` maps each literal's start to its decoded
 * value, or `null` when it interpolates (`"/users/$id"`, `"{$x}"`). `#` starts
 * a comment unless it opens an attribute (`#[`). `docs` keeps the raw text of
 * every `/** … *\/` docblock, where Symfony's `@Route` annotations live.
 *
 * @param {string} src
 * @returns {{ code: string, lits: Map<number, { value: string|null, end: number }>, docs: Array<{ start: number, end: number, text: string }> }}
 */
export function lexPhp(src) {
  const n = src.length;
  const out = src.split('');
  const lits = new Map();
  const docs = [];
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const literal = (start, end, value) => {
    out[start] = '"';
    for (let k = start + 1; k < end - 1; k++) if (out[k] !== '\n') out[k] = STRING_FILL;
    out[end - 1] = '"';
    lits.set(start, { value, end });
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if ((c === '/' && d === '/') || (c === '#' && d !== '[')) {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      const close = src.indexOf('*/', i + 2);
      const j = close < 0 ? n : close + 2;
      if (src[i + 2] === '*' && src[i + 3] !== '/') docs.push({ start: i, end: j, text: src.slice(i, j) });
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let value = '';
      while (j < n && src[j] !== "'") {
        if (src[j] === '\\' && (src[j + 1] === "'" || src[j + 1] === '\\')) { value += src[j + 1]; j += 2; }
        else value += src[j++];
      }
      const end = Math.min(n, j + 1);
      literal(i, end, value);
      i = end;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let value = '';
      let template = false;
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < n) {
          const e = src[j + 1];
          value += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : (e === '"' || e === '\\' || e === '$') ? e : '\\' + e;
          j += 2;
          continue;
        }
        if ((src[j] === '$' && /[A-Za-z_{]/.test(src[j + 1] || '')) || (src[j] === '{' && src[j + 1] === '$')) template = true;
        value += src[j++];
      }
      const end = Math.min(n, j + 1);
      literal(i, end, template ? null : value);
      i = end;
      continue;
    }
    if (c === '<' && src.startsWith('<<<', i)) {
      const head = /^<<<[ \t]*(['"]?)([A-Za-z_]\w*)\1\r?\n/.exec(src.slice(i, i + 96));
      if (head) {
        const bodyStart = i + head[0].length;
        const closer = new RegExp(`(^|\\n)[ \\t]*${head[2]}\\b`, 'g');
        closer.lastIndex = bodyStart - 1;
        const m = closer.exec(src);
        const end = m ? m.index + m[0].length : n;
        const body = src.slice(bodyStart, m ? m.index : n);
        const nowdoc = head[1] === "'";
        literal(i, end, nowdoc || !/\$[A-Za-z_{]|\{\$/.test(body) ? body : null);
        i = end;
        continue;
      }
    }
    i++;
  }
  return { code: out.join(''), lits, docs };
}

/** A lexed file: masked code, literals, bracket pairs and line starts. */
function prepare(file, content) {
  const { code, lits, docs } = lexPhp(content);
  const lines = [0];
  for (let k = 0; k < content.length; k++) if (content[k] === '\n') lines.push(k + 1);
  return { file, src: content, code, lits, docs, pairs: matchPairs(code), lines };
}

function lineAt(f, pos) {
  let lo = 0;
  let hi = f.lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (f.lines[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// ── Expressions ──────────────────────────────────────────────────────────────

const text = (f, [s, e]) => f.code.slice(s, e).trim();

/** Literal strings joined with `.`; `null` when any part is not a literal. */
function evalStr(f, range) {
  if (!range) return null;
  const parts = splitTopLevel(f.code, f.pairs, range[0], range[1], '.');
  if (!parts.length) return null;
  let out = '';
  for (const part of parts) {
    const lit = literalIn(f.code, f.lits, ...part);
    if (typeof lit !== 'string') return null;
    out += lit;
  }
  return out;
}

/** `[a, b]` / `array(a, b)` element ranges, or `null` when `range` is not an array. */
function arrayItems(f, range) {
  const [s, e] = trimRange(f.code, ...range);
  if (f.code[s] === '[' && f.pairs.get(s) === e - 1) return splitTopLevel(f.code, f.pairs, s + 1, e - 1);
  const call = /^array\s*\(/i.exec(f.code.slice(s, e));
  if (call && f.pairs.get(s + call[0].length - 1) === e - 1) return splitTopLevel(f.code, f.pairs, s + call[0].length, e - 1);
  return null;
}

/** Split `key => value` at its depth-0 arrow. */
function keyValue(f, [s, e]) {
  for (let i = s; i < e - 1; i++) {
    const c = f.code[i];
    if ((c === '(' || c === '[' || c === '{') && f.pairs.has(i)) { i = f.pairs.get(i); continue; }
    if (c === '=' && f.code[i + 1] === '>') return { key: trimRange(f.code, s, i), value: trimRange(f.code, i + 2, e) };
  }
  return { key: null, value: [s, e] };
}

/** An associative PHP array as a Map of literal key → value range. */
function phpMap(f, range) {
  const items = arrayItems(f, range);
  if (!items) return null;
  const map = new Map();
  for (const item of items) {
    const { key, value } = keyValue(f, item);
    if (!key) continue;
    const k = evalStr(f, key);
    if (typeof k === 'string') map.set(k, value);
  }
  return map;
}

/** Strings of a literal, an array of literals, or several arguments. `null` entries are unknown. */
function strList(f, ranges) {
  const out = [];
  for (const r of ranges) {
    const items = arrayItems(f, r);
    for (const item of items || [r]) {
      const cls = classNameOf(f, item);
      out.push(cls !== null ? cls : evalStr(f, item));
    }
  }
  return out;
}

/** `Foo::class` / `\App\Foo::class` → `Foo`; a string literal → its text; else `null`. */
function classNameOf(f, range) {
  const t = text(f, range);
  const m = /^\\?((?:[A-Za-z_]\w*\\)*[A-Za-z_]\w*)\s*::\s*class$/.exec(t);
  if (m) return m[1].split('\\').pop();
  return null;
}

function isClosure(f, range) {
  return /^(?:static\s+)?(?:function|fn)\b/.test(text(f, range));
}

/** The body range of a closure argument: a `function () {…}` block or an `fn () => …` expression. */
function closureBody(f, range) {
  const [s, e] = trimRange(f.code, ...range);
  const t = f.code.slice(s, e);
  const m = /^(?:static\s+)?(function|fn)\b\s*&?\s*\(/.exec(t);
  if (!m) return null;
  const paren = s + m[0].length - 1;
  if (!f.pairs.has(paren)) return null;
  let i = f.pairs.get(paren) + 1;
  if (m[1] === 'fn') {
    const arrow = f.code.indexOf('=>', i);
    return arrow >= 0 && arrow < e ? [arrow + 2, e] : null;
  }
  for (; i < e; i++) {
    const c = f.code[i];
    if (c === '(' && f.pairs.has(i)) { i = f.pairs.get(i); continue; }
    if (c === '{' && f.pairs.has(i)) return [i + 1, f.pairs.get(i)];
  }
  return null;
}

/** A route action → handler label. */
function handlerOf(f, range, controller) {
  if (!range) return '';
  if (isClosure(f, range)) return 'inline';
  const items = arrayItems(f, range);
  if (items && items.length === 2) {
    const cls = classNameOf(f, items[0]);
    const method = evalStr(f, items[1]);
    if (cls && typeof method === 'string') return `${cls}@${method}`;
  }
  const cls = classNameOf(f, range);
  if (cls) return cls;
  const s = evalStr(f, range);
  if (typeof s === 'string') return controller && !s.includes('@') ? `${controller}@${s}` : s.split('\\').pop();
  return '';
}

/** Laravel middleware that is auth evidence: `auth`, `auth:sanctum`, `auth.basic`, `can:…`, `Authenticate`. */
const AUTH_MIDDLEWARE = /^(?:auth(?:[.:].*)?|can:.+|Authenticate\w*)$/;
const authIn = names => names.some(n => typeof n === 'string' && AUTH_MIDDLEWARE.test(n));

/** Join path segments the way Laravel trims them: `'admin/'` + `'/users'` → `/admin/users`. */
function laravelJoin(parts) {
  const segs = parts.map(p => String(p).replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return '/' + segs.join('/');
}

// ── Laravel ──────────────────────────────────────────────────────────────────

const LARAVEL_VERBS = new Map([
  ['get', ['GET']], ['post', ['POST']], ['put', ['PUT']], ['patch', ['PATCH']],
  ['delete', ['DELETE']], ['options', ['OPTIONS']], ['any', ['ANY']],
]);
const LARAVEL_TERMINALS = new Set([
  ...LARAVEL_VERBS.keys(), 'match', 'redirect', 'permanentRedirect', 'view', 'group',
  'resource', 'apiResource', 'resources', 'apiResources', 'singleton', 'apiSingleton',
]);
const RESOURCE_ACTIONS = ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'];
const API_RESOURCE_ACTIONS = ['index', 'store', 'show', 'update', 'destroy'];

/**
 * Read the routes of every Laravel application in a project.
 *
 * An application is a directory holding `routes/web.php`, `routes/api.php` or
 * `bootstrap/app.php`. Its entry files come from `bootstrap/app.php`'s
 * `withRouting(...)` when present, else from `RouteServiceProvider`'s
 * `group(base_path(...))` mappings, else `routes/web.php` (no prefix) and
 * `routes/api.php` (`/api`). Only files in `paths` are read, so nothing outside
 * the project or in an ignored directory is.
 *
 * @param {string[]} paths  project-relative POSIX paths of the project's `.php` files
 * @param {(rel: string) => string|null} readFile
 * @returns {Array<{ method, path, handler, file, line, auth }> & { omitted: Array<{ file, line, reason }>, read: string[] }}
 */
export function extractLaravelRoutes(paths, readFile) {
  const known = new Set(paths);
  const cache = new Map();
  const read = new Set();
  const routes = [];
  const omitted = [];
  const load = rel => {
    if (!known.has(rel)) return null;
    if (!cache.has(rel)) {
      const content = readFile(rel);
      cache.set(rel, typeof content === 'string' ? prepare(rel, content) : null);
      if (typeof content === 'string') read.add(rel);
    }
    return cache.get(rel);
  };
  const roots = new Set();
  for (const p of paths) {
    const m = /^(?:(.*)\/)?(?:routes\/(?:web|api)\.php|bootstrap\/app\.php)$/.exec(p);
    if (m) roots.add(m[1] || '');
  }
  for (const root of [...roots].sort()) {
    const app = new LaravelApp(root, load, routes, omitted);
    app.run();
  }
  Object.defineProperty(routes, 'omitted', { value: omitted, enumerable: false });
  Object.defineProperty(routes, 'read', { value: [...read], enumerable: false });
  return routes;
}

class LaravelApp {
  constructor(root, load, routes, omitted) {
    this.root = root;
    this.load = load;
    this.routes = routes;
    this.omitted = omitted;
    this.loading = new Set();
  }

  rel(...parts) { return posix.normalize(posix.join(this.root || '.', ...parts)); }

  run() {
    const base = { prefix: [], auth: false, unknown: false, controller: null };
    const boot = this.load(this.rel('bootstrap/app.php'));
    const withRouting = boot && /\bwithRouting\s*\(/.exec(boot.code);
    if (withRouting) {
      const open = withRouting.index + withRouting[0].length - 1;
      if (this.readWithRouting(boot, open, base)) return;
    }
    const provider = this.load(this.rel('app/Providers/RouteServiceProvider.php'));
    if (provider && /->\s*group\s*\(/.test(provider.code)) {
      const before = this.loadedFiles();
      this.readBlock(provider, 0, provider.code.length, base);
      if (this.loadedFiles() > before) return;
    }
    this.loadFile(this.rel('routes/web.php'), base);
    this.loadFile(this.rel('routes/api.php'), { ...base, prefix: ['api'] });
  }

  loadedFiles() { return this.loadCount || 0; }

  /** `withRouting(web:, api:, apiPrefix:, health:, then:, using:)`; false when it names no route source. */
  readWithRouting(f, open, base) {
    if (!f.pairs.has(open)) return false;
    const named = new Map();
    for (const part of splitTopLevel(f.code, f.pairs, open + 1, f.pairs.get(open))) {
      const m = /^([A-Za-z_]\w*)\s*:(?!:)\s*/.exec(f.code.slice(...part));
      if (m) named.set(m[1], [part[0] + m[0].length, part[1]]);
    }
    if (named.has('using')) {
      const body = closureBody(f, named.get('using'));
      if (body) this.readBlock(f, ...body, base);
      return true;
    }
    if (!['web', 'api', 'health', 'then'].some(k => named.has(k))) return false;
    for (const range of this.pathList(f, named.get('web'))) this.loadPath(f, range, base);
    if (named.has('api')) {
      let prefix = 'api';
      let unknown = false;
      if (named.has('apiPrefix')) {
        const p = evalStr(f, named.get('apiPrefix'));
        if (typeof p === 'string') prefix = p; else unknown = true;
      }
      for (const range of this.pathList(f, named.get('api'))) this.loadPath(f, range, { ...base, prefix: [prefix], unknown });
    }
    if (named.has('health')) {
      const range = named.get('health');
      this.emit(f, range[0], base, ['GET'], evalStr(f, range), '', false);
    }
    if (named.has('then')) {
      const body = closureBody(f, named.get('then'));
      if (body) this.readBlock(f, ...body, base);
    }
    return true;
  }

  pathList(f, range) {
    if (!range) return [];
    return arrayItems(f, range) || [range];
  }

  /** Resolve a PHP file-path expression (`__DIR__.'/x.php'`, `base_path('routes/x.php')`) to a project path. */
  evalPath(f, range) {
    let out = '';
    for (const part of splitTopLevel(f.code, f.pairs, range[0], range[1], '.')) {
      const t = text(f, part);
      const lit = literalIn(f.code, f.lits, ...part);
      if (typeof lit === 'string') { out += lit; continue; }
      if (t === '__DIR__') { out += '/' + posix.dirname(f.file); continue; }
      if (t === 'dirname(__DIR__)') { out += '/' + posix.dirname(posix.dirname(f.file)); continue; }
      const call = /^(base_path|app_path)\s*\(/.exec(t);
      if (call) {
        const open = part[0] + f.code.slice(part[0]).indexOf('(');
        const inner = f.pairs.has(open) ? [open + 1, f.pairs.get(open)] : null;
        const arg = inner && text(f, inner) ? evalStr(f, inner) : '';
        if (typeof arg !== 'string') return null;
        out += '/' + posix.join(this.root || '.', call[1] === 'app_path' ? 'app' : '', arg);
        continue;
      }
      return null;
    }
    const rel = posix.normalize(out.replace(/^\/+/, ''));
    return rel.startsWith('..') ? null : rel;
  }

  loadPath(f, range, ctx) {
    const rel = this.evalPath(f, range);
    if (rel) this.loadFile(rel, ctx);
  }

  loadFile(rel, ctx) {
    if (this.loading.has(rel)) return;
    const f = this.load(rel);
    if (!f) return;
    this.loadCount = (this.loadCount || 0) + 1;
    this.loading.add(rel);
    this.readBlock(f, 0, f.code.length, ctx);
    this.loading.delete(rel);
  }

  /** Every `Route::…` statement and `require`/`include` in `[s, e)`. */
  readBlock(f, s, e, ctx) {
    const re = /(?<![\w$>])(?:\\?(?:[A-Za-z_]\w*\\)*)Route\s*::\s*([A-Za-z_]\w*)\s*\(|\b(require|require_once|include|include_once)\b/g;
    re.lastIndex = s;
    let m;
    while ((m = re.exec(f.code)) !== null && m.index < e) {
      if (m[2]) {
        let end = m.index + m[0].length;
        while (end < e && f.code[end] !== ';') {
          if ('([{'.includes(f.code[end]) && f.pairs.has(end)) end = f.pairs.get(end);
          end++;
        }
        let range = trimRange(f.code, m.index + m[0].length, end);
        if (f.code[range[0]] === '(' && f.pairs.get(range[0]) === range[1] - 1) range = [range[0] + 1, range[1] - 1];
        this.loadPath(f, range, ctx);
        re.lastIndex = end;
        continue;
      }
      const chain = readChain(f, m.index + m[0].length - 1, m[1]);
      this.evalChain(f, m.index, chain.calls, ctx);
      re.lastIndex = Math.max(chain.end, m.index + 1);
    }
  }

  evalChain(f, pos, calls, ctx) {
    let attrs = { ...ctx };
    let terminal = null;
    const post = [];
    for (const call of calls) {
      if (terminal) { post.push(call); continue; }
      if (LARAVEL_TERMINALS.has(call.name)) { terminal = call; continue; }
      attrs = this.applyAttribute(f, attrs, call);
    }
    if (!terminal) return;
    let auth = attrs.auth;
    const opts = { only: null, except: null, parameters: new Map(), shallow: false, creatable: false, destroyable: false };
    for (const call of post) {
      if (call.name === 'middleware' && authIn(strList(f, call.args))) auth = true;
      else if (call.name === 'can') auth = true;
      else if (call.name === 'withoutMiddleware' && authIn(strList(f, call.args))) auth = false;
      else if (call.name === 'only') opts.only = strList(f, call.args);
      else if (call.name === 'except') opts.except = strList(f, call.args);
      else if (call.name === 'parameters' && call.args[0]) {
        for (const [k, v] of phpMap(f, call.args[0]) || []) { const p = evalStr(f, v); if (typeof p === 'string') opts.parameters.set(k, p); }
      } else if (call.name === 'shallow') opts.shallow = true;
      else if (call.name === 'creatable') opts.creatable = true;
      else if (call.name === 'destroyable') opts.destroyable = true;
    }
    const at = terminal.pos;
    const a = terminal.args;
    const name = terminal.name;
    if (name === 'group') {
      let body = a[a.length - 1];
      if (a.length >= 2) attrs = this.applyGroupArray(f, attrs, a[0]);
      if (!body) return;
      const inner = { ...attrs, auth: attrs.auth || auth };
      if (isClosure(f, body)) {
        const range = closureBody(f, body);
        if (range) this.readBlock(f, ...range, inner);
      } else {
        this.loadPath(f, body, inner);
      }
      return;
    }
    if (LARAVEL_VERBS.has(name)) {
      this.emit(f, at, attrs, LARAVEL_VERBS.get(name), a[0] ? evalStr(f, a[0]) : null, handlerOf(f, a[1], attrs.controller), auth);
    } else if (name === 'match') {
      const methods = a[0] ? strList(f, [a[0]]) : [];
      const verbs = methods.filter(m => typeof m === 'string').map(m => m.toUpperCase()).filter(m => STANDARD.has(m));
      if (!verbs.length || verbs.length !== methods.length) { this.omit(f, at, 'methods are not literal'); return; }
      this.emit(f, at, attrs, verbs, a[1] ? evalStr(f, a[1]) : null, handlerOf(f, a[2], attrs.controller), auth);
    } else if (name === 'redirect' || name === 'permanentRedirect') {
      this.emit(f, at, attrs, ['ANY'], a[0] ? evalStr(f, a[0]) : null, '', auth);
    } else if (name === 'view') {
      this.emit(f, at, attrs, ['GET'], a[0] ? evalStr(f, a[0]) : null, '', auth);
    } else if (name === 'resources' || name === 'apiResources') {
      const map = a[0] ? phpMap(f, a[0]) : null;
      if (!map) { this.omit(f, at, 'resource names are not literal'); return; }
      for (const [res, ctl] of map) {
        this.resource(f, at, attrs, auth, res, classNameOf(f, ctl) || '', { ...opts, api: name === 'apiResources' });
      }
    } else {
      const res = a[0] ? evalStr(f, a[0]) : null;
      if (typeof res !== 'string') { this.omit(f, at, 'resource name is not literal'); return; }
      const options = a[2] ? phpMap(f, a[2]) : null;
      if (options) {
        if (options.has('only')) opts.only = strList(f, [options.get('only')]);
        if (options.has('except')) opts.except = strList(f, [options.get('except')]);
        for (const [k, v] of (options.has('parameters') && phpMap(f, options.get('parameters'))) || []) {
          const p = evalStr(f, v);
          if (typeof p === 'string') opts.parameters.set(k, p);
        }
      }
      const controller = (a[1] && classNameOf(f, a[1])) || '';
      if (name === 'singleton' || name === 'apiSingleton') this.singleton(f, at, attrs, auth, res, controller, { ...opts, api: name === 'apiSingleton' });
      else this.resource(f, at, attrs, auth, res, controller, { ...opts, api: name === 'apiResource' });
    }
  }

  applyAttribute(f, attrs, call) {
    const a = call.args;
    switch (call.name) {
      case 'prefix': {
        const p = a[0] ? evalStr(f, a[0]) : null;
        return typeof p === 'string' ? { ...attrs, prefix: [...attrs.prefix, p] } : { ...attrs, unknown: true };
      }
      case 'middleware': return authIn(strList(f, a)) ? { ...attrs, auth: true } : attrs;
      case 'withoutMiddleware': return authIn(strList(f, a)) ? { ...attrs, auth: false } : attrs;
      case 'can': return { ...attrs, auth: true };
      case 'controller': return { ...attrs, controller: (a[0] && (classNameOf(f, a[0]) || evalStr(f, a[0]))) || null };
      default: return attrs;
    }
  }

  /** `Route::group(['prefix' => 'admin', 'middleware' => 'auth'], …)`. */
  applyGroupArray(f, attrs, range) {
    const map = phpMap(f, range);
    if (!map) return attrs;
    let out = attrs;
    if (map.has('prefix')) {
      const p = evalStr(f, map.get('prefix'));
      out = typeof p === 'string' ? { ...out, prefix: [...out.prefix, p] } : { ...out, unknown: true };
    }
    if (map.has('middleware') && authIn(strList(f, [map.get('middleware')]))) out = { ...out, auth: true };
    if (map.has('controller')) out = { ...out, controller: classNameOf(f, map.get('controller')) || evalStr(f, map.get('controller')) };
    return out;
  }

  emit(f, pos, attrs, methods, path, handler, auth) {
    if (attrs.unknown || typeof path !== 'string') { this.omit(f, pos, 'path or prefix is not literal'); return; }
    const full = laravelJoin([...attrs.prefix, path]);
    for (const method of methods) {
      this.routes.push({ method, path: full, handler, file: f.file, line: lineAt(f, pos), auth: !!auth });
    }
  }

  omit(f, pos, reason) {
    this.omitted.push({ file: f.file, line: lineAt(f, pos), reason });
  }

  /** `resource` / `apiResource`, with nested `parent.child` names and `shallow`, as Laravel's ResourceRegistrar registers them. */
  resource(f, pos, attrs, auth, name, controller, opts) {
    const { prefix, last, parents, param } = resourceParts(name, opts.parameters);
    let actions = opts.api ? API_RESOURCE_ACTIONS : RESOURCE_ACTIONS;
    actions = filterActions(actions, opts);
    const nested = parents.map(p => `${p}/{${param(p)}}`).join('/');
    const collection = [nested, last].filter(Boolean).join('/');
    const member = `${opts.shallow ? last : collection}/{${param(last)}}`;
    const scoped = { ...attrs, prefix: [...attrs.prefix, ...prefix] };
    const table = {
      index: [['GET'], collection], create: [['GET'], `${collection}/create`], store: [['POST'], collection],
      show: [['GET'], member], edit: [['GET'], `${member}/edit`], update: [['PUT', 'PATCH'], member], destroy: [['DELETE'], member],
    };
    for (const action of actions) {
      const [methods, path] = table[action];
      this.emit(f, pos, scoped, methods, path, controller ? `${controller}@${action}` : action, auth);
    }
  }

  /** `singleton` / `apiSingleton`: show, edit and update (plus create, store and destroy when creatable). */
  singleton(f, pos, attrs, auth, name, controller, opts) {
    const { prefix, last, parents, param } = resourceParts(name, opts.parameters);
    let actions = opts.api ? ['show', 'update'] : ['show', 'edit', 'update'];
    if (opts.creatable) actions = [...actions, ...(opts.api ? ['store', 'destroy'] : ['create', 'store', 'destroy'])];
    else if (opts.destroyable) actions = [...actions, 'destroy'];
    actions = filterActions(actions, opts);
    const path = [parents.map(p => `${p}/{${param(p)}}`).join('/'), last].filter(Boolean).join('/');
    const scoped = { ...attrs, prefix: [...attrs.prefix, ...prefix] };
    const table = {
      show: [['GET'], path], create: [['GET'], `${path}/create`], store: [['POST'], path],
      edit: [['GET'], `${path}/edit`], update: [['PUT', 'PATCH'], path], destroy: [['DELETE'], path],
    };
    for (const action of actions) {
      const [methods, p] = table[action];
      this.emit(f, pos, scoped, methods, p, controller ? `${controller}@${action}` : action, auth);
    }
  }
}

function filterActions(actions, opts) {
  let out = actions;
  if (opts.only) out = out.filter(a => opts.only.includes(a));
  if (opts.except) out = out.filter(a => !opts.except.includes(a));
  return out;
}

/** `admin/photos.comments` → prefix `admin`, parents `photos`, last `comments`, and the wildcard rule. */
function resourceParts(name, parameters) {
  const slash = name.lastIndexOf('/');
  const prefix = slash >= 0 ? [name.slice(0, slash)] : [];
  const segs = name.slice(slash + 1).split('.');
  const param = seg => String(parameters.get(seg) ?? singularize(seg)).replace(/-/g, '_');
  return { prefix, last: segs[segs.length - 1], parents: segs.slice(0, -1), param };
}

/** `Route::a(...)->b(...)->…` from the `(` of the first call. */
function readChain(f, open, firstName) {
  const calls = [];
  if (!f.pairs.has(open)) return { calls, end: open + 1 };
  const argsOf = o => splitTopLevel(f.code, f.pairs, o + 1, f.pairs.get(o));
  calls.push({ name: firstName, args: argsOf(open), pos: open });
  let i = f.pairs.get(open) + 1;
  for (;;) {
    let j = i;
    while (j < f.code.length && /\s/.test(f.code[j])) j++;
    if (!f.code.startsWith('->', j)) break;
    j += 2;
    while (j < f.code.length && /\s/.test(f.code[j])) j++;
    const name = /^[A-Za-z_]\w*/.exec(f.code.slice(j, j + 64));
    if (!name) break;
    j += name[0].length;
    while (j < f.code.length && /\s/.test(f.code[j])) j++;
    if (f.code[j] !== '(' || !f.pairs.has(j)) break;
    calls.push({ name: name[0], args: argsOf(j), pos: j });
    i = f.pairs.get(j) + 1;
  }
  return { calls, end: i };
}

// ── Symfony ──────────────────────────────────────────────────────────────────

const SYMFONY_AUTH_ATTRS = new Set(['IsGranted', 'Security']);

/**
 * Read the routes of a Symfony project.
 *
 * @param {Array<{ file: string, content: string }>} sources  `.php` files, project-relative POSIX paths
 * @param {object} [opts]
 * @param {Array<{ file: string, content: string }>} [opts.yaml]  the route YAML entry files (`config/routes.yaml`, `config/routes/*.yaml`)
 * @param {(rel: string) => string|null} [opts.readFile]  reads a YAML file an import names
 * @returns {Array<{ method, path, handler, file, line, auth }> & { omitted: Array<{ file, line, reason }> }}
 */
export function extractSymfonyRoutes(sources, { yaml = [], readFile = () => null } = {}) {
  const routes = [];
  const omitted = [];
  const imports = []; // { target, dir: boolean, prefixes: (string|null)[] }
  const seenYaml = new Set();
  const loadYaml = (file, content, prefixes, depth) => {
    if (depth > 8 || seenYaml.has(`${file}|${prefixes.join('|')}`)) return;
    seenYaml.add(`${file}|${prefixes.join('|')}`);
    readRoutesYaml(file, content, prefixes, { routes, omitted, imports, depth, load: (rel, p) => {
      const c = readFile(rel);
      if (typeof c === 'string') loadYaml(rel, c, p, depth + 1);
    } });
  };
  for (const y of yaml) if (y && typeof y.content === 'string') loadYaml(y.file, y.content, [''], 0);
  for (const s of sources || []) {
    if (!s || typeof s.content !== 'string' || !/Route\b/.test(s.content)) continue;
    const f = prepare(s.file, s.content);
    const covering = imports.filter(imp => (imp.dir ? s.file.startsWith(imp.target) : s.file === imp.target));
    const importPrefixes = covering.length ? covering.flatMap(imp => imp.prefixes) : [''];
    symfonyFileRoutes(f, importPrefixes, routes, omitted);
  }
  Object.defineProperty(routes, 'omitted', { value: omitted, enumerable: false });
  return routes;
}

/** `#[A, B(…)]` groups ending right before `pos` (whitespace only between), in source order. */
function attributesBefore(f, pos) {
  const groups = [];
  let j = pos - 1;
  for (;;) {
    while (j >= 0 && /\s/.test(f.code[j])) j--;
    if (j < 0 || f.code[j] !== ']' || !f.pairs.has(j)) break;
    const open = f.pairs.get(j);
    if (f.code[open - 1] !== '#') break;
    groups.unshift([open + 1, j]);
    j = open - 2;
  }
  const attrs = [];
  for (const g of groups) {
    for (const part of splitTopLevel(f.code, f.pairs, ...g)) {
      const m = /^\\?((?:[A-Za-z_]\w*\\)*[A-Za-z_]\w*)\s*/.exec(f.code.slice(...part));
      if (!m) continue;
      const name = m[1].split('\\').pop();
      const paren = part[0] + m[0].length;
      const args = f.code[paren] === '(' && f.pairs.has(paren) ? splitTopLevel(f.code, f.pairs, paren + 1, f.pairs.get(paren)) : [];
      attrs.push({ name, args, pos: part[0] });
    }
  }
  const start = groups.length ? groups[0][0] - 2 : pos;
  // The docblock directly above the attributes / declaration.
  const doc = f.docs.filter(d => d.end <= start && !f.code.slice(d.end, start).trim()).pop() || null;
  return { attrs, doc };
}

/** The path(s), methods and position a `#[Route]` declares; `paths` holds `null` for an unreadable path. */
function routeAttribute(f, attr) {
  let pathRange = null;
  let methodsRange = null;
  let positional = 0;
  for (const part of attr.args) {
    const named = /^([A-Za-z_]\w*)\s*:(?!:)\s*/.exec(f.code.slice(...part));
    if (named) {
      const value = [part[0] + named[0].length, part[1]];
      if (named[1] === 'path') pathRange = value;
      else if (named[1] === 'methods') methodsRange = value;
    } else if (positional++ === 0) pathRange = part;
  }
  let paths = [''];
  if (pathRange) {
    const items = arrayItems(f, pathRange);
    paths = items ? items.map(item => evalStr(f, keyValue(f, item).value)) : [evalStr(f, pathRange)];
  }
  let methods = null;
  if (methodsRange) {
    const list = strList(f, [methodsRange]);
    methods = list.every(m => typeof m === 'string') ? list.map(m => m.toUpperCase()).filter(m => STANDARD.has(m)) : null;
    if (!methods || !methods.length) methods = null;
  }
  return { paths, methods, unknownMethods: !!methodsRange && !methods, pos: attr.pos };
}

/** `@Route("/x", name="y", methods={"GET","POST"})` inside a docblock. */
function routeAnnotations(text) {
  const out = [];
  const re = /@Route\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    let quote = null;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (quote) { if (c === quote && text[i - 1] !== '\\') quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(' || c === '{') depth++;
      else if (c === ')' || c === '}') depth--;
    }
    const args = text.slice(start, i - 1).replace(/^\s*\*\s?/gm, ' ');
    const items = [];
    let cur = '';
    let d = 0;
    quote = null;
    for (const c of args) {
      if (quote) { cur += c; if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      if (c === '{' || c === '(') d++;
      if (c === '}' || c === ')') d--;
      if (c === ',' && d === 0) { items.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) items.push(cur.trim());
    let path = '';
    let methods = null;
    let first = true;
    for (const item of items) {
      const named = /^([A-Za-z_]\w*)\s*=\s*([\s\S]*)$/.exec(item);
      const value = named ? named[2].trim() : item;
      const str = /^"([^"]*)"$|^'([^']*)'$/.exec(value);
      if (!named && first) { path = str ? (str[1] ?? str[2]) : null; first = false; continue; }
      if (named && (named[1] === 'path' || named[1] === 'value')) path = str ? (str[1] ?? str[2]) : null;
      if (named && named[1] === 'methods') {
        methods = [...value.matchAll(/"([^"]+)"|'([^']+)'/g)].map(x => (x[1] ?? x[2]).toUpperCase()).filter(x => STANDARD.has(x));
        if (!methods.length) methods = null;
      }
    }
    out.push({ paths: [path], methods, unknownMethods: false });
  }
  return out;
}

function symfonyJoin(...parts) {
  const joined = parts.join('').replace(/\/{2,}/g, '/');
  if (!joined) return '/';
  return joined.startsWith('/') ? joined : '/' + joined;
}

function symfonyFileRoutes(f, importPrefixes, routes, omitted) {
  const classRe = /\b((?:(?:final|abstract|readonly)\s+)*)class\s+([A-Za-z_]\w*)/g;
  let m;
  while ((m = classRe.exec(f.code)) !== null) {
    if (/(::|\bnew)\s*$/.test(f.code.slice(Math.max(0, m.index - 6), m.index))) continue;
    let open = f.code.indexOf('{', m.index + m[0].length);
    if (open < 0 || !f.pairs.has(open)) continue;
    const close = f.pairs.get(open);
    const cls = attributesBefore(f, m.index);
    const classRoutes = [
      ...cls.attrs.filter(a => a.name === 'Route').map(a => routeAttribute(f, a)),
      ...(cls.doc ? routeAnnotations(cls.doc.text) : []),
    ];
    const classPrefixes = classRoutes.length ? classRoutes.flatMap(r => r.paths) : [''];
    const classMethods = classRoutes.find(r => r.methods)?.methods || null;
    const classAuth = cls.attrs.some(a => SYMFONY_AUTH_ATTRS.has(a.name)) || /@(?:IsGranted|Security)\b/.test(cls.doc?.text || '');
    const fnRe = /\b((?:(?:public|protected|private|static|final|abstract)\s+)*)function\s+&?\s*([A-Za-z_]\w*)\s*\(/g;
    fnRe.lastIndex = open + 1;
    let fm;
    while ((fm = fnRe.exec(f.code)) !== null && fm.index < close) {
      const paren = fm.index + fm[0].length - 1;
      let bodyEnd = f.pairs.has(paren) ? f.pairs.get(paren) + 1 : fm.index + fm[0].length;
      let body = null;
      for (let k = bodyEnd; k < close; k++) {
        const c = f.code[k];
        if (c === ';') { bodyEnd = k + 1; break; }
        if (c === '{' && f.pairs.has(k)) { body = [k, f.pairs.get(k)]; bodyEnd = body[1] + 1; break; }
      }
      fnRe.lastIndex = bodyEnd;
      const decl = attributesBefore(f, fm.index);
      const declared = [
        ...decl.attrs.filter(a => a.name === 'Route').map(a => routeAttribute(f, a)),
        ...(decl.doc ? routeAnnotations(decl.doc.text) : []),
      ];
      if (!declared.length) continue;
      const auth = classAuth
        || decl.attrs.some(a => SYMFONY_AUTH_ATTRS.has(a.name))
        || /@(?:IsGranted|Security)\b/.test(decl.doc?.text || '')
        || (!!body && /denyAccessUnlessGranted\s*\(/.test(f.code.slice(...body)));
      for (const r of declared) {
        const line = lineAt(f, r.pos ?? fm.index);
        const methods = r.methods || classMethods || ['ANY'];
        for (const path of r.paths) {
          for (const classPrefix of classPrefixes) {
            for (const importPrefix of importPrefixes) {
              if (typeof path !== 'string' || typeof classPrefix !== 'string' || typeof importPrefix !== 'string' || r.unknownMethods) {
                omitted.push({ file: f.file, line, reason: 'path or prefix is not literal' });
                continue;
              }
              for (const method of methods) {
                routes.push({ method, path: symfonyJoin(importPrefix, classPrefix, path), handler: `${m[2]}::${fm[2]}`, file: f.file, line, auth });
              }
            }
          }
        }
      }
    }
  }
}

// ── Symfony YAML ─────────────────────────────────────────────────────────────

/**
 * The top-level entries of a route YAML file. Each entry maps its child keys to
 * `{ value, children, list, line }`; this reads the block-style YAML Symfony's
 * route files use, not YAML in general.
 */
function yamlEntries(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];
  let entry = null;
  let childIndent = null;
  let field = null;
  const unquote = v => {
    const t = v.trim();
    const q = /^"(.*)"$|^'(.*)'$/.exec(t);
    return q ? (q[1] ?? q[2]) : t;
  };
  lines.forEach((raw, idx) => {
    if (!raw.trim() || /^\s*#/.test(raw)) return;
    const line = raw.replace(/\s+#.*$/, '');
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (indent === 0) {
      const m = /^("[^"]*"|'[^']*'|[^\s:][^:]*):(?:\s+(.*))?$/.exec(body);
      entry = m ? { key: unquote(m[1]), line: idx + 1, fields: new Map() } : null;
      if (entry) entries.push(entry);
      childIndent = null;
      field = null;
      return;
    }
    if (!entry) return;
    if (childIndent === null) childIndent = indent;
    if (indent === childIndent) {
      const m = /^([^\s:][^:]*):(?:\s+(.*))?$/.exec(body);
      if (!m) { field = null; return; }
      field = { value: m[2] !== undefined ? unquote(m[2]) : null, children: new Map(), list: [], line: idx + 1 };
      entry.fields.set(m[1].trim(), field);
      return;
    }
    if (indent > childIndent && field) {
      const item = /^-\s+(.*)$/.exec(body);
      if (item) { field.list.push(unquote(item[1])); return; }
      const m = /^([^\s:][^:]*):(?:\s+(.*))?$/.exec(body);
      if (m) field.children.set(m[1].trim(), m[2] !== undefined ? unquote(m[2]) : '');
    }
  });
  return entries;
}

/** A YAML value as a list of strings: `GET|HEAD`, `[GET, POST]`, a block list, or one scalar. */
function yamlList(field) {
  if (!field) return null;
  if (field.list.length) return field.list;
  if (field.value === null) return null;
  const v = field.value.trim();
  const flow = /^\[(.*)\]$/.exec(v);
  if (flow) return flow[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  return v.split('|').map(s => s.trim()).filter(Boolean);
}

/** Path values of a YAML field: a scalar, or a localized map's values. */
function yamlStrings(field) {
  if (!field) return null;
  if (field.value !== null && field.value !== '') return [field.value];
  if (field.children.size) return [...field.children.values()];
  return null;
}

function readRoutesYaml(file, content, prefixes, { routes, omitted, imports, load }) {
  const dir = posix.dirname(file);
  for (const entry of yamlEntries(content)) {
    if (/^when@/.test(entry.key)) continue; // environment-only routes (profiler, error pages)
    const fields = entry.fields;
    const ownPrefixes = fields.has('prefix') ? yamlStrings(fields.get('prefix')) : [''];
    if (fields.has('resource')) {
      const res = fields.get('resource');
      const target = res.value || res.children.get('path') || null;
      if (!target || target.startsWith('@') || !ownPrefixes) continue;
      const combined = prefixes.flatMap(p => ownPrefixes.map(q => p + q));
      const rel = posix.normalize(posix.join(dir, target.replace(/[*{].*$/, '')));
      if (rel.startsWith('..')) continue;
      if (/\.ya?ml$/.test(rel)) { load(rel, combined); continue; }
      if (/\.php$/.test(rel)) imports.push({ target: rel, dir: false, prefixes: combined });
      else imports.push({ target: rel.replace(/\/?$/, '/'), dir: true, prefixes: combined });
      continue;
    }
    if (!fields.has('path')) continue;
    const paths = yamlStrings(fields.get('path'));
    const methods = yamlList(fields.get('methods'));
    const verbs = methods ? methods.map(m => m.toUpperCase()).filter(m => STANDARD.has(m)) : ['ANY'];
    if (!paths || !verbs.length) { omitted.push({ file, line: entry.line, reason: 'path is not literal' }); continue; }
    const handler = fields.get('controller')?.value || fields.get('defaults')?.children.get('_controller') || '';
    for (const prefix of prefixes) {
      for (const path of paths) {
        for (const method of verbs) routes.push({ method, path: symfonyJoin(prefix, path), handler, file, line: entry.line, auth: false });
      }
    }
  }
}
