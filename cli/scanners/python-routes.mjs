/**
 * Python web routes — FastAPI, Flask and Django (with Django REST framework),
 * resolved from module outlines so both parser tiers compose paths the same way.
 *
 * FastAPI/Flask: every router object (`FastAPI()`, `APIRouter()`, `Flask()`,
 * `Blueprint()`) under any variable name, its route decorators, and the edges
 * between objects (`include_router`, `register_blueprint`, `mount`). Paths are
 * composed from the applications down; a router no resolved edge reaches keeps
 * its own prefix and is flagged `mounted: false`, since the include may be
 * dynamic. A prefix that cannot be evaluated is skipped and flags the route
 * `pathIncomplete` rather than shortening it silently.
 *
 * Django: the URL configuration graph from `ROOT_URLCONF` (or, without one,
 * from every urls module nobody includes): `path`/`re_path`/`url`, `include()`
 * of modules, lists and DRF router `urls`, and router registrations expanded
 * into the list/detail/@action routes the viewset provides. An include mount
 * is never an endpoint; an include outside the project is a limitation.
 *
 * @implements docguard.python-extraction#FR-001
 * @implements docguard.python-extraction#FR-002
 * @implements docguard.python-extraction#FR-003
 */
import { relative } from 'node:path';
import { findPythonFiles, loadPythonOutlines, PythonIndex, refTail, exprText, evalString } from './py-outline.mjs';

const HTTP = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace']);
const APP_KINDS = new Set(['FastAPI', 'Flask', 'Quart']);
const ROUTER_KINDS = new Set(['FastAPI', 'APIRouter', 'Flask', 'Quart', 'Blueprint']);

// A dependency counts as authentication when its name says so. A dependency
// named otherwise (get_db) is never claimed. `Security()` always counts.
const AUTH_DEPENDENCY = /auth|admin|user|token|login|permission|perm(?:s)?\b|scope|role|jwt|oauth|api_?key|credential|verify|require|secur|guard|protect|principal|identity/i;
const FLASK_AUTH_DECORATOR = /login_required|auth|jwt_required|token_required|permission|roles?_(?:required|accepted)|admin_required|requires?_/i;
const DJANGO_AUTH_DECORATOR = /^(?:login_required|permission_required|user_passes_test|staff_member_required|superuser_required)$/;
const DJANGO_AUTH_MIXIN = /^(?:LoginRequiredMixin|PermissionRequiredMixin|UserPassesTestMixin|AccessMixin)$/;
const DRF_AUTH_PERMISSION = /^(?:IsAuthenticated|IsAdminUser|IsAuthenticatedOrReadOnly|DjangoModelPermissions|DjangoModelPermissionsOrAnonReadOnly|DjangoObjectPermissions)$/;

/**
 * Scan Python web routes.
 * @param {string} dir project root
 * @param {{django?: boolean, asgi?: boolean}} frameworks which resolvers to run
 * @returns {Array<object>} routes, with non-enumerable `scanTier` and `limitations`
 */
export function scanPythonWebRoutes(dir, frameworks = {}) {
  const files = findPythonFiles(dir);
  const { byFile, scanTier } = loadPythonOutlines(files, 'routes');
  const index = new PythonIndex(dir, byFile);
  const limitations = [];
  const routes = [];
  if (frameworks.asgi) routes.push(...resolveAppRoutes(dir, index, byFile, limitations));
  if (frameworks.django) routes.push(...resolveDjangoRoutes(dir, index, byFile, limitations));
  Object.defineProperty(routes, 'scanTier', { value: scanTier, enumerable: false, configurable: true, writable: true });
  Object.defineProperty(routes, 'limitations', { value: limitations, enumerable: false, configurable: true, writable: true });
  return routes;
}

// ── Shared evaluation ──────────────────────────────────────────────────────

/** Names of `Depends(x)` / `Security(x)` in an expression, with whether it was Security. */
function dependencyNames(expr, out = []) {
  if (!expr) return out;
  if (expr.t === 'call') {
    const fn = refTail(expr.fn);
    if (fn === 'Depends' || fn === 'Security') {
      const target = expr.args[0] || expr.kw?.dependency;
      out.push({ name: refTail(target) || exprText(target), security: fn === 'Security' });
      return out;
    }
    for (const a of expr.args) dependencyNames(a, out);
    for (const v of Object.values(expr.kw || {})) dependencyNames(v, out);
  } else if (expr.t === 'list') {
    for (const i of expr.items) dependencyNames(i, out);
  } else if (expr.t === 'sub') {
    for (const i of expr.index) dependencyNames(i, out);
  }
  return out;
}

