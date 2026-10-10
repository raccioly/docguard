/**
 * Route case sensitivity — whether a JavaScript framework matches a request
 * path to a route ignoring case, read statically per router.
 *
 * A route a framework matches case-insensitively is marked
 * `caseInsensitive: true`, and endpoint comparison folds case for it only
 * (`compareEndpoints` in api-doc.mjs). Verified against the frameworks'
 * sources:
 * - Express 5: `express.Router(opts)` matches case-insensitively unless
 *   `opts.caseSensitive` is true (router `caseSensitive`, path-to-regexp `i`
 *   flag). The app's own router takes `caseSensitive` from the
 *   `case sensitive routing` setting (application.js). A separately created
 *   router does NOT inherit that setting; it applies to routes on the app and
 *   to the mount prefix the app matches before handing over to a router.
 * - Koa (`@koa/router`, `koa-router`): each layer gets
 *   `sensitive: opts.sensitive || this.opts.sensitive || false`, so routes are
 *   case-insensitive unless `new Router({ sensitive: true })`.
 * - Fastify (find-my-way): `caseSensitive` defaults to true; a server created
 *   with a literal `caseSensitive: false` matches ignoring case.
 * - NestJS follows its HTTP adapter: Express (default) as above for the app,
 *   Fastify case-sensitive by default.
 * Hono, itty-router, Cloudflare Worker dispatch and Next.js compare paths
 * exactly and are never marked.
 *
 * A setting this reader cannot read (a value that is not a literal) leaves the
 * routes it may govern case-sensitive, so a gap is never hidden, and is
 * returned as a note.
 *
 * @implements docguard.coverage-followups#FR-009
 */

import { matchingBracket } from './js-ast.mjs';

/** Blank comments (keeping offsets) so a commented-out setting is not read. */
export function maskJsComments(src) {
  const out = src.split('');
  const n = src.length;
  for (let i = 0; i < n; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < n && src[i] !== ch; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      for (; i < n && src[i] !== '\n'; i++) out[i] = ' ';
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (; i < stop; i++) if (out[i] !== '\n') out[i] = ' ';
      i--;
    }
  }
  return out.join('');
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** First top-level argument text of the call whose `(` is at `open`, or '' / null. */
function firstArg(code, open) {
  const close = matchingBracket(code, open);
  if (close < 0) return null;
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') { for (i++; i < close && code[i] !== ch; i++) if (code[i] === '\\') i++; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) return code.slice(open + 1, i).trim();
  }
  return code.slice(open + 1, close).trim();
}

/**
 * The mode an options argument sets through `key`: `insensitive` when the
 * framework default applies or the key is literally the insensitive value,
 * `sensitive` for the sensitive literal, `unknown` for anything else (a
 * non-literal value, or options that are not an object literal).
 */
function optionMode(arg, key, { sensitiveWhen, defaultMode }) {
  if (arg === null) return 'unknown';
  if (arg === '') return defaultMode;
  if (!arg.startsWith('{')) return 'unknown';
  const m = new RegExp(`\\b${key}\\s*:\\s*([^,}\\s]+)`).exec(arg);
  if (!m) return /\.\.\./.test(arg) ? 'unknown' : defaultMode;
  if (m[1] === 'true') return sensitiveWhen === true ? 'sensitive' : 'insensitive';
  if (m[1] === 'false') return sensitiveWhen === false ? 'sensitive' : 'insensitive';
  return 'unknown';
}

