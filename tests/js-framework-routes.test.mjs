/**
 * NestJS and Cloudflare Workers route extraction (spec 058).
 *
 * Every reference-project assertion compares the scan with a ground truth
 * written by hand in tests/fixtures/js-framework-projects.mjs. Each project is
 * written to a fresh temp dir; nothing here reads repository state except the
 * docs test (FR-008).
 *
 * @req docguard.js-framework-routes#FR-001
 * @req docguard.js-framework-routes#FR-002
 * @req docguard.js-framework-routes#FR-003
 * @req docguard.js-framework-routes#FR-004
 * @req docguard.js-framework-routes#FR-005
 * @req docguard.js-framework-routes#FR-006
 * @req docguard.js-framework-routes#FR-007
 * @req docguard.js-framework-routes#FR-008
 * @req docguard.js-framework-routes#SC-001
 * @req docguard.js-framework-routes#SC-002
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  writeFiles, UNPARSEABLE,
  NEST_FILES, NEST_TRUTH, NEST_GUARD_FILES, NEST_BROKEN_CONTROLLER, NEST_GUARD_TRUTH,
  WORKER_FETCH_FILES, WORKER_FETCH_TRUTH, WORKER_ITTY_FILES, WORKER_ITTY_TRUTH,
  HONO_FILES, HONO_WORKER_FILES, HONO_TRUTH,
} from './fixtures/js-framework-projects.mjs';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { detectProjectProfile } from '../cli/scanners/project-type.mjs';
import { validateApiSurface, detectRouteFramework } from '../cli/validators/api-surface.mjs';

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-058-'));
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
  .sort((a, b) => a.file.localeCompare(b.file));
const nest = (files) => ({ 'package.json': JSON.stringify({ dependencies: { '@nestjs/common': '10', '@nestjs/core': '10' } }), ...files });
const worker = (files) => ({ 'wrangler.toml': 'name = "w"\n', 'package.json': '{}', ...files });

// ── FR-001, FR-002: NestJS paths ─────────────────────────────────────────────

describe('FR-001/FR-002: NestJS controllers, prefixes, versions and router modules', () => {
  it('reports exactly the reference project\'s routes, served paths and auth', () => {
    const routes = routesOf(project(NEST_FILES));
    assert.deepEqual(authMap(routes), sorted(NEST_TRUTH.routes));
    for (const [k, handler] of Object.entries(NEST_TRUTH.handlers)) {
      assert.equal(routes.find(r => key(r) === k)?.handler, handler, k);
    }
    assert.ok(routes.every(r => r.source === 'nestjs' && r.file && Number.isInteger(r.line)));
    assert.deepEqual(unresolvedOf(routes), NEST_TRUTH.unresolved);
  });

  it('reads array and object controller paths, @All, and same-file constants', () => {
    const routes = routesOf(project(nest({
      'src/a.controller.ts': `import { Controller, All, Get, Head, Options, Search } from '@nestjs/common';
const BASE = 'files';
@Controller(['a', 'b/'])
export class A { @All('*') any() {} }
@Controller({ path: BASE + '/x', host: 'admin.example.com' })
export class B { @Get(['', ':id']) get() {} @Head() head() {} @Options() opts() {} @Search() find() {} }
`,
    })));
    assert.deepEqual(routes.map(key).sort(), [
      'ALL /a/*', 'ALL /b/*', 'GET /files/x', 'GET /files/x/:id', 'HEAD /files/x', 'OPTIONS /files/x', 'SEARCH /files/x',
    ]);
  });

  it('applies defaultVersion, a custom version prefix, prefix: false and RouterModule children', () => {
    const files = nest({
      'src/main.ts': `import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
const app = await NestFactory.create(AppModule);
app.enableVersioning({ type: VersioningType.URI, prefix: 'version-', defaultVersion: ['1', '2'] });
`,
      'src/app.module.ts': `import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
const routes = [{ path: 'shop', module: ShopModule, children: [{ path: 'orders', module: OrdersModule }, CartModule] }];
@Module({ imports: [RouterModule.register(routes)] })
export class AppModule {}
@Module({ controllers: [OrdersController] }) export class OrdersModule {}
@Module({ controllers: [CartController] }) export class CartModule {}
`,
      'src/orders.controller.ts': `import { Controller, Get } from '@nestjs/common';
@Controller() export class OrdersController { @Get(':id') one() {} }
`,
      'src/cart.controller.ts': `import { Controller, Get, Version } from '@nestjs/common';
@Controller('cart') export class CartController { @Get() @Version('3') show() {} }
`,
    });
    assert.deepEqual(routesOf(project(files)).map(key).sort(), [
      'GET /version-1/shop/orders/:id', 'GET /version-2/shop/orders/:id', 'GET /version-3/shop/cart',
    ]);
    files['src/main.ts'] = files['src/main.ts'].replace("prefix: 'version-', defaultVersion: ['1', '2']", 'prefix: false');
    assert.deepEqual(routesOf(project(files)).map(key).sort(), ['GET /3/shop/cart', 'GET /shop/orders/:id']);
  });

  it('keeps header versioning out of the path', () => {
    const routes = routesOf(project(nest({
      'src/main.ts': "app.enableVersioning({ type: VersioningType.HEADER, header: 'X-Version' });\n",
      'src/c.controller.ts': "import { Controller, Get } from '@nestjs/common';\n@Controller({ path: 'c', version: '1' }) export class C { @Get() g() {} }\n",
    })));
    assert.deepEqual(routes.map(key), ['GET /c']);
  });

  it('scopes each application\'s settings to its own directory in a monorepo', () => {
    const routes = routesOf(project(nest({
      'apps/api/src/main.ts': "app.setGlobalPrefix('api');\n",
      'apps/api/src/users.controller.ts': "import { Controller, Get } from '@nestjs/common';\n@Controller('users') export class U { @Get() list() {} }\n",
      'apps/admin/src/main.ts': "app.setGlobalPrefix('admin');\n",
      'apps/admin/src/stats.controller.ts': "import { Controller, Get } from '@nestjs/common';\n@Controller('stats') export class S { @Get() list() {} }\n",
    })));
    assert.deepEqual(routes.map(key).sort(), ['GET /admin/stats', 'GET /api/users']);
  });
});

// ── FR-003: NestJS auth ──────────────────────────────────────────────────────

describe('FR-003: NestJS guards', () => {
  it('reads a global guard, @Public() and the pattern fallback in the reference project', () => {
    const files = { ...NEST_GUARD_FILES, 'src/items.controller.ts': NEST_BROKEN_CONTROLLER.replace('%UNPARSEABLE%', UNPARSEABLE) };
    const routes = routesOf(project(files));
    assert.deepEqual(authMap(routes), sorted(NEST_GUARD_TRUTH.routes));
    for (const r of routes) {
      assert.equal(r.tier, NEST_GUARD_TRUTH.regexFallback.includes(key(r)) ? 'regex-fallback' : 'js-ast', key(r));
    }
  });

  it('treats an APP_GUARD auth provider and an @Auth() decorator as auth, and Swagger decorators as not', () => {
    const routes = routesOf(project(nest({
      'src/app.module.ts': "import { APP_GUARD } from '@nestjs/core';\n@Module({ providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] }) export class AppModule {}\n",
      'src/a.controller.ts': `import { Controller, Get } from '@nestjs/common';
@Controller('a') export class A { @Get('open') @AllowAnonymous() open() {} @Get('closed') closed() {} }
`,
    })));
    assert.deepEqual(authMap(routes), { 'GET /a/closed': true, 'GET /a/open': false });

    const local = routesOf(project(nest({
      'src/b.controller.ts': `import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
@Controller('b') @ApiBearerAuth() export class B { @Get() @Auth(Role.Admin) admin() {} @Post() @UseGuards(ApiKeyGuard) key() {} @Get('doc') @ApiBearerAuth() doc() {} }
`,
    })));
    assert.deepEqual(authMap(local), { 'GET /b': true, 'GET /b/doc': false, 'POST /b': true });
  });
});

// ── FR-004: Cloudflare Workers fetch dispatch ────────────────────────────────

describe('FR-004: Worker fetch-handler dispatch', () => {
  it('reports exactly the reference Worker\'s routes and records what it cannot read', () => {
    const routes = routesOf(project(WORKER_FETCH_FILES));
    assert.deepEqual(authMap(routes), sorted(WORKER_FETCH_TRUTH.routes));
    assert.ok(routes.every(r => r.source === 'cloudflare-workers'), routes.map(r => r.source).join());
    assert.deepEqual(unresolvedOf(routes), WORKER_FETCH_TRUTH.unresolved);
  });

  it('reads the negated early-return form, a Map dispatch and the service-worker syntax', () => {
    const routes = routesOf(project(worker({
      'src/index.js': `addEventListener('fetch', (event) => event.respondWith(handle(event.request)));
const table = new Map([['/a', a], ['/b', b]]);
async function handle(request) {
  const path = new URL(request.url).pathname;
  const hit = table.get(path);
  if (hit) return hit(request);
  if (request.method !== 'POST' || path !== '/webhook') return new Response(null, { status: 404 });
  return new Response('ok');
}
`,
    })));
    assert.deepEqual(routes.map(key).sort(), ['ALL /a', 'ALL /b', 'POST /webhook']);
  });

  it('takes methods from a URLPattern route table and from an enclosing method check', () => {
    const routes = routesOf(project(worker({
      'src/worker.ts': `const ROUTES = [
  { method: 'GET', pattern: new URLPattern({ pathname: '/posts/:slug(\\\\w+)' }), handler: show },
  { method: ['PUT', 'PATCH'], pattern: new URLPattern({ pathname: '/posts/:slug' }), handler: save },
];
export default class extends WorkerEntrypoint {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method === 'DELETE') {
      if (pathname === '/cache') return purge();
    }
    for (const r of ROUTES) if (r.pattern.test(request.url)) return r.handler(request);
    return new Response(null, { status: 404 });
  }
}
`,
    })));
    assert.deepEqual(routes.map(key).sort(), ['DELETE /cache', 'GET /posts/:slug', 'PATCH /posts/:slug', 'PUT /posts/:slug']);
  });
});

// ── FR-005: Hono and itty-router ─────────────────────────────────────────────

describe('FR-005: Hono and itty-router routers', () => {
  it('reads an itty-router Worker with bases, chains, delegation and auth', () => {
    const routes = routesOf(project(WORKER_ITTY_FILES));
    assert.deepEqual(authMap(routes), sorted(WORKER_ITTY_TRUTH.routes));
    assert.ok(routes.every(r => r.source === 'itty-router'));
  });

  it('reads Hono on Workers with basePath, route() mounts across files and use() auth', () => {
    const routes = routesOf(project(HONO_WORKER_FILES));
    assert.deepEqual(authMap(routes), sorted(HONO_TRUTH.routes));
    assert.ok(routes.every(r => r.source === 'hono'));
  });

  it('reads the same Hono app identically without Wrangler', () => {
    const dir = project(HONO_FILES);
    assert.deepEqual(detectProjectProfile(dir, {}).frameworks, ['Hono']);
    assert.deepEqual(authMap(routesOf(dir)), sorted(HONO_TRUTH.routes));
  });

  it('applies an itty all("*", auth) and AutoRouter before, and keeps router-named receivers', () => {
    const routes = routesOf(project(worker({
      'src/index.ts': `import { AutoRouter, Router } from 'itty-router';
export const open = Router();
open.get('/ping', () => 'pong');
open.all('*', withAuth);
open.get('/secret', () => 's');
export const guarded = AutoRouter({ base: '/g', before: [withAuth] });
guarded.get('/x', () => 1);
`,
      'src/register.ts': "export function register(router) { router.post('/hooks', (req) => 1); }\n",
    })));
    assert.deepEqual(authMap(routes), { 'GET /g/x': true, 'GET /ping': false, 'GET /secret': true, 'POST /hooks': false });
  });

  it('records a dynamic Hono path as a limitation instead of a placeholder', () => {
    const routes = routesOf(project({
      'package.json': JSON.stringify({ dependencies: { hono: '4' } }),
      'src/app.ts': "import { Hono } from 'hono';\nimport { PATHS } from './paths';\nconst app = new Hono();\napp.get(PATHS.users, (c) => c.json([]));\napp.get(`/u/${id}`, (c) => c.json([]));\napp.get('/ok', (c) => c.text('ok'));\nexport default app;\n",
    }));
    assert.deepEqual(routes.map(key), ['GET /ok']);
    assert.deepEqual(unresolvedOf(routes).map(u => u.line), [4, 5]);
  });
});

// ── FR-006: tiers, fallback and coverage ─────────────────────────────────────

describe('FR-006: tiers, pattern fallback and partial coverage', () => {
  it('carries js-ast on every route read from a syntax tree and records the files read', () => {
    for (const files of [NEST_FILES, WORKER_FETCH_FILES, WORKER_ITTY_FILES, HONO_WORKER_FILES]) {
      const routes = routesOf(project(files));
      assert.ok(routes.length > 0);
      assert.ok(routes.every(r => r.tier === 'js-ast' && r.tierReason === null), JSON.stringify(routes.map(r => r.tier)));
      assert.ok(routes.scan.files > 0);
      assert.equal(routes.scan.tier.tier, 'js-ast');
    }
  });

  it('reads a Worker or router file that does not parse by pattern, at regex-fallback', () => {
    const routes = routesOf(project(worker({
      'src/index.ts': `export default {\n  async fetch(request) {\n    const url = new URL(request.url);\n    if (url.pathname === '/a') return new Response('a');\n${UNPARSEABLE}    switch (url.pathname) { case '/b': return new Response('b'); }\n  },\n};\n`,
      'src/r.ts': `import { Router } from 'itty-router';\nexport const router = Router();\nrouter.get('/c', h);\n${UNPARSEABLE}\n`,
    })));
    assert.deepEqual(routes.map(key).sort(), ['ALL /a', 'ALL /b', 'GET /c']);
    assert.ok(routes.every(r => r.tier === 'regex-fallback' && r.tierReason));
  });

  it('makes the API-surface check partial, naming the framework, count and first location', () => {
    const dir = project({
      ...NEST_FILES,
      'docs-canonical/API-REFERENCE.md': '#### GET `/api/v1/cats`\n',
    });
    const result = validateApiSurface(dir, {});
    assert.equal(result.applicability?.status, 'partial');
    assert.match(result.applicability.reason, /1 NestJS route/);
    assert.match(result.applicability.reason, /src\/cats\/cats\.controller\.ts:36/);
  });
});

// ── FR-007: labels ───────────────────────────────────────────────────────────

describe('FR-007: NestJS is labelled NestJS', () => {
  it('even when express is also a dependency', () => {
    assert.equal(detectProjectProfile(project(NEST_FILES), {}).primary.framework, 'NestJS');
  });

  it('in the API-surface package.json fallback', () => {
    const dir = project({
      'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/a/b/c/d/api'] }),
      'packages/a/b/c/d/api/package.json': JSON.stringify({ dependencies: { '@nestjs/core': '10', express: '4' } }),
    });
    assert.equal(detectRouteFramework(dir, {}), 'NestJS');
  });
});

// ── FR-008: documentation ───────────────────────────────────────────────────

describe('FR-008: the docs say what is read', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const read = rel => readFileSync(join(root, rel), 'utf8');

  it('lists NestJS, Cloudflare Workers and itty-router as read, and no longer as unread', () => {
    const doc = read('docs/reference/languages.md');
    assert.match(doc, /^\| NestJS \|.*nest-routes\.mjs/m);
    assert.match(doc, /^\| Cloudflare Workers \|.*worker-routes\.mjs/m);
    assert.match(doc, /^\| Hono \|.*router-routes\.mjs/m);
    assert.match(doc, /^\| itty-router \|.*router-routes\.mjs/m);
    const unread = doc.slice(doc.indexOf('Classified but not read'), doc.indexOf('Routes in test, fixture'));
    assert.doesNotMatch(unread, /NestJS|Cloudflare Workers/);
  });

  it('names the readers in the architecture and the change in the changelog', () => {
    const arch = read('docs-canonical/ARCHITECTURE.md');
    for (const file of ['nest-routes.mjs', 'worker-routes.mjs', 'router-routes.mjs']) assert.ok(arch.includes(file), file);
    const unreleased = read('CHANGELOG.md').split(/^## \[/m)[1];
    assert.match(unreleased, /specs\/058-js-framework-routes/);
  });
});
