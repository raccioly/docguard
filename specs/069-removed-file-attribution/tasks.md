# Tasks: Removed Files Are Attributed to the Spec That Removes Them

**Status**: Complete. SC-001: the User Story 1 cases failed before the change; the User Story 2 cases guard unchanged behaviour. SC-002: full suite and guard below; spec 067's completion plan links `.jules-setup.sh` to `docguard.jules-policy`.
**Spec**: `specs/069-removed-file-attribution/spec.md`
**Plan**: `specs/069-removed-file-attribution/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/removed-file-attribution.test.mjs`: a named deletion links (file and `dir/`); an unnamed deletion, a changed file named in prose, a draft spec's mention and near-miss names stay unresolved; docs and SPC006 help (FR-001–FR-004).

## Phase 2: Implementation

- [x] T002 FR-001–FR-003: `removalLinks` in `cli/scanners/reconciliation.mjs`

## Phase 3: Docs and verification

- [x] T003 FR-004: ARCHITECTURE, SPC006 help, `npm run docs:reference`, CHANGELOG; `npm test`; `docguard specs --write`; `docguard guard`; spec 067's completion plan no longer lists `.jules-setup.sh` (SC-002)
