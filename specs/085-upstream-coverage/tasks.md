# Tasks: Every Requirement Reaches a Task, and Every Task Cites a Real Requirement

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1 — Failing tests first

- [ ] T001 [US1] `tests/upstream-coverage.test.mjs`: `chainCoverage` on a fixture spec defining `FR-001`–`FR-003` and `SC-001`, a plan citing `FR-002`, and tasks citing `FR-001`, `FR-003` and `FR-009`: `FR-002` covered by the plan, `SC-001` uncovered, `FR-009` dangling (FR-001, FR-002).
- [ ] T002 [US1] Same file: ranges (`FR-004 to FR-006`, `FR-004–FR-006`, `FR-004..FR-006`), a sub-ID (`FR-001a`), fenced code, HTML comments and qualified IDs (`x.y#FR-002`) (FR-005, Edge Cases).
- [ ] T003 [US1] Same file: tasks with no IDs at all give `checked: false` and no SPK013 (US1-4).
- [ ] T004 [US2] Same file: a plan naming `spec.md` passes; a plan naming neither the file nor any ID gives SPK015; tasks naming neither file nor any ID give SPK015 (FR-003).
- [ ] T005 [US3] Same file: `[US1]` labels only, with stories 1 and 2, give SPK016 for story 2; no labels give nothing (FR-004).
- [ ] T006 Same file: an archived feature is skipped; 12 uncovered IDs give 10 SPK013 plus one elision note; the codes default to `info` and the exit code is unchanged (FR-006, FR-007).

## Phase 2 — Implementation

- [ ] T007 `cli/scanners/chain-coverage.mjs`.
- [ ] T008 `cli/scanners/speckit.mjs` wiring, archive and status skips, caps.
- [ ] T009 `cli/findings.mjs` SPK013 to SPK016.

## Phase 3 — Docs and proof

- [ ] T010 `npm run docs:reference`; `docs-canonical/TEST-SPEC.md`; `CHANGELOG.md`; `npm run llms`; `specs --write`; `anchors accept`.
- [ ] T011 SC-002: review every SPK013 and SPK014 on this repository by hand, and record the precision in Verification Notes.
- [ ] T012 SC-003: hermetic A/B on every local project, with additions per project recorded.
