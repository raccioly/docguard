# Feature Specification: Go, Spring and Rails Route Extraction

**Feature Branch**: `fix/go-spring-rails-routes`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.go-spring-rails-routes`

**Lineage**:
- Extends `docguard.language-repository-coverage`, which made unsupported
  analysis visible. These three scanners were supported, but read their
  frameworks' routing wrongly.
- Extends `docguard.adoption-workflow-integrity` (FR-013), which fixed the same
  class of defect for JavaScript routes: a route must carry the prefix it is
  served under.
- Sits beside `docguard.fallback-language-coverage` (spec 043), which changes
  how these scanners find files and disclose their tier. This spec changes
  only what they read in a file, not which files they read.

**Input**: Confirmed field defects in the Go, Spring and Rails route scanners
(`cli/scanners/routes.mjs`).

## Problem

Guard's API-surface check, `diff` and `generate` all take a project's routes
from one scanner. For Go, Spring and Rails that scanner reads route calls one
line at a time and ignores everything that frames them. On eight hand-written
reference projects (one per framework shape) it found 6 of 80 real routes and
emitted 43 routes that do not exist:

- **Go.** A route on a gin, echo or fiber group lost the group's prefix:
  `users := v1.Group("/users"); users.GET("/:id", h)` became `GET /:id`.
  `users.GET("", h)` was dropped because its path does not start with `/`.
  chi and fiber register routes with `Get`, `Post`, … and were not read at all.
  Go 1.22 method patterns (`mux.HandleFunc("GET /items/{id}", h)`) were
  dropped, and a route in a `_test.go` file was reported as product surface.
- **Spring.** A class-level `@RequestMapping(path = "/api/categories")` (or
  `value =`, or an array) was not read, so every method in the class lost its
  base and a bare `@GetMapping` became `GET /`. `@GetMapping(path = "...")`,
  arrays, constants and every method-level `@RequestMapping(method = ...)` were
  missed. A mapping inside a comment and a Feign client's outbound mapping
  were reported as routes.
- **Rails.** `namespace`, `scope`, `only:`, `except:` and nesting were ignored:
  `namespace :admin do resources :users, only: [:index, :show] end` produced
  seven `/users` routes instead of `GET /admin/users` and
  `GET /admin/users/:id`. `resource` (singular), `member`, `collection`,
  `root`, `match` and hash-rocket routes were missed.

Each wrong route is two false findings: an undocumented route that does not
exist, and a documented route reported absent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Go service's routes carry their group prefixes (Priority: P1)

A maintainer of a gin, echo, chi, fiber or gorilla/mux service runs guard.
Every route is reported at the path it is served under, including routes
registered through net/http in the same service.

**Acceptance Scenarios**:

1. **Given** `v1 := r.Group("/api/v1"); users := v1.Group("/users")`, **When**
   `users.GET("/:id", h)` and `users.GET("", h)` are registered, **Then** the
   routes are `GET /api/v1/users/:id` and `GET /api/v1/users`.
2. **Given** a function `registerOrders(rg *gin.RouterGroup)` in another file
   of the project, **When** `main` calls `registerOrders(v1)`, **Then** the
   routes it registers on `rg` carry `/api/v1`.
3. **Given** chi's `r.Route("/articles", func(r chi.Router) { r.Get("/", h) })`
   and `r.Mount("/admin", adminRouter())`, **Then** the routes are
   `GET /articles` and the admin router's routes under `/admin`.
4. **Given** `mux.HandleFunc("GET /items/{id}", h)`, **Then** the route is
   `GET /items/{id}`; **given** `mux.HandleFunc("/healthz", h)`, **then** it is
   `ANY /healthz`.
5. **Given** `http.Get("https://…")`, a route inside a comment, or a route in a
   `_test.go` file, **Then** no route is reported for it.

### User Story 2 - A Spring controller's routes carry the class base (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `@RequestMapping(path = "/api/categories")` on the class and a bare
   `@GetMapping` on a method, **Then** the route is `GET /api/categories`, not
   `GET /`.
2. **Given** `@GetMapping(path = "/{id}")`, `@PostMapping(value = "/bulk")` or
   `@GetMapping({"/search", "/find"})`, **Then** each path is read, joined to
   the class base.
3. **Given** `@RequestMapping(value = "/{id}", method = RequestMethod.PATCH)`,
   **Then** the route is `PATCH`; **given** no `method`, **then** it is `ANY`.
4. **Given** the Kotlin forms (`value = ["/api"]`, `method = [RequestMethod.POST]`),
   **Then** they read the same as Java's.
5. **Given** paths built from `static final String` or `const val` constants,
   **Then** the constants are resolved.
6. **Given** a `@FeignClient` interface, **Then** its mappings are not routes.

### User Story 3 - A Rails app's routes match `rails routes` (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `namespace :admin do resources :users, only: [:index, :show] end`,
   **Then** the routes are exactly `GET /admin/users` and
   `GET /admin/users/:id`.
2. **Given** nested `resources`, **Then** the child routes sit under
   `/parent/:parent_id`; **given** `member`/`collection` blocks or `on:`,
   **then** those routes sit under `/parent/:id` or `/parent`.
3. **Given** `resource :profile` (singular), **Then** its routes have no `:id`
   and no index.
4. **Given** `scope "/billing", module: "billing"`, **Then** the path prefix is
   `/billing`; **given** `scope module: "v1"` alone, **then** no prefix is added.
5. **Given** a resource's update action, **Then** both `PATCH` and `PUT` are
   reported, as `rails routes` lists them.

### Edge Cases

- **A prefix or path that is not literal text** (a variable, a function's
  result, a `${…}` placeholder, a Ruby interpolation): the route is omitted.
  A route at a wrong path is two false findings; an omitted one is at most one,
  and the tier already says these scanners read patterns, not syntax.
- **A function that receives a group from several callers:** its routes are
  reported under every prefix it is called with.
- **A function that is never called with a known group:** its routes keep the
  prefix they have in the function, as today.
- **A router variable reassigned in another function or block:** each binding
  is scoped to its block, so a name reused in two functions does not share a
  prefix.
- **Cyclic calls or mounts:** resolution stops; no route is reported twice.
- **An empty file, an unreadable file, a file with no routes:** no route and no
  error, as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Go scanner MUST compose route prefixes: gin, echo and fiber
  `Group`; gorilla/mux `PathPrefix(...).Subrouter()`; chi `Route` closures,
  `Group` closures and `Mount`; fiber `Route` and `Mount`; net/http
  `Handle(p, http.StripPrefix(q, sub))`. Composition MUST follow a group
  passed to a function anywhere in the scanned project, and a router returned
  by a function. Bindings are scoped to the enclosing block.
- **FR-002**: The Go scanner MUST read every route form of those routers: the
  upper-case (gin, echo) and capitalised (chi, fiber) method calls; an empty
  path on a group; `Any`/`All`/`HandleFunc`/`Handle` as `ANY`;
  `Handle("GET", path)`, `Add`, `Match([]string{...}, path)`, chi
  `Method`/`MethodFunc`, and gorilla `.Methods(...)`; Go 1.22 patterns with a
  method, `{name...}` and `{$}`. It MUST ignore comments, `_test.go` files and
  calls whose path is not a route path (such as `http.Get("https://…")`).
- **FR-003**: The Spring scanner MUST read a class-level `@RequestMapping` base
  in every form: positional, `value =`, `path =`, a Java `{…}` or Kotlin `[…]`
  array, and string constants joined with `+`. Every base MUST combine with
  every method-level path.
- **FR-004**: The Spring scanner MUST read method-level `@GetMapping`,
  `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping` and
  `@RequestMapping` in the same forms, with `@RequestMapping`'s `method =` (one
  value or an array; `ANY` when absent). It MUST ignore comments and skip
  `@FeignClient` types.
- **FR-005**: The Rails scanner MUST produce the routes `rails routes` lists
  for: `namespace` and `scope` (path prefixes; a module-only scope adds none),
  `resources` and `resource` with `only:`, `except:`, `param:`, `path:` and
  `shallow`, nested resources, `member`/`collection` blocks and `on:`, verb
  routes (string, symbol and `"path" => "controller#action"` forms), `match`
  with `via:`, `root`, `concern`/`concerns`, and `draw` files under
  `config/routes/`. A resource's update action MUST be reported as both `PATCH`
  and `PUT`. Comments MUST be ignored.
- **FR-006**: A route whose path or prefix cannot be resolved to literal text or
  a resolvable constant MUST be omitted, never reported at a guessed path.
  Every emitted method MUST be a standard HTTP method or `ANY`.
- **FR-007**: Go framework classification MUST recognize a module path with a
  major-version suffix (`github.com/labstack/echo/v4`,
  `github.com/go-chi/chi/v5`, `github.com/gofiber/fiber/v2`), so the Go scanner
  runs for those projects, and MUST classify gorilla/mux.
- **FR-008**: Guard's API-surface check and `diff` MUST agree on these routes:
  a project whose API reference documents exactly its routes reports no route
  gap in either.
- **FR-009**: `docs/commands.md`, `docs-canonical/TEST-SPEC.md` and the
  CHANGELOG MUST describe what the three scanners read and what they omit.

## Success Criteria *(mandatory)*

- **SC-001**: On the eight reference fixtures (gin, echo, chi, net/http,
  gorilla+fiber, Spring Java, Spring Kotlin, Rails), every route in the
  hand-written ground truth is reported and no other route is. Before this
  change: 6 of 80 found, 43 wrong.
- **SC-002**: The existing route tests keep passing. The one assertion that
  pinned the missing gin group prefix is corrected, with the reason recorded
  beside it.
- **SC-003**: No route is reported at a guessed path: a fixture of unresolvable
  prefixes and paths yields none of them.

## Assumptions

- The three scanners stay pattern readers (DocGuard has no Go, Java, Kotlin or
  Ruby parser and adds no dependency). They read comments, strings, brackets
  and blocks well enough to follow the structure above; they do not type-check.
- A Go function is matched to its call sites by name across the scanned
  project. Two functions with the same name both receive the caller's prefix.
- Routes emitted as `ANY` are compared by the API-reference parser, which spec
  044 extends to accept `ANY`; this spec does not change that parser.

## Out of Scope

- Which files the scanners read, their depth and file caps, and tier
  disclosure (spec 043).
- `generate`'s own framework detection, which reads only `package.json` and so
  never asks these scanners for a Go, Java or Ruby project (spec 044, FR-010).
  Once it asks, it gets the routes this spec fixes.
- Routes registered from runtime data (loops over a table, reflection, string
  building beyond `+` of constants).
- Spring WebFlux functional routes (`RouterFunctions.route`, `coRouter`), JAX-RS,
  Rails engines' own route files, `mount`ed Rack apps and `devise_for`.
- Classifying a Go project that uses only net/http as a web service; its
  framework stays unset (a separate classification change).
