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
 * @req docguard.js-route-shapes#FR-007
 * @req docguard.js-route-shapes#FR-008
 * @req docguard.js-route-shapes#FR-009
 * @req docguard.js-route-shapes#FR-010
 * @req docguard.js-route-shapes#FR-011
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
import { extractJsRouteCalls } from '../cli/scanners/js-ast.mjs';

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

// ── FR-007: Express and Fastify paths that are not literal ──────────────────

describe('FR-007: an Express or Fastify path that is not literal is a limitation, not a placeholder', () => {
  it('extractJsRouteCalls reports no route for a dynamic template and lists it as unresolved', () => {
    const got = extractJsRouteCalls("app.get(`/items/${kind}`, list);\napp.get(`/static/${'x'}`, h);\napp.get('title');\napp.put('/items/:id', update);\n", 'r.ts');
    assert.deepEqual(got.map(r => `${r.method} ${r.path}`), ['PUT /items/:id']);
    assert.deepEqual(got.unresolved.map(u => u.line), [1, 2]);
  });

  it('records Express template, imported-constant and regular-expression paths in scan.unresolved, and the check is partial', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { express: '4.19.2' } }),
      'src/app.js': `const express = require('express');
const { ROUTES } = require('./routes');
const app = express();
const kind = 'books';
const BASE = '/base';
app.get(\`/items/\${req}\`, list);
app.get(ROUTES.users, list);
app.get(/.*fly$/, list);
app.get(\`\${BASE}/const\`, list);
app.get(\`/kind/\${kind}\`, list);
app.set('title', 'x'); app.get('title');
app.post('/ok', create);
module.exports = app;
`,
      'docs-canonical/API-REFERENCE.md': '#### POST `/ok`\n#### GET `/base/const`\n#### GET `/kind/books`\n',
    });
    const routes = routesOf(dir, 'Express');
    assert.deepEqual(routes.map(key).sort(), ['GET /base/const', 'GET /kind/books', 'POST /ok']);
    assert.deepEqual(unresolvedOf(routes), [
      { framework: 'Express', file: 'src/app.js', line: 6 },
      { framework: 'Express', file: 'src/app.js', line: 7 },
      { framework: 'Express', file: 'src/app.js', line: 8 },
    ]);
    const result = validateApiSurface(dir, {});
    assert.equal(result.applicability?.status, 'partial');
    assert.match(result.applicability.reason, /3 Express routes/);
  });

  it('records a Fastify template path, and a template in a file read by pattern, without a route', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { fastify: '4.28.0' } }),
      'src/server.js': "const fastify = require('fastify')();\nfastify.get(`/u/${id}`, h);\nfastify.get('/ok', h);\n",
      'src/broken.js': `fastify.get(\`/b/\${id}\`, h);\nfastify.get('/fine', h);\n${UNPARSEABLE}`,
    });
    const routes = routesOf(dir, 'Fastify');
    assert.deepEqual(routes.map(key).sort(), ['GET /fine', 'GET /ok']);
    assert.deepEqual(unresolvedOf(routes), [
      { framework: 'Fastify', file: 'src/broken.js', line: 1 },
      { framework: 'Fastify', file: 'src/server.js', line: 2 },
    ]);
  });
});

// ── FR-008: Pages advanced mode and _routes.json ─────────────────────────────

