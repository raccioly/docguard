# Tasks: Decisions Are Recorded Completely and Their Supersession Chain Holds

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1 — Failing tests first

- [x] T001 [US1] `tests/decision-records.test.mjs`: statuses (missing, unknown, emoji, emphasis, headings, synonyms), and MADR front matter (FR-001, FR-002).
- [x] T002 [US2] Same file: one-way, dangling, superseded without a successor; prose and partial supersession are not links (FR-003 to FR-005).
- [x] T003 [US3] Same file: index status mismatch, and an index row with no record (FR-003, FR-006).
- [x] T004 [US4] Same file: empty clarifications and blank `[Answer]:` tags, with wrapped and parenthetical answers counted (FR-007).
- [x] T005 Same file: advisory level, absence claim, not-applicable, quiet on the scaffold (FR-008, SC-003).

## Phase 2 — Implementation and precision

- [x] T006 `cli/validators/decision-records.mjs` and its registration (FR-001 to FR-009).
- [x] T007 Precision review on the 45 local projects (SC-002); see plan.

## Phase 3 — Docs and proof

- [ ] T008 Docs, reference, CHANGELOG; full suite; hermetic A/B.
