# Tasks: Config Secrets and Analysis Disclosure

**Spec**: `specs/108-analysis-disclosure/spec.md`
**Plan**: `specs/108-analysis-disclosure/plan.md`

## Phase 1: Tests

- [x] T001 `tests/config-secrets-and-coverage.test.mjs` from the trees of issues 718 and 719; 7 of 8 fail on the base code.

## Phase 2: Implementation

- [x] T002 FR-001: the config secret scan; shell scripts.
- [x] T003 FR-002, FR-003: `unanalyzed` and SEC012.
- [x] T004 FR-004: registry entries and path rules.
- [x] T005 FR-005: MuleSoft, `NO_ROUTE_READER`, the generate note.

## Phase 3: Verification

- [x] T006 FR-006, FR-007: schema, docs, CHANGELOG.
- [ ] T007 Full suite, hermetic A/B.
- [ ] T008 Scrub check, pull request, CI, merge.
