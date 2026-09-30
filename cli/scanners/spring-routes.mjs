/**
 * Spring route reader (Java and Kotlin).
 *
 * A Spring route is the class-level `@RequestMapping` base joined to a
 * method-level mapping's path. Both annotations take the path in several
 * forms — positional, `value =`, `path =`, a Java `{…}` or Kotlin `[…]` array,
 * a constant, a `+` of constants — and `@RequestMapping` also takes
 * `method =`. Reading `@GetMapping("…")` alone, as the old pattern did, lost
 * every base written with `path =` (so a bare `@GetMapping` became `GET /`)
 * and every `@RequestMapping(method = …)` route.
 *
 * The reader masks comments, collects each run of annotations with the
 * declaration that follows it, and gives a method the base of the innermost
 * class around it. A `@FeignClient` interface declares outbound calls, not
 * routes, and is skipped. A path that is not literal text or a resolvable
 * constant (a `${…}` placeholder, a Kotlin template) is omitted.
 *
 * @implements docguard.go-spring-rails-routes#FR-003
 * @implements docguard.go-spring-rails-routes#FR-004
 * @implements docguard.go-spring-rails-routes#FR-006
 */

import { lexCLike, matchPairs, splitTopLevel, trimRange, literalIn } from './route-lexing.mjs';

const VERB_ANNOTATIONS = new Map([
  ['GetMapping', 'GET'], ['PostMapping', 'POST'], ['PutMapping', 'PUT'],
  ['DeleteMapping', 'DELETE'], ['PatchMapping', 'PATCH'],
]);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE']);
const MODIFIERS = /^(?:public|protected|private|static|final|abstract|open|internal|override|suspend|data|sealed|inner|default|synchronized|native|operator|inline|infix|tailrec|external|lateinit|strictfp|transient|volatile|annotation|value)\b\s*/;
const TYPE_KEYWORDS = new Set(['class', 'interface', 'object', 'enum', 'record']);
const AUTH = /@PreAuthorize|@Secured|SecurityContext/;

/**
 * Read the routes of a Spring project.
 * @param {Array<{ file: string, content: string }>} sources  `.java` / `.kt` files, project-relative paths
 * @returns {Array<{ method: string, path: string, handler: string, file: string, auth: boolean }>}
 */
