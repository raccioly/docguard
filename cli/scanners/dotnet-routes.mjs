/**
 * ASP.NET Core route reader (C#): attribute-routed controllers and minimal APIs.
 *
 * A controller action's route is the class-level `[Route]` template (which a
 * derived controller inherits) joined to the action's `[HttpGet("…")]`,
 * `[Route("…")]` or `[AcceptVerbs]` template, with the `[controller]`,
 * `[action]` and `[area]` tokens replaced. A minimal API's route is the
 * `MapGet`/`MapPost`/… pattern joined to the `MapGroup` prefixes above it,
 * which reach it through chains, variables, and methods the group is passed to
 * (`app.MapGroup("/users").MapUserEndpoints()`), in any file.
 *
 * DocGuard has no C# parser. `lexCSharp` masks comments and strings (regular,
 * verbatim, interpolated, raw) without moving offsets; the reader splits each
 * class body into members with their attributes and follows route groups the
 * way spec 047's Go reader does. A template that is not literal text or a
 * `const string` is omitted and recorded in the result's non-enumerable
 * `omitted` list, never guessed.
 *
 * @implements docguard.php-dotnet-routes#FR-004
 * @implements docguard.php-dotnet-routes#FR-005
 * @implements docguard.php-dotnet-routes#FR-006
 * @implements docguard.php-dotnet-routes#FR-007
 */

import { STRING_FILL, matchPairs, splitTopLevel, trimRange, literalIn, joinRoutePath } from './route-lexing.mjs';

const HTTP_ATTRS = new Map([
  ['HttpGet', 'GET'], ['HttpPost', 'POST'], ['HttpPut', 'PUT'], ['HttpDelete', 'DELETE'],
  ['HttpPatch', 'PATCH'], ['HttpHead', 'HEAD'], ['HttpOptions', 'OPTIONS'],
]);
const MAP_VERBS = new Map([['MapGet', 'GET'], ['MapPost', 'POST'], ['MapPut', 'PUT'], ['MapDelete', 'DELETE'], ['MapPatch', 'PATCH']]);
const MAP_NAMES = new Set([...MAP_VERBS.keys(), 'MapMethods', 'Map', 'MapGroup', 'MapHealthChecks']);
const STANDARD = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
const ROUTER_TYPES = /\b(?:IEndpointRouteBuilder|RouteGroupBuilder|WebApplication|IApplicationBuilder)\b/;
const MAX_DEPTH = 16;

// ── Lexing ───────────────────────────────────────────────────────────────────

/**
 * Mask C# comments and string bodies, keeping every offset.
 *
 * Same contract as `lexCLike`. Regular (`"…"`), verbatim (`@"…"`, where `""`
 * is a quote and `\` is literal) and raw (`"""…"""`) strings decode to their
 * text; an interpolated string (`$"…{x}…"`) whose text depends on a value is
 * `null`. A literal is keyed at its first prefix character (`$` or `@`), so
 * an argument range that starts there is the literal.
 *
 * @param {string} src
 * @returns {{ code: string, lits: Map<number, { value: string|null, end: number }> }}
 */
