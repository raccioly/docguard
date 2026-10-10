# Tasks: Sinatra, Starlette, Warp, Tide and net/http Routes

**Status**: Complete. SC-001: the five reference projects (Sinatra, Starlette, Warp, Tide, net/http-only Go; 51 routes) report exactly their ground truth end to end, where each reported 0 before; SC-002: the neighbouring route suites (160 tests) pass unchanged and the full suite passes (2983 tests); SC-003: non-literal Sinatra, Warp and Tide paths yield no route and are counted in the API-surface reason.
**Spec**: `specs/060-more-route-frameworks/spec.md`
**Plan**: `specs/060-more-route-frameworks/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/more-route-frameworks.test.mjs`: five reference projects with hand-written ground truth, end to end from detection (SC-001); run against today's scanner first, which reports 0 routes for each.
- [x] T002 Same file, per-requirement cases: Sinatra forms, apps, namespaces, extensions, `config.ru` (FR-001); Starlette lists, mounts, endpoints, decorator, pattern tier (FR-002); Warp composition (FR-003); Tide nesting (FR-004); non-literal paths omitted and counted (FR-005, SC-003); net/http classification (FR-006); dispatch, `source` and tier (FR-007); docs (FR-008).

## Phase 2: Implementation

- [x] T003 `cli/scanners/sinatra-routes.mjs` (FR-001, FR-005)
- [x] T004 `cli/scanners/python-routes.mjs` Starlette (FR-002, FR-005)
- [x] T005 `cli/scanners/rust-routes.mjs` Warp and Tide (FR-003, FR-004, FR-005)
- [x] T006 `cli/scanners/project-type.mjs` net/http (FR-006)
- [x] T007 `cli/scanners/routes.mjs` dispatch and wrappers; `cli/validators/api-surface.mjs` omitted-route reason (FR-005, FR-007)

## Phase 3: Docs and verification

- [x] T008 `docs/reference/languages.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md` (FR-008); `npm run llms`
- [x] T009 `docguard specs --write`; `docguard guard`; `npm test` (SC-002)
