# Feature Specification: Coverage Follow-ups From Specs 056–061

**Feature Branch**: `spec/063-coverage-followups`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.coverage-followups`

**Lineage**: Verified follow-ups reported while building specs 056–061. Extends `docguard.python-extraction` (046, FR-012: the plan's parser tier), `docguard.fallback-language-coverage` (043: pattern-only languages are partial coverage), `docguard.js-framework-routes` (058: `scan.unresolved`), `docguard.php-dotnet-routes` (059: ASP.NET Core routes), `docguard.more-route-frameworks` (060: Python route limitations) and `docguard.dogfood-round-2` (061: tech-stack detection, `diff` document roles).

**Input**: "These are verified follow-ups reported by the agents that built specs 056–061. Each is one FR with a failing-first test."

## Problem

1. **`generate --plan` calls pattern-read output complete.** The plan lowers confidence and marks sections partial only for `regex-fallback` (a parser that exists but was missing or failed). Endpoints and entities read by pattern because their language has no parser (`fallback-language`: Go, Java, Kotlin, Ruby, Rust, PHP, C#) report `degraded: false` with no partial marking, although the API-surface check already calls the same facts partial coverage (spec 043). A project mixing a parsed language with a pattern-only one is worse: the summary tier is `mixed`, which the plan treats as a missing parser, and the note tells the user to install `python3`. Go, Java, Rails and Rust entities carry no tier at all, so their pattern reading is invisible.
2. **.NET build output is scanned.** `obj/` (generated `.cs` such as `GlobalUsings.g.cs` and assembly attributes) and `bin/` (publish output with copied `wwwroot` scripts and settings) are not skipped, so generated files count toward scanned-file totals and route discovery. The other ecosystems' output directories (`target/`, `vendor/`, `build/`, `.gradle/`) are already skipped.
3. **ASP.NET Core routes compare case-sensitively.** ASP.NET Core matches routes case-insensitively, and `[controller]` keeps the class's case (`/api/Users`). A document that writes `/api/users` shows a false gap in both directions, in `guard` (API004) and `diff`.
4. **Python route limitations never lower coverage.** The Python reader records routes it could not read (`python-unresolved-route-path`, `python-unresolved-include`, `django-unresolved-route`, `django-unresolved-include`) on `routes.limitations`, but the API-surface check reads only `scan.unresolved`. A Python project whose paths cannot be resolved reports full coverage.
5. **Angular and Svelte are never detected.** Both are in the tech-stack vocabulary with no dependency mapping, so a Node project that documents them always gets DDF001 "documented but not found". The same happens for the official MongoDB driver (`mongodb`), the `mysql` client and the `postgres` client, which map to nothing.
6. **`generate --spec` has the same conflation.** It lowers confidence whenever the facts' summary tier is `mixed`, so an area with JavaScript routes and Go entities is reported `low` and told to install `python3`.
7. **`diff` reads fixed document paths.** Its route section reads `docs-canonical/API-REFERENCE.md` (falling back to `ARCHITECTURE.md`), its entity section `docs-canonical/DATA-MODEL.md`, and its environment section `docs-canonical/ENVIRONMENT.md`, ignoring `docs.roles` mappings and nested canonical documents that `guard` resolves with `resolveDocRole`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The plan says what was read by pattern (Priority: P1)

1. **Given** a Go (Gin) project, **When** `generate --plan --format json` runs, **Then** `surface.parserTiers.endpoints` has `patternRead: true` and names Go, `degraded` stays `false`, the endpoint section is marked partial with a reason that says no parser exists for Go, and a note says so without telling the user to install anything.
2. **Given** a project with JavaScript routes parsed by the syntax tree and Go routes, **Then** the plan is not `degraded` and does not mention `python3`.
3. **Given** a Python project read without an interpreter, **Then** the plan output is unchanged (`degraded: true`, `low` confidence).

### User Story 2 - Build output is not source (Priority: P1)

1. **Given** an ASP.NET Core project with `obj/Debug/net8.0/*.cs` and `bin/Release/net8.0/publish/wwwroot/js/site.js`, **Then** neither is scanned for routes or counted.
2. **Given** a Node package with `bin/cli.js` and no .NET project file beside it, **Then** `bin/cli.js` is still scanned.

### User Story 3 - ASP.NET Core routes match case-insensitively (Priority: P1)

1. **Given** a controller `UsersController` under `[Route("api/[controller]")]` and an API reference that documents `GET /api/users`, **Then** `guard` and `diff` report it matched.
2. **Given** a Spring or Laravel route `/api/Users` documented as `/api/users`, **Then** the gap is still reported.

### User Story 4 - Python coverage counts what was not read (Priority: P1)

1. **Given** a FastAPI or Starlette project with a route whose path does not evaluate, **Then** the API-surface check reports `partial` coverage, with the count, the framework and the first location.

### User Story 5 - Documented frameworks are found (Priority: P2)

1. **Given** a Node project depending on `@angular/core`, `svelte` or `@sveltejs/kit` that documents Angular or Svelte, **Then** DDF001 does not report it as not found.
2. **Given** a Node project depending on `mongodb`, `mysql` or `postgres`, **Then** MongoDB, MySQL or PostgreSQL is detected.

### User Story 6 - `generate --spec` keeps its confidence for pattern-only languages (Priority: P2)

1. **Given** an area with JavaScript routes parsed by the syntax tree and Go routes, **Then** `generate --spec` reports `high` confidence; **Given** an unparseable JavaScript route file, **Then** it reports `low` as before.

### User Story 7 - `diff` reads the mapped documents (Priority: P2)

1. **Given** `docs.roles` mapping the API reference, data model and environment documents, **Then** `diff` compares routes, entities and environment variables against the mapped files.

## Requirements *(mandatory)*

- **FR-001**: `generate --plan` MUST report, per surface (`endpoints`, `entities`) and overall, `patternRead: true` when any fact was read in a language with no parser (`fallback-language`), with `patternLanguages` naming the languages. `degraded` MUST keep its meaning: true only when a file whose language has a parser was read by the pattern fallback (`regex-fallback`), never because a pattern-only language is present. A pattern-read surface MUST be marked partial with a reason that says no parser exists for the language, and the plan MUST carry a note saying so; `surface.confidence` is unchanged by `fallback-language` alone. The text output MUST say which surfaces were read by pattern. Go, Java/Kotlin (JPA), Rails and Rust entities MUST carry their file's tier, as their routes already do.
- **FR-002**: The default ignored directories MUST include `obj` (.NET and C intermediate output) and `_build` (Mix, dune and Sphinx output). A directory named `bin` MUST be skipped only when its parent directory holds a .NET project file (`*.csproj`, `*.fsproj`, `*.vbproj`); every other `bin/` (a Node CLI, Ruby binstubs, shell scripts) MUST still be read. The rule MUST apply in the shared file walker and in the route, schema, environment and module walkers.
- **FR-003**: A route reader whose framework matches routes case-insensitively MUST mark its routes `caseInsensitive: true`. Only the ASP.NET Core reader does. Endpoint comparison (`guard`'s API-surface check, including the OpenAPI-versus-code check, and `diff`) MUST compare a marked route's path ignoring case. Unmarked routes (Spring, Laravel, Symfony, Rails, Django, Flask, FastAPI, Go, Rust, Next.js, Fastify, Hono, NestJS, Express, Koa) MUST compare exactly as before.
- **FR-004**: Every Python route limitation MUST reach the scan's `unresolved` list with the framework that produced it (Django for `django-*` codes, otherwise the detected FastAPI, Flask or Starlette framework), so the API-surface check reports `partial` coverage with the count, the framework and the first location. Limitations in test, fixture, example or ignored files MUST NOT count, as for the other readers. `routes.limitations` MUST still list every Python limitation.
- **FR-005**: Every technology in the tech-stack vocabulary MUST have at least one detection path. `@angular/core` MUST map to Angular; `svelte` and `@sveltejs/kit` to Svelte; `mongodb` to MongoDB; `mysql` to MySQL; `postgres` to PostgreSQL. A test MUST fail when a vocabulary name has no detection path.
- **FR-006**: `diff` MUST resolve the documents it compares with `resolveDocRole`, as `guard` does: the API reference (falling back to the architecture document when the API reference does not exist), the data model and the environment document.
- **FR-007**: `generate --spec` MUST lower its confidence and add its pattern-fallback note only when a route or entity fact, or the scan behind it, was read by `regex-fallback`. An area whose facts mix a parsed language with a pattern-only one (summary tier `mixed`) MUST NOT be reported `low` for that reason alone.
- **FR-008**: The user documentation (`docs/reference/languages.md`, `docs/commands.md`, `docs/configuration.md`) and the canonical architecture and data-model documents MUST describe the new fields and rules.

## Success Criteria *(mandatory)*

- **SC-001**: Each behaviour above has a test that fails before the change and passes after.
- **SC-002**: The full suite passes and `guard` on this repository reports no new finding.

## Out of Scope

- Express and Koa (and NestJS on the Express adapter) match routes case-insensitively by default, but an application or router can turn that off (`app.set('case sensitive routing', true)`, `Router({ caseSensitive: true })`, `sensitive: true`). Marking their routes needs the setting resolved per router; marking them unconditionally would hide real gaps in projects that enabled it.
- `docs-sync` (DSY003) already lowercases both sides of its JavaScript route-file comparison; it reads no ASP.NET Core route.
