# Tasks: Fixes From Dogfooding, Round 2

**Status**: Complete. SC-001: every reproduction in `tests/dogfood-round-2.test.mjs` failed before its fix (29 of 41 failing; the negatives and the no-pattern case passed, as they must); SC-002: full suite and guard below.
**Spec**: `specs/061-dogfood-round-2/spec.md`
**Plan**: `specs/061-dogfood-round-2/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/dogfood-round-2.test.mjs`: documented `test_*.mjs` files under `testPattern` (FR-001); DynamoDB and Docker text signals with file evidence, and their negatives (FR-002, FR-003, FR-004); password labels skipped and real credentials reported (FR-005); TypeORM, Sequelize and Mongoose (FR-006). Confirm each fails before the fix.

## Phase 2: Implementation

- [x] T002 FR-001: `docs-diff.mjs` documented-test extraction and patterns; `diff.mjs` uses it
- [x] T003 FR-002, FR-003: `shared-source.mjs` `detectCodeTechnologyEvidence`
- [x] T004 FR-004: DDF001 message and `diff` evidence
- [x] T005 FR-005: `security.mjs` password labels
- [x] T008 FR-006: `TECH_PATTERNS` / `TECH_DEPENDENCIES` name TypeORM and Sequelize

## Phase 3: Docs and verification

- [x] T006 `cli/findings.mjs` help text, `npm run docs:reference`, `docs/configuration.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, `npm run llms`
- [x] T007 `docguard specs --write`; `docguard guard`; `npm test` (SC-002)