const ROUTER_DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+)?(?:[A-Za-z_$][\w$]*\s*\.\s*)?Router\s*\(/g;
const EXPRESS_APP_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\s*\(\s*\)/g;
const CSR_RE = /\.\s*(enable|disable|set)\s*\(\s*(['"])case sensitive routing\2\s*(?:,\s*([^)]*?))?\s*\)/g;

/** Combine modes: any sensitive wins, then any unknown, else insensitive. */
export function combineModes(modes) {
  if (modes.includes('sensitive')) return 'sensitive';
  if (modes.includes('unknown')) return 'unknown';
  return 'insensitive';
}

/**
 * The Express `case sensitive routing` setting across `sources`
 * ({ file, content }). Several apps are not told apart: any app that enables
 * the setting makes every app's routes compare exactly.
 * @returns {{ mode: string, notes: object[] }}
 */
export function expressAppMode(sources) {
  const modes = [];
  const notes = [];
  for (const { file, content } of sources) {
    const code = maskJsComments(content);
    for (const m of code.matchAll(CSR_RE)) {
      if (m[1] === 'enable') modes.push('sensitive');
      else if (m[1] === 'disable') modes.push('insensitive');
      else if (m[3] === undefined) continue; // a getter
      else if (m[3] === 'true') modes.push('sensitive');
      else if (m[3] === 'false') modes.push('insensitive');
      else {
        modes.push('unknown');
        notes.push({ framework: 'Express', file, line: lineAt(code, m.index), reason: `'case sensitive routing' is set to ${m[3].trim()}, which is not a literal` });
      }
    }
  }
  return { mode: combineModes(modes), notes };
}

/**
 * Routers declared in one file (`const r = express.Router({...})`,
 * `const r = new Router({...})`) and the mode each one's options set.
 * @param {string} content
 * @param {{ key: string, sensitiveWhen: boolean, defaultMode: string }} option
 * @returns {Map<string, { mode: string, line: number, arg: string|null }>}
 */
export function routerDeclarations(content, option) {
  const code = maskJsComments(content);
  const out = new Map();
  for (const m of code.matchAll(ROUTER_DECL_RE)) {
    const open = m.index + m[0].length - 1;
    const arg = firstArg(code, open);
    out.set(m[1], { mode: optionMode(arg, option.key, option), line: lineAt(code, m.index), arg });
  }
  return out;
}

/** Names bound to `express()` in one file. */
export function expressApps(content) {
  return new Set([...maskJsComments(content).matchAll(EXPRESS_APP_RE)].map(m => m[1]));
}

export const EXPRESS_ROUTER_OPTION = { key: 'caseSensitive', sensitiveWhen: true, defaultMode: 'insensitive' };
export const KOA_ROUTER_OPTION = { key: 'sensitive', sensitiveWhen: true, defaultMode: 'insensitive' };

/**
 * The case mode of every Express route receiver. `files` are
 * `{ filePath, fileLabel, content }`. `modeOf(filePath, receiver)` returns the
 * receiver's own mode: a router declared in that file by its options, an
 * `express()` app by the app setting, anything else (a parameter, an import)
 * insensitive only when no router or app in the project is, or may be,
 * case-sensitive.
 */
export function expressCaseModel(files) {
  const app = expressAppMode(files.map(f => ({ file: f.fileLabel, content: f.content })));
  const notes = [...app.notes];
  const perFile = new Map();
  const all = [app.mode];
  for (const { filePath, fileLabel, content } of files) {
    const routers = routerDeclarations(content, EXPRESS_ROUTER_OPTION);
    for (const [name, r] of routers) {
      all.push(r.mode);
      if (r.mode === 'unknown') notes.push({ framework: 'Express', file: fileLabel, line: r.line, reason: `router ${name}'s options (${(r.arg || '').slice(0, 60)}) do not set caseSensitive to a literal` });
    }
    perFile.set(filePath, { routers, apps: expressApps(content) });
  }
  const fallback = combineModes(all);
  const modeOf = (filePath, receiver) => {
    const info = perFile.get(filePath);
    if (info && receiver && info.routers.has(receiver)) return info.routers.get(receiver).mode;
    if (info && receiver && info.apps.has(receiver)) return app.mode;
    return fallback;
  };
  return { modeOf, notes };
}

/**
 * The case mode of every Koa route receiver: a router declared in its file
 * by its `sensitive` option, anything else insensitive only when no Koa router
 * in the project is, or may be, case-sensitive.
 */
export function koaCaseModel(files) {
  const notes = [];
  const perFile = new Map();
  const all = [];
  for (const { filePath, fileLabel, content } of files) {
    const routers = routerDeclarations(content, KOA_ROUTER_OPTION);
    for (const [name, r] of routers) {
      all.push(r.mode);
      if (r.mode === 'unknown') notes.push({ framework: 'Koa', file: fileLabel, line: r.line, reason: `router ${name}'s options (${(r.arg || '').slice(0, 60)}) do not set sensitive to a literal` });
    }
    perFile.set(filePath, routers);
  }
  const fallback = combineModes(all);
  const modeOf = (filePath, receiver) => {
    const routers = perFile.get(filePath);
    if (routers && receiver && routers.has(receiver)) return routers.get(receiver).mode;
    return fallback;
  };
  return { modeOf, notes };
}

const FASTIFY_FACTORY_RE = /(?:\b(?:fastify|Fastify)\s*\(|\brequire\s*\(\s*['"]fastify['"]\s*\)\s*\()/g;

/**
 * Fastify's mode: insensitive only when every server the project creates
 * (`fastify(...)`, `Fastify(...)`, `require('fastify')(...)`) passes a literal
 * `caseSensitive: false`. find-my-way's default is case-sensitive.
 */
export function fastifyCaseMode(files) {
  const modes = [];
  const notes = [];
  for (const { fileLabel, content } of files) {
    const code = maskJsComments(content);
    for (const m of code.matchAll(FASTIFY_FACTORY_RE)) {
      const before = code.slice(Math.max(0, m.index - 1), m.index);
      if (before === '.') continue; // fastify.get(...) is a route, not a factory
      const arg = firstArg(code, m.index + m[0].length - 1);
      const mode = optionMode(arg, 'caseSensitive', { sensitiveWhen: true, defaultMode: 'sensitive' });
      modes.push(mode);
      if (mode === 'unknown') notes.push({ framework: 'Fastify', file: fileLabel, line: lineAt(code, m.index), reason: `the server options (${(arg || '').slice(0, 60)}) do not set caseSensitive to a literal` });
    }
  }
  return { mode: modes.length ? combineModes(modes) : 'sensitive', notes };
}

/**
 * NestJS: the Express adapter (default) matches like the Express app; the
 * Fastify adapter (`FastifyAdapter`, `@nestjs/platform-fastify`) is
 * case-sensitive by default and is never marked.
 */
export function nestCaseMode(sources, deps = {}) {
  const fastify = deps['@nestjs/platform-fastify'] || sources.some(s => /\bFastifyAdapter\b/.test(maskJsComments(s.content)));
  if (fastify) return { mode: 'sensitive', notes: [] };
  const app = expressAppMode(sources);
  return { mode: app.mode, notes: app.notes.map(n => ({ ...n, framework: 'NestJS' })) };
}