const authFrom = deps => deps.some(d => d.security || AUTH_DEPENDENCY.test(d.name || ''));

// ── FastAPI / Flask ─────────────────────────────────────────────────────────

function joinFlask(prefix, rule) {
  if (!prefix) return rule;
  if (!rule) return prefix;
  return `${prefix.replace(/\/+$/, '')}/${rule.replace(/^\/+/, '')}`;
}

function resolveAppRoutes(dir, index, byFile, limitations) {
  const objects = new Map(); // key → { key, kind, file, scope, name, own: {prefix, deps, framework}, routes: [], line }
  const edges = []; // { parent, child, prefix, deps, kind }

  const objectKey = (file, scope, name) => `${file}::${scope ? `${scope}.` : ''}${name}`;

  // Pass 1: router objects (module level and inside factory functions).
  for (const [file, rec] of byFile) {
    const visit = (body, scope) => {
      for (const s of body) {
        if (s.k === 'assign' && !s.aug && s.value?.t === 'call') {
          const kind = refTail(s.value.fn);
          if (ROUTER_KINDS.has(kind)) {
            for (const target of s.targets) {
              const key = objectKey(file, scope, target);
              objects.set(key, {
                key, kind, file, scope, name: target, line: s.line, tier: rec.tier, tierReason: rec.tierReason,
                prefix: kind === 'Blueprint' ? s.value.kw?.url_prefix : kind === 'APIRouter' ? s.value.kw?.prefix : null,
                deps: dependencyNames(s.value.kw?.dependencies),
                routes: [],
              });
            }
          }
        }
        if (s.k === 'def' && !scope) visit(s.body || [], s.name);
      }
    };
    visit(rec.outline.body, null);
  }

  // Resolve an object reference from a file (and an optional function scope).
  const lookup = (file, scope, dotted) => {
    if (!dotted) return null;
    if (scope && !dotted.includes('.')) {
      const local = objects.get(objectKey(file, scope, dotted));
      if (local) return local;
    }
    const direct = objects.get(objectKey(file, null, dotted));
    if (direct) return direct;
    const b = index.resolveRef(file, dotted);
    if (b?.kind === 'assign' && b.rest.length === 0) {
      for (const t of b.stmt.targets) if (objects.has(objectKey(b.file, null, t))) return objects.get(objectKey(b.file, null, t));
    }
    return null;
  };

  // Pass 2: route decorators and edges.
  for (const [file, rec] of byFile) {
    const visit = (body, scope) => {
      for (const s of body) {
        if (s.k === 'def') {
          for (const dec of s.decorators || []) {
            if (dec?.t !== 'call' || dec.fn?.t !== 'ref' || !dec.fn.v.includes('.')) continue;
            const parts = dec.fn.v.split('.');
            const method = parts.pop();
            const owner = parts.join('.');
            const lower = method.toLowerCase();
            if (!HTTP.has(lower) && method !== 'route' && method !== 'api_route') continue;
            let obj = lookup(file, scope, owner);
            if (!obj) {
              // An owner DocGuard cannot tie to a constructor (a factory, an
              // import from outside the project): report its routes unmounted.
              const key = objectKey(file, scope, owner);
              obj = objects.get(key) || { key, kind: 'unknown', file, scope, name: owner, line: s.line, tier: rec.tier, tierReason: rec.tierReason, prefix: null, deps: [], routes: [] };
              objects.set(key, obj);
            }
            const pathExpr = dec.args[0] || dec.kw?.path || dec.kw?.rule;
            let methods;
            if (HTTP.has(lower)) methods = [method.toUpperCase()];
            else {
              const list = dec.kw?.methods;
              methods = list?.t === 'list' ? list.items.filter(i => i?.t === 'str').map(i => i.v.toUpperCase()) : [];
              if (!methods.length) methods = ['GET'];
            }
            const paramDeps = [];
            for (const p of s.params || []) {
              dependencyNames(p.default, paramDeps);
              dependencyNames(p.ann, paramDeps);
              // `current_user: CurrentUser` where CurrentUser = Annotated[User, Depends(...)]
              if (p.ann?.t === 'ref') {
                const b = index.resolveRef(file, p.ann.v);
                if (b?.kind === 'assign' && b.rest.length === 0) dependencyNames(b.stmt.value, paramDeps);
              }
            }
            const decoratorAuth = (s.decorators || []).some(d => {
              const name = d?.t === 'call' ? refTail(d.fn) : refTail(d);
              return name && d !== dec && FLASK_AUTH_DECORATOR.test(name) && !HTTP.has(String(name).toLowerCase());
            });
            obj.routes.push({
              methods, pathExpr, func: s.name, doc: s.doc || '', line: s.line, file,
              deps: [...dependencyNames(dec.kw?.dependencies), ...paramDeps], decoratorAuth,
            });
          }
          if (!scope) visit(s.body || [], s.name);
        } else if (s.k === 'expr' || s.k === 'assign') {
          const call = s.value;
          if (call?.t !== 'call' || call.fn?.t !== 'ref' || !call.fn.v.includes('.')) continue;
          const parts = call.fn.v.split('.');
          const method = parts.pop();
          if (method !== 'include_router' && method !== 'register_blueprint' && method !== 'mount') continue;
          const parent = lookup(file, scope, parts.join('.'));
          const childExpr = method === 'mount' ? (call.args[1] || call.kw?.app) : (call.args[0] || call.kw?.router || call.kw?.blueprint);
          const child = childExpr?.t === 'ref' ? lookup(file, scope, childExpr.v) : null;
          if (!parent || !child) {
            if (childExpr && method !== 'mount') {
              limitations.push({ code: 'python-unresolved-include', file: relative(dir, file), line: s.line, target: exprText(childExpr) });
            }
            continue;
          }
          edges.push({
            parent: parent.key, child: child.key, kind: method, line: s.line, file,
            prefix: method === 'mount' ? call.args[0] || call.kw?.path : method === 'register_blueprint' ? call.kw?.url_prefix : call.kw?.prefix,
            deps: dependencyNames(call.kw?.dependencies),
          });
        }
      }
    };
    visit(rec.outline.body, null);
  }

  const children = new Map();
  const isChild = new Set();
  for (const e of edges) {
    if (!children.has(e.parent)) children.set(e.parent, []);
    children.get(e.parent).push(e);
    isChild.add(e.child);
  }

  const out = [];
  const reached = new Set();
  const evalPrefix = (obj, expr, acc) => {
    if (!expr || (expr.t === 'const' && expr.v === null)) return acc;
    const v = evalString(index, obj.file, expr);
    if (v === null) return { ...acc, incomplete: true, reasons: [...acc.reasons, `prefix ${exprText(expr)} could not be evaluated`] };
    return { ...acc, value: acc.value + v };
  };
  const emit = (obj, base, auth, mounted) => {
    const flask = obj.kind === 'Flask' || obj.kind === 'Blueprint' || obj.kind === 'Quart';
    for (const r of obj.routes) {
      const path = evalString(index, r.file, r.pathExpr);
      if (path === null) {
        limitations.push({ code: 'python-unresolved-route-path', file: relative(dir, r.file), line: r.line, target: exprText(r.pathExpr) });
        continue;
      }
      const full = flask ? joinFlask(base.value, path) : base.value + path;
      for (const method of r.methods) {
        const route = {
          method, path: full, handler: r.func, file: relative(dir, r.file), line: r.line,
          source: flask ? 'flask' : 'fastapi',
          auth: auth || authFrom(r.deps) || r.decoratorAuth,
          description: r.doc, tier: obj.tier, tierReason: obj.tierReason,
        };
        if (base.incomplete) Object.assign(route, { pathIncomplete: true, pathReason: base.reasons.join('; ') });
        if (!mounted) route.mounted = false;
        out.push(route);
      }
    }
  };
  const visit = (obj, acc, auth, mounted, stack) => {
    reached.add(obj.key);
    // FastAPI applies a router's own prefix to everything it holds; a Flask
    // blueprint's prefix was already chosen by whoever registered it.
    const base = obj.kind === 'APIRouter' ? evalPrefix(obj, obj.prefix, acc) : acc;
    const guarded = auth || authFrom(obj.deps);
    emit(obj, base, guarded, mounted);
    for (const e of children.get(obj.key) || []) {
      if (stack.has(e.child)) continue;
      const child = objects.get(e.child);
      let next;
      if (e.kind === 'register_blueprint') {
        const own = e.prefix ?? child.prefix;
        const rel = evalPrefix(child, own, { value: '', incomplete: false, reasons: [] });
        next = { value: joinFlask(base.value, rel.value), incomplete: base.incomplete || rel.incomplete, reasons: [...base.reasons, ...rel.reasons] };
      } else {
        next = evalPrefix(obj, e.prefix, base);
      }
      visit(child, next, guarded || authFrom(e.deps), mounted, new Set([...stack, e.child]));
    }
  };

  const start = { value: '', incomplete: false, reasons: [] };
  // Applications first, then any router nothing reaches (its include may be
  // dynamic): reported with its own prefix, and flagged unmounted.
  for (const obj of objects.values()) {
    if (APP_KINDS.has(obj.kind) && !isChild.has(obj.key)) visit(obj, start, false, true, new Set([obj.key]));
  }
  for (const obj of objects.values()) {
    if (reached.has(obj.key) || isChild.has(obj.key)) continue;
    const blueprintStart = obj.kind === 'Blueprint' ? evalPrefix(obj, obj.prefix, start) : start;
    visit(obj, blueprintStart, false, false, new Set([obj.key]));
  }
  // Children of unreached parents (a cycle with no entry point).
  for (const obj of objects.values()) {
    if (!reached.has(obj.key) && obj.routes.length) visit(obj, start, false, false, new Set([obj.key]));
  }
  return out;
}

