# Tasks: Compact Guard Response for Agents

**Status**: Complete. SC-001: 55% smaller on the budget fixture; SC-002: 50–55% on the three benchmark fixtures, 26% for a result with no findings; SC-003 holds on this repository and three benchmark fixtures.
**Spec**: `specs/037-compact-guard-response/spec.md`
**Plan**: `specs/037-compact-guard-response/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/compact-guard-response.test.mjs`: reconstruction on this repository and the benchmark fixtures (FR-005, SC-003); MCP default compact and `detail: "full"` (FR-003); CLI JSON unchanged and `--compact` (FR-004); size reductions (SC-001, SC-002).

## Phase 2: Implementation

- [x] T002 `cli/shared-guard-json.mjs`: `compactGuardResult` (FR-001, FR-002). Legacy validators without structured findings keep their messages, which exist nowhere else; the first draft dropped them and the reconstruction test caught it.
- [x] T003 `cli/commands/mcp.mjs`: `detail` argument (FR-003).
- [x] T004 `cli/commands/guard.mjs`, `cli/docguard.mjs`: `--compact` (FR-004).

## Phase 3: Docs and verification

- [x] T005 `README.md`, `docs/ai-integration.md`, `docs/commands.md`, `CHANGELOG.md` with an upgrade note (FR-006).
- [x] T006 `testguard.claims.json`: claim COMPACT-GUARD-LOSES-NOTHING; probe; gate; non-regression budgets (the MCP guard row shrinks, nothing else grows); `npm test`; `npm run llms`; `docguard specs --write`.

## Phase 4: The fixed part states each fact once (FR-007, SC-002 revised)

- [x] T007 `tests/compact-guard-response.test.mjs`: reconstruct each validator's applicability and `checkCoverage.limitations` from the compact form; SC-002 measured on the committed fixtures, plus a no-findings result. The first SC-002 test measured this repository and failed once the freshness review left one finding (8% saved).
- [x] T008 `cli/validator-coverage.mjs`: `STANDARD_APPLICABILITY_REASONS`, the one source for the standard reasons. `cli/shared-guard-json.mjs`: standard reasons once in `applicabilityReasons`; `checkCoverage` without `limitations`.
- [x] T009 `docs/ai-integration.md`, `CHANGELOG.md`; probe the claim again; budgets; `npm test`; `npm run llms`; `docguard specs --write`.
