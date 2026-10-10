# Tasks: Symbol Map in the Context Pack

**Status**: In progress. The symbol map ships opt-in behind `--symbols`. The v2 protocol is frozen but cannot run (its CLI version is not installed and its model is refused for ChatGPT-account Codex), so the 2026-10-10 amendment froze protocol v3, which changes only the executable pin (T014). T009 and T010 run and decide on v3; default-on stays blocked unless that result meets FR-008.
**Spec**: `specs/036-symbol-map/spec.md`
**Plan**: `specs/036-symbol-map/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/symbol-map.test.mjs`: hub ranks first (SC-001); fixed PageRank on a cycle; budget cut at a whole line with the omitted count; 12-symbol cap; degraded tiers named; no-edge fallback; byte-identical runs; pack unchanged without `--symbols` (FR-004, SC-003).
- [x] T002 `tests/symbol-map.test.mjs` (the v2 protocol tests sit beside the feature they gate; the v1 tests run unchanged): v1 still loads; v2 manifest rejected when a frozen field changes; `decideSymbolPromotion` on synthetic aggregates for promote, opt-in only, not released and incomplete (FR-005, FR-008).

## Phase 2: Symbol map (opt-in)

- [x] T003 `cli/scanners/js-ast.mjs`, `cli/scanners/as-built.mjs`: `exportedNames` moved from as-built into the shared parser module, and `moduleSymbols` added, which tells a parse failure from a file with no exports (FR-001).
- [x] T004 `cli/scanners/py-ast.mjs`: `symbols` in `PY_EXTRACTOR` (FR-001).
- [x] T005 `cli/scanners/symbol-map.mjs`: ranking and rendering; symbols are read only for the files that fit the budget (FR-002, FR-003). The import graph was already a scanner (spec 035).
- [x] T006 `cli/commands/memory.mjs`, `cli/docguard.mjs`, `schemas/docguard-config.schema.json`: `--symbols`, `memory.symbolMap.maxBytes`; the default and bounds live in `symbolMapBudget`, so `cli/config.mjs` is unchanged (FR-003, FR-004).

## Phase 3: Freeze the v2 protocol

- [x] T007 `benchmarks/agent-context/fixtures/ledger-service/` (29 source modules), three hidden evaluators and references; `verifyFixtures` passes for all six tasks (User Story 3).
- [x] T008 `benchmarks/agent-context/manifest-v2.json`, `benchmarks/agent-context/run.mjs`, and new v2 schemas beside the frozen v1 ones (`schemas/docguard-agent-context-benchmark-v2.schema.json`, `schemas/docguard-agent-context-result-v2.schema.json`): protocol dispatch, `context-pack-symbols`, `decideSymbolPromotion` (FR-005, FR-006, FR-008). Commit and record the manifest digest before any model run.

## Phase 4: Run and decide

- [x] T014 (amendment 2026-10-10, before any run) `benchmarks/agent-context/manifest-v3.json`, `V3_MANIFEST_DIGEST` and `--protocol v3` in `run.mjs`, a check that v3 differs from v2 only in the executable pin, the v2-format schemas widened to the v3 id, tests in `tests/symbol-map.test.mjs`, and the amendment recorded in `spec.md` and `results/README-v3.md`, committed before the run (FR-011).

- [ ] T009 Run the v3 matrix (v2 cannot run; see T014); write `results/observed-v3.json` and `results/README-v3.md` (FR-007, SC-004).
- [ ] T010 (after T009) Apply the computed decision: default-on with `Budget-Exempt: memory-pack-bytes — <v3 result>` (FR-009); or keep `--symbols` opt-in; or remove the flag and record "not promoted" in the spec outcome.

## Phase 5: Docs and verification

- [x] T011 `README.md`, `docs/commands.md`, `docs/configuration.md`, `docs/ai-integration.md`, `docs-canonical/ARCHITECTURE.md`, `benchmarks/agent-context/results/README-v2.md` (FR-010).
- [x] T012 `testguard.claims.json`: claim SYMBOL-MAP-IS-BUDGETED-AND-GATED; probe `--confirm 3 --serial`; gate.
- [x] T013 Non-regression budgets (`docguard.non-regression-budgets`): guard A/B time unchanged within budget; `memory --pack` bytes unchanged unless T010 promotes, and then exempted with the v2 result; `memory --pack` wall time ≤10% (SC-002); `agent --task` and MCP bytes unchanged; precision benchmark PASS; `npm test`; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
