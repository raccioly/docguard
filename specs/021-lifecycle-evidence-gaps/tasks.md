# Tasks: Lifecycle Evidence Gaps

**Status**: Complete — SPR006 first caught spec 018 (now annotated); zero SPR006 on this repository
**Spec**: `specs/021-lifecycle-evidence-gaps/spec.md`
**Plan**: `specs/021-lifecycle-evidence-gaps/plan.md`

## Phase 1: Evidence sources

- [x] T001 [US3] `cli/scanners/requirement-evidence.mjs`: YAML implementation annotations (FR-003).
- [x] T002 [US2] `cli/scanners/spec-registry.mjs` + `cli/commands/specs.mjs`: `untrackedEvidence` (FR-002).

## Phase 2: Signal

- [x] T003 [US1] `cli/validators/spec-registry.mjs` + `cli/findings.mjs`: SPR006 (FR-001).

## Phase 3: Tests and verification

- [x] T004 `tests/lifecycle-evidence-gaps.test.mjs`: the three fixtures (SC-001); `action.yml` evidence on this repository (SC-002).
- [x] T005 `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`; `docguard guard` (SC-003); `npm test`.
