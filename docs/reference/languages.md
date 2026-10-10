---
title: Languages and Frameworks
parent: Reference
nav_order: 3
---

# Languages and Frameworks

DocGuard reads source code statically. It never imports, builds or runs your
project. This page lists what it reads, how it reads it, and where its reading
stops. Every row points at the scanner that does the work, under `cli/scanners/`
unless stated otherwise.

Two things decide how much DocGuard sees in a file:

- the **parser tier**: whether a syntax tree was available, or the file was
  matched by pattern;
- the **framework**: route and model extraction runs only for the frameworks
  listed below. A framework that is not listed is not read, even in a language
  DocGuard otherwise supports.

## Parser tiers

Every finding carries a `parserTier` field (`cli/findings.mjs`,
`PARSER_TIERS`). The tier of one file comes from `tierFor` in
`cli/shared-source.mjs`.

| Tier | Meaning | When |
|---|---|---|
| `js-ast` | A syntax tree from `@babel/parser` | `.js .mjs .cjs .jsx .ts .tsx .mts .cts` when the parser loads and the file parses |
| `py-ast` | A syntax tree from your own Python interpreter's `ast` module | `.py` when an interpreter is found and the file parses |
| `regex-fallback` | The language has a parser tier, but it was not used for this file | The parser is missing, the interpreter is missing, or the file failed to parse |
| `fallback-language` | The language has no parser tier at all; the file was matched by pattern | Every other extension: Go, Java, Kotlin, Ruby, Rust, PHP, C# and the rest |
| `mixed` | The finding draws on files of different tiers | The reason names the weakest tier present |
| `not-applicable` | No scanned code is behind the finding, or the scanner records no tier | Document-only checks, and the Express, Next.js, Fastify and Koa route scanners (see below) |

What a degraded tier changes:

- **Findings are kept.** What a pattern found is real.
- **Coverage is lowered.** The owning validator reports
  `applicability: partial`, and the reason names the languages and file counts
  (`tierApplicability` in `cli/shared-source.mjs`). The absence of a finding in
  those files is weak evidence: a form the patterns do not match is not seen.
- **`generate` says which facts were read by pattern.** `generate --plan`
  reports a tier for its endpoints and entities, with two separate flags:
  - `degraded`: a file whose language has a parser was read by
    `regex-fallback`. The surface confidence is `low`, a note says how to get
    exact output (install `python3`, fix the parse error), and the endpoint,
    entity and diagram sections are marked partial.
  - `patternRead`, with `patternLanguages`: facts in a `fallback-language`
    language. There is nothing to install, so confidence is unchanged, but the
    same sections are marked partial and a note names the languages.

  A `mixed` tier sets neither on its own: JavaScript read by its parser beside
  Go read by pattern is `patternRead`, not `degraded`. `generate --spec` lowers
  its confidence only for `regex-fallback` in the same way.

