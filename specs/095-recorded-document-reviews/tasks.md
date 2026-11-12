# Tasks: Recorded Document Reviews and Per-Reference Staleness

## Phase 1 — Tests first
- [x] T001 `tests/recorded-document-reviews.test.mjs`: US1–US6, FR-010, FR-011 (16 cases).

## Phase 2 — Implementation
- [x] T002 `cli/scanners/doc-reviews.mjs` (FR-001–FR-004).
- [x] T003 `cli/scanners/reference-staleness.mjs` (FR-005).
- [x] T004 `cli/scanners/recorded-review-signals.mjs` and the Freshness wiring (FR-006–FR-009, FR-014).
- [x] T005 `review --accept <doc>` (FR-001).
- [x] T006 Role-scoped `findingSeverity`, config schema (FR-010).
- [x] T007 Stale-instructions line and JSON; `mkFinding` fields (FR-011).

## Phase 3 — Docs and evidence
- [x] T008 Findings registry, reference docs, DATA-MODEL, ARCHITECTURE, help, CHANGELOG, reviews schema (FR-013).
- [ ] T009 History-replay benchmark and results (FR-012, SC-003).
- [x] T010 Anchors accepted, spec registry, `npm run llms`.

## Phase 4 — Proof
- [x] T011 SC-002 demo on TestGuard f89ca46.
- [ ] T012 `npm test`, guard, `npm run budget`.
- [ ] T013 A/B on the local projects, with counts per code.
