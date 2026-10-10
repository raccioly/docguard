# Feature Specification: Laravel, Symfony and ASP.NET Core Route Extraction

**Feature Branch**: `spec/059-php-dotnet-routes`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.php-dotnet-routes`

**Lineage**:
- Extends `docguard.go-spring-rails-routes` (spec 047): the same reader shape
  (mask comments and strings, pair brackets, follow the framework's routing
  rules, omit what is not literal) for two more languages.
- Extends `docguard.fallback-language-coverage` (spec 043): PHP and C# routes
  carry the `fallback-language` tier, and a route the reader had to omit is
  disclosed as partial coverage.
- Part of raccioly/docguard#519, frameworks DocGuard detects but whose routes it
  does not read.

**Input**: Issue #519: "Laravel `Route::get(...)` in `routes/*.php`; Symfony
`#[Route]` attributes / YAML; ASP.NET Core `[HttpGet]` attributes,
`app.MapGet(...)` minimal APIs" are classified by `project-type.mjs` and read
by no route scanner.

## Problem

`project-type.mjs` labels a project Laravel, Symfony or ASP.NET Core, but the
route scanner has no reader for any of them. Guard's API-surface check, `diff`
and `generate` therefore see no endpoints for these projects: a documented
Laravel API reports every documented route as absent, and `generate` writes an
empty API reference.

ASP.NET Core is worse: the classifier tests a regular expression against the
empty string instead of the project file, so a project whose `.csproj` says
`Sdk="Microsoft.NET.Sdk.Web"` (every `dotnet new webapi` project) is not even
labelled ASP.NET Core. Only a project with an explicit
`Microsoft.AspNetCore.App` package reference, a form ASP.NET Core 2.x used, is.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Laravel app's routes match `php artisan route:list` (Priority: P1)

A maintainer of a Laravel application runs guard. Every route in the route
files the application loads is reported at the URI Laravel serves it under.

**Acceptance Scenarios**:

1. **Given** `routes/api.php` with `Route::get('/users', ...)`, **Then** the
   route is `GET /api/users`; **given** `routes/web.php` with
   `Route::get('/', ...)`, **then** it is `GET /`.
2. **Given** `bootstrap/app.php` with `withRouting(apiPrefix: 'api/v2', ...)`,
   or a `RouteServiceProvider` that maps `routes/api.php` under another prefix,
   **Then** the api routes carry that prefix.
3. **Given** `Route::prefix('admin')->middleware('auth')->group(function () { ... })`,
   **Then** the routes inside carry `/admin` and auth evidence.
4. **Given** `Route::resource('photos', PhotoController::class)`, **Then** the
   seven resource routes are reported, update as both `PUT` and `PATCH`;
   **given** `apiResource`, **then** create and edit are not.
5. **Given** `Route::middleware('auth:sanctum')->get('/user', ...)`, **Then**
   the route has auth evidence.

### User Story 2 - A Symfony app's attribute and YAML routes are read (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `#[Route('/api/posts')]` on a controller class and
   `#[Route('/{id}', methods: ['GET'])]` on a method, **Then** the route is
   `GET /api/posts/{id}`; **given** no `methods`, **then** it is `ANY`.
2. **Given** the legacy `@Route("/blog", methods={"GET"})` docblock
   annotation, **Then** it reads the same as the attribute.
3. **Given** `config/routes.yaml` entries with `path:` and `methods:`, **Then**
   each is a route; **given** an import of the controller directory with
   `prefix: /api`, **then** the attribute routes of that directory carry `/api`.

### User Story 3 - An ASP.NET Core API's routes are read (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `[ApiController] [Route("api/[controller]")] public class
   UsersController` with `[HttpGet("{id}")]`, **Then** the route is
   `GET /api/Users/{id}`.
2. **Given** `[Authorize]` on the class and `[AllowAnonymous]` on one action,
   **Then** every other action has auth evidence and that one does not.
3. **Given** `var todos = app.MapGroup("/todos").RequireAuthorization();
   todos.MapGet("/{id}", ...)`, **Then** the route is `GET /todos/{id}` with
   auth evidence.
4. **Given** an extension method `MapUserEndpoints(this RouteGroupBuilder group)`
   called as `app.MapGroup("/users").MapUserEndpoints()`, **Then** the routes it
   registers carry `/users`.
5. **Given** a `.csproj` with `Sdk="Microsoft.NET.Sdk.Web"`, **Then** the
   project is labelled ASP.NET Core and its routes are scanned.

### Edge Cases

- **A path or prefix that is not literal text or a resolvable constant** (a
  PHP variable or interpolated string, a C# interpolated string, a call): the
  route is omitted, never reported at a guessed path, and the API-surface
  check's coverage reason says how many registrations were omitted and where.
- **Comments and strings**: a route inside a comment or a string is not a route.
- **Laravel route files the application does not load** (`console.php`,
  `channels.php`): not read. A file `require`d from a loaded route file is read
  under the requiring file's group.
- **ASP.NET controllers without attribute routing** (conventional
  `{controller}/{action}` routes from `MapControllerRoute`): not reported; the
  URL depends on runtime route tables.
- **A route method called from several places**: reported under every prefix
  it is called with; never called with a known group, under no prefix.
- **An empty or unreadable file**: no route and no error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Laravel reader MUST read the route files the application
  loads: `routes/web.php` (no prefix) and `routes/api.php` (`/api`) by default;
  the files, `apiPrefix`, `health` path and `then`/`using` closures named in
  `bootstrap/app.php`'s `withRouting(...)`; the `group(base_path(...))`
  mappings in `app/Providers/RouteServiceProvider.php`; and files `require`d or
  `include`d from a loaded route file. File paths resolve only inside the
  project.
- **FR-002**: The Laravel reader MUST read `Route::get`, `post`, `put`,
  `patch`, `delete`, `options`, `any`, `match`, `redirect`, `permanentRedirect`
  and `view`; `prefix`, `middleware`, `withoutMiddleware`, `controller` and
  `group` (closure, attribute array, or file) in any chain order;
  `resource`, `apiResource`, `resources`, `apiResources`, `singleton` and
  `apiSingleton` expanded to their standard routes with `only`, `except`,
  `parameters`, `shallow`, `creatable`, nested `parent.child` names, and
  update as both `PUT` and `PATCH`. Auth evidence is an `auth`, `auth:*`,
  `auth.basic`, `can:*` or `Authenticate` middleware, or `->can(...)`, on the
  route, its group, or the provider mapping.
- **FR-003**: The Symfony reader MUST read `#[Route]` attributes and `@Route`
  docblock annotations on controller methods, joined to the class-level route
  prefix, with `methods` (`ANY` when absent) and localized path arrays; and
  `config/routes.yaml` and `config/routes/*.yaml` route entries (`path`,
  `methods`) and imports (`resource` + `prefix`, applied to attribute routes
  under an imported directory and to an imported YAML file). Environment
  blocks (`when@dev`) and bundle resources are skipped. Auth evidence is
  `IsGranted` or `Security` on the method or class, or a
  `denyAccessUnlessGranted` call in the method.
- **FR-004**: The ASP.NET Core reader MUST read controller routes: class-level
  `[Route]` (inherited from a base controller), `[HttpGet]`, `[HttpPost]`,
  `[HttpPut]`, `[HttpDelete]`, `[HttpPatch]`, `[HttpHead]`, `[HttpOptions]`
  with or without a template, method-level `[Route]`, `[AcceptVerbs]`,
  absolute templates (`/` or `~/`), and the `[controller]`, `[action]` and
  `[area]` tokens. `[NonAction]`, non-public, static and abstract members are
  not actions. String constants (`const string`) resolve.
- **FR-005**: The ASP.NET Core reader MUST read minimal APIs: `MapGet`,
  `MapPost`, `MapPut`, `MapDelete`, `MapPatch`, `MapMethods`, `Map` and
  `MapHealthChecks` on any receiver; `MapGroup` prefixes through chains and
  variables; and a group passed to a method (an extension method's `this`
  parameter or an ordinary parameter) in any scanned file.
- **FR-006**: ASP.NET Core auth evidence MUST come from `[Authorize]` and
  `[AllowAnonymous]` on the class (inherited) or action, `.RequireAuthorization()`
  and `.AllowAnonymous()` on an endpoint or group, and
  `MapControllers().RequireAuthorization()`; `AllowAnonymous` wins, as in
  ASP.NET Core.
- **FR-007**: A route whose path or prefix cannot be resolved to literal text
  or a resolvable constant MUST be omitted, never reported at a guessed path.
  Each omission MUST be counted, and the API-surface check MUST report partial
  coverage naming the framework, the count and the first locations. Every
  emitted method MUST be a standard HTTP method or `ANY`. Comments and strings
  MUST NOT produce routes.
- **FR-008**: The classifier MUST label a C# project ASP.NET Core when its
  `.csproj` uses the `Microsoft.NET.Sdk.Web` SDK, references the
  `Microsoft.AspNetCore.App` framework, or references a `Microsoft.AspNetCore.*`
  package; and Laravel (`laravel/framework`) and Symfony
  (`symfony/framework-bundle`) from `composer.json`. The label MUST reach the
  route scanner, and the routes MUST carry `source` (`laravel`, `symfony`,
  `aspnet-core`) and the `fallback-language` tier.
- **FR-009**: Guard's API-surface check and `diff` MUST agree: a project whose
  API reference documents exactly its routes reports no route gap in either.
- **FR-010**: `docs/reference/languages.md`, `docs/commands.md`,
  `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md` and the
  CHANGELOG MUST describe what the readers read and omit, and the three
  frameworks MUST leave the "classified but not read" list.

## Success Criteria *(mandatory)*

- **SC-001**: On the reference projects (Laravel 11 `bootstrap/app.php`,
  Laravel 10 `RouteServiceProvider`, Symfony attributes + YAML, ASP.NET Core
  controllers, ASP.NET Core minimal APIs), every route in the hand-written
  ground truth is reported and no other route is. Before this change each
  reports no route at all, and the `Sdk.Web` project is not classified.
- **SC-002**: The full test suite passes and guard reports no finding
  introduced by this change.
- **SC-003**: No route is reported at a guessed path: a fixture of
  unresolvable paths and prefixes in each framework yields none of them, and
  the API-surface coverage reason counts them.

## Assumptions

- The readers stay pattern readers. DocGuard has no PHP or C# parser and adds
  no dependency. They lex comments, strings and brackets, and do not
  type-check.
- ASP.NET Core matches URLs case-insensitively; the reader reports a
  `[controller]` token as the class name minus `Controller` (`/api/Users`),
  which is what the template expands to and what Swagger shows.
- A method is matched to its call sites by name across the scanned project.

## Out of Scope

- Laravel: Lumen's `$router->get`, route attribute packages, `Route::fallback`,
  domain routing, routes registered by packages (Fortify, Sanctum's CSRF route,
  Horizon) and `routes/channels.php` / `routes/console.php`.
- Symfony: `config/routes.php` and XML route files, routes from bundles,
  `security.yaml` `access_control` as auth evidence, and FOSRest annotations.
- ASP.NET Core: conventional routing (`MapControllerRoute`), Razor Pages,
  SignalR hubs, gRPC services, `MapIdentityApi`, `FallbackPolicy`, and
  `ApiExplorer`/OpenAPI generation at runtime.
- Routes registered from runtime data (loops, configuration, reflection).
