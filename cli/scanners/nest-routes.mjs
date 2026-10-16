/**
 * NestJS route extraction (docguard.js-framework-routes).
 *
 * Nest declares routes with decorators: `@Controller(path)` on a class and
 * `@Get(path)`, `@Post(path)`, … on its methods. The served path is composed
 * the way Nest's RoutePathFactory composes it: version segment, RouterModule
 * path, controller path, method path, then the global prefix unless the route
 * is excluded from it (the exclusion is matched without the version).
 *
 * One syntax-tree pass per file collects controllers and their methods,
 * `@Module({ controllers })` lists, `RouterModule.register` tables and the
 * application settings (`setGlobalPrefix`, `enableVersioning`,
 * `useGlobalGuards`, `APP_GUARD` providers). A file that does not parse is
 * read by a pattern fallback with the same output. A path that is not a
 * literal or a same-file constant is recorded as a limitation, never guessed.
 *
 * @implements docguard.js-framework-routes#FR-001
 * @implements docguard.js-framework-routes#FR-002
 * @implements docguard.js-framework-routes#FR-003
 * @implements docguard.js-framework-routes#FR-006
 */

import { dirname } from 'node:path';
import { walk, isAuthMiddlewareName, topLevelStaticStrings, pathArgValue } from './js-ast.mjs';
import { matchPairs, splitTopLevel, literalIn, trimRange } from './route-lexing.mjs';
import { parseWithTier, lineAt, joinSegments, isTestFile, nodeText, lexJs } from './js-route-support.mjs';

const FRAMEWORK = 'NestJS';
const METHOD_DECORATORS = { __proto__: null, Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', All: 'ALL', Head: 'HEAD', Options: 'OPTIONS', Search: 'SEARCH' };
/** Nest's own decorators: never a custom auth decorator. */
const NEST_DECORATORS = new Set([
  ...Object.keys(METHOD_DECORATORS), 'Controller', 'Module', 'Injectable', 'UseGuards', 'Version', 'Param', 'Body',
  'Query', 'Headers', 'Req', 'Request', 'Res', 'Response', 'HttpCode', 'Header', 'Redirect', 'Render', 'UsePipes',
  'UseInterceptors', 'UseFilters', 'SetMetadata', 'Ip', 'HostParam', 'Session', 'Next', 'UploadedFile', 'UploadedFiles',
]);
const NEUTRAL = '\0version-neutral';
/** The usual names of a decorator that exempts a route from a global auth guard. */
const PUBLIC_DECORATOR = /^(?:Public|IsPublic|PublicRoute|AllowAnonymous|Anonymous|SkipAuth|NoAuth|Unprotected|AllowUnauthenticated)$/;
const AUTHZ_WORDS = new Set(['role', 'roles', 'permission', 'permissions', 'session', 'token', 'acl', 'policy', 'policies',
  'scope', 'scopes', 'admin', 'casl', 'ability', 'abilities', 'owner', 'user', 'tenant']);

/**
 * True when a guard's name signals authentication or authorization. Every Nest
 * guard ends in `Guard`, which `isAuthMiddlewareName` counts as auth, so the
 * suffix is dropped first: `JwtAuthGuard`, `RolesGuard`, `ApiKeyGuard` are
 * auth; `ThrottlerGuard` is not.
 * @implements docguard.js-framework-routes#FR-003
 */
export function isNestAuthGuardName(name) {
  if (!name || typeof name !== 'string') return false;
  const base = name.replace(/Guard$/, '');
  if (!base) return false;
  const words = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_\-.$]+/).filter(Boolean).map(w => w.toLowerCase());
  if (words.some(w => AUTHZ_WORDS.has(w)) || words.join('').includes('apikey')) return true;
  return isAuthMiddlewareName(base);
}

function guardName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'CallExpression' || node.type === 'NewExpression') return guardName(node.callee);
  if (node.type === 'MemberExpression' && !node.computed) return node.property?.name || '';
  return '';
}

/** A custom decorator named for auth (`@Auth()`, `@RequireAuth()`); Swagger `@Api*` documents, it does not enforce. */
function isCustomAuthDecorator(name) {
  return !NEST_DECORATORS.has(name) && !/^Api/.test(name) && !PUBLIC_DECORATOR.test(name) && isAuthMiddlewareName(name);
}

