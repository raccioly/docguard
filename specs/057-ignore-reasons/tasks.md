# Tasks: Suppressions That Carry a Reason and an Expiry

**Status**: Complete. SC-001: `tests/ignore-reasons.test.mjs` failed before the change (its modules did not exist) and passes after (24 tests). SC-002: full suite 2983/2984 with one load flake in `tests/budget.test.mjs` (base-vs-base timing) that passes alone (14/14); guard on this repository passes all checks; every emitted claimspec document validates against the vendored schema.
**Spec**: `specs/057-ignore-reasons/spec.md`
**Plan**: `specs/057-ignore-reasons/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/ignore-reasons.test.mjs`: grammar and old-parser equivalence (FR-001, FR-002), expiry and invalid entries through config and `guard` (FR-003, FR-004, FR-005), the suppression model (FR-006), `docguard ignore` text/json (FR-007), the claimspec export and the vendored-schema validator against the conformance fixtures (FR-008, FR-009). Run it and see it fail.

## Phase 2: Implementation

- [x] T002 FR-001–FR-004: `cli/shared-ignore.mjs` parser and active-pattern loader
- [x] T003 FR-005: IGN codes in `cli/findings.mjs`, `cli/validators/suppressions.mjs`, guard/explain/config-schema registration
- [x] T004 FR-006: `parseInlinePragma`, `listValidatorMarkers`, `cli/scanners/suppressions.mjs`
- [x] T005 FR-009: vendored schemas, `cli/claimspec-schema.mjs`, conformance fixtures
- [x] T006 FR-007, FR-008: `cli/writers/claimspec-ignore.mjs`, `cli/commands/ignore.mjs`, `cli/docguard.mjs`; `tests/read-only-commands.test.mjs`

## Phase 3: Docs and verification

- [x] T007 `docs/configuration.md`, `docs/commands.md`, `docs/guides/troubleshooting.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/SECURITY.md`, README, `CHANGELOG.md`; `npm run docs:reference`; `npm run llms`
- [x] T008 `docguard specs --write`; `docguard guard`; `npm test` (SC-002)
