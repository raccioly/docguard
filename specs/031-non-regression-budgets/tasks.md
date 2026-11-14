# Tasks: Non-Regression Budgets

**Status**: Complete. SC-001 and SC-002 hold (local A/B: 80 s when written; 135 s at 93 specs after T006); SC-003 applies to every later PR.
**Spec**: `specs/031-non-regression-budgets/spec.md`
**Plan**: `specs/031-non-regression-budgets/plan.md`

## Phase 1: Tests

- [x] T001 `tests/budget.test.mjs`: compare verdicts (breach, floor, new metric, inconclusive, exemption) and SC-001's injected slowdown.

## Phase 2: Tool and CI

- [x] T002 `tools/budget.mjs`, `budgets.json`: measure and compare (FR-001, FR-002, FR-003, FR-006).
- [x] T003 `.github/workflows/ci.yml`: the budget job with its summary table (FR-004, FR-005, SC-002).

## Phase 3: Docs and verification

- [x] T004 `package.json` script; `AGENTS.md` rule; `docs-canonical/CI-RECIPES.md` recipe (FR-007).
- [x] T005 `testguard.claims.json` claim BUDGET-CATCHES-REGRESSIONS; probe; gate; `CHANGELOG.md`; `npm run llms`; `docguard specs --write`.

## Amendment 2026-11-13: the job fits its bound again

- [x] T006 `cli/scanners/speckit.mjs`, `cli/scanners/spec-registry.mjs`, `cli/scanners/revision-anchor.mjs`, `tests/guard-git-cost.test.mjs`: guard read git per spec (SPK010 history walks, SPR008 revision checks, registry path checks), so a guard run cost 22 s at 93 specs and the budget job (12 runs) hit its 6-minute bound; each answer is now read once per scan, with the same findings and a test on the git process count (SC-002).
