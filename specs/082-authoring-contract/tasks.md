# Tasks: Authoring Contract

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1 — Failing round trip first

- [x] T001 [US1] `tests/authoring-contract.test.mjs`: the guidance before this change fails three required sections; the fix prompt, skill and explain name every required section (FR-005, SC-001)
- [x] T002 [US2] [US3] [US4] Same file: filled templates, `generate` output, template readers, the score's exemptions, STR007 (FR-005, FR-006)

## Phase 2 — The registry and its consumers

- [x] T003 `cli/authoring-contract.mjs` (FR-001)
- [x] T004 STR003, the score, explain, `fix` prompts read it (FR-002); `memory --plan` names checked (FR-004)
- [x] T005 Skill and mirror marker block refreshed by `npm run docs:reference` (FR-003); STR007 (FR-006)

## Phase 3 — Docs and proof

- [ ] T006 Findings reference, ARCHITECTURE, TEST-SPEC, CHANGELOG (FR-007); full suite; hermetic A/B with `score` (SC-002)
