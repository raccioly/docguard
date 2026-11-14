# Tasks: Keep Completions Current

**Spec**: `specs/103-completion-upkeep/spec.md`
**Plan**: `specs/103-completion-upkeep/plan.md`

## Phase 1: Measure and reproduce

- [x] T001 U5: replay the last 30 squash commits on main; record the distribution with and without canonical documents and the tag-line exemption (spec "Measured before the warning was wired in").
- [x] T002 Run the proposed check on main's tip: it flags nothing.
- [x] T003 `tests/completion-upkeep.test.mjs`: the pull-request fixture, the batch, the blocked batch, the tag-only edit, and one test per friction point; run it on main's code and record which tests fail (13 of 18; the tests for FR-014 and SC-003 were added later and never ran on main).

## Phase 2: Implementation

- [x] T004 FR-001, FR-002, FR-003: `stale-completions.mjs`, SPR011, the findings entry.
- [x] T005 FR-004, FR-005, FR-006: `completeStale`, shared planning, one transaction, the `reviewedCommitOnHistory` fallback.
- [x] T006 FR-007: tag-only edits and working-tree blobs.
- [x] T007 FR-008, FR-009, FR-010, FR-011, FR-012: SPC004 help, the SPC006 hint, the written summary, the Status header, the did-you-mean hint.
- [x] T008 FR-013, FR-014: `docs/commands.md`, `AGENTS.md`, `CONTRIBUTING.md`, canonical documents, CHANGELOG, the plan's cost note.

## Phase 3: Verification

- [x] T009 Amend specs 101 (FR-001, FR-005) with dated notes; `anchors accept`; `specs --write`; `npm run llms`; `npm run docs:reference`.
- [x] T010 `npm test`, the CI lint, `docguard guard`, the benchmark, the two completion test files.
- [x] T011 Dogfood: close this spec with the one-commit flow, and every other spec whose evidence this change edited with `specs complete --stale`.
- [x] T012 Scrub check; pull request; CI.