const WORKER_JS = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/hello' && request.method === 'GET') return new Response('hi');
    if (url.pathname === '/api/echo') return new Response(await request.text());
    return env.ASSETS.fetch(request);
  },
};
`;

describe('FR-008: Pages advanced mode and _routes.json', () => {
  it('reads an output-directory _worker.js as the fetch entry and ignores functions/', () => {
    const routes = routesOf(project(pages({
      'wrangler.toml': 'name = "site"\npages_build_output_dir = "./dist"\n',
      'dist/_worker.js': WORKER_JS,
      'functions/api/users.ts': 'export const onRequestGet = () => new Response("[]");\n',
    })));
    assert.deepEqual(routes.map(key).sort(), ['ALL /api/echo', 'GET /api/hello']);
    assert.ok(routes.every(r => r.source === 'cloudflare-pages' && r.file.startsWith('dist/_worker.js')), JSON.stringify(routes.map(r => [r.source, r.file])));
  });

  it('reads a _worker.js directory and a _worker.ts source, following their imports', () => {
    const dirForm = routesOf(project(pages({
      'wrangler.toml': 'name = "site"\npages_build_output_dir = "public"\n',
      'public/_worker.js/index.js': "import { route } from './route.js';\nexport default { fetch: (request) => route(request) };\n",
      'public/_worker.js/route.js': "export function route(request) {\n  const { pathname } = new URL(request.url);\n  switch (pathname) { case '/ping': return new Response('pong'); }\n  return new Response(null, { status: 404 });\n}\n",
    })));
    assert.deepEqual(dirForm.map(key), ['ALL /ping']);
    const tsForm = routesOf(project(pages({ 'src/_worker.ts': WORKER_JS })));
    assert.deepEqual(tsForm.map(key).sort(), ['ALL /api/echo', 'GET /api/hello']);
  });

  it('serves only the Functions _routes.json includes and does not exclude', () => {
    const files = pages({
      'wrangler.toml': 'name = "site"\npages_build_output_dir = "./dist"\n',
      'dist/_routes.json': JSON.stringify({ version: 1, include: ['/api/*', '/files/readme'], exclude: ['/api/admin/*'] }),
      'functions/index.ts': 'export const onRequestGet = () => new Response("home");\n',
      'functions/api/users/[id].ts': 'export const onRequestGet = () => new Response("u");\n',
      'functions/api/admin/stats.ts': 'export const onRequestGet = () => new Response("s");\n',
      'functions/files/[[path]].ts': 'export const onRequest = () => new Response("f");\n',
    });
    assert.deepEqual(routesOf(project(files)).map(key).sort(), ['ALL /files/:path*', 'GET /api/users/:id']);
    const loose = { ...files };
    delete loose['wrangler.toml'];
    delete loose['dist/_routes.json'];
    loose['public/_routes.json'] = JSON.stringify({ version: 1, include: ['/*'], exclude: ['/files/*'] });
    loose['package.json'] = '{}';
    assert.deepEqual(routesOf(project(loose)).map(key).sort(), ['GET /', 'GET /api/admin/stats', 'GET /api/users/:id']);
  });

  it('records a _routes.json it cannot read and filters nothing', () => {
    const routes = routesOf(project(pages({
      'wrangler.toml': 'name = "site"\npages_build_output_dir = "./dist"\n',
      'dist/_routes.json': '{ "version": 1, "include": [',
      'functions/a.ts': 'export const onRequestGet = () => new Response("a");\n',
    })));
    assert.deepEqual(routes.map(key), ['GET /a']);
    assert.deepEqual(unresolvedOf(routes), [{ framework: 'Cloudflare Pages', file: 'dist/_routes.json', line: 1 }]);
  });
});

// ── FR-009: koa-router redirect() ────────────────────────────────────────────

describe('FR-009: koa-router redirect()', () => {
  it('reports ALL at a literal source path under the prefix, and records a route-name source', () => {
    const routes = routesOf(project(koa({
      'src/r.js': `const Router = require('@koa/router');
const router = new Router({ prefix: '/p' });
router.get('start', '/start', h);
router.redirect('/old', '/new');
router.redirect('start', '/elsewhere', 302);
module.exports = router;
`,
    })));
    assert.deepEqual(routes.map(key).sort(), ['ALL /p/old', 'GET /p/start']);
    assert.equal(routes.find(r => key(r) === 'ALL /p/old').handler, 'redirect');
    assert.deepEqual(unresolvedOf(routes), [{ framework: 'Koa', file: 'src/r.js', line: 5 }]);
  });

  it('does not read redirect() on a router that is not Koa', () => {
    const routes = routesOf(project(hono({
      'src/app.ts': "import { Hono } from 'hono';\nconst app = new Hono();\napp.redirect('/old', '/new');\napp.get('/ok', h);\nexport default app;\n",
    })));
    assert.deepEqual(routes.map(key), ['GET /ok']);
  });
});

// ── FR-010: Express mounts whose prefix is not literal ──────────────────────

const express = files => ({ 'package.json': JSON.stringify({ dependencies: { express: '4.19.2' } }), ...files });
const USERS_ROUTER = "import { Router } from 'express';\nconst router = Router();\nrouter.get('/:id', show);\nrouter.post('/', create);\nexport default router;\n";

describe('FR-010: an Express mount prefix that is not literal', () => {
  it('resolves a same-file constant, an imported const and a template of constants', () => {
    const routes = routesOf(project(express({
      'src/config.ts': "export const API_PREFIX = '/api';\nexport const VERSION = 'v2';\n",
      'src/users.ts': USERS_ROUTER,
      'src/orders.ts': "import { Router } from 'express';\nconst orders = Router();\norders.get('/', list);\nexport default orders;\n",
      'src/items.ts': "import { Router } from 'express';\nconst items = Router();\nitems.get('/all', list);\nexport default items;\n",
      'src/app.ts': `import express from 'express';
