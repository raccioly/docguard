# Feature Specification: Route Reader Gaps Found on Real Projects

**Feature Branch**: `fix/real-project-route-gaps`

**Created**: 2026-10-11

**Status**: Draft

**Spec ID**: `docguard.real-project-route-gaps`

**Lineage**: Found by running DocGuard on public RealWorld example applications (Actix, Axum, Symfony, Koa, Laravel, NestJS, ASP.NET Core, Sinatra, Starlette) and the Hono examples. Extends the route readers of `docguard.js-framework-routes` (spec 058, the router graph that Koa composition reuses), `docguard.php-dotnet-routes` (spec 059, the Symfony and Laravel readers), `docguard.more-route-frameworks` (spec 060, the Rust readers and the `omitted` contract) and `docguard.js-route-shapes` (spec 064, Koa mounts and the `route-unresolved-*` records in `scan.unresolved`). Follows their rule: a route is reported at the path it is served under, and a path or prefix that is not literal is recorded, never guessed.

**Input**: "Fix four route-reader gaps found on real public projects: Actix builder style not read at all, Axum method chains keep only the first method, Symfony docblock annotations not read, Koa routers mounted through `routes()` exports lose their prefix; and make a route declaration the reader cannot turn into a route visible instead of a silent zero."

## Problem

Every RealWorld backend serves the same 19 endpoints, which makes the reference applications a ground truth. Run on them, DocGuard reported:

1. **Actix: 0 of 19, with nothing unresolved.** The Actix reader matched only `App::route("/x", web::get()…)` on one line. The builder style every non-trivial Actix service uses, `web::scope("/api").service(web::resource("users").route(web::post().to(h)))`, produced nothing, and nothing said so: an empty surface with no gap reads as "this project has no routes".
2. **Axum: 12 of 19.** `.route("/api/user", get(a).put(b))` registers two routes; DocGuard kept the first method of each chain. `.nest("/api", router)` prefixes were not applied either.
3. **Symfony: 0 of 19.** A controller with an `__invoke` method declares its route on the class (`/** @Route("/api/users", methods={"POST"}) */ final class RegisterController`). DocGuard read a class-level route only as a prefix for method routes, so an invokable controller had none. The same held for the `#[Route]` attribute form.
4. **Koa: 19 of 19 paths without `/api`.** `users-router.js` does `module.exports = router.routes()`, and `api.use(users)` mounts it; `router.use('/api', api.routes())` then prefixes it. DocGuard did not follow an export of `router.routes()` nor a `use()` of an imported router without a path, so the prefix was lost.
5. **Silent zero.** For Actix, Axum, Rocket, Symfony and Laravel, a declaration the reader recognised but could not turn into a route left no trace in `scan.unresolved`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An Actix service built with scopes and resources is read (Priority: P1)

A maintainer of an Actix Web API runs `docguard guard`.

1. **Given** `App::new().configure(routes)` and `fn routes(cfg: &mut web::ServiceConfig)` that registers `web::scope("/api").service(web::resource("users").route(web::post().to(register)))`, **Then** `POST /api/users` is reported.
2. **Given** `web::resource("user").route(web::get().to(a)).route(web::put().to(b))`, **Then** `GET /api/user` and `PUT /api/user` are reported; **given** `web::resource("/").to(index)`, **Then** `ANY /` is reported.
3. **Given** nested scopes `web::scope("/api").service(web::scope("/v1").route("/ping", web::get().to(p)))`, **Then** `GET /api/v1/ping` is reported.
4. **Given** `#[get("/users/{id}")] async fn get_user` registered with `web::scope("/api").service(get_user)`, **Then** `GET /api/users/{id}` is reported, not `GET /users/{id}`; a handler macro that is never registered keeps its own path, as before.
5. **Given** `web::scope(PREFIX)` with `PREFIX` not a `const` string, or `web::resource(path)` with a runtime `path`, **Then** no route is guessed and `scan.unresolved` records it with a `route-unresolved-*` code.

### User Story 2 - Every method of an Axum method router is read (Priority: P1)

1. **Given** `.route("/api/user", get(get_user).put(update_user))`, **Then** `GET /api/user` and `PUT /api/user` are reported; a chain of three methods, written over several lines, yields three routes.
2. **Given** `.route("/x", on(MethodFilter::GET | MethodFilter::POST, h))` or `any(h)`, **Then** `GET` and `POST`, or `ANY`, are reported.
3. **Given** `Router::new().nest("/api", users::router())` where `users::router()` returns `Router::new().route("/users", post(create))`, **Then** `POST /api/users` is reported; `.merge(other())` adds `other`'s routes with no prefix.
4. **Given** `.route("/x", handlers)` with `handlers` not a method router the reader can read, or `.nest(prefix, r)` with a runtime `prefix`, **Then** `scan.unresolved` records it.

### User Story 3 - An invokable Symfony controller's class route is read (Priority: P1)

1. **Given** `/** @Route("/api/users", methods={"POST"}, name="api_users_post") */` above `final class RegisterController` with `public function __invoke()`, **Then** `POST /api/users` is reported; the `#[Route('/api/users', methods: ['POST'])]` attribute form is read the same way.
2. **Given** a class `@Route("/api")` and method routes, **Then** the class route stays a prefix, as before, and is not also reported as a route.
3. **Given** a `@Route` or `#[Route]` declaration that yields no route (a route on a trait method, a route the reader cannot place), **Then** `scan.unresolved` records it.

