/**
 * Frontend Scanner — captures the UI surface of a project so the generated
 * "memory" covers screens/pages/components, not just the backend API.
 *
 * Detects:
 *   - Screens/routes:
 *       • React Router  — <Route path="/x" element={<XPage/>} /> and route-object configs
 *       • Next.js App   — app/**​/page.{tsx,jsx}
 *       • Next.js Pages — pages/**​/*.{tsx,jsx} (excluding api/ and _files)
 *   - Component inventory (files under components/ dirs)
 *   - State + data libraries (from dependencies)
 *
 * Monorepo-aware via resolveSourceRoots(). Pure read-only scanning.
 * Zero NPM dependencies — Node.js built-ins only.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, basename, extname } from 'node:path';
import { resolveSourceRoots, collectPackageJsons, readScannable } from '../shared-source.mjs';
import { DEFAULT_IGNORE_DIRS as IGNORE_DIRS, shouldIgnore, relPosix } from '../shared-ignore.mjs';
import { extractJsxRouteScreens } from './js-ast.mjs';
const UI_EXT = new Set(['.tsx', '.jsx']);

function walk(dir, onFile, depth = 0) {
  if (depth > 12 || !existsSync(dir)) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, onFile, depth + 1);
    else if (e.isFile()) onFile(full);
  }
}

function readSafe(p) { return readScannable(p) ?? ''; } // size-capped; skips bundles

/** Normalize a route path param syntax to {param} and strip trailing slash. */
function normRoute(p) {
  let s = String(p).trim();
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\[(?:\.\.\.)?(\w+)\]/g, '{$1}');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

/** Detect the frontend stack from merged dependencies. */
function detectFrontendStack(projectDir, config) {
  const deps = {};
  for (const { pkg } of collectPackageJsons(projectDir, config)) {
    Object.assign(deps, pkg.dependencies || {}, pkg.devDependencies || {});
  }
  let framework = '';
  if (deps.next) framework = 'Next.js';
  else if (deps['react-router-dom'] || deps['react-router']) framework = 'React Router';
  else if (deps['@tanstack/react-router']) framework = 'TanStack Router';
  else if (deps.react) framework = 'React';
  else if (deps.vue) framework = 'Vue';
  else if (deps.svelte || deps['@sveltejs/kit']) framework = 'Svelte';

  const stateLib = deps.zustand ? 'Zustand'
    : deps['@reduxjs/toolkit'] || deps.redux ? 'Redux'
    : deps.jotai ? 'Jotai' : deps.mobx ? 'MobX' : null;
  const dataLib = deps['@tanstack/react-query'] ? 'TanStack Query'
    : deps.swr ? 'SWR' : deps['@apollo/client'] ? 'Apollo' : null;
  const buildTool = deps.vite ? 'Vite' : deps.next ? 'Next.js' : deps.webpack ? 'Webpack' : null;

  return { framework, stateLib, dataLib, buildTool };
}

// Components that WRAP a route's real screen — skip them when identifying the page.
const ROUTE_WRAPPERS = new Set([
  'RequireAuth', 'ProtectedRoute', 'PrivateRoute', 'PublicRoute', 'AuthGuard',
  'Guard', 'Suspense', 'Layout', 'AppLayout', 'MainLayout', 'RootLayout',
  'Fragment', 'Outlet', 'Navigate', 'ErrorBoundary', 'Route', 'Routes',
  'Provider', 'Wrapper',
]);

/** Pick the most meaningful screen component from candidates in a route element. */
function pickScreenComponent(candidates) {
  const real = candidates.filter(c => !ROUTE_WRAPPERS.has(c));
  if (real.length === 0) return candidates[candidates.length - 1] || null;
  // Prefer a *Page / *Screen / *View name, else the innermost (last) real one.
  const named = real.find(c => /(Page|Screen|View)$/.test(c));
  return named || real[real.length - 1];
}

