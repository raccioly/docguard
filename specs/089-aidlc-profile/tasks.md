# Tasks: What AI-DLC Verified at Its Gates Stays True After the Workflow Ends

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1 — Failing tests first

- [x] T001 [US1] `tests/aidlc-profile.test.mjs`: removed OK target reported; ID, prose, existing path and directory targets fine (FR-002). (SC-001: fixtures follow AI-DLC 2.11.2's documented traceability.json, source-manifest.json and aidlc-state.md examples)
- [x] T002 [US2] Same file: GAP and ORPHAN reported only in a completed stage (FR-003).
- [x] T003 [US3] Same file: later removal reported, the unit's own deletion and other repos skipped; an uncommitted manifest is partial (FR-004).
- [x] T004 [US4] Same file: legacy layout, malformed JSON, escaping path, empty without AI-DLC; advisory, absence claims, read counts (FR-001, FR-005 to FR-007).

## Phase 2 — Implementation

- [x] T005 `cli/scanners/aidlc.mjs`, `cli/validators/aidlc.mjs`, registration, codes.

## Phase 3 — Docs and proof

- [x] T006 COMPARISONS, README, docs, CHANGELOG (FR-008).
- [x] T007 Full suite, guard, hermetic A/B (SC-003); SC-002 with spec 090's fixture.
