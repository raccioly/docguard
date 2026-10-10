/**
 * Koa mounts, Cloudflare Pages Functions and @hono/zod-openapi routes
 * (spec 064).
 *
 * Every reference-project assertion compares the scan with a ground truth
 * written by hand in tests/fixtures/js-route-shape-projects.mjs. Each project
 * is written to a fresh temp dir; nothing here reads repository state except
 * the docs test (FR-006).
 *
 * @req docguard.js-route-shapes#FR-001
 * @req docguard.js-route-shapes#FR-002
 * @req docguard.js-route-shapes#FR-003
 * @req docguard.js-route-shapes#FR-004
 * @req docguard.js-route-shapes#FR-005
 * @req docguard.js-route-shapes#FR-006
 * @req docguard.js-route-shapes#SC-001
 * @req docguard.js-route-shapes#SC-002
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  writeFiles, UNPARSEABLE,
  KOA_FILES, KOA_TRUTH, PAGES_FILES, PAGES_TRUTH, OPENAPI_FILES, OPENAPI_TRUTH,
} from './fixtures/js-route-shape-projects.mjs';
import { WORKER_FETCH_FILES, WORKER_FETCH_TRUTH } from './fixtures/js-framework-projects.mjs';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { detectProjectProfile } from '../cli/scanners/project-type.mjs';
import { validateApiSurface } from '../cli/validators/api-surface.mjs';

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-064-'));
  dirs.push(dir);
  writeFiles(dir, files);
  return dir;
}

function routesOf(dir, framework = null) {
  const fw = framework ?? detectProjectProfile(dir, {}).frameworks.join(' ');
  return scanRoutesDeep(dir, { framework: fw }, {}, { config: {} });
}

const key = r => `${r.method} ${r.path}`;
const authMap = routes => Object.fromEntries(routes.map(r => [key(r), Boolean(r.auth)]).sort(([a], [b]) => a.localeCompare(b)));
const sorted = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
const unresolvedOf = routes => (routes.scan?.unresolved || []).map(u => ({ framework: u.framework, file: u.file, line: u.line }))
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const koa = files => ({ 'package.json': JSON.stringify({ dependencies: { koa: '2.15.3', '@koa/router': '12.0.1' } }), ...files });
const hono = files => ({ 'package.json': JSON.stringify({ dependencies: { hono: '4.4.6', '@hono/zod-openapi': '0.14.5' } }), ...files });
const pages = files => ({ 'wrangler.toml': 'name = "site"\npages_build_output_dir = "dist"\n', 'package.json': '{}', ...files });

// ── FR-001: Koa ──────────────────────────────────────────────────────────────

describe('FR-001: Koa routers, prefixes and mounts', () => {
  it('reports exactly the reference project\'s routes, served paths and auth', () => {
    const dir = project(KOA_FILES);
    assert.equal(detectProjectProfile(dir, {}).primary.framework, 'Koa');
    const routes = routesOf(dir);
    assert.deepEqual(authMap(routes), sorted(KOA_TRUTH.routes));
    assert.ok(routes.every(r => r.source === 'koa' && r.file && Number.isInteger(r.line)), JSON.stringify(routes.map(r => r.source)));
    assert.ok(routes.every(r => r.tier === 'js-ast'));
    assert.deepEqual(unresolvedOf(routes), []);
  });

  it('reads ES module routers, a chained prefix(), middleware() mounts and koa-mount of a router', () => {
    const routes = routesOf(project(koa({
      'src/index.ts': `import Koa from 'koa';
import mount from 'koa-mount';
import Router from '@koa/router';
import orders from './orders';
const app = new Koa();
const v2 = new Router().prefix('/v2');
v2.use('/orders', orders.middleware());
app.use(v2.routes());
app.use(mount('/legacy', orders.routes()));
`,
      'src/orders.ts': `import Router from '@koa/router';
const orders = new Router();
orders.get('/', list).post('/', create);
orders.patch('/:id', update);
export default orders;
`,
    })));
    assert.deepEqual(routes.map(key).sort(), [
      'GET /legacy', 'GET /v2/orders', 'PATCH /legacy/:id', 'PATCH /v2/orders/:id', 'POST /legacy', 'POST /v2/orders',
    ]);
  });

  it('reads a koa-router factory call and a use() path as a prefix for auth', () => {
    const routes = routesOf(project(koa({
      'src/routes.js': `const router = require('koa-router')({ prefix: '/app' });
router.use('/private', requireUser);
router.get('/private', show);
router.get('/private/settings', show);
router.get('/privateer', show);
router.get('/public', show);
module.exports = router;
`,
    })));
    assert.deepEqual(authMap(routes), {
      'GET /app/private': true, 'GET /app/private/settings': true, 'GET /app/privateer': false, 'GET /app/public': false,
    });
  });

  it('marks routes under a mount with auth middleware beside it, and keeps a router mounted twice at both paths', () => {
    const routes = routesOf(project(koa({
      'src/app.js': `const Router = require('@koa/router');
const items = new Router();
items.get('/items', list);
const root = new Router();
root.use('/secure', authenticate, items.routes());
root.use('/open', items.routes());
module.exports = root;
`,
    })));
    assert.deepEqual(authMap(routes), { 'GET /open/items': false, 'GET /secure/items': true });
  });

  it('records an unresolvable prefix or mount path and does not report the routes below it', () => {
    const routes = routesOf(project(koa({
      'src/a.js': `const Router = require('@koa/router');
const { PREFIX } = require('./config');
const dynamic = new Router({ prefix: process.env.API_PREFIX });
dynamic.get('/x', h);
const parent = new Router();
const child = new Router();
child.get('/y', h);
parent.use(PREFIX, child.routes());
parent.get(ROUTES.z, h);
parent.get('/ok', h);
module.exports = parent;
`,
    })));
    assert.deepEqual(routes.map(key), ['GET /ok']);
    assert.deepEqual(unresolvedOf(routes), [
      { framework: 'Koa', file: 'src/a.js', line: 3 },
      { framework: 'Koa', file: 'src/a.js', line: 8 },
      { framework: 'Koa', file: 'src/a.js', line: 9 },
    ]);
  });

  it('reads a Koa file that does not parse by pattern, with its prefix, at regex-fallback', () => {
    const routes = routesOf(project(koa({
      'src/r.js': `const Router = require('@koa/router');\nconst router = new Router({ prefix: '/p' });\nrouter.get('/a', h);\nrouter.del('/b', h);\n${UNPARSEABLE}`,
    })));
    assert.deepEqual(routes.map(key).sort(), ['DELETE /p/b', 'GET /p/a']);
    assert.ok(routes.every(r => r.tier === 'regex-fallback' && r.tierReason && r.source === 'koa'));
  });
});

// ── FR-002: the Pages label ──────────────────────────────────────────────────

describe('FR-002: Cloudflare Pages is labelled Pages, and a plain Worker stays a Worker', () => {
  it('labels a Wrangler file with pages_build_output_dir as Cloudflare Pages, keeping React as a library', () => {
    const profile = detectProjectProfile(project(PAGES_FILES), {});
    assert.equal(profile.primary.framework, 'Cloudflare Pages');
    assert.ok(profile.primary.libraries.includes('React'));
  });

  it('labels a project with no Wrangler file and onRequest exports under functions/ as Cloudflare Pages', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { react: '18.3.1' } }),
      'functions/api/hello.js': 'export function onRequestGet() { return new Response("hi"); }\n',
    });
    assert.equal(detectProjectProfile(dir, {}).primary.framework, 'Cloudflare Pages');
    assert.deepEqual(routesOf(dir).map(key), ['GET /api/hello']);
  });

  it('does not label a Firebase functions/ directory, or a Wrangler JSON file without the key, as Pages', () => {
    const firebase = project({
      'package.json': JSON.stringify({ dependencies: { express: '4.19.2' } }),
      'functions/index.js': "const { onRequest } = require('firebase-functions/v2/https');\nexports.api = onRequest(app);\nexport const api2 = onRequest(app);\n",
    });
    assert.equal(detectProjectProfile(firebase, {}).primary.framework, 'Express');
    const dir = project(WORKER_FETCH_FILES);
    assert.equal(detectProjectProfile(dir, {}).primary.framework, 'Cloudflare Workers');
    assert.deepEqual(authMap(routesOf(dir)), sorted(WORKER_FETCH_TRUTH.routes));
    const jsonPages = project({ 'wrangler.jsonc': '// site\n{ "name": "s", "pages_build_output_dir": "./out" }\n', 'package.json': '{}' });
    assert.equal(detectProjectProfile(jsonPages, {}).primary.framework, 'Cloudflare Pages');
  });
});

// ── FR-003: Pages Functions ──────────────────────────────────────────────────

describe('FR-003: Pages Functions routes', () => {
  it('reports exactly the reference project\'s routes, served paths and auth', () => {
    const routes = routesOf(project(PAGES_FILES));
    assert.deepEqual(authMap(routes), sorted(PAGES_TRUTH.routes));
    for (const r of routes) {
      assert.equal(r.source, PAGES_TRUTH.sources[key(r)] || 'cloudflare-pages', key(r));
      assert.equal(r.tier, 'js-ast', key(r));
    }
    assert.deepEqual(unresolvedOf(routes), []);
  });

  it('reads export lists, re-exports and function middleware arrays, and scopes a middleware to its methods', () => {
    const routes = routesOf(project(pages({
      'functions/a.ts': 'const get = () => new Response("a");\nfunction put() { return new Response(null); }\nexport { get as onRequestGet, put as onRequestPut };\n',
      'functions/b/index.js': "export { onRequestPost } from '../../lib/b';\n",
      'functions/b/_middleware.js': 'export const onRequestPost = [checkSignature, async (ctx) => { if (!ctx.data.session) return new Response(null, { status: 401 }); return ctx.next(); }];\n',
      'functions/b/[slug]/[[rest]].ts': 'export const onRequestHead = () => new Response(null);\nexport const onRequestOptions = () => new Response(null);\n',
    })));
    assert.deepEqual(authMap(routes), {
      'GET /a': false, 'HEAD /b/:slug/:rest*': false, 'OPTIONS /b/:slug/:rest*': false, 'POST /b': true, 'PUT /a': false,
    });
  });

  it('records an export * and a partial-segment file name instead of guessing, and reads an unparseable file by pattern', () => {
    const routes = routesOf(project(pages({
      'functions/star.ts': "export * from '../impl/star';\n",
      'functions/user-[id].ts': 'export const onRequestGet = () => new Response("u");\n',
      'functions/broken.ts': `export async function onRequestPost() { return new Response(null); }\n${UNPARSEABLE}`,
      'functions/ok.ts': 'export const onRequest = () => new Response("ok");\n',
    })));
    assert.deepEqual(routes.map(key).sort(), ['ALL /ok', 'POST /broken']);
    assert.equal(routes.find(r => key(r) === 'POST /broken').tier, 'regex-fallback');
    assert.deepEqual(unresolvedOf(routes), [
      { framework: 'Cloudflare Pages', file: 'functions/star.ts', line: 1 },
      { framework: 'Cloudflare Pages', file: 'functions/user-[id].ts', line: 1 },
    ]);
  });
});

// ── FR-004: @hono/zod-openapi ────────────────────────────────────────────────

describe('FR-004: @hono/zod-openapi routes', () => {
  it('reports exactly the reference project\'s routes, served paths and auth', () => {
    const dir = project(OPENAPI_FILES);
    assert.equal(detectProjectProfile(dir, {}).primary.framework, 'Hono');
    const routes = routesOf(dir);
    assert.deepEqual(authMap(routes), sorted(OPENAPI_TRUTH.routes));
    assert.ok(routes.every(r => r.source === 'hono' && r.tier === 'js-ast'));
    assert.deepEqual(unresolvedOf(routes), []);
  });

  it('reads the same OpenAPI app on Workers', () => {
    const routes = routesOf(project({ ...OPENAPI_FILES, 'wrangler.toml': 'name = "users"\nmain = "src/index.ts"\n' }));
    assert.deepEqual(authMap(routes), sorted(OPENAPI_TRUTH.routes));
  });

  it('reads a plain route object and a route mounted from another OpenAPIHono app', () => {
    const routes = routesOf(project(hono({
      'src/app.ts': `import { OpenAPIHono } from '@hono/zod-openapi';
const api = new OpenAPIHono();
api.openapi({ method: 'patch', path: '/things/{thingId}', responses: {} }, (c) => c.json({}));
api.doc31('/spec', { openapi: '3.1.0', info: { title: 't', version: '1' } });
const app = new OpenAPIHono();
app.route('/api', api);
export default app;
`,
    })));
    assert.deepEqual(routes.map(key).sort(), ['GET /api/spec', 'PATCH /api/things/:thingId']);
  });

  it('records a non-literal path, an unresolvable route value and a non-literal method', () => {
    const routes = routesOf(project(hono({
      'src/app.ts': `import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { external } from 'some-package';
const app = new OpenAPIHono();
app.openapi(createRoute({ method: 'get', path: PATHS.user, responses: {} }), h);
app.openapi(routes[0], h);
app.openapi(external, h);
app.openapi(createRoute({ method: verb, path: '/v', responses: {} }), h);
app.openapi(createRoute({ method: 'get', path: '/fine', responses: {} }), h);
export default app;
`,
    })));
    assert.deepEqual(routes.map(key), ['GET /fine']);
    assert.deepEqual(unresolvedOf(routes).map(u => u.line), [4, 5, 6, 7]);
  });
});

// ── FR-005: coverage ─────────────────────────────────────────────────────────

describe('FR-005: an unresolved path makes the API-surface check partial', () => {
  it('names the framework, count and first location', () => {
    const dir = project(koa({
      'src/a.js': "const Router = require('@koa/router');\nconst r = new Router();\nr.get('/ok', h);\nr.get(PATHS.users, h);\nmodule.exports = r;\n",
      'docs-canonical/API-REFERENCE.md': '#### GET `/ok`\n',
    }));
    const result = validateApiSurface(dir, {});
    assert.equal(result.applicability?.status, 'partial');
    assert.match(result.applicability.reason, /1 Koa route/);
    assert.match(result.applicability.reason, /src\/a\.js:4/);
  });

  it('drops a Hono sub-app mounted under an unresolvable route() prefix instead of reporting it at the root', () => {
    const routes = routesOf(project(hono({
      'src/app.ts': "import { Hono } from 'hono';\nconst app = new Hono();\nconst books = new Hono();\nbooks.get('/list', h);\napp.route(BOOKS_PREFIX, books);\napp.get('/ok', h);\nexport default app;\n",
    })));
    assert.deepEqual(routes.map(key), ['GET /ok']);
    assert.deepEqual(unresolvedOf(routes).map(u => u.line), [5]);
  });
});

// ── FR-006: documentation ───────────────────────────────────────────────────

describe('FR-006: the docs say what is read', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const read = rel => readFileSync(join(root, rel), 'utf8');

  it('lists Koa, Cloudflare Pages and @hono/zod-openapi in the languages reference', () => {
    const doc = read('docs/reference/languages.md');
    assert.match(doc, /^\| Koa \|.*router-routes\.mjs/m);
    assert.match(doc, /^\| Cloudflare Pages \|.*pages-routes\.mjs/m);
    assert.match(doc, /^\| Hono \|.*zod-openapi/m);
    assert.match(read('docs/commands.md'), /Cloudflare Pages/);
  });

  it('names the reader in the architecture and the change in the changelog', () => {
    assert.ok(read('docs-canonical/ARCHITECTURE.md').includes('pages-routes.mjs'));
    const unreleased = read('CHANGELOG.md').split(/^## \[/m)[1];
    assert.match(unreleased, /specs\/064-js-route-shapes/);
  });
});
