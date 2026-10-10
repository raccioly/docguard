# Feature Specification: Koa Mounts, Cloudflare Pages Functions and Hono OpenAPI Routes

**Feature Branch**: `spec/064-js-route-shapes`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.js-route-shapes`

**Lineage**: Part of raccioly/docguard#519 (frameworks DocGuard detects but does not read), the three JavaScript route shapes `docguard.js-framework-routes` (spec 058) listed as out of scope. Extends `docguard.js-framework-routes`, whose router graph (`basePath`, `route()` mounts, prefixes across files), tiers and `scan.unresolved` limitations it applies to Koa, Pages Functions and `@hono/zod-openapi`, and `docguard.docs-verification-findings` (spec 054), which labelled Koa projects Koa. Follows the rule of `docguard.go-spring-rails-routes` (spec 047): a route is reported at the path it is served under, and a path that is not literal is never guessed.

**Input**: "Three JS route shapes still not read: Koa mounts (`router.use('/x', sub.routes())`, koa-mount, `new Router({ prefix })`, `router.prefix()`), Cloudflare Pages Functions (file-based routes under `functions/`), and `@hono/zod-openapi` `app.openapi(createRoute({...}))` routes."

## Problem

DocGuard reads Express mounts (spec 045) and Hono `route()` mounts (spec 058), but three common JavaScript shapes still produce a wrong or empty API surface:

1. **Koa prefixes are dropped.** Koa routes are read by the method-shorthand scanner one call at a time. `new Router({ prefix: '/api' })`, `router.prefix('/v1')`, a nested router mounted with `router.use('/users', users.routes())` and a sub-application mounted with `app.use(mount('/admin', admin))` (koa-mount) are ignored, so every documented `/api/users/:id` looks absent and `/:id` looks undocumented. A router bound to a name that does not look like a router (`users`, `api`) is not read at all, and `router.del()` and named routes (`router.get('user', '/users/:id', h)`) are missed.
2. **Cloudflare Pages Functions are not read.** A Pages project routes by file: `functions/api/users/[id].ts` exporting `onRequestGet` serves `GET /api/users/:id`. No scanner reads that layout, and a Pages project with a `wrangler.toml` is labelled Cloudflare Workers, whose reader looks for a `fetch` entry a Pages project does not have.
3. **`@hono/zod-openapi` routes are not read.** `app.openapi(createRoute({ method: 'get', path: '/users/{id}' }), handler)` registers a route the Hono reader does not recognise, so an OpenAPI-first Hono service reports no routes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Koa service's routes carry their prefixes (Priority: P1)

A maintainer of a Koa API runs `docguard guard`.

1. **Given** `const api = new Router({ prefix: '/api' })` and `api.use('/users', users.routes())` with `users` required from another file, **Then** the users router's `GET /:id` is reported as `GET /api/users/:id`.
2. **Given** `admin.use(router.routes())` on a Koa sub-application with `router.prefix('/v1')`, and `app.use(mount('/admin', admin))`, **Then** `router.get('/stats')` is reported as `GET /admin/v1/stats`.
3. **Given** `admin.use(jwt({ secret }))` before the router is mounted on it, **Then** that router's routes are marked auth; `router.use('/private', requireUser)` marks `/private` and every route under it.
4. **Given** `router.del('/:id', h)` and `router.get('user', '/users/:id', h)`, **Then** `DELETE /:id` and `GET /users/:id` are reported.
5. **Given** `new Router({ prefix: process.env.PREFIX })` or `router.use(PREFIX, sub.routes())` with an imported constant, **Then** the routes below it are not reported at a guessed path and the API-surface check reports `partial`.
6. **Given** the Koa project of spec 054 (`router.get('/health')` on a `@koa/router` router), **Then** the same routes are still reported with `source: koa`.

### User Story 2 - A Cloudflare Pages project's Functions are read (Priority: P1)

A maintainer of a Pages project runs `docguard guard`.

1. **Given** a `wrangler.toml` with `pages_build_output_dir`, or no Wrangler file and a `functions/` directory whose files export `onRequest` handlers, **Then** the project is labelled Cloudflare Pages; a Wrangler file without that key keeps the Cloudflare Workers label.
2. **Given** `functions/api/users/[id].ts` exporting `onRequestGet` and `onRequestDelete`, **Then** `GET /api/users/:id` and `DELETE /api/users/:id` are reported; `onRequest` is `ALL`, `index.ts` serves its directory and `[[path]].ts` is the catch-all `:path*`.
3. **Given** `functions/api/admin/_middleware.ts` whose `onRequest` rejects requests without credentials, **Then** every route under `/api/admin` is marked auth; a middleware that only sets headers is not auth evidence, and `_middleware.ts` is not a route.
4. **Given** `export const onRequest = handle(app)` delegating to a Hono app, **Then** the Hono app's routes are reported and the catch-all file is not.
5. **Given** `export * from './impl'` in a Functions file, or a segment such as `user-[id].ts`, **Then** no route is guessed and the API-surface check reports `partial`.

### User Story 3 - An OpenAPI-first Hono service's routes are read (Priority: P2)

1. **Given** `app.openapi(createRoute({ method: 'get', path: '/users/{id}' }), h)`, **Then** `GET /users/:id` is reported, the same parameter form as every other Hono route.
2. **Given** `const getUser = createRoute({ ... })` exported from `routes.ts` and `users.openapi(getUser, h)` in `users.ts` mounted with `app.route('/users', users)` under `basePath('/v1')`, **Then** the route is `/v1/users/:id`.
3. **Given** `createRoute({ middleware: [requireAuth] })` or an earlier covering `app.use('/admin/*', bearerAuth(...))`, **Then** the route is marked auth; an OpenAPI `security` entry alone is documentation, not auth.
4. **Given** `app.doc('/openapi.json', ...)` on an `OpenAPIHono` app, **Then** `GET /openapi.json` is reported.
5. **Given** `createRoute({ path: PATHS.user })` or `app.openapi(routes[0], h)`, **Then** no route is guessed and the API-surface check reports `partial`.

### User Story 4 - The remaining JavaScript shapes follow the same rules (Priority: P2)

1. **Given** ``app.get(`/items/${kind}`, h)`` with a runtime `kind`, `app.get(ROUTES.users, h)` or `app.get(/.*fly$/, h)` in an Express or Fastify project, **Then** no route is reported at a `:param` placeholder, each is recorded, and the API-surface check reports `partial`; every literal route is reported exactly as before.
2. **Given** a Pages project whose output directory holds `_worker.js` (a file or a directory), **Then** its `fetch` dispatch is read as for a Worker and the `functions/` routes are not reported, because Pages ignores them in advanced mode.
3. **Given** a `_routes.json` with `include: ['/api/*']` and `exclude: ['/api/admin/*']`, **Then** Functions outside `/api/` and under `/api/admin/` are not reported; a `_routes.json` that does not parse is recorded and filters nothing.
4. **Given** `router.redirect('/old', '/new')` on a Koa router with prefix `/p`, **Then** `ALL /p/old` is reported; a source that is a route name is recorded.
5. **Given** `app.use(API_PREFIX + '/users', users)` with `API_PREFIX` a `const` exported by another file, **Then** the users routes sit under `/api/users`; **given** `app.use(config.apiPrefix, admin)` or ``app.use(`${process.env.BASE}/v1`, health)``, **Then** those routers' routes (and routers mounted below them) are not reported at the root, the prefix is recorded once, and the API-surface check reports `partial`.
6. **Given** `router.get(USERS_PATH, h)` with `USERS_PATH` exported by `./paths`, `const { PREFIX } = require('./config')` or `cfg.PREFIX` where `config.js` has `module.exports = { PREFIX: '/api' }`, **Then** the path or prefix resolves in Express, Fastify, Koa and Hono; a name the target does not export as a string stays recorded.

### Edge Cases

- A Koa or Hono router whose prefix, mount path or base path is not literal is recorded once as a limitation; its routes, and the routes of routers mounted below it, are not reported under a partial path.
- A file that does not parse is read by a pattern fallback, and its routes carry `tier: regex-fallback`.
- A Firebase `functions/` directory (`export const api = onRequest(app)`) is not a Pages project: the export is not named `onRequest`.
- Functions files under test directories do not count, as for every other reader.

## Requirements *(mandatory)*

- **FR-001**: In a project labelled Koa, the router reader MUST read Koa routers (`new Router()`, `Router()` and `require('koa-router')()` from `@koa/router` or `koa-router`, in ES module and CommonJS form) with their `prefix` option and `router.prefix()` calls, and compose prefixes through `router.use(path?, sub.routes() | sub.middleware())` and `app.use(sub.routes())` on Koa applications, and koa-mount's `mount(path?, appOrRouter)`, across files through `import`/`export` and `require`/`module.exports`. `router.del()` is `DELETE`; a named route's path is its second argument. Auth comes from the route's own middleware or handler, an earlier `use()` on the router or application (a `use()` path covers that path and everything under it), or auth middleware beside a mount. Routes carry `source: koa`, and every route the method-shorthand scanner reported for a Koa project with literal paths is still reported, under its prefix when one applies.
- **FR-002**: A JavaScript project MUST be labelled Cloudflare Pages when its Wrangler file sets `pages_build_output_dir`, or when it has no Wrangler file and a `functions/` directory with a file that exports an `onRequest` handler. A Wrangler file without that key keeps the Cloudflare Workers label and reader.
- **FR-003**: In a Cloudflare Pages project, the reader MUST report one route per `onRequest`, `onRequestGet`, `onRequestPost`, `onRequestPut`, `onRequestPatch`, `onRequestDelete`, `onRequestHead` or `onRequestOptions` export (function declarations, variables, export lists and re-exports) of each file under `functions/`, at the path its file serves: directories and file names as segments, `index` serving its directory, `[name]` as `:name` and `[[name]]` as `:name*`. `onRequest` is method `ALL`; the source is `cloudflare-pages`. A route is marked auth when its own handler or middleware array shows auth, or a `_middleware` file in its directory or above it exports a handler for its method (or `onRequest`) that shows auth. `_middleware` files are not routes. An export that delegates to a router (`handle(app)` from `hono/cloudflare-pages`, a router's `fetch`) is not a route; the Hono and itty-router routes in the project are read as in a Workers project.
- **FR-004**: In a Hono project (and Hono on Workers or Pages), the router reader MUST read `@hono/zod-openapi` routes: `openapi(route, handler)` on any router value, where `route` is `createRoute({ method, path, middleware? })` inline, a same-file variable, a variable imported from another project file, or a plain object with `method` and `path`. OpenAPI path parameters `{name}` are reported as `:name`, as other Hono parameters are; the route composes with `basePath()` and `route()` mounts; auth comes from the route's `middleware`, the handler or a covering `use()`, never from `security` alone. `doc()` and `doc31()` on an `OpenAPIHono` value report `GET` at their path.
- **FR-005**: Every route from these readers MUST carry `tier` and `tierReason`, and a file that does not parse MUST be read by a pattern fallback. A path, prefix, mount path, route definition or export the reader cannot resolve statically MUST NOT be guessed: it is recorded in `scan.unresolved` with its framework, file and line, the routes below an unresolved prefix are omitted, and the API-surface check reports coverage `partial`.
- **FR-006**: `docs/reference/languages.md`, `docs/commands.md`, `docs-canonical/ARCHITECTURE.md` and `CHANGELOG.md` MUST describe what is read.
- **FR-007**: The Express and Fastify scanners MUST NOT report a route whose path is not literal text or a same-file constant (a template with a runtime substitution, an imported constant, a member expression, a regular expression, in the syntax tree and in the pattern fallback); each such registration (a path plus at least one handler) is recorded in `scan.unresolved` with its framework, file and line, and the API-surface check reports `partial`. A one-argument `app.get('name')` is a settings read, not a registration. Every route with a literal path is reported exactly as before.
- **FR-008**: In a Cloudflare Pages project, an advanced-mode Worker — `_worker.js` (a file, or a directory with an `index`) in the `pages_build_output_dir`, or a `_worker.js`/`_worker.ts` file in the project — MUST be read as a Worker `fetch` entry with the Workers dispatch reader (source `cloudflare-pages`), and the `functions/` routes MUST NOT be reported, since Pages ignores that directory in advanced mode. Otherwise a `_routes.json` (in the output directory, else the project root, `public/` or `static/`) MUST limit the reported Functions routes to those an `include` rule matches and no `exclude` rule matches (`*` matching any characters, `exclude` winning); one that does not parse or has no `include` list is recorded as a limitation and filters nothing. `_routes.json` is not applied to an advanced-mode Worker.
- **FR-009**: In a Koa project, koa-router `redirect(source, destination, code?)` with a literal path source MUST be reported as `ALL` at `source` under the router's prefixes, with handler `redirect` (the route model has no redirect field); a source that is a route name or not literal is recorded as a limitation. `redirect()` on a router that is not Koa is not read.
- **FR-010**: An Express mount whose prefix is not literal MUST be resolved when it is built from same-file `const` strings or `const` strings another project file exports (`import { API_PREFIX } from './config'`), by name, concatenation or template. Otherwise the routers it mounts, and routers reachable only through it, MUST NOT be reported (not at the root, not under a partial path); the prefix is recorded once in `scan.unresolved` (framework `Express`, code `route-unresolved-prefix`, file and line) and the API-surface check reports `partial`. A first argument counts as a prefix when it is a template, a concatenation, or a name that says so (`API_PREFIX`, `basePath`, `config.apiPrefix`, `process.env.X`); middleware such as `requireAuth` does not. Routes a literal mount reaches are reported exactly as before.
- **FR-011**: Route paths and mount prefixes MUST resolve `const` strings another project file exports, in the Express and Fastify scanners and the Koa, Hono and itty-router reader: named imports (`import { USERS_PATH }`), namespace imports (`paths.USERS`), destructured `require()` (`const { PREFIX } = require('./config')`), and a `require()` (or a default import of a CommonJS module) used as an object (`cfg.PREFIX`), alone, concatenated or in a template. Exported strings are `export const`, `export { x as Y }`, `module.exports = { Y: '/y' }`, `exports.Y = '/y'` and `module.exports.Y = '/y'`. An ES module default import is not an object of the module's named exports. A local binding wins over an import, and a name the target does not export as a string stays recorded under FR-007 or FR-010. Literal results are unchanged.

## Success Criteria *(mandatory)*

- **SC-001**: Each behaviour above has a test that fails before the change and passes after; for FR-007, every literal Express and Fastify route of the existing extraction, generated-docs and API-surface suites is unchanged. Each reference project (a Koa service with nested routers and a mounted sub-application, a Cloudflare Pages project with middleware and a delegated Hono app, and an OpenAPI-first Hono service across files) has a ground truth written by hand, and the scan reports exactly that set of methods, paths and auth flags.
- **SC-002**: The full suite passes and `docguard guard` on this repository reports no new finding.

## Out of Scope

- Host-based routing and routers built in loops; `@hono/zod-openapi` `openAPIRegistry` registrations that are not routes.