/** Extract React Router screens: <Route path=".." element={<Wrapper><Comp/></Wrapper>} /> + route objects. */
function scanReactRouterScreens(roots, projectDir) {
  const screens = [];
  const seen = new Set();
  const add = (path, component, file) => {
    const p = normRoute(path);
    if (seen.has(p)) return; // one screen per path
    seen.add(p);
    screens.push({ path: p, component: component || null, file: relative(projectDir, file) });
  };

  // Find each `path="..."`, then look in a window AFTER it for the element's
  // component(s) — the element JSX can nest wrappers, so collect all and pick.
  const pathRe = /\bpath\s*[=:]\s*["'`]([^"'`]+)["'`]/g;
  const compRe = /<\s*([A-Z][A-Za-z0-9_]*)/g;

  for (const root of roots) {
    walk(root, (file) => {
      if (!UI_EXT.has(extname(file)) && !/\.(ts|js|mjs)$/.test(file)) return;
      const content = readSafe(file);
      if (!content.includes('<Route') && !content.includes('createBrowserRouter') &&
          !content.includes('useRoutes') && !content.includes('createRoutesFrom')) return;

      // AST-first: scopes each route's element JSX exactly (nested auth wrappers,
      // layouts, and multi-line elements no longer truncate or mis-pick the
      // screen). `null` → parse failure → the window-based regex fallback below.
      const astScreens = extractJsxRouteScreens(content, file);
      if (astScreens) {
        for (const s of astScreens) add(s.path, pickScreenComponent(s.components), file);
        return;
      }

      let m;
      const re = new RegExp(pathRe.source, 'g');
      while ((m = re.exec(content)) !== null) {
        // Window = from this path up to the START of the next route entry
        // (next `path=`/`path:`), capped — so nested `<Spinner/>` fallbacks don't
        // truncate the window before the real screen component.
        const start = m.index + m[0].length;
        const nextPath = new RegExp(pathRe.source, 'g');
        nextPath.lastIndex = start;
        const nm = nextPath.exec(content);
        const end = Math.min(nm ? nm.index : content.length, start + 400);
        const windowStr = content.slice(start, end);
        const comps = [];
        let cm;
        const cre = new RegExp(compRe.source, 'g');
        while ((cm = cre.exec(windowStr)) !== null) comps.push(cm[1]);
        add(m[1], pickScreenComponent(comps), file);
      }
    });
  }
  return screens;
}

/** Extract Next.js screens from app/ and pages/ file conventions. */
function scanNextScreens(projectDir, config) {
  const screens = [];
  const seen = new Set();
  const add = (path, file) => {
    const p = normRoute(path || '/');
    if (seen.has(p)) return;
    seen.add(p);
    screens.push({ path: p, component: basename(relative(projectDir, file)), file: relative(projectDir, file) });
  };

  // Next conventions live at a PACKAGE root (app/, pages/, src/app, src/pages),
  // so search package/project bases — not the granular source roots (which
  // already include `app/` and would double-append).
  const bases = new Set([resolve(projectDir)]);
  for (const { dir } of collectPackageJsons(projectDir, config)) bases.add(dir);

  for (const root of bases) {
    // App Router: app/**/page.{tsx,jsx}
    for (const appBase of ['app', 'src/app']) {
      const appDir = resolve(root, appBase);
      if (!existsSync(appDir)) continue;
      walk(appDir, (file) => {
        if (!/^page\.(tsx|jsx|ts|js)$/.test(basename(file))) return;
        const rel = relative(appDir, file).replace(/\/page\.\w+$/, '').replace(/^page\.\w+$/, '');
        // strip route groups (group) segments
        const routePath = '/' + rel.split('/').filter(seg => seg && !/^\(.*\)$/.test(seg)).join('/');
        add(routePath, file);
      });
    }
    // Pages Router: pages/**/*.{tsx,jsx} excluding api and _files
    for (const pagesBase of ['pages', 'src/pages']) {
      const pagesDir = resolve(root, pagesBase);
      if (!existsSync(pagesDir)) continue;
      walk(pagesDir, (file) => {
        if (!UI_EXT.has(extname(file))) return;
        const rel = relative(pagesDir, file);
        if (rel.startsWith('api/') || basename(file).startsWith('_')) return;
        const routePath = '/' + rel.replace(extname(rel), '').replace(/\/index$/, '').replace(/^index$/, '');
        add(routePath, file);
      });
    }
  }
  return screens;
}

/** Inventory component files under components/ directories. */
function scanComponents(roots, projectDir) {
  const components = [];
  const seen = new Set();
  for (const root of roots) {
    walk(root, (file) => {
      if (!UI_EXT.has(extname(file))) return;
      const rel = relative(projectDir, file);
      // Heuristic: under a components/ dir, PascalCase filename, not a test/story.
      if (!/(^|\/)components\//.test(rel)) return;
      if (/\.(test|spec|stories)\./.test(rel)) return;
      const name = basename(file, extname(file));
      if (!/^[A-Z]/.test(name)) return;
      if (seen.has(rel)) return;
      seen.add(rel);
      components.push({ name, file: rel });
    });
  }
  return components;
}

/** Scan frontend state stores (Zustand, Redux Toolkit slices, Jotai atoms, MobX). */
function scanStores(roots, projectDir) {
  const out = [];
  const seen = new Set();
  const add = (name, library, file) => {
    const key = `${name}::${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, library, file: relative(projectDir, file) });
  };
  // Zustand: const useThing = create(...) / create<T>(...)
  const zustand = /\b(?:export\s+)?const\s+(use[A-Z]\w*)\s*=\s*create\b/g;
  // Redux Toolkit slice
  const rtkSlice = /\bcreateSlice\s*\(\s*\{[^}]*?\bname\s*:\s*["']([^"']+)["']/g;
  // Jotai atoms: const xAtom = atom(...) / atomWithStorage(...)
  const jotai = /\b(?:export\s+)?const\s+(\w+Atom)\s*=\s*atom(?:WithStorage)?\b/g;
  // MobX: class XStore { makeObservable / makeAutoObservable }
  const mobx = /\bclass\s+(\w+Store)\b[\s\S]{0,400}?(?:makeObservable|makeAutoObservable)\b/g;

  for (const root of roots) {
    walk(root, (file) => {
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) return;
      const content = readSafe(file);
      if (!content) return;
      let m;
      if (content.includes('create(') || content.includes('create<')) {
        const re = new RegExp(zustand.source, 'g');
        while ((m = re.exec(content)) !== null) add(m[1], 'Zustand', file);
      }
      if (content.includes('createSlice')) {
        const re = new RegExp(rtkSlice.source, 'g');
        while ((m = re.exec(content)) !== null) add(m[1], 'Redux Toolkit', file);
      }
      if (content.includes('atom(') || content.includes('atomWithStorage')) {
        const re = new RegExp(jotai.source, 'g');
        while ((m = re.exec(content)) !== null) add(m[1], 'Jotai', file);
      }
      if (content.includes('makeObservable') || content.includes('makeAutoObservable')) {
        const re = new RegExp(mobx.source, 'g');
        while ((m = re.exec(content)) !== null) add(m[1], 'MobX', file);
      }
    });
  }
  return out;
}