const posixDir = rel => { const d = dirname(rel); return d === '.' ? '' : d; };
const emptySettings = () => ({ prefix: undefined, exclude: [], versioning: undefined, globalAuth: false });

/**
 * NestJS routes of a project.
 * @param {Array<{ file: string, abs: string, content: string }>} sources  `file` is project-relative POSIX
 * @param {{ config?: object }} [opts]
 * @returns {Array<object>} routes, with non-enumerable `limitations` and `fileTiers`
 */
export function extractNestRoutes(sources, { config = {} } = {}) {
  const controllers = [];
  const settings = [];
  const moduleOf = new Map();     // controller class -> module class
  const routerPaths = new Map();  // module class -> RouterModule path
  const limitations = [];
  const fileTiers = [];
  const limit = (code, file, line, target = '') => limitations.push({ framework: FRAMEWORK, code, file, line, target });

  for (const src of sources) {
    const { ast, tier, tierReason } = parseWithTier(src.content, src.abs);
    fileTiers.push({ file: src.file, tier, tierReason });
    const facts = ast ? factsFromAst(ast, src, limit) : factsByPattern(src, limit);
    for (const c of facts.controllers) controllers.push({ ...c, file: src.file, tier, tierReason });
    for (const [ctrl, mod] of facts.modules) moduleOf.set(ctrl, mod);
    for (const [mod, path] of facts.routerPaths) routerPaths.set(mod, path);
    const s = facts.settings;
    if ((s.prefix !== undefined || s.versioning || s.globalAuth) && !isTestFile(src.file, config)) {
      settings.push({ ...s, dir: posixDir(src.file), file: src.file });
    }
  }

  // Settings apply to the controllers under the directory that declares them
  // (one `main.ts` per app in a monorepo); with one application, everywhere.
  const settingsFor = (file) => {
    const dir = posixDir(file);
    let pool = settings.filter(s => s.dir === '' || dir === s.dir || dir.startsWith(`${s.dir}/`));
    if (!pool.length && settings.length) {
      if (new Set(settings.map(s => s.dir)).size > 1) return null;
      pool = settings;
    }
    const merged = emptySettings();
    for (const s of [...pool].sort((a, b) => a.dir.length - b.dir.length)) {
      if (s.prefix !== undefined) { merged.prefix = s.prefix; merged.exclude = s.exclude; }
      if (s.versioning) merged.versioning = s.versioning;
      merged.globalAuth = merged.globalAuth || s.globalAuth;
    }
    return merged;
  };

  const routes = [];
  for (const ctrl of controllers) {
    const app = settingsFor(ctrl.file);
    if (!app) { limit('nest-ambiguous-application', ctrl.file, ctrl.line, ctrl.className); continue; }
    // A prefix or versioning that is set but unreadable changes every path under it.
    if (app.prefix === null) { limit('nest-unresolved-prefix', ctrl.file, ctrl.line, ctrl.className); continue; }
    if (app.versioning === 'unknown') { limit('nest-unresolved-versioning', ctrl.file, ctrl.line, ctrl.className); continue; }
    const modulePath = routerPaths.get(moduleOf.get(ctrl.className)) || '';
    for (const m of ctrl.methods) {
      const versions = m.versions ?? ctrl.versions ?? app.versioning?.defaults ?? [undefined];
      for (const cp of ctrl.paths) for (const mp of m.paths) for (const v of versions) {
        const versionSeg = app.versioning?.uri && v !== undefined && v !== NEUTRAL ? `${app.versioning.prefix}${v}` : '';
        const unprefixed = joinSegments(modulePath, cp, mp);
        const excluded = app.prefix !== undefined && excludedFromPrefix(app.exclude, unprefixed, m.method);
        routes.push({
          method: m.method,
          path: joinSegments(excluded ? '' : app.prefix, versionSeg, unprefixed),
          handler: m.name,
          file: ctrl.file,
          line: m.line,
          source: 'nestjs',
          auth: Boolean(m.auth || ctrl.auth || (app.globalAuth && !m.public && !ctrl.public)),
          description: '',
          tier: ctrl.tier,
          tierReason: ctrl.tierReason,
        });
      }
    }
  }
  Object.defineProperty(routes, 'limitations', { value: limitations, enumerable: false });
  Object.defineProperty(routes, 'fileTiers', { value: fileTiers, enumerable: false });
  return routes;
}

