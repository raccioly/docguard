# Tasks: Fixes From Dogfooding, Round 2

**Status**: Complete. SC-001: every reproduction in `tests/dogfood-round-2.test.mjs` failed before its fix (29 of the first 41 failed; the negatives and the no-pattern case passed, as they must; T009 records the FR-007/FR-008 run); SC-002: full suite and guard below.
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
- [x] T009 FR-007, FR-008 tests first in `tests/dogfood-round-2.test.mjs`: Python, Go, Ruby, Rust, PHP and C# projects, no manifest, `generate` then guard on Python; `diff` with a mapped test spec. Seven of the nine failed before the fix; the no-manifest case passed, as it must.
- [x] T010 FR-007: `cli/scanners/tech-stack.mjs` (`scanCodeTechnologies`, per-ecosystem coverage); `docs-diff.mjs` runs on any manifest and reports absence only for covered technologies; importers moved
- [x] T011 FR-008: `diff.mjs` `diffTests` uses `resolveDocRole`

## Phase 3: Docs and verification

- [x] T006 `cli/findings.mjs` help text, `npm run docs:reference`, `docs/configuration.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, `npm run llms`
- [x] T007 `docguard specs --write`; `docguard guard`; `npm test` (SC-002)
