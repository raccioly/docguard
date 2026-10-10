# Feature Specification: NestJS and Cloudflare Workers Route Extraction

**Feature Branch**: `spec/058-js-framework-routes`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.js-framework-routes`

**Lineage**: Part of raccioly/docguard#519 (frameworks DocGuard detects but does not read), the JavaScript and TypeScript share. Extends `docguard.js-ts-extraction` (spec 045), whose syntax-tree route reading, per-route auth and mount composition this applies to two more frameworks, and `docguard.go-spring-rails-routes` (spec 047), whose rule it follows: a route is reported at the path it is served under, and a path that is not literal is never guessed. Listed as out of scope in `docguard.docs-verification-findings` (spec 054).

**Input**: "Route extraction for frameworks DocGuard detects but does not read: NestJS and Cloudflare Workers (fetch handlers, itty-router, Hono on Workers)."

## Problem

DocGuard labels a project NestJS or Cloudflare Workers, then reads none of its routes. `generate`, `diff` and the API-surface check see an empty surface, so every documented endpoint looks absent and nothing undocumented is ever found.

1. **NestJS.** Routes are class decorators: `@Controller('cats')` plus `@Get(':id')`, `@Post()` and the other method decorators, under an application-wide `setGlobalPrefix('api')`, URI versioning and `RouterModule` module paths. No scanner reads decorators. A NestJS project that also lists `express` (common with `@nestjs/platform-express`) is labelled Express, and the Express scanner finds nothing in it.
2. **Cloudflare Workers.** A Worker routes inside its `fetch` handler: `url.pathname === '/x'`, `switch (url.pathname)`, `URLPattern`, or a router library (itty-router, Hono). The Workers label wins over every other label, so a Hono app deployed on Workers is never handed to the Hono scanner, and nothing reads the other forms.
3. **Hono prefixes.** The Hono scanner reads method calls one at a time: `new Hono().basePath('/api')` and `app.route('/books', books)` are ignored, so a sub-app's routes lose their prefix, and a router bound to a name such as `api` is not read at all.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A NestJS service's routes are read (Priority: P1)

A maintainer of a NestJS API runs `docguard guard`.

1. **Given** `@Controller('cats')` with `@Get(':id')`, **Then** `GET /cats/:id` is reported, with the method name as handler.
2. **Given** `app.setGlobalPrefix('api', { exclude: ['health'] })` in `main.ts`, **Then** every route carries `/api` except `GET /health`.
3. **Given** `app.enableVersioning({ type: VersioningType.URI })` and `@Controller({ path: 'cats', version: '1' })`, **Then** the route is `/api/v1/cats`; `@Version('2')` on a method overrides it and `VERSION_NEUTRAL` adds no segment.
4. **Given** `RouterModule.register([{ path: 'admin', module: AdminModule }])` and a controller listed in `AdminModule`, **Then** its routes sit under `/admin`.
5. **Given** `@UseGuards(AuthGuard('jwt'))` on a class or method, **Then** those routes are marked auth; `@UseGuards(ThrottlerGuard)` is not auth.
6. **Given** a global auth guard and `@Public()` on a method, **Then** only that method is unauthenticated.
7. **Given** a NestJS project that also depends on `express`, **Then** it is labelled NestJS.
8. **Given** `@Get(ROUTES.search)` with an imported constant, **Then** no route is guessed and the API-surface check reports `partial`, naming the location.

### User Story 2 - A Cloudflare Worker's routes are read (Priority: P1)

A maintainer of a Worker runs `docguard guard`.

1. **Given** `if (url.pathname === '/login' && request.method === 'POST')` in the entry's `fetch`, **Then** `POST /login` is reported.
2. **Given** `switch (url.pathname) { case '/health': … }`, **Then** `ALL /health` is reported; method checks inside the case narrow it.
3. **Given** `new URLPattern({ pathname: '/items/:id' })` tested in the handler, **Then** `/items/:id` is reported with the methods its branch checks.
4. **Given** a Durable Object class with its own `fetch`, **Then** its internal paths are not reported.
5. **Given** `url.pathname.startsWith('/api/')` or a regular expression test, **Then** no route is guessed and coverage is `partial`.
6. **Given** an itty-router `Router({ base: '/users' })`, **Then** its routes carry `/users`.
7. **Given** a Hono app on Workers with `basePath('/api')` and `app.route('/books', books)`, **Then** the sub-app's routes are `/api/books/...`, and `app.use('/admin/*', jwt(...))` marks routes under `/admin` as auth.

### User Story 3 - A Hono app reads the same with or without Wrangler (Priority: P2)

1. **Given** the Hono app of User Story 2 without a Wrangler file, **Then** the same routes are reported.

### Edge Cases

- A controller or route path built from an expression DocGuard cannot resolve is omitted and recorded as a limitation, never reported with a placeholder.
- A file that does not parse is read by a pattern fallback, and its routes carry `tier: regex-fallback`.
- `setGlobalPrefix` in an end-to-end test file does not prefix product routes.
- `location.pathname` in browser code is not a Worker route, and a module the Worker entry never imports is not read for dispatch.

## Requirements *(mandatory)*

- **FR-001**: The NestJS reader MUST report one route per controller path and method path combination of every class decorated `@Controller` (no argument, a string, an array, or `{ path }`) and every method decorated `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@All`, `@Head`, `@Options` or `@Search` imported from `@nestjs/common`. Paths are joined with single slashes, `:param` segments are kept, `@All` is method `ALL`, the handler is the method name, and the source is `nestjs`. Same-file string constants are resolved.
- **FR-002**: NestJS application settings MUST shape the path as Nest serves it: `setGlobalPrefix` (with `exclude` strings and `{ path, method: RequestMethod.X }` entries), URI versioning from `enableVersioning` (`prefix`, `defaultVersion`) with `@Controller({ version })` and `@Version()` (strings, arrays, `VERSION_NEUTRAL`), and `RouterModule.register` paths (with `children`) for controllers listed in that module's `@Module({ controllers })`. Settings apply to controllers under the directory of the file that declares them; when every setting sits in one directory they apply to all controllers. Test files and test directories never supply settings.
- **FR-003**: A NestJS route MUST be marked auth when a `@UseGuards` on its class or method names a guard that signals authentication or authorization (`AuthGuard('jwt')`, `JwtAuthGuard`, `RolesGuard`, an API-key guard; not `ThrottlerGuard`), when a custom decorator named for auth (`@Auth()`) is applied, or when a global guard (`useGlobalGuards`, an `APP_GUARD` provider) signals auth and no `@Public()`-style decorator opts the method or class out. Swagger `@Api*` decorators are not evidence.
- **FR-004**: In a Cloudflare Workers project, the reader MUST report the paths a Worker's public `fetch` entry dispatches on (`export default { fetch }`, a default-exported class with a `fetch` method, or `addEventListener('fetch', …)`), in the entry file and the modules it imports: `pathname` compared with a literal (`===`, `==`, and the negated early-return form), `switch` on the pathname, an object or `Map` keyed by pathname, and `URLPattern` with a literal pathname. The method comes from `request.method` checks in the same condition, inside the branch, or around it, else `ALL`. Paths inside other classes (Durable Objects) and `location.pathname` are not routes. The source is `cloudflare-workers`.
- **FR-005**: Hono and itty-router routers MUST be read with their prefixes, in Workers projects and in Hono projects: method shorthand (and Hono `on()` and path-less chained methods) on routers created by `new Hono()`, `Router()`, `AutoRouter()` or `IttyRouter()`, with itty `base`, Hono `basePath()`, and Hono `route('/prefix', subApp)` mounts across files through relative and `tsconfig`-aliased imports. A call that delegates to another router's `fetch` or `handle` is not a route. Auth comes from the route's own middleware, an earlier `use()` (or itty `all('*', auth)`, `AutoRouter({ before })`) covering it, or a parent's covering `use()` before the mount. Method calls on receivers named like routers (`app`, `router`, …) keep being read. Sources are `hono` and `itty-router`.
- **FR-006**: Every route from these readers MUST carry `tier` and `tierReason` (`js-ast`, or `regex-fallback` when the file did not parse or the parser is missing), and each file read is recorded with the scan. A file that does not parse MUST be read by a pattern fallback. A path that cannot be resolved statically (an unresolved constant, a dynamic expression, a `startsWith` or regular-expression dispatch, a non-literal `RouterModule` table or versioning setting) MUST NOT be guessed: it is recorded as a limitation, and the API-surface check MUST report coverage `partial`, naming the count, framework and first location.
- **FR-007**: A JavaScript project with `@nestjs/core` MUST be labelled NestJS even when `express` is also a dependency, and the API-surface check's `package.json` fallback MUST recognise NestJS.
- **FR-008**: The user documentation (`docs/reference/languages.md`), `docs-canonical/ARCHITECTURE.md` and `CHANGELOG.md` MUST describe what is read, and NestJS and Cloudflare Workers MUST leave the "classified but not read" list.

## Success Criteria *(mandatory)*

- **SC-001**: Each behaviour above has a test that fails before the change and passes after. Each reference project (NestJS, NestJS with a global guard, a fetch-handler Worker, an itty-router Worker, Hono on Workers, and the same Hono app without Wrangler) has a ground truth written by hand, and the scan reports exactly that set of methods, paths and auth flags.
- **SC-002**: The full suite passes and `docguard guard` on this repository reports no new finding.

## Out of Scope

- Cloudflare Pages Functions (`functions/` file routing with `onRequestGet`): a Pages project is not a Worker.
- `@hono/zod-openapi` `app.openapi(createRoute({ … }))` routes, NestJS GraphQL resolvers, microservice handlers, WebSocket gateways and host-based routing.
- Koa keeps its current scanner.
- Python route limitations (spec 046) are attached to the scan but do not lower coverage; that is unchanged here.
