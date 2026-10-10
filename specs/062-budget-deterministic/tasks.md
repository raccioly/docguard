# Tasks: Deterministic Budget Timing Tests

**Status**: Complete. SC-001: the rewritten file failed to load before the seam (no `guardPair` export); the original file passed 20/20 sequential and 20/20 concurrent-under-load runs (mean 15.0 s per run), the new file 20/20 and 20/20 (mean 2.7 s). SC-002: `npm test` ran 2963 tests, all passing; guard reports no findings beyond the expected DLC002 for this spec (and the pre-existing one for spec 055).
**Spec**: `specs/062-budget-deterministic/spec.md`
**Plan**: `specs/062-budget-deterministic/plan.md`

## Phase 1: Tests first

- [x] T001 Measure the current file: 20 sequential runs, five rounds of four concurrent runs beside 18 busy-loop processes.
- [x] T002 `tests/budget.test.mjs`: scripted, seeded timing source; ten noisy base-vs-base comparisons pass and the same with a 30% slowdown fail, a one-sample burst fails (FR-001); interleaving order and steady drift (FR-002); one real-process smoke test with lower bounds only (FR-003). Confirm they fail without the seam.

## Phase 2: Implementation

- [x] T003 FR-004: `tools/budget.mjs` exports `guardPair(base, head, targets, { samples, sample = guardSample })`; `measurePair` calls it.
- [x] T004 Mutation check: removing the interleaving fails the order test; sampling base then head in sequence fails the order and drift tests; a mean instead of the median fails the base-vs-base and drift tests.

## Phase 3: Verification

- [x] T005 Repeat the T001 measurement on the new file (SC-001).
- [x] T006 Base-vs-base A/B of this repository with the tool's own sampling (three targets, five samples) under CPU load, to check whether the method itself can be fooled. Result: 12/12 target comparisons passed (largest median ratio ×1.054); within one loaded run, single rounds differed by up to ×1.34 while the medians stayed within ×0.94–×1.04. No tool change.
- [x] T007 `docs-canonical/CI-RECIPES.md` (FR-005), `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`; `npm run llms`; `docguard specs --write`; `docguard guard`; `npm test` (SC-002).
