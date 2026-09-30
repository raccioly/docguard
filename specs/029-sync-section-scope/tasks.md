# Tasks: Sync Section Scope

**Status**: Complete. SC-001 holds.
**Spec**: `specs/029-sync-section-scope/spec.md`
**Plan**: `specs/029-sync-section-scope/plan.md`

## Phase 1: Tests

- [x] T001 `tests/sync-since.test.mjs`: the table equals the plan's section IDs; docs-only, code and manifest changes; conservative defaults. Three fail on the previous table.

## Phase 2: Fix

- [x] T002 `cli/shared-sync-scope.mjs`, `cli/validators/api-surface.mjs`: re-keyed matchers (FR-001).

## Phase 3: Verification

- [x] T003 `testguard.claims.json`, `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