// ── Django ─────────────────────────────────────────────────────────────────

const VIEWSET_ACTIONS = {
  ModelViewSet: ['list', 'create', 'retrieve', 'update', 'partial_update', 'destroy'],
  ReadOnlyModelViewSet: ['list', 'retrieve'],
  ListModelMixin: ['list'],
  CreateModelMixin: ['create'],
  RetrieveModelMixin: ['retrieve'],
  UpdateModelMixin: ['update', 'partial_update'],
  DestroyModelMixin: ['destroy'],
};
const ACTION_ROUTE = {
  list: ['GET', 'list'], create: ['POST', 'list'], retrieve: ['GET', 'detail'],
  update: ['PUT', 'detail'], partial_update: ['PATCH', 'detail'], destroy: ['DELETE', 'detail'],
};
const VIEWSET_BASES = new Set(['ViewSet', 'GenericViewSet', 'ViewSetMixin', 'ModelViewSet', 'ReadOnlyModelViewSet']);
const GENERIC_VIEW_METHODS = {
  ListAPIView: ['GET'], CreateAPIView: ['POST'], ListCreateAPIView: ['GET', 'POST'],
  RetrieveAPIView: ['GET'], UpdateAPIView: ['PUT', 'PATCH'], DestroyAPIView: ['DELETE'],
  RetrieveUpdateAPIView: ['GET', 'PUT', 'PATCH'], RetrieveDestroyAPIView: ['GET', 'DELETE'],
  RetrieveUpdateDestroyAPIView: ['GET', 'PUT', 'PATCH', 'DELETE'],
  TemplateView: ['GET'], ListView: ['GET'], DetailView: ['GET'], RedirectView: ['GET'],
  ArchiveIndexView: ['GET'], YearArchiveView: ['GET'], MonthArchiveView: ['GET'], DayArchiveView: ['GET'],
};
const VIEW_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** Convert a Django `path()` route: `<int:pk>` and `<pk>` become `{pk}`. */
function convertPath(route) {
  return route.replace(/<(?:[A-Za-z_][\w]*:)?([A-Za-z_][\w]*)>/g, '{$1}');
}

