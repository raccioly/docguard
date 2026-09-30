# Tasks: Non-Regression Budgets

**Status**: Planned. It is implemented before `docguard.doc-dependency-lock`, which measures FR-008 with it.
**Spec**: `specs/031-non-regression-budgets/spec.md`
**Plan**: `specs/031-non-regression-budgets/plan.md`

## Phase 1: Tests

- [ ] T001 `tests/budget.test.mjs`: compare verdicts (breach, floor, new metric, inconclusive, exemption) and SC-001's injected slowdown.

## Phase 2: Tool and CI

- [ ] T002 `tools/budget.mjs`, `budgets.json`: measure and compare (FR-001, FR-002, FR-003, FR-006).
- [ ] T003 `.github/workflows/ci.yml`: the budget job with its summary table (FR-004, FR-005, SC-002).

## Phase 3: Docs and verification

- [ ] T004 `package.json` script; `AGENTS.md` rule; `docs-canonical/CI-RECIPES.md` recipe (FR-007).
- [ ] T005 `testguard.claims.json` claim BUDGET-CATCHES-REGRESSIONS; probe; gate; `CHANGELOG.md`; `npm run llms`; `docguard specs --write`.
