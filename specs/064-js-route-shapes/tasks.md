# Tasks: Koa Mounts, Cloudflare Pages Functions and Hono OpenAPI Routes

**Status**: Complete. SC-001: the 20 tests in `tests/js-route-shapes.test.mjs` failed before the change and pass after; each reference project matches its hand-written truth, and a scratch Koa project reports the same routes and auth flags from the old and new scanners. SC-002: the full suite (3217 tests) passes and `docguard guard` reports no finding from this change. Phase 4 (FR-007–FR-009): 9 more tests (29 in the file) failed before and pass after, the old and new scanners give identical literal Express/Fastify route records, and the full suite (3226 tests) passes. Phase 5 (FR-010): 4 more tests (33 in the file; 3 failed before, the middleware guard passed before and after), identical literal Express records old vs new (53 routes), and the full suite (3230 tests) passes. Phase 6 (FR-011): 5 more tests (38 in the file; 4 failed before, the ES-module default-import guard passed before and after), identical literal records old vs new (69 routes, ES module and CommonJS), and the full suite (3235 tests) passes.
**Spec**: `specs/064-js-route-shapes/spec.md`
**Plan**: `specs/064-js-route-shapes/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/fixtures/js-route-shape-projects.mjs`: three reference projects (Koa, Cloudflare Pages, `@hono/zod-openapi`) with hand-written truths (SC-001).
- [x] T002 `tests/js-route-shapes.test.mjs`: Koa (FR-001), the Pages label (FR-002), Pages Functions (FR-003), zod-openapi (FR-004), limitations and coverage (FR-005), docs (FR-006); run and see all 20 fail.

## Phase 2: Implementation

- [x] T003 FR-001, FR-004, FR-005: `cli/scanners/router-routes.mjs`
- [x] T004 FR-003: `cli/scanners/pages-routes.mjs`
- [x] T005 FR-002: `isPagesProject` in `cli/shared-source.mjs`, label in `cli/scanners/project-type.mjs`
- [x] T006 Dispatch in `cli/scanners/routes.mjs`; compare the old and new Koa results on a scratch project

## Phase 3: Docs and verification

- [x] T007 FR-006: `docs/reference/languages.md`, `docs/commands.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, `npm run llms`
- [x] T008 SC-002: `docguard specs --write`, `docguard guard`, `npm test`

## Phase 4: Follow-ups (FR-007, FR-008, FR-009)

- [x] T009 Tests first in `tests/js-route-shapes.test.mjs` (Express/Fastify paths, advanced mode, `_routes.json`, `redirect()`) and the placeholder test in `tests/js-ast.test.mjs`; see them fail.
- [x] T010 FR-007: `cli/scanners/js-ast.mjs`, `cli/scanners/routes.mjs`; compare old and new literal results.
- [x] T011 FR-008: `cli/scanners/pages-routes.mjs`, `cli/scanners/worker-routes.mjs`, `cli/shared-source.mjs`, `cli/scanners/routes.mjs`
- [x] T012 FR-009: `cli/scanners/router-routes.mjs`
- [x] T013 Docs, `docguard specs --write`, `docguard guard`, `npm test`

## Phase 5: Express mount prefixes (FR-010)

- [x] T014 Tests first in `tests/js-route-shapes.test.mjs` (constant, imported and template prefixes; unreadable prefixes; a router mounted both ways; middleware first arguments); see them fail.
- [x] T015 `cli/scanners/js-ast.mjs` (`extractJsMountsAndImports`), `cli/scanners/routes.mjs` (`buildExpressMountMap`, `scanExpressRoutes`); compare old and new literal results.
- [x] T016 Docs, `docguard specs --write`, `docguard guard`, `npm test`

## Phase 6: Imported constants (FR-011)

- [x] T017 Tests first in `tests/js-route-shapes.test.mjs` (ES module and CommonJS constants for Express paths and prefixes, Fastify, Koa and Hono; a default import of an ES module stays unresolved); see them fail.
- [x] T018 `cli/scanners/js-ast.mjs`, `cli/scanners/routes.mjs`, `cli/scanners/router-routes.mjs`; compare old and new literal results.
- [x] T019 Docs, `docguard specs --write`, `docguard guard`, `npm test`