import { API_PREFIX, VERSION } from './config';
import users from './users';
import orders from './orders';
import items from './items';
const app = express();
const LOCAL = '/local';
app.use(API_PREFIX + '/users', users);
app.use(\`\${API_PREFIX}/\${VERSION}/orders\`, orders);
app.use(LOCAL, items);
`,
    })), 'Express');
    assert.deepEqual(routes.map(key).sort(), ['GET /api/users/:id', 'GET /api/v2/orders', 'GET /local/all', 'POST /api/users']);
    assert.deepEqual(unresolvedOf(routes), []);
  });

  it('omits the routes under a prefix it cannot read, records the prefix once, and the check is partial', () => {
    const dir = project(express({
      'src/users.ts': USERS_ROUTER,
      'src/admin.ts': "import { Router } from 'express';\nimport users from './users';\nconst admin = Router();\nadmin.get('/stats', s);\nadmin.use('/users', users);\nexport default admin;\n",
      'src/health.ts': "import { Router } from 'express';\nconst health = Router();\nhealth.get('/health', h);\nexport default health;\n",
      'src/app.ts': `import express from 'express';
import { config } from './settings';
import admin from './admin';
import health from './health';
const app = express();
app.use(config.apiPrefix, admin);
app.use(\`\${process.env.BASE}/v1\`, health);
app.get('/ok', ok);
`,
      'docs-canonical/API-REFERENCE.md': '#### GET `/ok`\n',
    }));
    const routes = routesOf(dir, 'Express');
    assert.deepEqual(routes.map(key), ['GET /ok']);
    assert.deepEqual((routes.scan.unresolved || []).map(u => [u.framework, u.code, u.file, u.line]).sort(), [
      ['Express', 'route-unresolved-prefix', 'src/app.ts', 6],
      ['Express', 'route-unresolved-prefix', 'src/app.ts', 7],
    ]);
    const result = validateApiSurface(dir, {});
    assert.equal(result.applicability?.status, 'partial');
    assert.match(result.applicability.reason, /2 Express routes.*src\/app\.ts:6/);
  });

  it('keeps the routes a literal mount reaches when the same router is also mounted under an unreadable prefix', () => {
    const routes = routesOf(project(express({
      'src/users.ts': USERS_ROUTER,
      'src/app.ts': "import express from 'express';\nimport users from './users';\nconst app = express();\napp.use('/users', users);\napp.use(PREFIX, users);\n",
    })), 'Express');
    assert.deepEqual(routes.map(key).sort(), ['GET /users/:id', 'POST /users']);
    assert.deepEqual(unresolvedOf(routes).map(u => u.line), [5]);
  });

  it('does not take middleware for a prefix', () => {
    const routes = routesOf(project(express({
      'src/users.ts': USERS_ROUTER,
      'src/app.ts': "import express from 'express';\nimport users from './users';\nconst app = express();\napp.use(requireAuth, users);\napp.use(middlewares.cors, users);\n",
    })), 'Express');
    assert.deepEqual(routes.map(key).sort(), ['GET /:id', 'POST /']);
    assert.deepEqual(unresolvedOf(routes), []);
  });
});

// ── FR-011: route paths and prefixes from imported constants ────────────────

