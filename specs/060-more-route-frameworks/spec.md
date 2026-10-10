# Feature Specification: Sinatra, Starlette, Warp, Tide and net/http Routes

**Feature Branch**: `spec/060-more-route-frameworks`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.more-route-frameworks`

**Lineage**:
- Extends `docguard.go-spring-rails-routes` (spec 047): the same pattern-reader
  model (symbolic nodes, prefixes resolved after the scan, a non-literal path
  omitted rather than guessed) applied to Sinatra, Warp and Tide, and the
  existing Go reader made reachable for a `net/http`-only module.
- Extends `docguard.python-extraction` (spec 046): Starlette is read from the
  same module outlines, at the same parser tiers, as FastAPI and Flask.
- Extends `docguard.fallback-language-coverage` (spec 043): every new
  pattern-read route carries `tier: 'fallback-language'`, and what a reader
  could not read lowers coverage instead of passing silently.

**Input**: raccioly/docguard#519, "Route extraction for frameworks DocGuard
detects but does not read". This spec takes the Ruby (Sinatra), Python
(Starlette), Rust (Warp, Tide) and Go standard-library rows.

## Problem

`project-type.mjs` classifies Sinatra, Starlette, Warp and Tide, so a project
using one of them is labelled with it, but no route scanner reads them:
`generate`, `diff` and guard's API-surface check see no endpoint. A Go module
that serves HTTP with the standard library alone has no router dependency, so
it is not classified at all, and the Go reader, which already reads
`net/http` registrations, never runs. The languages reference
(`docs/reference/languages.md`) states each gap.

On five hand-written reference projects (one per framework, 51 routes in all)
the scanner reports 0 routes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Sinatra app's routes are read (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a classic app (`require 'sinatra'`; `get '/' do … end`), **Then**
   every verb route with a literal path is reported at that path.
2. **Given** a modular app (`class Api < Sinatra::Base`, or a class inheriting
   from such a class in another file), **Then** its routes are reported; a
   method named `get` on an unrelated class is not.
3. **Given** `namespace '/api' do namespace '/v1' do get '/users' do … end end end`,
   **Then** the route is `GET /api/v1/users`.
4. **Given** `config.ru` with `map '/admin' do run AdminApp end`, **Then**
   `AdminApp`'s routes sit under `/admin`.
5. **Given** an extension module (`def self.registered(app); app.get '/x' do … end; end`)
   registered with `register Ext` in an app, **Then** its routes are that app's.
6. **Given** `get %r{/posts/(\d+)} do`, **Then** no route is reported, and the
   API-surface coverage reason says one Sinatra route was omitted.

### User Story 2 - A Starlette app's routes are read (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `app = Starlette(routes=[Route('/users', list_users), Route('/users', create_user, methods=['POST'])])`,
   **Then** the routes are `GET /users` and `POST /users`.
2. **Given** `Mount('/api', routes=[...])`, a `Mount('/v1', app=router)` of a
   `Router(routes=[...])` defined in another module, and a route list held in a
   variable, **Then** the prefixes compose.
3. **Given** a `Route` whose endpoint is an `HTTPEndpoint` class with `get` and
   `post` methods, **Then** both methods are reported.
4. **Given** the legacy `@app.route('/x', methods=['PUT'])` decorator and
   `app.add_route('/y', handler)`, **Then** both are read.
5. **Given** no Python interpreter, **Then** the same routes are read at the
   `regex-fallback` tier.

### User Story 3 - A Warp or Tide service's routes are read (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `warp::path!("todos" / u64).and(warp::get())`, **Then** the route
   is `GET /todos/{u64}`.
2. **Given** filters built in functions in other files and combined with
   `.or()` under `warp::path("api").and(…)`, and served with `warp::serve`,
   **Then** each alternative carries the `/api` prefix.
3. **Given** a filter with no method filter, **Then** it is reported as `ANY`.
4. **Given** `warp::path(name)` where `name` is not a literal or constant,
   **Then** that route is omitted and counted.
5. **Given** Tide's `app.at("/users/:id").get(h).delete(h)`, `route.at("/x")`
   nesting and `app.at("/api").nest(api)`, **Then** each route carries its
   composed path.

### User Story 4 - A Go service on net/http alone is read (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a `go.mod` with no router dependency and a file that registers
   `mux.HandleFunc("GET /items/{id}", h)` on `http.NewServeMux()`, **Then** the
   project is classified `net/http` and the route is reported.
2. **Given** a Go module with no HTTP server code, **Then** it stays
   unclassified.
3. **Given** a gin, echo, chi, fiber or gorilla/mux project, **Then** its
   classification and routes are unchanged.

### Edge Cases

- **A path that is not literal** (a Ruby interpolation or regex, a Warp path
  from a variable, a Tide `at()` with a computed string, a Starlette path that
  does not evaluate): the route is omitted and counted, never guessed.
- **A Sinatra route block with no body we can read, or a `configure` block:**
  routes inside unknown blocks are not read.
- **A Warp filter the reader cannot resolve** (a function parameter): assumed to
  add no path segment.
- **A Warp catch-all with no path and no method** (`warp::any().map(…)` as a
  fallback): not a route.
- **Cycles** between Warp functions, Tide nests or Sinatra `use`: resolution
  stops; nothing is reported twice.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Sinatra reader MUST report `get`, `post`, `put`, `patch`,
  `delete`, `head`, `options`, `link` and `unlink` routes and sinatra-contrib's
  `route :get, :post, '/x'`, in classic apps (top-level routes with a block) and
  in modular apps (classes inheriting, directly or through project classes in
  any file, from `Sinatra::Base` or `Sinatra::Application`, plus
  `Sinatra.new`/`Class.new(Sinatra::Base)` constants). It MUST compose nested
  `namespace` prefixes, add the routes of extensions registered with
  `register`, and place each app under the prefixes `config.ru` maps it to
  (`map` blocks, `Rack::URLMap`), or its host's prefixes when an app `use`s it.
- **FR-002**: The Starlette reader MUST report `Route` entries of
  `Starlette(routes=…)`, `Router(routes=…)` and `Mount(…, routes=…)` lists,
  following list variables (`+` included) across modules, `Mount(…, app=…)` of
  another app or router, `add_route`, `mount` and the `@app.route` decorator.
  Methods come from `methods=`, else from an `HTTPEndpoint` class's handler
  methods, else `GET`. `Router`, `Route` and `Mount` count only when imported
  from Starlette (or FastAPI). Routes carry `source: 'starlette'` and the
  file's Python tier.
- **FR-003**: The Warp reader MUST evaluate filter expressions: `path!` (literal
  segments, typed parameters, `..`), `path(…)`, `path::param`, `path::end`,
  `path::tail`, the method filters, `and`, `or` and pass-through combinators,
  `let` bindings and project functions across files. Routes come from the
  filters passed to `warp::serve`/`warp::service`, or, when there is none, from
  filter functions no other function calls. A filter with no method filter is
  `ANY`.
- **FR-004**: The Tide reader MUST read `at(…)` routes with their verb methods
  (`all` as `ANY`, `serve_dir`/`serve_file` as `GET`, `method(Method::X, …)`),
  chained and variable-held `at` nesting, `nest()` of a server variable, a
  block, or a project function returning a server, and functions that receive
  a server or route as a parameter.
- **FR-005**: A Sinatra, Warp or Tide route whose path or prefix is not literal
  text (or, for Warp, a resolvable `const`) MUST be omitted, and the
  API-surface coverage reason MUST name the framework and how many routes were
  omitted. A Starlette path that does not evaluate MUST be omitted and recorded
  as a limitation, as FastAPI's is.
- **FR-006**: A Go module with no router dependency MUST be classified
  `net/http` when one of its `.go` files imports `net/http` and registers a
  handler or starts a server, so the Go reader runs; gin, echo, chi, fiber and
  gorilla/mux classification and routes MUST be unchanged.
- **FR-007**: Detection MUST route each framework to its reader: a `sinatra`
  gem (without `rails`), a `starlette` dependency (without `fastapi`, `flask`
  or `django`), and a `warp` or `tide` crate. New routes carry `source`
  (`sinatra`, `starlette`, `warp`, `tide`) and their tier
  (`fallback-language` for Ruby and Rust).
- **FR-008**: `docs/reference/languages.md` MUST list the new readers and drop
  them from "classified but not read"; `docs-canonical/ARCHITECTURE.md` MUST
  name the new scanner files; the CHANGELOG MUST record the change under #519.

## Success Criteria *(mandatory)*

- **SC-001**: On five reference projects (Sinatra, Starlette, Warp, Tide,
  net/http-only Go), each with a hand-written ground truth, the scan reports
  exactly the truth set, end to end from detection. Before: 0 routes for every
  one.
- **SC-002**: The existing route suites (`go-spring-rails-routes`,
  `python-extraction`, `routes-multilang`, `fallback-language-coverage`) pass
  unchanged, the full suite passes, and guard on this repository reports no
  new finding.
- **SC-003**: A fixture of non-literal paths for Sinatra, Warp and Tide yields
  none of them, and the API-surface reason counts them.

## Assumptions

- Ruby and Rust stay pattern-read: no parser and no dependency is added. The
  readers mask comments and strings and follow blocks and brackets; they do
  not type-check.
- Sinatra's `get` also answers `HEAD`; only `GET` is reported, as for every
  other framework DocGuard reads.

## Out of Scope

- A Rails app that mounts a Sinatra app: the project is classified Rails and
  only `config/routes.rb` is read.
- Sinatra routes inside `configure` or other arbitrary blocks, and routes a
  Sinatra subclass inherits from a parent app class.
- Starlette apps built inside a function and returned (`return Starlette(…)`),
  `Host` routing and WebSocket routes.
- Warp filters received as function parameters; Tide routes registered through
  trait objects or macros.
- The other frameworks of #519 (NestJS, Cloudflare Workers: spec 058; Laravel,
  Symfony, ASP.NET Core: spec 059).