/** Convert a `re_path()` regex to a path; `incomplete` when regex syntax remains. */
function convertRegex(route) {
  let s = route.replace(/^\^/, '').replace(/\$$/, '').replace(/\\Z$/, '');
  let n = 0;
  let out = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && k + 1 < s.length && /[./\-_~]/.test(s[k + 1])) { out += s[k + 1]; k++; continue; }
    if (c === '(') {
      let depth = 1;
      let j = k + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '(') depth++;
        else if (s[j] === ')') depth--;
        j++;
      }
      const group = s.slice(k + 1, j - 1);
      const named = group.match(/^\?P<([A-Za-z_]\w*)>/);
      if (named) out += `{${named[1]}}`;
      else if (group.startsWith('?:')) out += `(${group})`;
      else out += `{arg${++n}}`;
      k = j - 1;
      if (s[k + 1] === '?' && !/[?]$/.test(out)) { k++; } // optional group
      continue;
    }
    if (c === '?' && /[/]$/.test(out)) continue; // `/?`: optional trailing slash
    out += c;
  }
  s = out;
  const incomplete = /[\\[\]()*+?|^$]/.test(s.replace(/\{[A-Za-z_]\w*\}/g, ''));
  return { path: s, incomplete };
}

function resolveDjangoRoutes(dir, index, byFile, limitations) {
  const out = [];

  // Routers and their registrations, per module file.
  const routers = new Map(); // `${file}::${name}` → router
  for (const [file, rec] of byFile) {
    for (const s of rec.outline.body) {
      if (s.k === 'assign' && s.value?.t === 'call') {
        const kind = refTail(s.value.fn);
        if (kind === 'DefaultRouter' || kind === 'SimpleRouter') {
          const ts = s.value.kw?.trailing_slash;
          for (const t of s.targets) {
            routers.set(`${file}::${t}`, { kind, file, line: s.line, trailingSlash: !(ts?.t === 'const' && ts.v === false), registrations: [] });
          }
        }
      }
    }
    for (const s of rec.outline.body) {
      if (s.k !== 'expr' || s.value?.t !== 'call' || s.value.fn?.t !== 'ref' || !s.value.fn.v.endsWith('.register')) continue;
      const owner = s.value.fn.v.slice(0, -'.register'.length);
      const router = routers.get(`${file}::${owner}`) || resolveRouter(index, routers, file, owner);
      if (!router) continue;
      const prefix = evalString(index, file, s.value.args[0] || s.value.kw?.prefix);
      const viewset = s.value.args[1] || s.value.kw?.viewset;
      if (prefix === null || !viewset) continue;
      router.registrations.push({ prefix, viewset, file, line: s.line });
    }
  }

  // Roots: ROOT_URLCONF, else every urls module no other module includes.
  const roots = new Set();
  for (const [file, rec] of byFile) {
    for (const s of rec.outline.body) {
      if (s.k === 'assign' && s.targets.includes('ROOT_URLCONF') && s.value?.t === 'str') {
        const target = index.moduleFile(s.value.v);
        if (target) roots.add(target);
      }
    }
  }
  const urlconfs = [...byFile.keys()].filter(f => urlpatternsOf(index, routers, f) !== null);
  if (roots.size === 0) {
    const included = new Set();
    for (const f of urlconfs) {
      for (const s of index.outline(f).body) walkCalls(s.value, call => {
        if (refTail(call.fn) === 'include' && call.args[0]?.t === 'str') {
          const t = index.moduleFile(call.args[0].v);
          if (t) included.add(t);
        }
      });
    }
    for (const f of urlconfs) if (!included.has(f)) roots.add(f);
  }

  const emit = (file, method, path, handler, auth, extra = {}) => {
    const rec = byFile.get(file);
    out.push({
      method, path: `/${path}`.replace(/\/{2,}/g, '/'), handler, file: relative(dir, file), line: extra.line ?? null,
      source: 'django', auth: !!auth, description: '', tier: rec.tier, tierReason: rec.tierReason,
      ...(extra.incomplete ? { pathIncomplete: true, pathReason: 'regular expression route' } : {}),
    });
  };

  const walkPatterns = (file, entries, prefix, incomplete, stack) => {
    for (const entry of entries) {
      if (entry.router) { expandRouter(file, entry.router, prefix, incomplete); continue; }
      const call = entry.call;
      const fn = refTail(call.fn);
      if (fn !== 'path' && fn !== 're_path' && fn !== 'url') continue;
      const routeExpr = call.args[0] || call.kw?.route || call.kw?.regex;
      const route = evalString(index, file, routeExpr);
      if (route === null) {
        limitations.push({ code: 'django-unresolved-route', file: relative(dir, file), line: entry.line, target: exprText(routeExpr) });
        continue;
      }
      const converted = fn === 'path' ? { path: convertPath(route), incomplete: false } : convertRegex(route);
      const here = prefix + converted.path;
      const inc = incomplete || converted.incomplete;
      const view = call.args[1] || call.kw?.view;
      if (!view) continue;
      if (view.t === 'call' && refTail(view.fn) === 'include') {
        includeTarget(file, view, here, inc, stack, entry.line);
        continue;
      }
      if (view.t === 'ref' && /(?:^|\.)site\.urls$/.test(view.v)) {
        emit(file, 'ALL', here, view.v, true, { line: entry.line, incomplete: inc }); // the admin site requires a staff login
        continue;
      }
      const { methods, auth, handler } = viewInfo(file, view);
      for (const m of methods) emit(file, m, here, handler, auth, { line: entry.line, incomplete: inc });
    }
  };

  const includeTarget = (file, call, prefix, incomplete, stack, line) => {
    let arg = call.args[0] || call.kw?.arg;
    if (arg?.t === 'list' && arg.items[0]) arg = arg.items[0]; // include(("app.urls", "ns"))
    if (arg?.t === 'str') {
      const target = index.moduleFile(arg.v);
      if (!target) { limitations.push({ code: 'django-unresolved-include', file: relative(dir, file), line, target: arg.v }); return; }
      if (stack.has(target)) return;
      walkPatterns(target, urlpatternsOf(index, routers, target) || [], prefix, incomplete, new Set([...stack, target]));
      return;
    }
    if (arg?.t === 'list') { walkPatterns(file, patternEntries(index, routers, file, arg), prefix, incomplete, stack); return; }
    if (arg?.t === 'ref') {
      const entries = patternEntries(index, routers, file, arg);
      if (entries.length) { walkPatterns(file, entries, prefix, incomplete, stack); return; }
      const b = index.resolveRef(file, arg.v);
      if (b?.kind === 'module') {
        if (!stack.has(b.file)) walkPatterns(b.file, urlpatternsOf(index, routers, b.file) || [], prefix, incomplete, new Set([...stack, b.file]));
        return;
      }
    }
    limitations.push({ code: 'django-unresolved-include', file: relative(dir, file), line, target: exprText(arg) });
  };

  const expandRouter = (file, router, prefix, incomplete) => {
    const trailing = router.trailingSlash ? '/' : '';
    if (router.kind === 'DefaultRouter') emit(router.file, 'GET', prefix, 'api-root', false, { line: router.line, incomplete });
    for (const reg of router.registrations) {
      const vs = viewsetInfo(reg.file, reg.viewset);
      const base = `${prefix}${reg.prefix}`;
      const lookup = vs.lookup || 'pk';
      const list = `${base}${trailing}`;
      const detail = `${base}/{${lookup}}${trailing}`;
      if (vs.unknown) {
        emit(reg.file, 'ALL', list, vs.name, vs.auth, { line: reg.line, incomplete });
        emit(reg.file, 'ALL', detail, vs.name, vs.auth, { line: reg.line, incomplete });
        continue;
      }
      for (const action of vs.actions) {
        const [method, kind] = ACTION_ROUTE[action];
        emit(reg.file, method, kind === 'list' ? list : detail, `${vs.name}.${action}`, vs.auth, { line: reg.line, incomplete });
      }
      for (const extra of vs.extra) {
        const path = extra.detail ? `${base}/{${lookup}}/${extra.urlPath}${trailing}` : `${base}/${extra.urlPath}${trailing}`;
        for (const m of extra.methods) emit(reg.file, m, path, `${vs.name}.${extra.name}`, vs.auth || extra.auth, { line: reg.line, incomplete });
      }
    }
  };

  /** Class and its project-resolvable ancestors, nearest first. */
  const classChain = (file, expr) => {
    const chain = [];
    const external = [];
    const seen = new Set();
    const walk = (f, e, depth) => {
      if (!e || depth > 8) return;
      const dotted = e.t === 'ref' ? e.v : null;
      if (!dotted) return;
      const b = index.resolveRef(f, dotted);
      if (b?.kind === 'class' && b.rest.length === 0) {
        const id = `${b.file}::${b.stmt.name}`;
        if (seen.has(id)) return;
        seen.add(id);
        chain.push({ file: b.file, stmt: b.stmt });
        for (const base of b.stmt.bases || []) walk(b.file, base, depth + 1);
      } else {
        external.push(dotted.split('.').pop());
      }
    };
    walk(file, expr, 0);
    return { chain, external };
  };

  const classAuth = chain => chain.chain.some(c => (c.stmt.bases || []).some(b => DJANGO_AUTH_MIXIN.test(refTail(b) || ''))
    || (c.stmt.decorators || []).some(d => decoratorMentions(d, DJANGO_AUTH_DECORATOR))
    || (c.stmt.body || []).some(s => s.k === 'assign' && s.targets.includes('permission_classes') && mentions(s.value, DRF_AUTH_PERMISSION)))
    || chain.external.some(n => DJANGO_AUTH_MIXIN.test(n));

  const viewsetInfo = (file, expr) => {
    const name = refTail(expr) || exprText(expr);
    const chain = classChain(file, expr);
    if (chain.chain.length === 0) return { name, unknown: true, auth: false, actions: [], extra: [] };
    const actions = new Set();
    const names = [...chain.external, ...chain.chain.flatMap(c => (c.stmt.bases || []).map(refTail))];
    for (const n of names) for (const a of VIEWSET_ACTIONS[n] || []) actions.add(a);
    const extra = [];
    let lookup = null;
    for (const c of chain.chain) {
      for (const s of c.stmt.body || []) {
        if (s.k === 'def' && ACTION_ROUTE[s.name]) actions.add(s.name);
        if (s.k === 'def') {
          const dec = (s.decorators || []).find(d => d?.t === 'call' && ['action', 'detail_route', 'list_route'].includes(refTail(d.fn)));
          if (dec && !extra.some(x => x.name === s.name)) {
            const tail = refTail(dec.fn);
            const detail = tail === 'detail_route' || (tail === 'action' && dec.kw?.detail?.t === 'const' && dec.kw.detail.v === true);
            const list = dec.kw?.methods;
            const methods = list?.t === 'list' ? list.items.filter(i => i?.t === 'str').map(i => i.v.toUpperCase()) : ['GET'];
            const urlPath = evalString(index, c.file, dec.kw?.url_path) || s.name;
            const auth = mentions(dec.kw?.permission_classes, DRF_AUTH_PERMISSION);
            extra.push({ name: s.name, detail, methods, urlPath, auth });
          }
        }
        if (!lookup && s.k === 'assign' && (s.targets.includes('lookup_url_kwarg') || s.targets.includes('lookup_field'))) {
          const v = evalString(index, c.file, s.value);
          if (v) lookup = v;
        }
      }
    }
    const known = names.some(n => VIEWSET_ACTIONS[n] || VIEWSET_BASES.has(n));
    if (!known && actions.size === 0 && extra.length === 0) return { name, unknown: true, auth: classAuth(chain), actions: [], extra: [] };
    const order = ['list', 'create', 'retrieve', 'update', 'partial_update', 'destroy'];
    return { name, unknown: false, auth: classAuth(chain), actions: order.filter(a => actions.has(a)), extra, lookup };
  };

  const viewInfo = (file, view) => {
    // Class-based: X.as_view(...)
    if (view.t === 'call' && view.fn?.t === 'ref' && view.fn.v.endsWith('.as_view')) {
      const clsRef = { t: 'ref', v: view.fn.v.slice(0, -'.as_view'.length) };
      const chain = classChain(file, clsRef);
      const methods = new Set();
      for (const c of chain.chain) for (const s of c.stmt.body || []) if (s.k === 'def' && VIEW_METHODS.includes(s.name)) methods.add(s.name.toUpperCase());
      for (const n of [...chain.external, ...chain.chain.flatMap(c => (c.stmt.bases || []).map(refTail))]) for (const m of GENERIC_VIEW_METHODS[n] || []) methods.add(m);
      return { methods: methods.size ? [...methods] : ['ALL'], auth: classAuth(chain), handler: clsRef.v };
    }
    if (view.t !== 'ref') return { methods: ['ALL'], auth: false, handler: exprText(view) };
    const b = index.resolveRef(file, view.v);
    if (b?.kind === 'def' && b.rest.length === 0) {
      let methods = null;
      let auth = false;
      for (const d of b.stmt.decorators || []) {
        const tail = d?.t === 'call' ? refTail(d.fn) : refTail(d);
        if ((tail === 'api_view' || tail === 'require_http_methods') && d.t === 'call' && d.args[0]?.t === 'list') {
          methods = d.args[0].items.filter(i => i?.t === 'str').map(i => i.v.toUpperCase());
        } else if (tail === 'api_view') methods = ['GET'];
        else if (tail === 'require_GET') methods = ['GET'];
        else if (tail === 'require_POST') methods = ['POST'];
        else if (tail === 'require_safe') methods = ['GET', 'HEAD'];
        if (DJANGO_AUTH_DECORATOR.test(tail || '')) auth = true;
        if (tail === 'permission_classes' && d.t === 'call' && mentions(d.args[0], DRF_AUTH_PERMISSION)) auth = true;
      }
      return { methods: methods && methods.length ? methods : ['ALL'], auth, handler: view.v };
    }
    if (b?.kind === 'class' && b.rest.length === 0) return viewInfo(file, { t: 'call', fn: { t: 'ref', v: `${view.v}.as_view` }, args: [], kw: {} });
    return { methods: ['ALL'], auth: false, handler: view.v };
  };

  for (const root of [...roots].sort()) walkPatterns(root, urlpatternsOf(index, routers, root) || [], '', false, new Set([root]));
  return out;
}

