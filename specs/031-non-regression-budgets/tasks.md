# Tasks: Non-Regression Budgets

**Status**: Complete. SC-001 and SC-002 hold (local A/B: 80 s); SC-003 applies to every later PR.
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