describe('FR-011: imported const strings in paths and prefixes, ES module and CommonJS', () => {
  it('resolves Express route paths from named, namespace, concatenated and template uses of imported consts', () => {
    const routes = routesOf(project(express({
      'src/paths.ts': "export const USERS_PATH = '/users';\nconst ORDERS = '/orders';\nexport { ORDERS as ORDERS_PATH };\nexport const API = '/api';\n",
      'src/app.ts': `import express from 'express';
import { USERS_PATH, API, ORDERS_PATH } from './paths';
import * as P from './paths';
const app = express();
app.get(USERS_PATH, list);
app.get(API + '/items', list);
app.get(\`\${API}\${ORDERS_PATH}/:id\`, show);
app.get(P.USERS_PATH + '/me', me);
app.get(UNKNOWN_PATH, h);
`,
    })), 'Express');
    assert.deepEqual(routes.map(key).sort(), ['GET /api/items', 'GET /api/orders/:id', 'GET /users', 'GET /users/me']);
    assert.deepEqual(unresolvedOf(routes).map(u => u.line), [9]);
  });

  it('resolves CommonJS destructured and member constants for Express paths and mount prefixes', () => {
    const routes = routesOf(project(express({
      'src/config.js': "module.exports = { PREFIX: '/api', TIMEOUT: 30 };\n",
      'src/paths.js': "exports.USERS = '/users';\nmodule.exports.ORDERS = '/orders';\n",
      'src/users.js': "const express = require('express');\nconst router = express.Router();\nrouter.get('/:id', show);\nmodule.exports = router;\n",
      'src/app.js': `const express = require('express');
const { PREFIX } = require('./config');
const cfg = require('./config');
const paths = require('./paths');
const users = require('./users');
const app = express();
app.use(PREFIX, users);
app.use(cfg.PREFIX + '/v2', users);
app.get(paths.USERS, list);
app.get(\`\${paths.ORDERS}/:id\`, show);
app.get(cfg.MISSING, h);
`,
    })), 'Express');
    assert.deepEqual(routes.map(key).sort(), ['GET /api/:id', 'GET /api/v2/:id', 'GET /orders/:id', 'GET /users']);
    assert.deepEqual(unresolvedOf(routes).map(u => u.line), [11]);
  });

  it('resolves an imported const path for Fastify', () => {
    const routes = routesOf(project({
      'package.json': JSON.stringify({ dependencies: { fastify: '4.28.0' } }),
      'src/paths.js': "export const HEALTH = '/health';\n",
      'src/server.js': "import Fastify from 'fastify';\nimport { HEALTH } from './paths';\nconst fastify = Fastify();\nfastify.get(HEALTH, h);\n",
    }), 'Fastify');
    assert.deepEqual(routes.map(key), ['GET /health']);
    assert.deepEqual(unresolvedOf(routes), []);
  });

  it('resolves imported consts for Koa prefixes and Hono paths', () => {
    const koaRoutes = routesOf(project(koa({
      'src/config.js': "module.exports = { PREFIX: '/api' };\nexports.ignored = 1;\n",
      'src/paths.js': "exports.USERS = '/users';\n",
      'src/r.js': `const Router = require('@koa/router');
const { PREFIX } = require('./config');
const paths = require('./paths');
const router = new Router({ prefix: PREFIX });
router.get(paths.USERS, h);
router.get(\`\${paths.USERS}/:id\`, h);
module.exports = router;
`,
    })));
    assert.deepEqual(koaRoutes.map(key).sort(), ['GET /api/users', 'GET /api/users/:id']);
    const honoRoutes = routesOf(project(hono({
      'src/paths.ts': "export const BOOKS = '/books';\n",
      'src/app.ts': "import { Hono } from 'hono';\nimport { BOOKS } from './paths';\nconst app = new Hono();\napp.get(BOOKS, (c) => c.json([]));\nexport default app;\n",
    })));
    assert.deepEqual(honoRoutes.map(key), ['GET /books']);
    assert.deepEqual(unresolvedOf(honoRoutes), []);
  });

  it('takes a default import of a CommonJS module as its exports object, but not of an ES module', () => {
    const routes = routesOf(project(express({
      'src/paths.ts': "export const USERS = '/users';\n",
      'src/app.ts': "import express from 'express';\nimport paths from './paths';\nconst app = express();\napp.get(paths.USERS, h);\n",
    })), 'Express');
    assert.deepEqual(routes.map(key), []);
    assert.deepEqual(unresolvedOf(routes).map(u => u.line), [4]);    const cjs = routesOf(project(express({
      'src/paths.js': "module.exports = { USERS: '/users' };\n",
      'src/app.ts': "import express from 'express';\nimport paths from './paths';\nconst app = express();\napp.get(paths.USERS, h);\n",
    })), 'Express');
    assert.deepEqual(cjs.map(key), ['GET /users']);
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
    assert.match(doc, /^\| Cloudflare Pages \|.*_routes\.json.*_worker\.js/m);
    assert.match(doc, /^\| Koa \|.*redirect/m);
    assert.match(doc, /^\| Express \|.*require\('\.\/config'\).*not literal.*mount prefix/m);
    assert.match(read('docs/commands.md'), /Cloudflare Pages/);
  });

  it('names the reader in the architecture and the change in the changelog', () => {
    assert.ok(read('docs-canonical/ARCHITECTURE.md').includes('pages-routes.mjs'));
    const unreleased = read('CHANGELOG.md').split(/^## \[/m)[1];
    assert.match(unreleased, /specs\/064-js-route-shapes/);
  });
});