/** `setGlobalPrefix(…, { exclude })`: a path (with `:param`, `*`, `(.*)`) and an optional method. */
function excludedFromPrefix(exclude, path, method) {
  return exclude.some(ex => (ex.method === null || ex.method === method) && excludeRegex(ex.path).test(path));
}

function excludeRegex(pattern) {
  const norm = joinSegments(pattern);
  let src = '';
  for (let i = 0; i < norm.length;) {
    const param = /^:[A-Za-z_$][\w$]*/.exec(norm.slice(i));
    if (param) { src += '[^/]+'; i += param[0].length; continue; }
    if (norm.startsWith('(.*)', i)) { src += '.*'; i += 4; continue; }
    const ch = norm[i];
    src += ch === '*' ? '.*' : /[.+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
    i++;
  }
  return new RegExp(`^${src}$`);
}

// ── Syntax-tree tier ─────────────────────────────────────────────────────────

function propValue(obj, key) {
  if (obj?.type !== 'ObjectExpression') return undefined;
  const p = (obj.properties || []).find(q => q.type === 'ObjectProperty' && !q.computed && (q.key?.name ?? q.key?.value) === key);
  return p ? p.value : undefined;
}

function factsFromAst(ast, src, limit) {
  const { content, file } = src;
  const constants = topLevelStaticStrings(ast);
  const nestImports = new Map();
  const topLevel = new Map();
  for (const st of ast.program?.body || []) {
    if (st.type === 'ImportDeclaration' && st.source?.value === '@nestjs/common') {
      for (const sp of st.specifiers || []) if (sp.type === 'ImportSpecifier') nestImports.set(sp.local.name, sp.imported?.name ?? sp.imported?.value);
    }
    const decl = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
    if (decl?.type === 'VariableDeclaration') for (const d of decl.declarations || []) if (d.id?.type === 'Identifier' && d.init) topLevel.set(d.id.name, d.init);
  }
  const facts = { controllers: [], modules: new Map(), routerPaths: new Map(), settings: emptySettings() };
  const lineOf = node => node?.loc?.start.line ?? lineAt(content, node?.start ?? 0);
  const one = node => { const v = pathArgValue(node, constants, false); return typeof v === 'string' ? v : null; };
  const pathList = (node) => {
    if (node === undefined) return [''];
    if (node.type === 'ArrayExpression') { const vals = (node.elements || []).map(one); return vals.includes(null) ? null : vals; }
    const v = one(node);
    return v === null ? null : [v];
  };
  const versionOne = node => (node?.type === 'Identifier' && node.name === 'VERSION_NEUTRAL' ? NEUTRAL : one(node));
  const versionList = (node) => {
    if (node?.type === 'ArrayExpression') { const vals = (node.elements || []).map(versionOne); return vals.includes(null) ? null : vals; }
    const v = versionOne(node);
    return v === null ? null : [v];
  };
  const decoratorsOf = (list) => (list || []).map(d => {
    const e = d.expression;
    if (e?.type === 'CallExpression' && e.callee?.type === 'Identifier') return { local: e.callee.name, args: e.arguments || [], node: d };
    if (e?.type === 'Identifier') return { local: e.name, args: [], node: d };
    return null;
  }).filter(Boolean).map(d => ({ ...d, nest: nestImports.get(d.local) || null }));
  const isGuards = d => d.nest === 'UseGuards' || d.local === 'UseGuards';
  const isAuth = d => (isGuards(d) ? d.args.some(a => isNestAuthGuardName(guardName(a))) : !d.nest && isCustomAuthDecorator(d.local));
  const isPublic = d => !d.nest && PUBLIC_DECORATOR.test(d.local);

  const classFacts = (cls) => {
    const decos = decoratorsOf(cls.decorators);
    const mod = decos.find(d => d.nest === 'Module' || d.local === 'Module');
    if (mod) {
      const list = propValue(mod.args[0], 'controllers');
      for (const el of list?.elements || []) if (el?.type === 'Identifier' && cls.id?.name) facts.modules.set(el.name, cls.id.name);
    }
    const ctrl = decos.find(d => d.nest === 'Controller');
    if (!ctrl) return;
    const arg = ctrl.args[0];
    let paths = [''];
    let versions;
    if (arg?.type === 'ObjectExpression') {
      const p = propValue(arg, 'path');
      if (p !== undefined) paths = pathList(p);
      const v = propValue(arg, 'version');
      if (v !== undefined) versions = versionList(v);
    } else if (arg) paths = pathList(arg);
    if (paths === null || versions === null) {
      limit(paths === null ? 'nest-unresolved-path' : 'nest-unresolved-version', file, lineOf(ctrl.node), nodeText(content, arg));
      return;
    }
    const methods = [];
    for (const member of cls.body?.body || []) {
      if (member.type !== 'ClassMethod' || !member.decorators?.length) continue;
      const md = decoratorsOf(member.decorators);
      const verbs = md.filter(d => METHOD_DECORATORS[d.nest]);
      if (!verbs.length) continue;
      const name = member.key?.name ?? member.key?.value ?? '';
      const ver = md.find(d => d.nest === 'Version' || d.local === 'Version');
      const mVersions = ver ? versionList(ver.args[0]) : undefined;
      if (mVersions === null) { limit('nest-unresolved-version', file, lineOf(ver.node), nodeText(content, ver.args[0])); continue; }
      for (const verb of verbs) {
        const mp = pathList(verb.args[0]);
        if (mp === null) { limit('nest-unresolved-path', file, lineOf(verb.node), nodeText(content, verb.args[0])); continue; }
        methods.push({ name, method: METHOD_DECORATORS[verb.nest], paths: mp, versions: mVersions, line: lineOf(verb.node), auth: md.some(isAuth), public: md.some(isPublic) });
      }
    }
    facts.controllers.push({ className: cls.id?.name || '', paths, versions, auth: decos.some(isAuth), public: decos.some(isPublic), line: lineOf(ctrl.node), methods });
  };

  const readRouterTable = (node, parent) => {
    if (node?.type !== 'ArrayExpression') return false;
    for (const el of node.elements || []) {
      if (el?.type === 'Identifier') { facts.routerPaths.set(el.name, parent); continue; }
      if (el?.type !== 'ObjectExpression') return false;
      const pathNode = propValue(el, 'path');
      const p = pathNode === undefined ? '' : one(pathNode);
      if (p === null) return false;
      const full = joinSegments(parent, p);
      const mod = propValue(el, 'module');
      if (mod?.type === 'Identifier') facts.routerPaths.set(mod.name, full);
      const children = propValue(el, 'children');
      if (children !== undefined && !readRouterTable(children, full)) return false;
    }
    return true;
  };

  const callFacts = (call) => {
    const callee = call.callee;
    if (callee?.type !== 'MemberExpression' || callee.computed) return;
    const name = callee.property?.name;
    const [first, second] = call.arguments || [];
    if (name === 'setGlobalPrefix') {
      const prefix = first ? one(first) : null;
      facts.settings.prefix = prefix; // null: set, but not readable
      if (prefix === null) { limit('nest-unresolved-prefix', file, lineOf(call), nodeText(content, first)); return; }
      const ex = propValue(second, 'exclude');
      if (ex === undefined) return;
      if (ex.type !== 'ArrayExpression') { limit('nest-unresolved-prefix-exclude', file, lineOf(call), nodeText(content, ex)); return; }
      for (const el of ex.elements || []) {
        const p = el?.type === 'ObjectExpression' ? one(propValue(el, 'path')) : one(el);
        const m = el?.type === 'ObjectExpression' ? propValue(el, 'method') : undefined;
        const method = m?.type === 'MemberExpression' && !m.computed ? m.property?.name : null;
        if (p === null) { limit('nest-unresolved-prefix-exclude', file, lineOf(el), nodeText(content, el)); continue; }
        facts.settings.exclude.push({ path: p, method: method && method !== 'ALL' ? method : null });
      }
    } else if (name === 'enableVersioning') {
      const type = propValue(first, 'type');
      const typeName = type?.type === 'MemberExpression' && !type.computed ? type.property?.name
        : type?.type === 'NumericLiteral' ? ['URI', 'HEADER', 'MEDIA_TYPE', 'CUSTOM'][type.value] : null;
      const pfx = propValue(first, 'prefix');
      const prefix = pfx === undefined ? 'v' : pfx.type === 'BooleanLiteral' && !pfx.value ? '' : one(pfx);
      const dv = propValue(first, 'defaultVersion');
      const defaults = dv === undefined ? undefined : versionList(dv);
      if (!typeName || (typeName === 'URI' && (prefix === null || defaults === null))) {
        facts.settings.versioning = 'unknown';
        limit('nest-unresolved-versioning', file, lineOf(call), nodeText(content, first));
        return;
      }
      facts.settings.versioning = { uri: typeName === 'URI', prefix, defaults };
    } else if (name === 'useGlobalGuards') {
      if ((call.arguments || []).some(a => isNestAuthGuardName(guardName(a)))) facts.settings.globalAuth = true;
    } else if ((name === 'register' || name === 'forRoutes') && callee.object?.type === 'Identifier' && callee.object.name === 'RouterModule') {
      const table = first?.type === 'Identifier' ? topLevel.get(first.name) : first;
      if (!readRouterTable(table, '')) limit('nest-unresolved-router-module', file, lineOf(call), nodeText(content, first));
    }
  };

  walk(ast, (node) => {
    if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.decorators?.length) classFacts(node);
    else if (node.type === 'CallExpression') callFacts(node);
    else if (node.type === 'ObjectExpression') {
      // { provide: APP_GUARD, useClass: JwtAuthGuard } — a global guard.
      const provide = propValue(node, 'provide');
      if (provide?.type !== 'Identifier' || provide.name !== 'APP_GUARD') return;
      const guard = propValue(node, 'useClass') ?? propValue(node, 'useExisting');
      if (isNestAuthGuardName(guardName(guard))) facts.settings.globalAuth = true;
    }
  });
  return facts;
}