function resolveRouter(index, routers, file, dotted) {
  const b = index.resolveRef(file, dotted);
  if (b?.kind === 'assign' && b.rest.length === 0) {
    for (const t of b.stmt.targets) if (routers.has(`${b.file}::${t}`)) return routers.get(`${b.file}::${t}`);
  }
  return null;
}

function walkCalls(expr, fn) {
  if (!expr || typeof expr !== 'object') return;
  if (expr.t === 'call') { fn(expr); walkCalls(expr.fn, fn); for (const a of expr.args) walkCalls(a, fn); for (const v of Object.values(expr.kw || {})) walkCalls(v, fn); }
  else if (expr.t === 'list') for (const i of expr.items) walkCalls(i, fn);
  else if (expr.t === 'bin') { walkCalls(expr.l, fn); walkCalls(expr.r, fn); }
}

function mentions(expr, re) {
  let hit = false;
  const walk = e => {
    if (!e || hit) return;
    if (e.t === 'ref' && re.test(e.v.split('.').pop())) hit = true;
    else if (e.t === 'list') e.items.forEach(walk);
    else if (e.t === 'call') { walk(e.fn); e.args.forEach(walk); Object.values(e.kw || {}).forEach(walk); }
    else if (e.t === 'bin') { walk(e.l); walk(e.r); }
  };
  walk(expr);
  return hit;
}

