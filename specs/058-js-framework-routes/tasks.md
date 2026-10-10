# Tasks: NestJS and Cloudflare Workers Route Extraction

**Status**: Complete. SC-001: the 22 tests in `tests/js-framework-routes.test.mjs` failed before the readers existed and pass after; each reference project matches its hand-written truth. SC-002: the full suite (2979 tests) passes and `docguard guard` passes all checks.
**Spec**: `specs/058-js-framework-routes/spec.md`
**Plan**: `specs/058-js-framework-routes/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/fixtures/js-framework-projects.mjs`: six reference projects with hand-written truths (SC-001).
- [x] T002 `tests/js-framework-routes.test.mjs`: NestJS paths, settings and auth (FR-001–FR-003), Worker dispatch (FR-004), Hono and itty-router (FR-005), tiers, fallback and coverage (FR-006), labels (FR-007), docs (FR-008); run and see them fail.

## Phase 2: Implementation

- [x] T003 FR-001–FR-003: `cli/scanners/nest-routes.mjs`
- [x] T004 FR-004: `cli/scanners/worker-routes.mjs`
- [x] T005 FR-005: `cli/scanners/router-routes.mjs`
- [x] T006 FR-006, FR-007: dispatch in `routes.mjs`, helper exports in `js-ast.mjs`, `routeScanGaps` and the fallback in `api-surface.mjs`, label order in `project-type.mjs`

## Phase 3: Docs and verification

- [x] T007 FR-008: `docs/reference/languages.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, `npm run llms`
- [x] T008 SC-002: `docguard specs --write`, `docguard guard`, `npm test`
