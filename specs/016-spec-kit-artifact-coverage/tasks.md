# Tasks: Spec Kit Artifact Coverage

**Status**: Complete — SC-001: untiered 55 → 18 on this repository; SC-002: pre-v2 constitution flagged by MET004
**Spec**: `specs/016-spec-kit-artifact-coverage/spec.md`
**Plan**: `specs/016-spec-kit-artifact-coverage/plan.md`

## Phase 1: Validator isolation (US4)

- [x] T001 [US4] `tests/validator-isolation.test.mjs`; confirm it fails on the current tree (SC-004).
- [x] T002 [US4] Move `findAllOpenApiSpecs` to `cli/shared-openapi.mjs`; `cli/validators/api-surface.mjs` imports and re-exports it; `cli/validators/docs-sync.mjs` imports the shared module (FR-007).

## Phase 2: Spec Kit tier (US1)

- [x] T003 [US1] `cli/scanners/speckit.mjs`: `findConstitution()` (FR-002).
- [x] T004 [US1] `cli/commands/guard.mjs`: `specKit` coverage tier, constitution discovery, tier line (FR-001, FR-003).

## Phase 3: Constitution claims (US2, US3)

- [x] T005 [US2] `cli/validators/metrics-consistency.mjs`: constitution in scope; `MET004` dependency claims (FR-004, FR-005, FR-006); register `MET004` in `cli/findings.mjs` and `docguard explain`.
- [x] T006 [US3] `cli/validators/reference-existence.mjs`: constitution in `indexDocs` (FR-006).
- [x] T007 `tests/spec-kit-artifact-coverage.test.mjs`: tier counts, dot-dir constitution, ignored spec, MET004 true/false/qualified-prose/no-manifest, constitution reference finding, the pre-v2 constitution fixture (SC-002).

## Phase 4: Documentation and verification

- [x] T008 [P] `docs-canonical/ARCHITECTURE.md` coverage row; `docs-canonical/DATA-MODEL.md` coverage JSON field; `README.md` finding code table if it lists MET codes.
- [x] T009 `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`; `docguard guard`; `npm test`; record SC-001 before and after numbers.