/** Inventory custom React hooks: exported `useXxx` declarations. */
function scanHooks(roots, projectDir) {
  const out = [];
  const seen = new Set();
  // export function useThing / export const useThing = / export { useThing }
  const decl = /\bexport\s+(?:function|const|let)\s+(use[A-Z]\w*)\b/g;
  const reexport = /\bexport\s*\{\s*([^}]+)\}/g;
  for (const root of roots) {
    walk(root, (file) => {
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) return;
      if (/\.(test|spec|stories)\./.test(file)) return;
      const content = readSafe(file);
      if (!content || !content.includes('use')) return;
      const rel = relative(projectDir, file);
      let m;
      const re1 = new RegExp(decl.source, 'g');
      while ((m = re1.exec(content)) !== null) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ name: m[1], file: rel });
      }
      const re2 = new RegExp(reexport.source, 'g');
      while ((m = re2.exec(content)) !== null) {
        // For `X as Y`, the EXPORTED name is the alias (Y) — that's what consumers see.
        for (const id of m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)) {
          if (/^use[A-Z]/.test(id) && !seen.has(id)) {
            seen.add(id);
            out.push({ name: id, file: rel });
          }
        }
      }
    });
  }
  return out;
}

/** React Context inventory: `const XContext = createContext(...)`. */
function scanContexts(roots, projectDir) {
  const out = [];
  const seen = new Set();
  const re = /\b(?:export\s+)?const\s+(\w+Context)\s*=\s*(?:React\.)?createContext\b/g;
  for (const root of roots) {
    walk(root, (file) => {
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) return;
      const content = readSafe(file);
      if (!content || !content.includes('createContext')) return;
      let m;
      const r = new RegExp(re.source, 'g');
      while ((m = r.exec(content)) !== null) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ name: m[1], file: relative(projectDir, file) });
      }
    });
  }
  return out;
}

