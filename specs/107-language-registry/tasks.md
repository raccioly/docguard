# Tasks: One Language Registry

**Spec**: `specs/107-language-registry/spec.md`
**Plan**: `specs/107-language-registry/plan.md`

## Phase 1: Audit and test

- [x] T001 Audit every extension list under `cli/`; split reader-bound lists from "is this code?" lists.
- [x] T002 `tests/language-registry.test.mjs`: the private-list detector, the registry, the Apex fixture.

## Phase 2: Implementation

- [x] T003 FR-001, FR-002: the registry and its derived sets.
- [x] T004 FR-002: move each consumer; FR-003: exemption comments.
- [x] T005 FR-005: API-Surface skips the Salesforce DX framework name.

## Phase 3: Verification

- [ ] T006 FR-006: CHANGELOG, docs.
- [ ] T007 `npm test` by exit code, hermetic A/B.
- [ ] T008 Scrub check, pull request, CI, merge.