// ── Pattern tier (the file did not parse) ────────────────────────────────────

function factsByPattern(src, limit) {
  const { content, file } = src;
  const { code, lits } = lexJs(content);
  const pairs = matchPairs(code);
  const facts = { controllers: [], modules: new Map(), routerPaths: new Map(), settings: emptySettings() };
  const text = ([s, e]) => content.slice(s, e).trim();
  const literal = (range) => {
    const v = literalIn(code, lits, range[0], range[1]);
    return typeof v === 'string' ? v : null;
  };
  const inner = (range) => {
    const [s, e] = trimRange(code, range[0], range[1]);
    return (code[s] === '[' || code[s] === '{') && pairs.get(s) === e - 1 ? [s + 1, e - 1] : null;
  };
  const listOf = (range, one) => {
    const arr = code[trimRange(code, range[0], range[1])[0]] === '[' ? inner(range) : null;
    const vals = arr ? splitTopLevel(code, pairs, arr[0], arr[1]).map(one) : [one(range)];
    return vals.includes(null) ? null : vals;
  };
  const versionOne = range => (text(range) === 'VERSION_NEUTRAL' ? NEUTRAL : literal(range));
  const entries = (range) => {
    const body = inner(range);
    const map = new Map();
    if (!body || code[trimRange(code, range[0], range[1])[0]] !== '{') return map;
    for (const [s, e] of splitTopLevel(code, pairs, body[0], body[1])) {
      const colon = code.indexOf(':', s);
      if (colon < 0 || colon >= e) continue;
      map.set(code.slice(s, colon).trim(), [colon + 1, e]);
    }
    return map;
  };

  // Every decorator in source order, with its argument ranges.
  const decos = [];
  for (const m of code.matchAll(/@([A-Za-z_$][\w$]*)\s*/g)) {
    let end = m.index + m[0].length;
    let args = [];
    if (code[end] === '(' && pairs.has(end)) {
      args = splitTopLevel(code, pairs, end + 1, pairs.get(end));
      end = pairs.get(end) + 1;
    }
    decos.push({ name: m[1], start: m.index, end, args });
  }
  // Consecutive decorators decorate one target: a class or a method.
  const runs = [];
  for (const d of decos) {
    const last = runs[runs.length - 1];
    if (last && /^\s*$/.test(code.slice(last.end, d.start))) { last.decos.push(d); last.end = d.end; } else runs.push({ decos: [d], end: d.end });
  }
  const isAuth = d => (d.name === 'UseGuards'
    ? d.args.some(r => isNestAuthGuardName((/^(?:new\s+)?([A-Za-z_$][\w$]*)/.exec(text(r)) || [])[1]))
    : isCustomAuthDecorator(d.name));
  const isPublic = d => PUBLIC_DECORATOR.test(d.name);

  let current = null;
  for (const run of runs) {
    const after = code.slice(run.end, run.end + 200);
    const cls = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(after);
    const method = cls ? null : /^\s*(?:(?:public|private|protected|static|async|readonly|override)\s+)*([A-Za-z_$][\w$]*)\s*[(<]/.exec(after);
    if (cls) {
      current = null;
      const mod = run.decos.find(d => d.name === 'Module');
      const list = mod?.args[0] ? entries(mod.args[0]).get('controllers') : null;
      const items = list && inner(list);
      for (const r of items ? splitTopLevel(code, pairs, items[0], items[1]) : []) facts.modules.set(text(r), cls[1]);
      const ctrl = run.decos.find(d => d.name === 'Controller');
      if (!ctrl) continue;
      let paths = [''];
      let versions;
      const arg = ctrl.args[0];
      if (arg && code[trimRange(code, arg[0], arg[1])[0]] === '{') {
        const e = entries(arg);
        if (e.has('path')) paths = listOf(e.get('path'), literal);
        if (e.has('version')) versions = listOf(e.get('version'), versionOne);
      } else if (arg) paths = listOf(arg, literal);
      if (paths === null || versions === null) {
        limit(paths === null ? 'nest-unresolved-path' : 'nest-unresolved-version', file, lineAt(content, ctrl.start), arg ? text(arg) : '');
        continue;
      }
      current = { className: cls[1], paths, versions, auth: run.decos.some(isAuth), public: run.decos.some(isPublic), line: lineAt(content, ctrl.start), methods: [] };
      facts.controllers.push(current);
    } else if (method && current) {
      const ver = run.decos.find(d => d.name === 'Version');
      const mVersions = ver ? (ver.args[0] ? listOf(ver.args[0], versionOne) : null) : undefined;
      if (mVersions === null) { limit('nest-unresolved-version', file, lineAt(content, ver.start)); continue; }
      for (const verb of run.decos.filter(d => METHOD_DECORATORS[d.name])) {
        const mp = verb.args[0] ? listOf(verb.args[0], literal) : [''];
        if (mp === null) { limit('nest-unresolved-path', file, lineAt(content, verb.start), text(verb.args[0])); continue; }
        current.methods.push({ name: method[1], method: METHOD_DECORATORS[verb.name], paths: mp, versions: mVersions, line: lineAt(content, verb.start), auth: run.decos.some(isAuth), public: run.decos.some(isPublic) });
      }
    }
  }

  // Application settings, read by pattern.
  for (const m of code.matchAll(/\.\s*(setGlobalPrefix|enableVersioning|useGlobalGuards)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    if (!pairs.has(open)) continue;
    const args = splitTopLevel(code, pairs, open + 1, pairs.get(open));
    const line = lineAt(content, m.index);
    if (m[1] === 'setGlobalPrefix') {
      const prefix = args[0] ? literal(args[0]) : null;
      facts.settings.prefix = prefix;
      if (prefix === null) limit('nest-unresolved-prefix', file, line);
      if (args[1]) limit('nest-unresolved-prefix-exclude', file, line, text(args[1]));
    } else if (m[1] === 'enableVersioning') {
      facts.settings.versioning = 'unknown';
      limit('nest-unresolved-versioning', file, line);
    } else if (args.some(r => isNestAuthGuardName((/^(?:new\s+)?([A-Za-z_$][\w$]*)/.exec(text(r)) || [])[1]))) {
      facts.settings.globalAuth = true;
    }
  }
  for (const m of code.matchAll(/\bprovide\s*:\s*APP_GUARD\s*,\s*use(?:Class|Existing)\s*:\s*([A-Za-z_$][\w$]*)/g)) {
    if (isNestAuthGuardName(m[1])) facts.settings.globalAuth = true;
  }
  for (const m of code.matchAll(/\bRouterModule\s*\.\s*(?:register|forRoutes)\s*\(/g)) {
    limit('nest-unresolved-router-module', file, lineAt(content, m.index));
  }
  return facts;
}
