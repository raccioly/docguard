# Tasks: Symbol Map in the Context Pack

**Status**: Planned. Default-on is blocked until Phase 4 records a v2 result that meets FR-008. Implement after `docguard.non-regression-budgets` and `docguard.code-derived-diagrams`.
**Spec**: `specs/036-symbol-map/spec.md`
**Plan**: `specs/036-symbol-map/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/symbol-map.test.mjs`: hub ranks first (SC-001); fixed PageRank on a cycle; budget cut at a whole line with the omitted count; 12-symbol cap; degraded tiers named; no-edge fallback; byte-identical runs; pack unchanged without `--symbols` (FR-004, SC-003).
- [ ] T002 `tests/agent-context-benchmark.test.mjs`: v1 manifest and assertions unchanged; v2 manifest rejected when a frozen field changes; `decideSymbolPromotion` on synthetic aggregates for promote, opt-in only, not released and incomplete (FR-005, FR-008).

## Phase 2: Symbol map (opt-in)

- [ ] T003 `cli/scanners/js-ast.mjs`, `cli/scanners/as-built.mjs`: `extractExportedSymbols` (FR-001).
- [ ] T004 `cli/scanners/py-ast.mjs`: `symbols` in `PY_EXTRACTOR` (FR-001).
- [ ] T005 `cli/scanners/symbol-map.mjs` (and `cli/scanners/import-graph.mjs` if not yet moved): ranking and rendering (FR-002, FR-003).
- [ ] T006 `cli/commands/memory.mjs`, `cli/docguard.mjs`, `cli/config.mjs`, `schemas/docguard-config.schema.json`: `--symbols`, `memory.symbolMap.maxBytes` (FR-003, FR-004).

## Phase 3: Freeze the v2 protocol

- [ ] T007 Navigation-bound fixtures, hidden evaluators and references; `verifyFixtures` passes (User Story 3).
- [ ] T008 `benchmarks/agent-context/manifest-v2.json`, `benchmarks/agent-context/run.mjs`, both benchmark schemas: protocol dispatch, `context-pack-symbols`, `decideSymbolPromotion` (FR-005, FR-006, FR-008). Commit and record the manifest digest before any model run.

## Phase 4: Run and decide

- [ ] T009 Run the v2 matrix; write `results/observed-v2.json` and the results README section (FR-007, SC-004).
- [ ] T010 Apply the computed decision: default-on with `Budget-Exempt: memory-pack-bytes — <v2 result>` (FR-009); or keep `--symbols` opt-in; or remove the flag and record "not promoted" in the spec outcome.

## Phase 5: Docs and verification

- [ ] T011 `README.md`, `docs/commands.md`, `docs/configuration.md`, `docs/ai-integration.md` (FR-010).
- [ ] T012 `testguard.claims.json`: claim SYMBOL-MAP-IS-BUDGETED-AND-GATED; probe `--confirm 3 --serial`; gate.
- [ ] T013 Non-regression budgets (`docguard.non-regression-budgets`): guard A/B time unchanged within budget; `memory --pack` bytes unchanged unless T010 promotes, and then exempted with the v2 result; `memory --pack` wall time ≤10% (SC-002); `agent --task` and MCP bytes unchanged; precision benchmark PASS; `npm test`; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