function decoratorMentions(dec, re) {
  let hit = false;
  walkCalls(dec, c => { if (mentions({ t: 'list', items: c.args }, re)) hit = true; });
  return hit || (dec?.t === 'ref' && re.test(dec.v.split('.').pop()));
}

/**
 * The URL pattern entries of a module: `urlpatterns = [...]`, `+=`, `+ router.urls`,
 * `.append()`/`.extend()`. Null when the module defines no urlpatterns.
 */
function urlpatternsOf(index, routers, file) {
  const body = index.outline(file)?.body || [];
  let found = false;
  const entries = [];
  for (const s of body) {
    if (s.k === 'assign' && s.targets.includes('urlpatterns')) {
      found = true;
      if (!s.aug) entries.length = 0;
      entries.push(...patternEntries(index, routers, file, s.value, s.line));
    } else if (s.k === 'expr' && s.value?.t === 'call' && s.value.fn?.t === 'ref') {
      if (s.value.fn.v === 'urlpatterns.append') entries.push(...patternEntries(index, routers, file, { t: 'list', items: s.value.args }, s.line));
      else if (s.value.fn.v === 'urlpatterns.extend') entries.push(...patternEntries(index, routers, file, s.value.args[0], s.line));
    }
  }
  return found ? entries : null;
}