export function lexCSharp(src) {
  const n = src.length;
  const out = src.split('');
  const lits = new Map();
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const literal = (start, end, value) => {
    out[start] = '"';
    for (let k = start + 1; k < end - 1; k++) if (out[k] !== '\n') out[k] = STRING_FILL;
    out[end - 1] = '"';
    lits.set(start, { value, end });
  };
  const interpolated = raw => /\{(?!\{)/.test(raw.replace(/\{\{/g, ''));
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      const close = src.indexOf('*/', i + 2);
      const j = close < 0 ? n : close + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === '$' || c === '@') {
      if ((c === '$' || c === '@') && /[\w]/.test(src[i - 1] || '')) { i++; continue; }
      let j = i;
      let interp = false;
      let verbatim = false;
      while (src[j] === '$') { interp = true; j++; }
      if (src[j] === '@') { verbatim = true; j++; while (src[j] === '$') { interp = true; j++; } }
      if (src[j] !== '"') { i++; continue; }
      if (src.startsWith('"""', j)) {
        let q = 0;
        while (src[j + q] === '"') q++;
        const fence = '"'.repeat(q);
        const close = src.indexOf(fence, j + q);
        const end = close < 0 ? n : close + q;
        const raw = src.slice(j + q, close < 0 ? n : close);
        const body = raw.includes('\n') ? raw.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n[ \t]*$/, '') : raw;
        literal(i, end, interp && /\{/.test(body) ? null : body);
        i = end;
        continue;
      }
      let k = j + 1;
      let value = '';
      if (verbatim) {
        while (k < n) {
          if (src[k] === '"') { if (src[k + 1] === '"') { value += '"'; k += 2; continue; } break; }
          value += src[k++];
        }
      } else {
        while (k < n && src[k] !== '"' && src[k] !== '\n') {
          if (src[k] === '\\' && k + 1 < n) {
            const e = src[k + 1];
            value += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === '0' ? '\0' : e;
            k += 2;
          } else value += src[k++];
        }
      }
      const end = Math.min(n, k + 1);
      if (interp) value = interpolated(value) ? null : value.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
      literal(i, end, value);
      i = end;
      continue;
    }
    if (c === "'") {
      const m = /^'(?:\\.[^'\n]{0,8}|[^'\\\n])'/.exec(src.slice(i, i + 12));
      if (m) {
        for (let k = i; k < i + m[0].length; k++) out[k] = STRING_FILL;
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return { code: out.join(''), lits };
}

function prepare(file, content) {
  const { code, lits } = lexCSharp(content);
  const lines = [0];
  for (let k = 0; k < content.length; k++) if (content[k] === '\n') lines.push(k + 1);
  return { file, src: content, code, lits, pairs: matchPairs(code), lines, types: [], methods: [] };
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

const skipWs = (code, i) => { while (i < code.length && /\s/.test(code[i])) i++; return i; };
const skipWsBack = (code, i) => { while (i >= 0 && /\s/.test(code[i])) i--; return i; };

// ── Declarations ─────────────────────────────────────────────────────────────

/** `[A, B(x, Name = y)]` → `[{ name, positional, named }]`; `[assembly: …]` and other targets are skipped. */
function parseAttributeGroup(f, open) {
  const close = f.pairs.get(open);
  const out = [];
  const inner = [open + 1, close];
  if (/^\s*[a-z]+\s*:(?!:)/.test(f.code.slice(...inner))) return out;
  for (const part of splitTopLevel(f.code, f.pairs, ...inner)) {
    const m = /^([A-Za-z_][\w.]*)\s*/.exec(f.code.slice(...part));
    if (!m) continue;
    const name = m[1].split('.').pop().replace(/Attribute$/, '');
    const paren = part[0] + m[0].length;
    const positional = [];
    const named = new Map();
    if (f.code[paren] === '(' && f.pairs.has(paren)) {
      for (const arg of splitTopLevel(f.code, f.pairs, paren + 1, f.pairs.get(paren))) {
        const nm = /^([A-Za-z_]\w*)\s*(?:=(?!=)|:(?!:))\s*/.exec(f.code.slice(...arg));
        if (nm) named.set(nm[1], [arg[0] + nm[0].length, arg[1]]);
        else positional.push(arg);
      }
    }
    out.push({ name, positional, named, pos: part[0] });
  }
  return out;
}

/** Attribute groups ending right before `pos`, in source order. */
function attributesBefore(f, pos) {
  const attrs = [];
  let j = skipWsBack(f.code, pos - 1);
  while (j >= 0 && f.code[j] === ']' && f.pairs.has(j)) {
    const open = f.pairs.get(j);
    attrs.unshift(...parseAttributeGroup(f, open));
    j = skipWsBack(f.code, open - 1);
  }
  return attrs;
}

/** Every class / record / struct with its attributes, modifiers, base and body. */
function findTypes(f) {
  const re = /\b((?:(?:public|internal|private|protected|static|sealed|abstract|partial|file|readonly|new|unsafe)\s+)*)(class|record|struct|interface)\s+([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(f.code)) !== null) {
    const before = skipWsBack(f.code, m.index - 1);
    if (before >= 0 && (f.code[before] === ':' || f.code[before] === ',' || f.code[before] === '.')) continue;
    let i = m.index + m[0].length;
    let open = -1;
    let baseText = '';
    let colon = -1;
    for (; i < f.code.length; i++) {
      const c = f.code[i];
      if ((c === '(' || c === '[') && f.pairs.has(i)) { i = f.pairs.get(i); continue; }
      if (c === ':' && colon < 0) colon = i;
      if (c === '{') { open = f.pairs.has(i) ? i : -1; break; }
      if (c === ';') break;
    }
    if (colon >= 0) baseText = f.code.slice(colon + 1, open >= 0 ? open : i).split(/\bwhere\b/)[0];
    const firstBase = baseText.replace(/<[^<>]*>/g, '').split(',')[0].trim();
    f.types.push({
      f, name: m[3], kind: m[2], start: m.index,
      mods: new Set(m[1].split(/\s+/).filter(Boolean)),
      attrs: attributesBefore(f, m.index),
      base: firstBase ? firstBase.split('.').pop() : null,
      open, close: open >= 0 ? f.pairs.get(open) : -1,
    });
  }
}

/** The members of a type body, split at depth 0, with their attributes and modifiers; methods only. */
function findMembers(f, type) {
  const { code, pairs } = f;
  let i = type.open + 1;
  const end = type.close;
  while (i < end) {
    i = skipWs(code, i);
    if (i >= end) break;
    const attrs = [];
    while (code[i] === '[' && pairs.has(i)) {
      attrs.push(...parseAttributeGroup(f, i));
      i = skipWs(code, pairs.get(i) + 1);
    }
    const headerStart = i;
    let paren = -1;
    let body = null;
    let k = i;
    for (; k < end; k++) {
      const c = code[k];
      if (c === '(' && pairs.has(k)) { if (paren < 0) paren = k; k = pairs.get(k); continue; }
      if (c === '[' && pairs.has(k)) { k = pairs.get(k); continue; }
      if (c === ';') { k++; break; }
      if (c === '=' && code[k + 1] === '>' && !body) { if (paren >= 0) body = [k + 2, -1]; k++; continue; }
      if (c === '{' && pairs.has(k)) {
        const close = pairs.get(k);
        if (!body) body = [k + 1, close];
        k = close;
        const next = skipWs(code, k + 1);
        if (code[next] === '=' && code[next + 1] !== '>') continue; // property initializer
        if (body[1] === -1) continue; // a block inside an expression body
        k++;
        break;
      }
    }
    if (body && body[1] === -1) body[1] = k;
    const header = code.slice(headerStart, paren >= 0 ? paren : k);
    i = Math.max(k, i + 1);
    if (paren < 0 || /\b(?:class|record|struct|interface|enum|delegate|event|operator)\b/.test(header) || header.includes('=')) continue;
    const nm = /([A-Za-z_]\w*)\s*(?:<[^<>]*>)?\s*$/.exec(header);
    if (!nm || nm[1] === type.name) continue;
    const mods = new Set((header.match(/\b(?:public|private|protected|internal|static|abstract|virtual|override|sealed|async|new|extern|unsafe|partial)\b/g) || []));
    const params = splitTopLevel(code, pairs, paren + 1, pairs.get(paren)).map(r => {
      const t = code.slice(...r).replace(/=.*$/s, '').trim();
      const pm = /^(this\s+)?(?:(?:ref|in|out|params|scoped)\s+)*([\s\S]+?)\s+([A-Za-z_]\w*)$/.exec(t.replace(/^\[[^\]]*\]\s*/, ''));
      return pm ? { name: pm[3], type: pm[2], isThis: !!pm[1] } : null;
    }).filter(Boolean);
    const method = { f, type, name: nm[1], namePos: headerStart + nm.index, attrs, mods, params, body, start: headerStart };
    method.isExtension = !!params[0]?.isThis;
    f.methods.push(method);
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

function collectConstants(files) {
  const byKey = new Map();
  for (const f of files) {
    const re = /\bconst\s+string\s+([A-Za-z_]\w*)\s*=\s*/g;
    let m;
    while ((m = re.exec(f.code)) !== null) {
      const s = m.index + m[0].length;
      let e = s;
      for (; e < f.code.length && f.code[e] !== ';'; e++) {
        if ('([{'.includes(f.code[e]) && f.pairs.has(e)) e = f.pairs.get(e);
      }
      const owner = f.types.filter(t => t.open < m.index && m.index < t.close).sort((a, b) => b.open - a.open)[0];
      const def = { f, range: [s, e] };
      for (const key of owner ? [m[1], `${owner.name}.${m[1]}`] : [m[1]]) {
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(def);
      }
    }
  }
  const cache = new Map();
  const lookup = (ref, seen = new Set()) => {
    const parts = ref.split('.');
    for (const key of parts.length >= 2 ? [parts.slice(-2).join('.'), parts[parts.length - 1]] : [ref]) {
      if (cache.has(key)) return cache.get(key);
      const defs = byKey.get(key);
      if (!defs || seen.has(key)) continue;
      seen.add(key);
      const values = new Set(defs.map(d => evalCs(d.f, d.range, r => lookup(r, seen))));
      const value = values.size === 1 ? [...values][0] : null;
      cache.set(key, value);
      return value;
    }
    return null;
  };
  return lookup;
}

/** Literals and `const string` references joined with `+`; `null` when unknown. */
function evalCs(f, range, lookup) {
  if (!range) return null;
  const parts = splitTopLevel(f.code, f.pairs, range[0], range[1], '+');
  if (!parts.length) return null;
  let out = '';
  for (const part of parts) {
    const lit = literalIn(f.code, f.lits, ...part);
    if (typeof lit === 'string') { out += lit; continue; }
    if (lit === null) return null;
    const ref = f.code.slice(...part).trim();
    if (!/^[A-Za-z_][\w.]*$/.test(ref)) return null;
    const v = lookup(ref);
    if (typeof v !== 'string') return null;
    out += v;
  }
  return out;
}

function cleanPath(p) {
  const joined = ('/' + String(p).replace(/^~?\/+/, '')).replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/+$/, '') : joined;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Read the routes of an ASP.NET Core project.
 * @param {Array<{ file: string, content: string }>} sources  `.cs` files, project-relative paths
 * @returns {Array<{ method, path, handler, file, line, auth }> & { omitted: Array<{ file, line, reason }> }}
 */
export function extractAspNetRoutes(sources) {
  const files = [];
  for (const s of sources || []) {
    if (!s || typeof s.content !== 'string') continue;
    const f = prepare(s.file, s.content);
    findTypes(f);
    for (const t of f.types) if (t.open >= 0) findMembers(f, t);
    files.push(f);
  }
  const lookup = collectConstants(files);
  const routes = [];
  const omitted = [];
  const ctx = { files, lookup, routes, omitted };
  controllerRoutes(ctx);
  minimalApiRoutes(ctx);
  const seen = new Set();
  const out = routes.filter(r => {
    const key = `${r.method} ${r.path} ${r.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  Object.defineProperty(out, 'omitted', { value: omitted, enumerable: false });
  return out;
}

// ── Controllers ──────────────────────────────────────────────────────────────

function controllerRoutes(ctx) {
  const { files, lookup } = ctx;
  const byName = new Map();
  for (const f of files) for (const t of f.types) { if (!byName.has(t.name)) byName.set(t.name, []); byName.get(t.name).push(t); }
  const baseOf = t => (t.base && byName.get(t.base)?.find(b => b !== t)) || null;
  /** The nearest type in `t`'s base chain (itself first) for which `pick` returns a value. */
  const inherited = (t, pick) => {
    for (let cur = t, depth = 0; cur && depth < MAX_DEPTH; cur = baseOf(cur), depth++) {
      const v = pick(cur);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const has = (attrs, name) => attrs.some(a => a.name === name);
  const globalAuth = files.some(f => /\.\s*MapControllers\s*\(\s*\)\s*\.\s*RequireAuthorization\s*\(/.test(f.code));

  for (const f of files) {
    for (const type of f.types) {
      if (type.open < 0 || type.kind === 'interface' || type.kind === 'struct') continue;
      if (type.mods.has('abstract') || type.mods.has('static') || ['private', 'protected', 'internal', 'file'].some(m => type.mods.has(m))) continue;
      if (has(type.attrs, 'NonController')) continue;
      const markedController = inherited(type, t => (has(t.attrs, 'ApiController') || has(t.attrs, 'Controller') ? true : undefined));
      const derives = inherited(type, t => (t !== type && /Controller(Base)?$/.test(t.name) ? true : undefined))
        || /^(?:Controller|ControllerBase)$/.test(type.base || '');
      if (!type.name.endsWith('Controller') && !markedController && !derives) continue;
      const routeAttrs = inherited(type, t => {
        const own = t.attrs.filter(a => a.name === 'Route');
        return own.length ? { owner: t, attrs: own } : undefined;
      });
      const classTemplates = routeAttrs
        ? routeAttrs.attrs.map(a => evalCs(routeAttrs.owner.f, a.positional[0] || a.named.get('Template'), lookup))
        : null;
      const areaAttr = inherited(type, t => {
        const a = t.attrs.find(x => x.name === 'Area');
        return a ? { f: t.f, a } : undefined;
      });
      const area = areaAttr ? evalCs(areaAttr.f, areaAttr.a.positional[0] || areaAttr.a.named.get('AreaName'), lookup) : undefined;
      const classAuth = !!inherited(type, t => (has(t.attrs, 'Authorize') ? true : undefined));
      const classAnon = !!inherited(type, t => (has(t.attrs, 'AllowAnonymous') ? true : undefined));
      const controllerName = type.name.replace(/Controller$/, '');

      for (const method of f.methods) {
        if (method.type !== type) continue;
        const mods = method.mods;
        if (!mods.has('public') || mods.has('static') || mods.has('abstract') || mods.has('override')) continue;
        if (has(method.attrs, 'NonAction')) continue;
        const selectors = [];
        const free = [];
        for (const a of method.attrs) {
          if (HTTP_ATTRS.has(a.name)) {
            const tpl = a.positional[0] || a.named.get('Template');
            if (tpl) selectors.push({ verbs: [HTTP_ATTRS.get(a.name)], tpl, a });
            else free.push(HTTP_ATTRS.get(a.name));
          } else if (a.name === 'AcceptVerbs') {
            const verbs = a.positional.map(r => evalCs(f, r, lookup)).filter(v => typeof v === 'string').map(v => v.toUpperCase()).filter(v => STANDARD.has(v));
            if (a.named.has('Route')) selectors.push({ verbs: verbs.length ? verbs : ['ANY'], tpl: a.named.get('Route'), a });
            else free.push(...verbs);
          }
        }
        const methodRoutes = method.attrs.filter(a => a.name === 'Route');
        for (const a of methodRoutes) selectors.push({ verbs: free.length ? free : ['ANY'], tpl: a.positional[0] || a.named.get('Template'), a });
        if (!methodRoutes.length && free.length) selectors.push({ verbs: free, tpl: null });
        if (!selectors.length) {
          if (!classTemplates) continue; // conventional routing: not read
          selectors.push({ verbs: ['ANY'], tpl: null });
        }
        const actionAttr = method.attrs.find(a => a.name === 'ActionName');
        const actionName = (actionAttr && evalCs(f, actionAttr.positional[0], lookup)) || method.name.replace(/Async$/, '');
        const anon = has(method.attrs, 'AllowAnonymous') || classAnon;
        const auth = !anon && (has(method.attrs, 'Authorize') || classAuth || globalAuth);
        const line = lineAt(f, method.start);
        for (const sel of selectors) {
          const tpl = sel.tpl ? evalCs(f, sel.tpl, lookup) : '';
          let paths;
          if (typeof tpl !== 'string') paths = [null];
          else if (/^~?\//.test(tpl)) paths = [tpl];
          else if (classTemplates) paths = classTemplates.map(b => (typeof b === 'string' ? joinRoutePath(b, tpl) : null));
          else if (sel.tpl) paths = [tpl];
          else continue;
          for (const raw of paths) {
            const path = raw === null ? null : replaceTokens(raw, { controller: controllerName, action: actionName, area });
            if (path === null) { ctx.omitted.push({ file: f.file, line, reason: 'route template is not literal' }); continue; }
            for (const verb of sel.verbs) {
              ctx.routes.push({ method: verb, path: cleanPath(path), handler: `${type.name}.${method.name}`, file: f.file, line, auth });
            }
          }
        }
      }
    }
  }
}

/** Replace `[controller]`, `[action]` and `[area]`; `null` for any other token or a missing area. */
function replaceTokens(template, values) {
  let unknown = false;
  const out = template.replace(/\[\[|\]\]|\[([A-Za-z_]\w*)\]/g, (whole, name) => {
    if (whole === '[[') return '[';
    if (whole === ']]') return ']';
    const v = values[name.toLowerCase()];
    if (typeof v !== 'string') { unknown = true; return whole; }
    return v;
  });
  return unknown ? null : out;
}

// ── Minimal APIs ─────────────────────────────────────────────────────────────

const ROOT = Object.freeze({ prefix: '', auth: null, unknown: false });
const stateKey = s => `${s.prefix}|${s.auth}|${s.unknown}`;
const uniq = states => [...new Map(states.map(s => [stateKey(s), s])).values()];

function minimalApiRoutes(ctx) {
  const { files, lookup } = ctx;
  const routeMethods = new Map();
  for (const f of files) {
    for (const m of f.methods) {
      m.routerParams = m.params.map((p, i) => (ROUTER_TYPES.test(p.type) ? i : -1)).filter(i => i >= 0);
      if (!m.routerParams.length) continue;
      if (!routeMethods.has(m.name)) routeMethods.set(m.name, []);
      routeMethods.get(m.name).push(m);
    }
  }
  const scopeOf = (f, pos) => {
    let best = null;
    for (const m of f.methods) {
      if (m.body && m.body[0] <= pos && pos < m.body[1] && (!best || m.body[0] > best.body[0])) best = m;
    }
    return best ? { id: `${f.file}#${best.start}`, method: best, range: best.body } : { id: `${f.file}#top`, method: null, range: null };
  };

  // Chains: every `.Map*(` or `.RouteMethod(` call, walked back to its root.
  const chains = [];
  const bindings = new Map(); // `${scope.id}:${name}` → { f, range, scope }
  const plainCalls = [];
  for (const f of files) {
    const roots = new Set();
    const re = /\.\s*([A-Za-z_]\w*)\s*(?:<[^<>()]*>)?\s*\(/g;
    let m;
    while ((m = re.exec(f.code)) !== null) {
      if (!MAP_NAMES.has(m[1]) && !routeMethods.has(m[1])) continue;
      const root = chainRoot(f, m.index);
      if (root < 0 || roots.has(root)) continue;
      roots.add(root);
      const chain = parseChain(f, root);
      if (chain) chains.push({ ...chain, f, scope: scopeOf(f, root) });
    }
    const bind = /\b(?:var|RouteGroupBuilder|IEndpointRouteBuilder|IEndpointConventionBuilder)\s+([A-Za-z_]\w*)\s*=(?![=>])\s*/g;
    while ((m = bind.exec(f.code)) !== null) {
      const s = m.index + m[0].length;
      let e = s;
      for (; e < f.code.length && f.code[e] !== ';'; e++) if ('([{'.includes(f.code[e]) && f.pairs.has(e)) e = f.pairs.get(e);
      const scope = scopeOf(f, m.index);
      bindings.set(`${scope.id}:${m[1]}`, { f, range: [s, e], scope });
    }
    const declared = new Set(f.methods.map(x => x.namePos));
    for (const name of routeMethods.keys()) {
      const call = new RegExp(`(?<![.\\w])${name}\\s*\\(`, 'g');
      while ((m = call.exec(f.code)) !== null) {
        if (declared.has(m.index)) continue;
        const open = m.index + m[0].length - 1;
        if (!f.pairs.has(open)) continue;
        plainCalls.push({ f, name, args: splitTopLevel(f.code, f.pairs, open + 1, f.pairs.get(open)), scope: scopeOf(f, m.index) });
      }
    }
  }

  // Call sites of each route method: `recv.M(...)` (extension or static) and `M(...)`.
  const callSites = new Map();
  const addSite = (name, site) => { if (!callSites.has(name)) callSites.set(name, []); callSites.get(name).push(site); };
  for (const chain of chains) {
    chain.segments.forEach((seg, i) => { if (routeMethods.has(seg.name)) addSite(seg.name, { chain, index: i }); });
  }
  for (const call of plainCalls) addSite(call.name, { plain: call });

  const visiting = new Set();
  const rootStates = (name, scope) => {
    const binding = bindings.get(`${scope.id}:${name}`);
    if (binding) {
      const key = `b:${scope.id}:${name}`;
      if (visiting.has(key)) return [];
      visiting.add(key);
      const out = exprStates(binding.f, binding.range, binding.scope);
      visiting.delete(key);
      return out;
    }
    const method = scope.method;
    const idx = method ? method.params.findIndex(p => p.name === name) : -1;
    if (method && method.routerParams.includes(idx)) return paramStates(method, idx);
    return [ROOT];
  };
  const paramStates = (method, idx) => {
    const sites = callSites.get(method.name) || [];
    if (!sites.length) return [ROOT];
    const key = `p:${method.f.file}#${method.start}:${idx}`;
    if (visiting.has(key)) return [];
    visiting.add(key);
    const out = [];
    for (const site of sites) {
      if (site.plain) {
        const arg = site.plain.args[idx];
        if (arg) out.push(...exprStates(site.plain.f, arg, site.plain.scope));
        continue;
      }
      const { chain, index } = site;
      const seg = chain.segments[index];
      if (method.isExtension) {
        if (idx === 0) out.push(...applySegments(chain, rootStates(chain.root, chain.scope), index).states);
        else if (seg.args[idx - 1]) out.push(...exprStates(chain.f, seg.args[idx - 1], chain.scope));
      } else if (seg.args[idx]) {
        out.push(...exprStates(chain.f, seg.args[idx], chain.scope));
      }
    }
    visiting.delete(key);
    return uniq(out);
  };
  /** The group states of an expression: a chain from a root name, or a bare name. */
  const exprStates = (f, range, scope) => {
    const [s, e] = trimRange(f.code, ...range);
    const chain = parseChain(f, s);
    if (!chain || chain.end < e) return [{ ...ROOT, unknown: true }];
    return applySegments({ ...chain, f, scope }, rootStates(chain.root, scope), chain.segments.length).states;
  };
  /** Apply group segments (`MapGroup`, `RequireAuthorization`, `AllowAnonymous`) up to `limit`. */
  const applySegments = (chain, states, limit) => ({
    states: uniq(states.map(state => {
      let cur = state;
      for (const seg of chain.segments.slice(0, limit)) {
        if (seg.name === 'MapGroup') {
          const tpl = evalCs(chain.f, seg.args[0], lookup);
          cur = typeof tpl === 'string' ? { ...cur, prefix: joinRoutePath(cur.prefix, tpl) } : { ...cur, unknown: true };
        } else if (seg.name === 'RequireAuthorization') cur = { ...cur, auth: true };
        else if (seg.name === 'AllowAnonymous') cur = { ...cur, auth: false };
        else if (MAP_VERBS.has(seg.name) || seg.name === 'MapMethods') break;
      }
      return cur;
    })),
  });

  for (const chain of chains) {
    const states = rootStates(chain.root, chain.scope);
    for (const state of states) emitChain(ctx, chain, state);
  }
}

/** Walk back from the `.` of a call to the start of its receiver chain; -1 when the receiver is not a name chain. */
function chainRoot(f, dot) {
  const { code, pairs } = f;
  let i = skipWsBack(code, dot - 1);
  for (let guard = 0; guard < 64; guard++) {
    if (code[i] === ')' && pairs.has(i)) {
      let j = skipWsBack(code, pairs.get(i) - 1);
      if (code[j] === '>') {
        let depth = 0;
        for (; j >= 0; j--) { if (code[j] === '>') depth++; else if (code[j] === '<' && --depth === 0) break; }
        j = skipWsBack(code, j - 1);
      }
      if (!/\w/.test(code[j] || '')) return -1;
      while (j > 0 && /\w/.test(code[j - 1])) j--;
      const before = skipWsBack(code, j - 1);
      if (code[before] === '.') { i = skipWsBack(code, before - 1); continue; }
      return j;
    }
    if (/\w/.test(code[i] || '')) {
      let j = i;
      while (j > 0 && /\w/.test(code[j - 1])) j--;
      const before = skipWsBack(code, j - 1);
      if (code[before] === '.') { i = skipWsBack(code, before - 1); continue; }
      return /^[A-Za-z_]/.test(code[j]) ? j : -1;
    }
    return -1;
  }
  return -1;
}

/** `root(.Name<T>(args) | .Name)*` from `start`: the root name and the call segments. */
function parseChain(f, start) {
  const { code, pairs } = f;
  const head = /^[A-Za-z_]\w*/.exec(code.slice(start, start + 128));
  if (!head) return null;
  let i = start + head[0].length;
  const segments = [];
  let rootIsCall = false;
  let j = skipWs(code, i);
  if (code[j] === '(' && pairs.has(j)) { rootIsCall = true; i = pairs.get(j) + 1; }
  for (;;) {
    j = skipWs(code, i);
    if (code[j] !== '.') break;
    j = skipWs(code, j + 1);
    const name = /^[A-Za-z_]\w*/.exec(code.slice(j, j + 128));
    if (!name) break;
    j += name[0].length;
    let k = skipWs(code, j);
    if (code[k] === '<') {
      const gen = /^<[^<>()]*>/.exec(code.slice(k, k + 256));
      if (gen) k = skipWs(code, k + gen[0].length);
    }
    if (code[k] === '(' && pairs.has(k)) {
      segments.push({ name: name[0], args: splitTopLevel(code, pairs, k + 1, pairs.get(k)), pos: j - name[0].length });
      i = pairs.get(k) + 1;
    } else {
      segments.push({ name: name[0], args: null, pos: j - name[0].length, property: true });
      i = j;
    }
  }
  return { root: rootIsCall ? `${head[0]}()` : head[0], segments, end: i };
}

function emitChain(ctx, chain, state) {
  const { f } = chain;
  let cur = state;
  let pending = null;
  const flush = () => {
    if (!pending) return;
    const { verbs, tpl, seg, handler, auth } = pending;
    const line = lineAt(f, seg.pos);
    if (cur.unknown || typeof tpl !== 'string') {
      ctx.omitted.push({ file: f.file, line, reason: 'route pattern or group prefix is not literal' });
    } else {
      for (const verb of verbs) ctx.routes.push({ method: verb, path: cleanPath(joinRoutePath(cur.prefix, tpl)), handler, file: f.file, line, auth: auth === null ? !!cur.auth : auth });
    }
    pending = null;
  };
  for (const seg of chain.segments) {
    if (seg.property) continue;
    if (pending) {
      if (seg.name === 'RequireAuthorization') pending.auth = true;
      else if (seg.name === 'AllowAnonymous') pending.auth = false;
      continue;
    }
    if (seg.name === 'MapGroup') {
      const tpl = evalCs(f, seg.args[0], ctx.lookup);
      cur = typeof tpl === 'string' ? { ...cur, prefix: joinRoutePath(cur.prefix, tpl) } : { ...cur, unknown: true };
    } else if (seg.name === 'RequireAuthorization') cur = { ...cur, auth: true };
    else if (seg.name === 'AllowAnonymous') cur = { ...cur, auth: false };
    else if (MAP_VERBS.has(seg.name) || seg.name === 'MapMethods' || seg.name === 'Map' || seg.name === 'MapHealthChecks') {
      const tpl = seg.args[0] ? evalCs(f, seg.args[0], ctx.lookup) : null;
      if (seg.name === 'Map' && !(typeof tpl === 'string' && tpl.startsWith('/'))) break; // AutoMapper's Map(), not a route
      let verbs = ['ANY'];
      let handlerArg = seg.args[1];
      if (MAP_VERBS.has(seg.name)) verbs = [MAP_VERBS.get(seg.name)];
      if (seg.name === 'MapMethods') {
        const list = seg.args[1];
        verbs = [];
        if (list) for (const [start, lit] of f.lits) if (start >= list[0] && start < list[1] && typeof lit.value === 'string') verbs.push(lit.value.toUpperCase());
        verbs = verbs.filter(v => STANDARD.has(v));
        handlerArg = seg.args[2];
        if (!verbs.length) { ctx.omitted.push({ file: f.file, line: lineAt(f, seg.pos), reason: 'methods are not literal' }); break; }
      }
      const handlerText = handlerArg ? f.code.slice(...handlerArg).trim() : '';
      let auth = null;
      if (/^\[\s*(?:[\w.]+\.)?Authorize\b/.test(handlerText)) auth = true;
      if (/^\[\s*(?:[\w.]+\.)?AllowAnonymous\b/.test(handlerText)) auth = false;
      const handler = /^[A-Za-z_][\w.]*$/.test(handlerText) ? handlerText : handlerText ? 'inline' : '';
      pending = { verbs, tpl, seg, handler, auth };
    }
  }
  flush();
}