See [Understanding check coverage](../configuration.md#understanding-check-coverage)
for the applicability states, and [Finding Codes](findings.md) for the codes
that carry a tier.

## Requirements

| Need | Used for | Without it |
|---|---|---|
| Node.js 18 or later | Everything | DocGuard does not run |
| `@babel/parser` (installed with the package; DocGuard's only runtime dependency) | The `js-ast` tier | It is loaded optionally. If it is missing, JS/TS files are read by pattern and carry `regex-fallback` |
| `python3` or `python` on `PATH` | The `py-ast` tier and the Python import graph | Python routes, models and settings are read by the pattern tier (`regex-fallback`); the Python import graph is not built and reports `python-interpreter-unavailable` |

DocGuard probes `python3`, then `python`, and accepts the first that can import
`ast`, `sys` and `json` (`cli/scanners/py-ast.mjs`). It never installs Python
packages and never imports your modules.

To see which tier `generate` used, run:

```bash
docguard generate --plan --format json
```

and read `surface.parserTiers`. With no interpreter on `PATH`, a FastAPI
project reports:

```json
"endpoints": { "tier": "regex-fallback", "reason": "No usable python3 interpreter; routes matched by pattern.", "degraded": true, "patternRead": false, "patternLanguages": [] }
```

A Gin project reports:

```json
"endpoints": { "tier": "fallback-language", "reason": "No parser exists for Go; matched by pattern.", "degraded": false, "patternRead": true, "patternLanguages": ["Go"] }
```

`surface.parserTiers` also carries `degraded`, `patternRead` and
`patternLanguages` for the plan as a whole.

## Languages

What DocGuard extracts per language. "Pattern" means the file is read without a
syntax tree. A dash means nothing is extracted.

| Language | Extensions | Tier | Routes | Models and entities | Env vars | Import graph |
|---|---|---|---|---|---|---|
| JavaScript, TypeScript | `.js .mjs .cjs .jsx .ts .tsx` (`.mts .cts`: parser tier and test counts only) | `js-ast`, else `regex-fallback` | Express, Next.js, Fastify, Hono, Koa, NestJS, Cloudflare Workers, itty-router | Prisma, Drizzle, Mongoose, TypeORM, Sequelize; Knex (table names, `guard` only); Zod when no ORM is found | Yes | Yes |
| Python | `.py` | `py-ast`, else `regex-fallback` | FastAPI, Flask, Starlette, Django and Django REST framework | SQLAlchemy, Django models, SQLModel; Pydantic when no ORM model is found | Yes | Yes, with an interpreter only |
| Go | `.go` | `fallback-language` | Gin, Echo, Chi, Fiber, gorilla/mux, `net/http` | Structs with `json`, `gorm`, `db` or `bson` tags | Yes | - |
| Java | `.java` | `fallback-language` | Spring | JPA `@Entity` classes | Yes, plus Spring config placeholders | - |
| Kotlin | `.kt .kts` | `fallback-language` | Spring (`.kt`) | JPA `@Entity` classes (`.kt`) | Yes | - |
| Ruby | `.rb` | `fallback-language` | Rails, Sinatra | Rails migrations and `db/schema.rb` | Yes | - |
| Rust | `.rs` | `fallback-language` | Axum, Actix Web, Rocket, Warp, Tide | Diesel `table!` | Yes | - |
| PHP | `.php` | `fallback-language` | Laravel, Symfony | - | Yes | - |
| C# | `.cs` | `fallback-language` | ASP.NET Core controllers and minimal APIs | - | Yes | - |

Every other language in `LANGUAGE_NAMES` (`cli/shared-source.mjs`) is
recognised by extension so that a coverage gap can name it, and nothing is
extracted from it:

Swift (`.swift`), Scala (`.scala`), Elixir (`.ex .exs`), Dart (`.dart`),
C (`.c .h`), C++ (`.cc .cpp .cxx .hpp`), Objective-C (`.m .mm`), Lua (`.lua`),
Clojure (`.clj`), Haskell (`.hs`), Erlang (`.erl`), OCaml (`.ml`), F# (`.fs`),
Visual Basic (`.vb`), Groovy (`.groovy`), Perl (`.pl`), Crystal (`.cr`),
Nim (`.nim`), Zig (`.zig`), Julia (`.jl`).

When the env scan's source roots contain files in one of these languages, the
Environment validator reports `partial` and names them, instead of a silent
pass. The symbol map and the module graph also name the languages the import
graph does not read, with file counts.

### What "partial" means per language

| Language | Reported as partial when |
|---|---|
| JavaScript, TypeScript | `@babel/parser` is missing or a file fails to parse (`regex-fallback`). The Express, Next.js, Fastify and Koa route scanners attach no tier to their routes, so API-surface findings drawn from them carry `not-applicable`; NestJS, Cloudflare Workers, Hono and itty-router routes carry their file's tier. A NestJS, Worker, Hono or itty-router path that is not literal text or a same-file constant (an imported constant, a `startsWith` or regular-expression dispatch) is omitted, and the API-surface check reports `partial` with the count and the first location |
| Python | No interpreter is found, or a file fails to parse (`regex-fallback`). A route path, router prefix or include that cannot be resolved is never guessed: the API-surface check reports `partial` with the count, the framework (FastAPI, Flask, Starlette or Django) and the first location. Those in test, fixture, example or ignored files do not count |
| Go, Java, Kotlin, Ruby, Rust, PHP, C# | Always, when routes or env vars were read from them (`fallback-language`); `generate --plan` marks their endpoint and entity sections partial (`patternRead`). A route whose path or prefix is not literal text or a resolvable constant is omitted. A framework read by pattern that yields no route makes the API-surface check `partial`, naming the framework and the files read. The Laravel, Symfony and ASP.NET Core readers also count each route they omitted, and the API-surface reason gives the count and the first locations |
| Any other source language | When files in it sit under the env scan's roots |

Route discovery for the pattern-read languages walks up to 32 directory levels
and stops at 20,000 files per scan; reaching that cap also makes coverage
`partial` (`cli/scanners/routes.mjs`).

## Project and framework detection

DocGuard identifies each ecosystem from its manifest files, up to four
directory levels deep, skipping dependency, build and test-fixture directories
(`cli/scanners/project-type.mjs`). A repository can hold several.

| Manifest | Language | Frameworks it classifies |
|---|---|---|
| `package.json`, `wrangler.toml`, `wrangler.json`, `wrangler.jsonc` | JavaScript (TypeScript when a `typescript` dependency or `tsconfig.json` is present) | Cloudflare Workers (a wrangler config), Next.js, React, Vue, a generic frontend (Angular, Svelte, SvelteKit, Nuxt), Express, Fastify, NestJS, Hono |
| `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile` | Python | Django (also a `manage.py`), FastAPI, Flask, Starlette, Typer, Click |
| `Cargo.toml` | Rust | Actix Web, Axum, Rocket, Warp, Tide, Clap |
| `go.mod` | Go | Gin, Echo, Chi, Fiber, Gorilla Mux (module paths with a `/vN` suffix are recognised); `net/http` when none of these is required and a `.go` file (not `_test.go`, not under `vendor` or `testdata`) imports `net/http` and registers a handler, makes a `ServeMux` or starts a server |
| `pom.xml`, `build.gradle` | Java | Spring Boot |
| `build.gradle.kts` | Kotlin | Spring Boot |
| `Gemfile` | Ruby | Rails, Sinatra |
| `composer.json` | PHP | Laravel, Symfony |
| `*.csproj` | C# | ASP.NET Core (the `Microsoft.NET.Sdk.Web` SDK, the `Microsoft.AspNetCore.App` framework reference, or a `Microsoft.AspNetCore.*` package) |

A classified framework is not the same as a read one. The next section lists
which frameworks have a scanner. For a JS/TS ecosystem the profile also names
the ORM, UI and auth libraries it finds in dependencies: Prisma, Drizzle,
Mongoose, TypeORM, Sequelize, Knex, React, Vue, Svelte, NextAuth.js,
Passport.js, Clerk and Lucia.

## Frameworks

### HTTP routes

Routes feed the API-surface check in `docguard guard`, `docguard diff` and the
API reference that `docguard generate` writes. When the project has an OpenAPI
or Swagger file (`openapi.yaml`, `openapi.yml`, `openapi.json`, `swagger.*`, or
`openapi.*` under `api/`, `docs/` or `spec/`), its endpoints are used instead of
the code scan (`cli/scanners/doc-tools.mjs`).

| Framework | Read when | What is extracted | Tier | Scanner |
|---|---|---|---|---|
| Express | An `express` dependency, or no framework detected at all | Method calls on any receiver; `.route('/x').get().post()` chains; `use('/prefix', router)` mounts across files, including `tsconfig`/`jsconfig` path aliases; per-route auth | Syntax tree, pattern fallback; routes carry no tier | `routes.mjs`, `js-ast.mjs`, `ts-paths.mjs` |
| Next.js App Router | A `next` dependency | `app/api/**/route.*` and `src/app/api/**/route.*`: exported `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`; route groups dropped; `[id]` and catch-all segments as parameters; auth from the handler or a `middleware` matcher | Syntax tree, pattern fallback; routes carry no tier | `routes.mjs` |
| Next.js Pages Router | A `next` dependency | `pages/api/**` and `src/pages/api/**` (files starting with `_` skipped); methods from `req.method === 'X'` checks and `case 'X'` labels, `ALL` when none is found | Pattern; routes carry no tier | `routes.mjs` |
| Fastify | A `fastify` dependency | Method shorthand (`fastify.get('/x')`) and the `route({ method, url })` object form | Syntax tree, pattern fallback; routes carry no tier | `routes.mjs` |
| NestJS | A `@nestjs/core` dependency (even beside `express`) | `@Controller` paths (string, array, `{ path, version }`) joined with `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@All`, `@Head`, `@Options`, `@Search` imported from `@nestjs/common`; `setGlobalPrefix` with `exclude`; URI versioning from `enableVersioning` (`prefix`, `defaultVersion`), `@Version()` and `VERSION_NEUTRAL`; `RouterModule.register` paths with `children`. Settings apply to controllers under the directory that declares them, never from test files. Auth from `@UseGuards` naming an auth guard (`AuthGuard('jwt')`, `JwtAuthGuard`, `RolesGuard`; not `ThrottlerGuard`), a custom `@Auth()` decorator, or a global guard (`useGlobalGuards`, `APP_GUARD`) unless `@Public()` or a similar decorator opts out | `js-ast`, else `regex-fallback`, per route | `nest-routes.mjs` |
| Cloudflare Workers | A `wrangler.toml`, `wrangler.json` or `wrangler.jsonc` | The paths the public `fetch` entry (`export default { fetch }`, a default-exported class, `addEventListener('fetch')`) and the modules it imports test: `pathname` compared with a literal (also the negated early-return form), `switch` on the pathname, an object or `Map` keyed by pathname, `URLPattern` with a literal pathname. Methods from `request.method` checks in the condition, inside the branch or around it, else `ALL`. Other classes (Durable Objects) and `location.pathname` are not read. Plus every itty-router and Hono route, as below | `js-ast`, else `regex-fallback`, per route | `worker-routes.mjs`, `router-routes.mjs` |
| Hono | A `hono` dependency (or Hono on Workers) | Method shorthand, `on()` and path-less chained methods on `new Hono()` values and on any receiver named like a router; `basePath()`; `app.route('/prefix', subApp)` mounts across files, including `tsconfig` path aliases; auth from the route's middleware or an earlier covering `use()` | `js-ast`, else `regex-fallback`, per route | `router-routes.mjs` |
| itty-router | In a Cloudflare Workers or Hono project | Method shorthand on `Router()`, `AutoRouter()` and `IttyRouter()` values with their `base`; a call that delegates to another router's `fetch` is not a route; auth from the route's middleware, an earlier `all('*', auth)` or `AutoRouter({ before })` | `js-ast`, else `regex-fallback`, per route | `router-routes.mjs` |
| Koa | A `koa` dependency with no Express, Fastify, NestJS or Hono dependency | Method shorthand on any receiver, including `@koa/router` (`router.get('/x')`); routes carry `source: koa` | Syntax tree, pattern fallback; routes carry no tier | `project-type.mjs`, `routes.mjs` |
| FastAPI | A `fastapi` dependency | Route decorators on any `FastAPI()` or `APIRouter()` object; prefixes from `APIRouter(prefix=)`, `include_router(..., prefix=)` and `mount()`, across modules; auth from `Depends()`/`Security()` dependencies whose names signal auth | `py-ast`, else `regex-fallback` | `python-routes.mjs`, `py-outline.mjs` |
| Flask | A `flask` dependency | Route decorators on `Flask()` and `Blueprint()` objects; `url_prefix` on the blueprint and on `register_blueprint`; auth decorators | `py-ast`, else `regex-fallback` | `python-routes.mjs` |
| Django, Django REST framework | A `django` dependency or `manage.py` | The URL configuration from `ROOT_URLCONF`: `path()`, `re_path()`, `url()`, `include()`; DRF `DefaultRouter`/`SimpleRouter` registrations expanded to list, detail and `@action` routes; declared view methods; auth decorators, mixins and permission classes | `py-ast`, else `regex-fallback` | `python-routes.mjs` |
| Spring (Java, Kotlin) | A `spring-boot-starter-web` (or `spring-boot-starter`) dependency | Class-level `@RequestMapping` joined to `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping` and `@RequestMapping(method = ...)` (`ANY` when no method is given), in positional, `value =`, `path =`, array and constant forms; `@FeignClient` types skipped | `fallback-language` | `spring-routes.mjs` |
| Rails | A `rails` gem | `config/routes.rb` and the `config/routes/*.rb` files it `draw`s: `namespace`, `scope`, `resources`/`resource` with `only:`, `except:`, `param:`, `path:`, `shallow`, nesting, `member`/`collection`, verb routes, `match ... via:`, `root`, `concern`/`concerns`; update is reported as both `PATCH` and `PUT` | `fallback-language` | `rails-routes.mjs` |
| Gin, Echo, Chi, Fiber, gorilla/mux, `net/http` | One of these in `go.mod`, or a `net/http` server in a module that requires none of them | Routes with prefixes composed from `Group`, `Route`, `Mount`, `PathPrefix(...).Subrouter()` and `http.StripPrefix`, across functions and files; `Any`, `Handle`, `HandleFunc`, `Match`, `Method`, `.Methods(...)`; Go 1.22 method patterns. `_test.go` files are skipped | `fallback-language` | `go-routes.mjs` |
| Axum, Actix Web, Rocket | One of these in `Cargo.toml` | Axum `.route("/x", get(h))`, Actix `.route("/x", web::get())`, Rocket `#[get("/x")]`, each on one line; no prefix composition | `fallback-language` | `routes.mjs` |
| Starlette | A `starlette` dependency with no Django, FastAPI or Flask dependency (a FastAPI app reads the same forms) | `Route` entries of `Starlette(routes=...)`, `Router(routes=...)` and `Mount(..., routes=...)` lists, followed through variables and `+` across modules; `Mount(..., app=...)` of another app or router; `add_route`, `mount` and the `@app.route` decorator. Methods from `methods=`, else an `HTTPEndpoint` class's handler methods, else `GET`; auth from `@requires`. `Router`, `Route` and `Mount` count only when imported from Starlette or FastAPI | `py-ast`, else `regex-fallback` | `python-routes.mjs` |
| Sinatra | A `sinatra` gem with no `rails` gem | `.rb` files and `config.ru`: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `link`, `unlink` and `route :get, :post, ...` with a block, in classic apps and in classes inheriting (across files) from `Sinatra::Base` or `Sinatra::Application`; nested `namespace` prefixes; extensions added with `register`; `config.ru` `map` blocks and `Rack::URLMap`; an app `use`d by another sits under its host. A route without a block (a Rack::Test call) is not a route. Only `GET` is reported for `get` | `fallback-language` | `sinatra-routes.mjs` |
| Warp | A `warp` crate | Filters evaluated through `and`, `or` and pass-through combinators, `let` bindings and project functions across files: `path!` (literal segments, typed parameters as `{u64}`, `..`), `path(...)` with a literal or `const`, `path::param`, `path::end`, `path::tail`, the method filters (`ANY` when there is none), `fs::dir`. Routes are what `warp::serve`/`warp::service` run, or, without one, filter functions no other function calls. A filter with no path is not a route; a filter this reader cannot resolve is assumed to add no segment | `fallback-language` | `rust-routes.mjs` |
| Tide | A `tide` crate | `at(...)` routes with `get`, `post`, `put`, `delete`, `patch`, `head`, `options`, `connect`, `trace`, `all` (`ANY`), `serve_dir` (`GET /x/*`), `serve_file` and `method(Method::X, ...)`; nested `at`, route variables, `nest()` of a server variable, a block or a project function returning a server, and functions receiving a server or route | `fallback-language` | `rust-routes.mjs` |
| Laravel | A `laravel/framework` dependency in `composer.json` | The route files the app loads: `routes/web.php`, and `routes/api.php` under `/api`, unless `bootstrap/app.php`'s `withRouting(...)` (its `web`, `api`, `apiPrefix`, `health`, `then` and `using` arguments) or `RouteServiceProvider`'s `group(base_path(...))` mappings say otherwise; files they `require`. `Route::get`, `post`, `put`, `patch`, `delete`, `options`, `any`, `match`, `redirect` (`ANY`) and `view`; `prefix`, `middleware`, `controller` and `group` (closure, attribute array or file) chains; `resource`, `apiResource`, `resources`, `singleton` and their `api` forms, with `only`, `except`, `parameters`, `shallow` and nested `photos.comments` names; update is both `PUT` and `PATCH`. Auth from an `auth`, `auth:*`, `can:*` or `Authenticate` middleware on the route or a group above it. `console.php` and `channels.php` are not read | `fallback-language` | `php-routes.mjs` |
| Symfony | A `symfony/framework-bundle` dependency in `composer.json` | `#[Route]` attributes and `@Route` docblock annotations on controller methods, joined to the class-level route, with `methods` (`ANY` when absent) and localized path arrays; `config/routes.yaml` and `config/routes/*.yaml` routes (`path`, `methods`) and imports, whose `prefix` applies to the attribute routes of an imported directory or to an imported YAML file. `when@env` blocks and bundle resources are skipped; `config/routes.php` and XML are not read. Auth from `IsGranted` or `Security` on the method or class, or `denyAccessUnlessGranted` in the method | `fallback-language` | `php-routes.mjs` |
| ASP.NET Core | A `.csproj` using `Microsoft.NET.Sdk.Web`, referencing the `Microsoft.AspNetCore.App` framework or a `Microsoft.AspNetCore.*` package | Controllers: class-level `[Route]` (inherited from a base controller) joined to `[HttpGet]`, `[HttpPost]`, `[HttpPut]`, `[HttpDelete]`, `[HttpPatch]`, `[HttpHead]`, `[HttpOptions]`, `[Route]` and `[AcceptVerbs]` templates; `/` and `~/` templates are absolute; `[controller]` (the class name, case kept), `[action]` (`Async` suffix removed, `[ActionName]` honoured) and `[area]`; `const string` templates. Minimal APIs: `MapGet`, `MapPost`, `MapPut`, `MapDelete`, `MapPatch`, `MapMethods`, `Map` and `MapHealthChecks` (`ANY`) under `MapGroup` prefixes, through variables and methods the group is passed to, in any file. Auth from `[Authorize]`/`[AllowAnonymous]`, `RequireAuthorization()`/`AllowAnonymous()` and `MapControllers().RequireAuthorization()`. Conventional routes (`MapControllerRoute`) are not read | `fallback-language` | `dotnet-routes.mjs` |

A Sinatra app inside a Rails project is not read: the project is classified
Rails and only `config/routes.rb` is read.

ASP.NET Core routes compare case-insensitively, as ASP.NET Core matches them:
`[controller]` keeps the class's case (`/api/Users`), and a document that
writes `/api/users` matches it in `guard` and `diff`. Each ASP.NET Core route
carries `caseInsensitive: true`. Every other framework's routes compare
exactly, case included: Spring, Laravel, Symfony, Rails, Django, Flask, FastAPI
and the Go and Rust frameworks match case-sensitively. Express and Koa match
case-insensitively by default, but an application or router can switch that
off, so their routes still compare exactly.

Routes in test, fixture and example directories are dropped by default. When
that leaves no route, the API-surface reason says how many were excluded and
names the `detection.includeNonProduct` setting.

### Data models

Two consumers read models, and they do not read the same set:

- **`generate` and `diff`** use `scanSchemasDeep` in `schemas.mjs`.
- **The Schema-Sync validator in `guard`** uses `cli/validators/schema-sync.mjs`.

| Library | Where it is found | What is extracted | Read by | Scanner |
|---|---|---|---|---|
| Prisma | `prisma/*.prisma`, `prisma/schema/*.prisma`, or `package.json` `prisma.schema`, in the project and its workspaces | Models, fields, relations (each once), enums reported apart from entities | Both | `schemas.mjs` |
| Drizzle | The `schema` entry of `drizzle.config.*`; otherwise files that call `pgTable`, `mysqlTable` or `sqliteTable` with a literal name, under `db`, `database`, `schema`, `schemas`, `drizzle`, `models`, `model`, `entities`, `entity` and the source roots | Tables, columns, `.references()` relations | Both | `schemas.mjs`, `js-ast.mjs` |
| Mongoose | Files that construct a `Schema`, in the same directories | Fields (including `{ type, required, ref }` and arrays), the model name from `model('Name', schema)`, `ref` relations | Both | `schemas.mjs`, `js-ast.mjs` |
| TypeORM | Files that use an `@Entity` or column decorator imported from `typeorm`, directly or through a local module that re-exports it (relative, tsconfig path alias or workspace package, up to three modules away), in the same directories | `@Entity` classes, named by class with the table name kept (guard accepts either as documented); columns from `@Column`, `@PrimaryGeneratedColumn`, `@PrimaryColumn`, `@CreateDateColumn`, `@UpdateDateColumn`, `@DeleteDateColumn` and `@VersionColumn` (type, `nullable`, `primary`, `unique`, `default`, `comment`); columns and relations inherited through `extends`; `@ManyToOne`, `@OneToMany`, `@OneToOne` and `@ManyToMany` relations, each drawn once from its owning side | Both | `schemas.mjs`, `js-ast.mjs` |
| Sequelize | Files that mention `sequelize` and call `define` or `init`, in the same directories | Models from `sequelize.define('Name', …)` and `Model.init(…, { sequelize })` (`modelName`, `tableName`), declared attributes (`DataTypes.X`, `allowNull`, `primaryKey`, `unique`, `defaultValue`, `comment`), and `belongsTo`, `hasMany`, `hasOne` and `belongsToMany` associations, each drawn once | Both | `schemas.mjs`, `js-ast.mjs` |
| Knex | `.js` and `.ts` files under `migrations`, `db/migrations` | Table names from `createTable('x')` | `guard` only | `schema-sync.mjs` |
| Zod | Source files | Object schemas, used as the data model only when no ORM entity is found | `generate` and `diff` only | `schemas.mjs` |
| SQLAlchemy | Python files | Classic `Column` and 2.0 `Mapped`/`mapped_column` columns on declarative classes, relationships with cardinality | Both | `python-models.mjs` |
| Django models | Python files | `models.Model` subclasses, fields, `ForeignKey`, `ManyToManyField` and `OneToOneField` relations | Both | `python-models.mjs` |
| SQLModel | Python files | Classes declared with `table=True` | Both | `python-models.mjs` |
| Pydantic | Python files | Models, used as the data model only when no ORM model is found | Both | `python-models.mjs` |
| Rails ActiveRecord | `db/migrate/*.rb` and `db/schema.rb` | `create_table` names and their columns (`generate`); table names from `db/migrate` (`guard`) | Both | `schemas.mjs`, `schema-sync.mjs` |
| JPA | `.java` and `.kt` files containing `@Entity` | Class names and fields | `generate` and `diff` only | `schemas.mjs` |
| Go structs | `.go` files | Any struct whose fields carry `json`, `gorm`, `db` or `bson` tags | `generate` and `diff` only | `schemas.mjs` |
| Diesel | `.rs` files | `table!` blocks and their columns | `generate` and `diff` only | `schemas.mjs` |

An OpenAPI file's schemas, when present, take priority over code for
`generate`. Python, Drizzle, Mongoose, TypeORM and Sequelize model findings
carry the tier of the files behind them; a schema read by pattern marks the
plan's entity surface partial. Prisma, Knex and Rails model findings carry
`not-applicable`.

TypeORM and Sequelize list the columns the code declares. Columns the ORM adds
on its own are not listed: TypeORM's relation foreign keys and Sequelize's
default `id`, `createdAt` and `updatedAt`. Not read: TypeORM `EntitySchema`
objects, `@ViewEntity`, `@ChildEntity`, embedded columns and class-level
`@Unique`/`@Index`; `sequelize-typescript` decorators.

### Environment variables

The env scan reads source files under the source roots and reports names that
are UPPER_SNAKE_CASE: starting with a letter and ending with a letter or digit
(`grepEnvUsage` in `cli/shared-source.mjs`). A name built at runtime, such as
`os.Getenv(key)`, is not seen in any language. Each form is matched only in
files of its own language.

| Language | Forms read |
|---|---|
| JavaScript, TypeScript | `process.env.X`, `process.env['X']`, `import.meta.env.X`, and names destructured from `process.env` or `import.meta.env`, with defaults and renames. Vite's built-in `DEV`, `PROD`, `MODE`, `BASE_URL` and `SSR` are ignored |
| Python | `os.environ['X']`, `os.environ.get('X')`, `os.getenv('X')`; `environ` and `getenv` imported from `os` under any alias; pydantic `BaseSettings` fields with `env_prefix`, `alias`, `validation_alias`, `AliasChoices`, v1 `env=` and `case_sensitive` (`py-env.mjs`) |
| Go | `os.Getenv("X")`, `os.LookupEnv("X")`. With `go.mod` at the root, every `.go` file in the module is read |
| Java, Kotlin | `System.getenv("X")`; Spring `@Value("${X}")`; `${X}` and `${X:default}` in `application*` and `bootstrap*` `.yml`, `.yaml` and `.properties` files, skipping comment lines |
| Ruby | `ENV["X"]`, `ENV.fetch("X")`. With a `Gemfile` at the root, `.rb` files under `config/` are read too |
| Rust | `env::var("X")`, `env::var_os("X")` |
| PHP | `getenv("X")`, `$_ENV["X"]`, Laravel's `env("X")` |
| C# | `Environment.GetEnvironmentVariable("X")` |

Env reads inside templated YAML, such as a Rails `database.yml` with ERB, are
not read.

### Imports and the module graph

The import graph (`import-graph.mjs`) feeds the Architecture validator's cycle
and layer checks, the module-graph diagram, `docguard diff --since` impact and
the symbol map.

| Language | How imports are read | Limits |
|---|---|---|
| JavaScript, TypeScript | `import ... from`, `require()` and dynamic `import()` by pattern; non-relative specifiers resolved through the nearest `tsconfig.json` or `jsconfig.json` (`paths`, `baseUrl`, `extends` up to 8 levels) | A dynamic `import()` is not a load-time edge. An alias that names no project file adds no edge |
| Python | The interpreter's `ast`: regular flat and `src/` packages, explicit relative imports | Needs an interpreter. Dynamic imports, `sys.path` changes, ambiguous modules and parse failures are reported as limitations |
| Every other language | Not read | The graph names the language and its file count instead of reporting "no imports" |

### Tests

| Language | Test files recognised | Test cases counted |
|---|---|---|
| JavaScript, TypeScript | `*.test.*`, `*.spec.*`, files under `__tests__/` | `it(` and `test(` calls; with a syntax tree in the metrics check |
| Python | `test_*.py`, `*_test.py`, `tests.py` | `def test_` functions |
| Go | `*_test.go` | Top-level `func Test` functions (subtests are not counted) |
| Ruby | `*_spec.rb`, `*_test.rb` | `it`, `test` and `specify` lines, in the generated test inventory |
| Java, Kotlin | `*Test`, `*Tests`, `*Spec`, `*IT` (`.java`, `.kt`), for requirement traceability only | - |
| Rust | Files under `tests/`, for requirement traceability only | - |

Counts are declared cases, not executed ones: a case inside a loop or a
parametrized test is counted once, so the number is a lower bound of what a
test runner reports (`cli/shared-test-cases.mjs`).

### Frontend screens

`docguard generate --plan` records the UI surface of a JS/TS project
(`frontend.mjs`). Guard does not check it.

| Item | What is read |
|---|---|
| Stack | Next.js, React Router, TanStack Router, React, Vue or Svelte from dependencies; state (Zustand, Redux, Jotai, MobX), data (TanStack Query, SWR, Apollo) and build tool (Vite, Next.js, Webpack) |
| Screens | Next.js `app/**/page.*` and `pages/**` (excluding `api/` and `_` files); React Router `<Route path>` elements and route-object configs, also tried for TanStack Router and plain React |
| Components | `.tsx` and `.jsx` files under a `components/` directory, excluding tests and stories |
| Other | Zustand and Redux stores, exported `use*` hooks, `createContext` contexts, API calls through `fetch` or an `axios`/`api`/`client` object, and `t('a.b')` translation keys against locale files |

Vue and Svelte are named in the stack only; their screens and components are
not read.

### Infrastructure as code

The Docs-Coverage validator detects one infrastructure tool and checks that
`ARCHITECTURE.md` has a heading for it (`iac.mjs`). It does not read resources.

| Tool | Detected by |
|---|---|
| AWS CDK | `cdk.json` |
| Terraform | Any `*.tf` file |
| Pulumi | `Pulumi.yaml` or `Pulumi.yml` |
| AWS SAM | `template.yaml` or `template.yml` containing `AWS::Serverless::` |
| Serverless Framework | `serverless.yml`, `serverless.yaml` or `serverless.ts` |

Plain CloudFormation templates without `AWS::Serverless::`, Kubernetes
manifests and Helm charts are not detected.

### Tech stack

The Tech Stack drift check (DDF001), `diff` and the tech stack `generate`
writes read one detector (`cli/scanners/tech-stack.mjs`). It compares the
technologies `ARCHITECTURE.md` names with what the code shows, in every
ecosystem that has a dependency manifest. A project with no manifest is not
checked.

A technology the code shows but the doc does not name is always reported. A
technology the doc names but the code does not show is reported only where a
manifest could have shown it:

| Ecosystem | Read from | Reported missing when absent |
|---|---|---|
| Any | Dockerfile or compose file; `docker run`, `build` or `compose` in a script, Makefile or CI workflow; any `*.tf` file | Docker, Terraform |
| JavaScript, TypeScript | `package.json` dependencies (root, source root, workspaces); DynamoDB API targets, endpoints and SDK calls in source | Every technology in the list. Each has a dependency that shows it, for example `@angular/core` for Angular, `svelte` or `@sveltejs/kit` for Svelte, `mongodb` or `mongoose` for MongoDB, `pg` or `postgres` for PostgreSQL, `mysql` or `mysql2` for MySQL |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile` | PostgreSQL, MySQL, MongoDB |
| Go | `go.mod` | Redis, PostgreSQL, MySQL, MongoDB |
| Ruby | `Gemfile` | Redis, PostgreSQL, MySQL, MongoDB |
| Rust | `Cargo.toml` | Redis, MongoDB, DynamoDB |
| PHP | `composer.json` | MongoDB |
| C# | `*.csproj` | Redis, PostgreSQL, MySQL, MongoDB, DynamoDB |
| Java, Kotlin | `pom.xml`, `build.gradle` | None |

Every ecosystem also detects the databases it can see, such as `redis` in
`requirements.txt` or `pynamodb`. The third column is narrower because the
missing cases leave no dependency to find. Python's Redis is often an extra
(`celery[redis]`) and its DynamoDB goes through boto3. Rust's PostgreSQL and
MySQL are usually sqlx or diesel features. PHP's PDO drivers and phpredis are
extensions. Gradle version catalogs hide Java drivers. DynamoDB source signals
are read in every language.

### External services

`docguard generate --plan` names the third-party services a project depends on
by matching dependency names from every detected manifest against a fixed list
(`integrations.mjs`): cloud providers, databases, payments, auth, AI, messaging,
observability, search, queues and storage. It reads dependency names only, not
code.