/**
 * i18n: detect translation keys used in code (`t('a.b')`, `i18n.t('a.b')`, `i18nKey="a.b"`)
 * and the locale files that define them. Reports keys used in code but missing
 * from locales as a small drift signal the agent can call out.
 * @returns {{ usedKeys, locales, missing }}
 */
function scanI18n(projectDir, roots) {
  const usedKeys = new Set();
  const codeRe = /\b(?:i18n\.)?t\(\s*[`'"]([a-zA-Z][\w.-]*\.[\w.-]+)[`'"]/g;
  const propRe = /\bi18nKey\s*=\s*[`'"]([a-zA-Z][\w.-]*\.[\w.-]+)[`'"]/g;

  for (const root of roots) {
    walk(root, (file) => {
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) return;
      const content = readSafe(file);
      if (!content || (!content.includes('t(') && !content.includes('i18nKey'))) return;
      let m;
      const r1 = new RegExp(codeRe.source, 'g');
      while ((m = r1.exec(content)) !== null) usedKeys.add(m[1]);
      const r2 = new RegExp(propRe.source, 'g');
      while ((m = r2.exec(content)) !== null) usedKeys.add(m[1]);
    });
  }

  // Locale files: src/i18n/locales/<lang>.json, src/locales/<lang>.json, public/locales/<lang>/*.json
  const locales = [];
  const localeKeys = new Set();
  const seenLocaleDirs = new Set();
  const seenLocaleFiles = new Set();
  const candidates = ['i18n', 'locales', 'src/i18n', 'src/locales', 'public/locales'];
  for (const base of [resolve(projectDir), ...roots]) {
    for (const sub of candidates) {
      const localesDir = resolve(base, sub);
      if (seenLocaleDirs.has(localesDir) || !existsSync(localesDir)) continue;
      seenLocaleDirs.add(localesDir);
      walk(localesDir, (file) => {
        if (seenLocaleFiles.has(file)) return;
        seenLocaleFiles.add(file);
        if (!file.endsWith('.json')) return;
        let json;
        try { json = JSON.parse(readSafe(file) || '{}'); } catch { return; }
        const rel = relative(projectDir, file);
        const collected = [];
        const walkObj = (obj, prefix) => {
          for (const [k, v] of Object.entries(obj || {})) {
            const path = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === 'object' && !Array.isArray(v)) walkObj(v, path);
            else { localeKeys.add(path); collected.push(path); }
          }
        };
        walkObj(json, '');
        if (collected.length) locales.push({ file: rel, keys: collected.length });
      });
    }
  }

  const missing = [...usedKeys].filter(k => !localeKeys.has(k)).sort();
  return { usedKeys: [...usedKeys].sort(), locales, missing };
}

/**
 * Frontend → backend wiring: extract API calls (`axios.get('/api/...')`,
 * `fetch('/api/...')`, generic client methods) so the agent can map screens
 * to the endpoints they hit.
 */
function scanApiCalls(roots, projectDir) {
  const out = [];
  const seen = new Set();
  const add = (method, path, file) => {
    const key = `${method} ${path}::${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ method, path, file: relative(projectDir, file) });
  };
  // method-call style: <obj>.get('/api/...'), axios.post('/api/...'), apiClient.users.get('/api/...')
  const methodCall = /\b(?:axios|api|client|apiClient|http|fetcher)\b[\w.]*\.(get|post|put|delete|patch)\s*\(\s*[`'"](\/[^`'")\s]+)/gi;
  // bare fetch
  const fetchCall = /\bfetch\s*\(\s*[`'"](\/[^`'")\s]+)[`'"]\s*(?:,\s*\{[^}]*?method\s*:\s*[`'"](GET|POST|PUT|DELETE|PATCH))?/gi;

  for (const root of roots) {
    walk(root, (file) => {
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) return;
      const content = readSafe(file);
      if (!content) return;
      let m;
      const a = new RegExp(methodCall.source, 'gi');
      while ((m = a.exec(content)) !== null) add(m[1].toUpperCase(), m[2], file);
      const f = new RegExp(fetchCall.source, 'gi');
      while ((m = f.exec(content)) !== null) add((m[2] || 'GET').toUpperCase(), m[1], file);
    });
  }
  return out;
}

/**
 * Scan the frontend surface of a project.
 * @returns {{ framework, buildTool, stateLib, dataLib, routerType,
 *             screens: object[], components: object[],
 *             stores: object[], hooks: object[], contexts: object[], apiCalls: object[] }}
 */
export function scanFrontend(projectDir, config = {}) {
  const stack = detectFrontendStack(projectDir, config);
  const roots = resolveSourceRoots(projectDir, config);

  let screens = [];
  let routerType = null;
  if (stack.framework === 'Next.js') {
    screens = scanNextScreens(projectDir, config);
    routerType = 'next';
  } else {
    // React Router (and TanStack/React fallbacks use the same JSX/route-object forms)
    screens = scanReactRouterScreens(roots, projectDir);
    if (screens.length) routerType = 'react-router';
    // If nothing matched but a Next layout exists, try Next as a fallback.
    if (!screens.length) {
      const nx = scanNextScreens(projectDir, config);
      if (nx.length) { screens = nx; routerType = 'next'; }
    }
  }

  screens.sort((a, b) => a.path.localeCompare(b.path));
  const components = scanComponents(roots, projectDir).sort((a, b) => a.name.localeCompare(b.name));
  const stores = scanStores(roots, projectDir).sort((a, b) => a.name.localeCompare(b.name));
  const hooks = scanHooks(roots, projectDir).sort((a, b) => a.name.localeCompare(b.name));
  const contexts = scanContexts(roots, projectDir).sort((a, b) => a.name.localeCompare(b.name));
  const apiCalls = scanApiCalls(roots, projectDir).sort((a, b) =>
    a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const i18n = scanI18n(projectDir, roots);

  // Honor .docguardignore / config.ignore — drop entries whose source file the
  // user excluded (e.g. a fixtures/storybook dir). Entries without a `file`
  // (or in i18n) are unaffected.
  const keep = (arr) => Array.isArray(arr)
    ? arr.filter(x => !x || !x.file || !shouldIgnore(relPosix(projectDir, resolve(projectDir, x.file)), config))
    : arr;
  return {
    ...stack, routerType,
    screens: keep(screens), components: keep(components), stores: keep(stores),
    hooks: keep(hooks), contexts: keep(contexts), apiCalls: keep(apiCalls), i18n,
  };
}