export function extractSpringRoutes(sources) {
  const files = [];
  for (const s of sources || []) {
    if (!s || typeof s.content !== 'string') continue;
    const kotlin = /\.kts?$/.test(s.file);
    const { code, lits } = lexCLike(s.content, { tripleQuote: true, nestedComments: kotlin, templates: kotlin });
    const f = { file: s.file, src: s.content, code, lits, pairs: matchPairs(code) };
    f.types = findTypes(f);
    files.push(f);
  }
  const consts = collectConstants(files);
  const routes = [];
  const seen = new Set();
  for (const f of files) {
    if (!f.code.includes('Mapping')) continue;
    for (const r of fileRoutes(f, consts)) {
      const key = `${r.method} ${r.path} ${r.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(r);
    }
  }
  return routes;
}

// ── Declarations ─────────────────────────────────────────────────────────────

/** Every class / interface / object / enum / record, with its body range. */
function findTypes(f) {
  const { code, pairs } = f;
  const types = [];
  const re = /\b(class|interface|object|enum|record)\s+([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const before = code.slice(Math.max(0, m.index - 2), m.index);
    if (/[.@:]\s*$/.test(before) || TYPE_KEYWORDS.has(m[2])) continue; // Foo.class, @interface, ::class
    const open = bodyOpenAfter(code, pairs, m.index + m[0].length);
    types.push({ keyword: m[1], name: m[2], start: m.index, open, close: open >= 0 ? pairs.get(open) : -1 });
  }
  return types;
}

/** The `{` of a type body, past a constructor, supertypes and generics; -1 when the type has none. */
function bodyOpenAfter(code, pairs, i) {
  let angle = 0;
  for (; i < code.length; i++) {
    const c = code[i];
    if ((c === '(' || c === '[') && pairs.has(i)) { i = pairs.get(i); continue; }
    if (c === '<') angle++;
    else if (c === '>' && angle > 0) angle--;
    else if (angle === 0 && c === '{') return pairs.has(i) ? i : -1;
    else if (angle === 0 && (c === ';' || c === '@' || c === '}')) return -1;
    else if (angle === 0 && /[A-Za-z_]/.test(c) && !/\w/.test(code[i - 1] || '')) {
      const w = /^[A-Za-z_]\w*/.exec(code.slice(i, i + 32))[0];
      if (w === 'fun' || w === 'val' || w === 'var' || TYPE_KEYWORDS.has(w)) return -1;
      i += w.length - 1;
    }
  }
  return -1;
}

/** Innermost type whose body contains `pos`. */
function enclosingType(types, pos) {
  let best = null;
  for (const t of types) {
    if (t.open >= 0 && t.open < pos && pos < t.close && (!best || t.open > best.open)) best = t;
  }
  return best;
}

/** Each annotation: name (last segment), start, end, and argument range. */
function findAnnotations(f) {
  const { code, pairs } = f;
  const out = [];
  const re = /@\s*([A-Za-z_][\w.]*)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (m[1] === 'interface') continue;
    let end = m.index + m[0].length;
    let args = null;
    let j = end;
    while (j < code.length && /[ \t]/.test(code[j])) j++;
    if (code[j] === '(' && pairs.has(j)) {
      args = [j + 1, pairs.get(j)];
      end = pairs.get(j) + 1;
    }
    out.push({ name: m[1].split('.').pop(), start: m.index, end, args });
  }
  return out;
}

/** What follows an annotation run: a type (by start) or a member (method name). */
function declAt(f, pos) {
  const { code } = f;
  let i = pos;
  for (let guard = 0; guard < 16; guard++) {
    const mod = MODIFIERS.exec(code.slice(i, i + 32));
    if (!mod) break;
    i += mod[0].length;
  }
  const rest = code.slice(i, i + 512);
  const type = /^(?:class|interface|object|enum|record)\s+([A-Za-z_]\w*)/.exec(rest);
  if (type) return { kind: 'type', start: i };
  const fun = /^fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/.exec(rest);
  if (fun) return { kind: 'member', name: fun[1] };
  const method = /^(?:<[^>]*>\s*)?[\w.<>?,[\]\s]+?\b([A-Za-z_]\w*)\s*\(/.exec(rest);
  if (method) return { kind: 'member', name: method[1] };
  return null;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** `static final String X = …` / `String X = …` (interface) / Kotlin `const val X = …`, by `Type.X` and `X`. */
function collectConstants(files) {
  const byKey = new Map();
  const put = (key, def) => {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(def);
  };
  for (const f of files) {
    const { code, pairs } = f;
    const decl = /\b(?:String|const\s+val)\s+([A-Za-z_]\w*)\s*(?::\s*String\s*)?=\s*/g;
    let m;
    while ((m = decl.exec(code)) !== null) {
      const s = m.index + m[0].length;
      let e = s;
      for (; e < code.length; e++) {
        const c = code[e];
        if ((c === '(' || c === '[' || c === '{') && pairs.has(e)) { e = pairs.get(e); continue; }
        if (c === ';' || c === '\n' && !/\+\s*$/.test(code.slice(s, e))) break;
      }
      const owner = enclosingType(f.types, m.index);
      const def = { f, s, e };
      put(m[1], def);
      if (owner) put(`${owner.name}.${m[1]}`, def);
    }
  }
  const cache = new Map();
  const lookup = (ref, seen = new Set()) => {
    const parts = ref.split('.');
    const keys = parts.length >= 2 ? [parts.slice(-2).join('.'), parts[parts.length - 1]] : [ref];
    for (const key of keys) {
      if (cache.has(key)) return cache.get(key);
      const defs = byKey.get(key);
      if (!defs || seen.has(key)) continue;
      seen.add(key);
      const values = new Set(defs.map(d => evalString(d.f, [d.s, d.e], r => lookup(r, seen))));
      const value = values.size === 1 ? [...values][0] : null;
      cache.set(key, value);
      return value;
    }
    return null;
  };
  return { lookup };
}

/** Literals, constant references and `+`. `null` for anything unknown or a `${…}` placeholder. */
function evalString(f, [s, e], lookupConst) {
  const parts = splitTopLevel(f.code, f.pairs, s, e, '+');
  if (!parts.length) return null;
  let out = '';
  for (const [a, b] of parts) {
    const lit = literalIn(f.code, f.lits, a, b);
    if (typeof lit === 'string') { out += lit; continue; }
    if (lit === null) return null;
    const ref = f.code.slice(a, b).trim();
    if (!/^[A-Za-z_][\w.]*$/.test(ref)) return null;
    const v = lookupConst(ref);
    if (typeof v !== 'string') return null;
    out += v;
  }
  return out.includes('${') ? null : out;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** `{a, b}`, `[a, b]`, `arrayOf(a, b)` or a single value → element ranges. */
function elements(f, range) {
  const [s, e] = trimRange(f.code, ...range);
  const c = f.code[s];
  if ((c === '{' || c === '[') && f.pairs.get(s) === e - 1) return splitTopLevel(f.code, f.pairs, s + 1, e - 1);
  const call = /^arrayOf\s*\(/.exec(f.code.slice(s, e));
  if (call && f.pairs.get(s + call[0].length - 1) === e - 1) return splitTopLevel(f.code, f.pairs, s + call[0].length, e - 1);
  return [[s, e]];
}

/** The paths an annotation declares: `[""]` when it declares none; `null` entries are unresolvable. */
function annotationPaths(f, ann, consts) {
  if (!ann.args) return [''];
  let range = null;
  for (const part of splitTopLevel(f.code, f.pairs, ...ann.args)) {
    const named = /^([A-Za-z_]\w*)\s*=\s*/.exec(f.code.slice(...part));
    if (!named) { if (!range) range = part; continue; }
    if (named[1] === 'value' || named[1] === 'path') range = [part[0] + named[0].length, part[1]];
  }
  if (!range) return [''];
  const list = elements(f, range);
  return list.length ? list.map(r => evalString(f, r, consts.lookup)) : [''];
}

/** `@RequestMapping(method = …)`: its methods, or `['ANY']` when it names none. */
function annotationMethods(f, ann) {
  if (!ann.args) return ['ANY'];
  for (const part of splitTopLevel(f.code, f.pairs, ...ann.args)) {
    const named = /^method\s*=\s*/.exec(f.code.slice(...part));
    if (!named) continue;
    const methods = elements(f, [part[0] + named[0].length, part[1]])
      .map(r => f.code.slice(...r).trim().split('.').pop().toUpperCase())
      .filter(m => HTTP_METHODS.has(m));
    return methods.length ? methods : ['ANY'];
  }
  return ['ANY'];
}

function springJoin(base, path) {
  const left = String(base).replace(/\/+$/, '');
  const right = path ? '/' + String(path).replace(/^\/+/, '') : '';
  const joined = (left + right).replace(/\/{2,}/g, '/');
  if (!joined) return '/';
  return joined.startsWith('/') ? joined : '/' + joined;
}

function fileRoutes(f, consts) {
  const annotations = findAnnotations(f);
  const byStart = new Map(annotations.map(a => [a.start, a]));
  const typeAt = new Map(f.types.map(t => [t.start, t]));
  const classInfo = new Map(); // type → { bases: string[] | null (skip) }
  const members = [];
  for (let i = 0; i < annotations.length;) {
    const run = [annotations[i]];
    let end = annotations[i].end;
    let j = i + 1;
    for (; j < annotations.length; j++) {
      let k = end;
      while (k < f.code.length && /\s/.test(f.code[k])) k++;
      if (byStart.get(k) !== annotations[j]) break;
      run.push(annotations[j]);
      end = annotations[j].end;
    }
    i = j;
    let k = end;
    while (k < f.code.length && /\s/.test(f.code[k])) k++;
    const decl = declAt(f, k);
    if (!decl) continue;
    if (decl.kind === 'type') {
      const type = typeAt.get(decl.start);
      if (!type) continue;
      if (run.some(a => a.name === 'FeignClient')) { classInfo.set(type, { bases: null }); continue; }
      const mapping = run.find(a => a.name === 'RequestMapping');
      const bases = mapping ? annotationPaths(f, mapping, consts).filter(p => typeof p === 'string') : [''];
      classInfo.set(type, { bases: bases.length ? bases : null });
    } else {
      const mapping = run.find(a => VERB_ANNOTATIONS.has(a.name) || a.name === 'RequestMapping');
      if (mapping) members.push({ mapping, name: decl.name });
    }
  }
  const routes = [];
  const auth = AUTH.test(f.src);
  for (const { mapping, name } of members) {
    const owner = enclosingType(f.types, mapping.start);
    const info = owner ? classInfo.get(owner) : null;
    const bases = info ? info.bases : [''];
    if (!bases) continue; // a Feign client, or a base that cannot be resolved
    const methods = VERB_ANNOTATIONS.has(mapping.name) ? [VERB_ANNOTATIONS.get(mapping.name)] : annotationMethods(f, mapping);
    for (const sub of annotationPaths(f, mapping, consts)) {
      if (typeof sub !== 'string') continue; // FR-006: omitted, not guessed
      for (const base of bases) {
        for (const method of methods) {
          routes.push({ method, path: springJoin(base, sub), handler: name, file: f.file, auth });
        }
      }
    }
  }
  return routes;
}
