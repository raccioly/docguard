# Tasks: Route Reader Gaps Found on Real Projects

**Status**: Complete. SC-001: each FR has a look-alike reproduction in `tests/real-project-route-gaps.test.mjs` that failed before the change (12 of 14 failed; the two that passed before, the one-line `App::route` form and an unregistered handler macro, guard behaviour that must not change). SC-002: see the counts and the suite below.
**Spec**: `specs/071-real-project-route-gaps/spec.md`
**Plan**: `specs/071-real-project-route-gaps/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/real-project-route-gaps.test.mjs`: Actix builder (FR-001), Axum chains and nests (FR-002), Symfony invokable controllers (FR-003), Koa `routes()` exports (FR-004), unresolved declarations (FR-005), unchanged forms (FR-006); run it and see each fail.

## Phase 2: Implementation

- [x] T002 FR-001, FR-002, FR-005: `cli/scanners/rust-routes.mjs` `extractRustBuilderRoutes`; `cli/scanners/routes.mjs` `scanRustWebRoutes`
- [x] T003 FR-003, FR-005: `cli/scanners/php-routes.mjs`; `routes.mjs` `scanSymfonyRoutes`, `scanLaravelRoutes`
- [x] T004 FR-004, FR-008: `cli/scanners/router-routes.mjs` (Koa `routes()` exports; pass-through JWT middleware)

## Phase 3: Docs and verification

- [x] T005 FR-007: `docs/reference/languages.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`; `npm run llms`
- [x] T006 FR-006, SC-002: re-run the scan on the public reference projects and record the counts below; `docguard specs --write`; `docguard guard`; `npm test`

## Reference-project counts (SC-002)

Scanned with `scanRoutesDeep` and the detected framework, before (origin/main 59b7758) and after:

| Project | Before | After |
|---|---|---|
| actix-realworld-example-app | 0 routes, 0 unresolved | 20: the 19 RealWorld endpoints under `/api`, plus `ANY /` (`web::resource("/").to(index)`) |
| realworld-axum-sqlx | 12 | 19 |
| symfony-realworld-example-app | 0 | 19 |
| koa-knex-realworld-example | 19, none under `/api` | 19, all under `/api` |
| laravel-realworld-example-app | 22 | 22 (unchanged) |
| nestjs-realworld-example-app | 21 | 21 (unchanged) |
| aspnetcore-realworld-example-app | 19 | 19 (unchanged; the `api` prefix from an `IControllerModelConvention` is out of scope) |
| sinatra-api-example | 6 | 6 (unchanged) |
| sqladmin | 0 | 0 (unchanged; library, out of scope) |
| it-toolbox | 21 | 21 (unchanged) |
| honojs/examples (13 dirs) | as before | identical route sets |

Every project other than the four targets reports the identical route set.

## Verification

- `node --test tests/real-project-route-gaps.test.mjs`: 14/14; the 36 route, API-surface and docs test files: 636/636.
- `npm test`: 3391/3391.
- `docguard guard`: 2130/2131, the one warning DLC002 for this spec (expected until approval).
