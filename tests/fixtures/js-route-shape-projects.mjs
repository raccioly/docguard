/**
 * Scratch Koa, Cloudflare Pages and @hono/zod-openapi projects with a written
 * ground truth, for specs/064-js-route-shapes (docguard.js-route-shapes).
 *
 * Each FILES object is a small but realistic project the test writes to a
 * fresh temp dir; each TRUTH states, by hand, every route a correct scan
 * reports (method and path as served -> auth). The truths follow the
 * frameworks' documented semantics: koa-router's `prefix` and nested
 * `use(path, sub.routes())`, koa-mount's path stripping, Pages Functions'
 * file-based routing (`index`, `[param]`, `[[catchall]]`, `_middleware`), and
 * OpenAPIHono's `{param}` -> `:param` conversion under `basePath`/`route()`.
 * @req docguard.js-route-shapes#SC-001
 */

export { writeFiles, UNPARSEABLE } from './js-ts-projects.mjs';

const pkg = (deps, devDeps = {}) =>
  JSON.stringify({ name: 'fixture', dependencies: deps, devDependencies: devDeps }, null, 2);

// ── Koa: nested routers, prefixes, a koa-mount sub-application (CommonJS) ────

export const KOA_FILES = {
  'package.json': pkg({ koa: '2.15.3', '@koa/router': '12.0.1', 'koa-mount': '4.0.0', 'koa-jwt': '4.0.4' }),
  'src/app.js': `const Koa = require('koa');
const mount = require('koa-mount');
const api = require('./routes/api');
const admin = require('./admin');

const app = new Koa();
app.use(api.routes()).use(api.allowedMethods());
app.use(mount('/admin', admin));

module.exports = app;
`,
  'src/routes/api.js': `const Router = require('@koa/router');
const users = require('./users');
const { health } = require('./health');

const api = new Router({ prefix: '/api' });

api.use('/users', users.routes(), users.allowedMethods());
api.use(health.routes());
api.get('status', '/status', (ctx) => { ctx.body = { ok: true }; });

module.exports = api;
`,
  'src/routes/users.js': `const Router = require('@koa/router');

const router = new Router();
const requireUser = async (ctx, next) => {
  if (!ctx.state.user) ctx.throw(401);
  await next();
};

router.get('/', async (ctx) => { ctx.body = []; });
router.get('/:id', async (ctx) => { ctx.body = { id: ctx.params.id }; });
router.post('/', requireUser, async (ctx) => { ctx.status = 201; });
router.del('/:id', requireUser, async (ctx) => { ctx.status = 204; });

module.exports = router;
`,
  'src/routes/health.js': `const Router = require('@koa/router');

const health = new Router();
health.get('/health', (ctx) => { ctx.body = 'ok'; });

module.exports = { health };
`,
  'src/admin.js': `const Koa = require('koa');
const Router = require('@koa/router');
const jwt = require('koa-jwt');

const admin = new Koa();
const router = new Router();
router.prefix('/v1');
router.get('/stats', (ctx) => { ctx.body = {}; });

admin.use(jwt({ secret: 'dev-secret' }));
admin.use(router.routes());

module.exports = admin;
`,
};

export const KOA_TRUTH = {
  routes: {
    'GET /api/users': false,
    'GET /api/users/:id': false,
    'POST /api/users': true,
    'DELETE /api/users/:id': true,
    'GET /api/health': false,
    'GET /api/status': false,
    'GET /admin/v1/stats': true,
  },
};

// ── Cloudflare Pages: Functions, middleware, a Hono app behind a catch-all ───

