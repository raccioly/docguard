# Tasks: Laravel, Symfony and ASP.NET Core Route Extraction

**Status**: Complete. SC-001: the five reference projects reported no route before the readers and report exactly their ground truth after; SC-003: unresolvable paths are omitted and counted; SC-002: full suite and guard below.
**Spec**: `specs/059-php-dotnet-routes/spec.md`
**Plan**: `specs/059-php-dotnet-routes/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/php-dotnet-routes.test.mjs`: five reference projects with hand-written ground truth (SC-001); Laravel, Symfony and ASP.NET Core edge cases (FR-001 to FR-006); unresolvable paths omitted and counted (FR-007, SC-003); classification (FR-008); guard and diff agree (FR-009); docs (FR-010). Run it and see it fail.

## Phase 2: Implementation

- [x] T002 FR-008: `project-type.mjs` ASP.NET Core classification
- [x] T003 FR-001, FR-002, FR-003, FR-007: `php-routes.mjs`
- [x] T004 FR-004, FR-005, FR-006, FR-007: `dotnet-routes.mjs`
- [x] T005 FR-007, FR-008: `routes.mjs` dispatch and omitted count; `api-surface.mjs` coverage reason

## Phase 3: Docs and verification

- [x] T006 FR-010: `docs/reference/languages.md`, `docs/commands.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`; `npm run llms`
- [ ] T007 SC-002: `docguard specs --write`, `docguard guard`, `npm test`