### User Story 4 - A Koa router exported as `routes()` keeps its prefix (Priority: P1)

1. **Given** `users-router.js` ending `module.exports = router.routes()`, `index.js` with `const users = require('./users-router'); api.use(users); router.use('/api', api.routes())`, **Then** the users routes are reported under `/api`.
2. **Given** `export default router.routes()` or `module.exports = router.middleware()`, **Then** the same holds.
3. **Given** `api.use(requireAuth)` with `requireAuth` an imported auth middleware, **Then** it is still read as auth middleware, not as a router.

### User Story 5 - A recognised declaration never produces a silent zero (Priority: P1)

1. **Given** an Actix, Axum, Rocket, Symfony or Laravel project with a route declaration the reader recognises but cannot turn into a route, **Then** `scan.unresolved` holds an entry `{ framework, code, file, line, target }` with a `route-unresolved-*` code, and the API-surface check reports the surface as partial.
2. **Given** a Laravel route file under `routes/` that the application never loads, **Then** its first route statement is recorded with `route-unresolved-declaration`.

## Requirements *(mandatory)*

- **FR-001**: The Actix reader MUST read `web::scope(p)`, `web::resource(p)` with `.route(web::<method>().to(h))`, `.to(h)` (any method) and `.to_async(h)`, `App`/scope/`ServiceConfig` `.route(p, web::<method>().to(h))`, `.service(…)` (one service or a tuple), `.configure(f)` and project functions returning a scope or taking a `ServiceConfig`, and compose scope prefixes across functions and files. Handler macros (`#[get("/p")]`) registered with `.service(h)` MUST take the prefix of the scope they are registered on; Rocket's `.mount(p, routes![…])` MUST likewise prefix the handlers it mounts.
- **FR-002**: The Axum reader MUST report every method of a method router chain (`get(a).post(b)`, `routing::get`, `any`, `on(MethodFilter::…)`, `*_service` variants), across lines, and compose `.nest(p, r)` and `.merge(r)` across functions and files.
- **FR-003**: The Symfony reader MUST report a class-level `@Route` annotation or `#[Route]` attribute as the route of the class's `__invoke` method when no method of the class declares a route, with the same path, methods, import prefix and auth semantics as a method route.
- **FR-004**: The Koa composition MUST follow a module that exports `router.routes()` or `router.middleware()` (CommonJS or ES default export) and a Koa `use()` of an imported router value with no path, so the mounted routes take every prefix above them.
- **FR-005**: When the detected framework is Actix Web, Axum, Rocket, Symfony or Laravel, a route declaration the reader recognises but cannot turn into a route MUST be recorded in `scan.unresolved` as `{ framework, code, file, line, target }` with a `route-unresolved-path`, `route-unresolved-prefix`, `route-unresolved-method` or `route-unresolved-declaration` code. At minimum an Actix `web::resource(` that yields no route, an Actix or Axum `.route(` whose method cannot be read, a Symfony `@Route(`/`#[Route(` that yields no route and a Laravel route file the application does not load MUST be recorded.
- **FR-006**: Every route that the readers reported correctly before this change MUST be reported unchanged: the NestJS, Laravel, ASP.NET Core, Sinatra, Cloudflare Pages and Hono reference projects keep their counts.
- **FR-007**: `docs/reference/languages.md` MUST describe the forms now read and the known limitations below.
- **FR-008**: A JWT middleware built to let unauthenticated requests through (koa-jwt `passthrough: true`, express-jwt `credentialsRequired: false`), written inline, bound locally or imported from a project module, MUST NOT mark the routes it covers as requiring auth; route-level auth middleware still does. Without that option, the middleware keeps marking every route below it.

## Success Criteria *(mandatory)*

- **SC-001**: Each of FR-001 to FR-005 and FR-008 has a test, on a minimal look-alike fixture, that fails before the change and passes after it.
- **SC-002**: The full suite passes and `docguard guard` reports no new finding; re-run on the public reference projects, Actix reads 19 routes under `/api`, Axum 19, Symfony 19, Koa's 19 paths carry `/api` with auth only on the 12 routes that carry route-level auth middleware, and no other count changes.

## Out of Scope

- An ASP.NET Core route prefix added by a custom `IControllerModelConvention` (the RealWorld ASP.NET Core app adds `api` from configuration at run time) cannot be read statically; the routes are reported without it.
- A Starlette `Route(...)` list built inside a library class (sqladmin) mounts at a path the host application chooses; a library has no served path of its own.
- Auth detection for Actix `.wrap(...)` and Axum `.layer(...)` / `.route_layer(...)` middleware: the Rust builder readers report `auth: false`, as the pattern readers did.
- Axum routers built by reassignment (`app = app.route(…)`) are read as unprefixed registrations, as before.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `11ad93a5e0a44c92430d31e36df0eb1a20e3b6e4` — Reviewed at 11ad93a (main after #558): Actix 0-19 under /api, Axum 12-19, Symfony 0-19, Koa paths gain /api; pass-through JWT marks nothing auth (Koa auth on exactly 12 routes). Re-run on 11 public apps and 10 Hono examples: no other count changed. tests/real-project-route-gaps.test.mjs (17), full suite 3,394. Deviations: none; limits in languages.md. Evidence: `cli/scanners/php-routes.mjs`, `cli/scanners/router-routes.mjs`, `cli/scanners/rust-routes.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `tests/real-project-route-gaps.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