export const PAGES_FILES = {
  'package.json': pkg({ react: '18.3.1', hono: '4.4.6' }, { wrangler: '3.60.0', typescript: '5.4.5' }),
  'wrangler.toml': `name = "shop"
pages_build_output_dir = "./dist"
compatibility_date = "2024-09-01"
`,
  'src/App.tsx': 'export default function App() { return null; }\n',
  'functions/_middleware.ts': `export const onRequest: PagesFunction = async ({ next }) => {
  const response = await next();
  response.headers.set('x-served-by', 'pages');
  return response;
};
`,
  'functions/index.ts': `export const onRequestGet: PagesFunction = () => new Response('home');
`,
  'functions/api/users/index.ts': `export const onRequestGet: PagesFunction = async ({ env }) => Response.json([]);

export async function onRequestPost({ request }) {
  return Response.json(await request.json(), { status: 201 });
}
`,
  'functions/api/users/[id].ts': `import { requireAuth } from '../../lib/auth';

export const onRequestGet: PagesFunction = async ({ params }) => Response.json({ id: params.id });

const update: PagesFunction = async ({ request }) => Response.json(await request.json());
export const onRequestPatch = [requireAuth, update];

export const onRequestDelete: PagesFunction = async ({ data }) => {
  if (!data.user) return new Response(null, { status: 403 });
  return new Response(null, { status: 204 });
};
`,
  'functions/api/admin/_middleware.ts': `export const onRequest: PagesFunction = async ({ request, next }) => {
  const token = request.headers.get('Authorization');
  if (!token) return new Response('Unauthorized', { status: 401 });
  return next();
};
`,
  'functions/api/admin/stats.ts': `export function onRequestGet() {
  return Response.json({ users: 1 });
}
`,
  'functions/files/[[path]].ts': `export const onRequest: PagesFunction = ({ params }) => new Response(String(params.path));
`,
  'functions/lib/auth.ts': `export const requireAuth: PagesFunction = async ({ request, next }) => {
  if (!request.headers.get('Authorization')) return new Response(null, { status: 401 });
  return next();
};
`,
  'functions/api/hono/[[route]].ts': `import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';

const app = new Hono().basePath('/api/hono');
app.get('/ping', (c) => c.text('pong'));

export const onRequest = handle(app);
`,
};

export const PAGES_TRUTH = {
  routes: {
    'GET /': false,
    'GET /api/users': false,
    'POST /api/users': false,
    'GET /api/users/:id': false,
    'PATCH /api/users/:id': true,
    'DELETE /api/users/:id': true,
    'GET /api/admin/stats': true,
    'ALL /files/:path*': false,
    'GET /api/hono/ping': false,
  },
  sources: { 'GET /api/hono/ping': 'hono' },
};

// ── @hono/zod-openapi: createRoute across files, basePath, route(), doc() ────

export const OPENAPI_FILES = {
  'package.json': pkg({ hono: '4.4.6', '@hono/zod-openapi': '0.14.5', zod: '3.23.8' }, { typescript: '5.4.5' }),
  'src/index.ts': `import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { bearerAuth } from 'hono/bearer-auth';
import { users } from './users';

const app = new OpenAPIHono().basePath('/v1');

app.use('/admin/*', bearerAuth({ token: 'dev-token' }));
app.route('/users', users);
app.openapi(
  createRoute({ method: 'get', path: '/admin/report', responses: { 200: { description: 'ok' } } }),
  (c) => c.json({}),
);
app.doc('/openapi.json', { openapi: '3.0.0', info: { title: 'Users', version: '1.0.0' } });

export default app;
`,
  'src/routes.ts': `import { createRoute, z } from '@hono/zod-openapi';
import { requireAuth } from './auth';

export const listUsers = createRoute({ method: 'get', path: '/', responses: { 200: { description: 'list' } } });

export const getUser = createRoute({
  method: 'get',
  path: '/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'one' } },
});

export const deleteUser = createRoute({
  method: 'delete',
  path: '/{id}',
  middleware: [requireAuth] as const,
  responses: { 204: { description: 'gone' } },
});

export const updateProfile = createRoute({
  method: 'put',
  path: '/{id}/profile/{section}',
  security: [{ Bearer: [] }],
  responses: { 200: { description: 'saved' } },
});
`,
  'src/users.ts': `import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { listUsers, getUser, deleteUser, updateProfile } from './routes';

export const users = new OpenAPIHono();

users
  .openapi(listUsers, (c) => c.json([]))
  .openapi(getUser, (c) => c.json({ id: c.req.valid('param').id }));
users.openapi(deleteUser, (c) => c.body(null, 204));
users.openapi(updateProfile, (c) => c.json({}));

const createUser = createRoute({ method: 'post', path: '/', responses: { 201: { description: 'made' } } });
users.openapi(createUser, (c) => c.json({}, 201));
`,
  'src/auth.ts': `export const requireAuth = async (c, next) => {
  if (!c.req.header('Authorization')) return c.text('Unauthorized', 401);
  await next();
};
`,
};

export const OPENAPI_TRUTH = {
  routes: {
    'GET /v1/users': false,
    'GET /v1/users/:id': false,
    'DELETE /v1/users/:id': true,
    'PUT /v1/users/:id/profile/:section': false,
    'POST /v1/users': false,
    'GET /v1/admin/report': true,
    'GET /v1/openapi.json': false,
  },
};