function patternEntries(index, routers, file, expr, line = null, depth = 0) {
  if (!expr || depth > 8) return [];
  const next = e => patternEntries(index, routers, file, e, line, depth + 1);
  if (expr.t === 'list') {
    return expr.items.flatMap(i => (i?.t === 'call' && ['path', 're_path', 'url'].includes(refTail(i.fn)) ? [{ call: i, line }] : next(i)));
  }
  if (expr.t === 'bin' && expr.op === '+') return [...next(expr.l), ...next(expr.r)];
  if (expr.t === 'call') {
    const fn = refTail(expr.fn);
    if (['path', 're_path', 'url'].includes(fn)) return [{ call: expr, line }];
    if (fn === 'format_suffix_patterns') return next(expr.args[0]);
    if (fn === 'i18n_patterns') return next({ t: 'list', items: expr.args });
    return [];
  }
  if (expr.t === 'ref') {
    if (expr.v.endsWith('.urls')) {
      const owner = expr.v.slice(0, -'.urls'.length);
      const router = routers.get(`${file}::${owner}`) || resolveRouter(index, routers, file, owner);
      if (router) return [{ router }];
    }
    const b = index.resolveRef(file, expr.v);
    if (b?.kind === 'assign' && b.rest.length === 0 && b.stmt.value) {
      return patternEntries(index, routers, b.file, b.stmt.value, b.stmt.line, depth + 1);
    }
  }
  return [];
}
