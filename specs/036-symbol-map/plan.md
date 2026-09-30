# Implementation Plan: Symbol Map in the Context Pack

**Branch**: `feat/symbol-map` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

Two parts, in order. The benchmark protocol is frozen before the feature can be
turned on.

**Part A: the symbol map (opt-in).**

- `exportedNames` moves from `cli/scanners/as-built.mjs` to
  `cli/scanners/js-ast.mjs` as `extractExportedSymbols(content, filename)`,
  returning `{ name, kind, line }`. `as-built.mjs` imports it; its facts do not
  change.
- `PY_EXTRACTOR` in `cli/scanners/py-ast.mjs` adds a `symbols` list (top-level
  `def`, `async def`, `class`, and `__all__` when it is a literal list).
  `extractPythonFiles` returns it beside `imports`.
- A new scanner, `cli/scanners/symbol-map.mjs`, takes the file graph from
  `buildImportGraph` in `cli/scanners/import-graph.mjs` (moved there by
  `docguard.code-derived-diagrams`; this spec does the move if it lands
  first), runs the fixed PageRank, collects symbols, and renders lines until
  the byte budget.
- `runMemoryPack` in `cli/commands/memory.mjs` appends the section when
  `flags.symbols` is set. `cli/docguard.mjs` adds `--symbols` to `memory`.

**Part B: the v2 benchmark gate.**

- `benchmarks/agent-context/manifest-v2.json` holds protocol
  `docguard-agent-context-v2`, the three conditions, six or more tasks, the
  FR-008 thresholds, and `frozenAt`. It is committed before any v2 run.
- `loadManifest` dispatches on `protocol.id`. The v1 assertions stay exactly
  as they are; v2 gets its own frozen assertions.
- `contextFor` adds `context-pack-symbols`: `memory --pack --stdout --symbols`,
  normalized by the existing `normalizePack`.
- `decidePromotion` is v1-specific (it compares `targeted-packet` with the
  other two). A new `decideSymbolPromotion(manifest, aggregate)` applies
  FR-008 to `context-pack-symbols` against `context-pack`, and returns
  `incomplete` on infrastructure failures, as v1 does.
- New fixtures under `benchmarks/agent-context/fixtures/`, with hidden
  evaluators and references under `hidden/` and `reference/`, for three
  navigation-bound tasks on trees of 25 or more modules.
- `schemas/docguard-agent-context-benchmark.schema.json` and
  `schemas/docguard-agent-context-result.schema.json` accept the v2 protocol
  id beside v1.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18; Python 3 for the
optional Python tier
**Primary Dependencies**: none new
**Storage**: `.docguard/context-pack.md` (existing); benchmark results JSON
**Testing**: `node:test` for the scanner, ranking and manifest loading; the
model matrix is run by hand with a new `--manifest` option (today `run.mjs`
accepts only `--run`, `--out`, `--concurrency` and `--codex`)
**Performance Goals**: ≤10% added `memory --pack` wall time (SC-002)
**Constraints**: deterministic output; the v1 protocol, fixtures and results
are read-only

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. No tokenizer; bytes stand in for tokens. |
| IV (validator isolation) | The symbol scanner imports the graph from a scanner, never from the Architecture validator. |
| V (no prose) | The section lists file paths and symbol names from the parser. It describes nothing. |
| VI (safe writes) | The pack is still written with `safeWrite`. |
| VIII (local-first) | The pack is built offline. Only the maintainer's benchmark run uses a model, as in v1. |
| IX (honest assurance) | Degraded tiers are named in the section. The ship decision is computed from a frozen rule, and a "not promoted" result is recorded, not dropped. |

Pass.

## Project Structure

```text
cli/scanners/js-ast.mjs                 # extractExportedSymbols (moved from as-built.mjs)
cli/scanners/as-built.mjs               # import it
cli/scanners/py-ast.mjs                 # PY_EXTRACTOR symbols
cli/scanners/import-graph.mjs           # from docguard.code-derived-diagrams (or moved here)
cli/scanners/symbol-map.mjs             # NEW: PageRank, symbols, budgeted rendering
cli/commands/memory.mjs                 # --symbols section in runMemoryPack
cli/docguard.mjs                        # --symbols flag, help
cli/config.mjs, schemas/docguard-config.schema.json   # memory.symbolMap.maxBytes
benchmarks/agent-context/manifest-v2.json             # NEW, frozen before runs
benchmarks/agent-context/run.mjs        # protocol dispatch, context-pack-symbols, decideSymbolPromotion
benchmarks/agent-context/fixtures/, hidden/, reference/   # three navigation-bound tasks
benchmarks/agent-context/results/observed-v2.json     # NEW, after the run
benchmarks/agent-context/results/README.md            # v2 decision
schemas/docguard-agent-context-benchmark.schema.json, schemas/docguard-agent-context-result.schema.json
README.md, docs/commands.md, docs/configuration.md, docs/ai-integration.md
tests/symbol-map.test.mjs               # NEW
tests/agent-context-benchmark.test.mjs  # v2 manifest freezing, v1 unchanged, promotion rule
testguard.claims.json                   # SYMBOL-MAP-IS-BUDGETED-AND-GATED
```

## Design notes

- PageRank runs on the file graph, including edges into files that are then
  excluded from display, so a hub's rank does not depend on the exclusion
  list. Only display is filtered.
- `kind` is kept in the data but not printed by default. Functions get `()`
  after the name; that is the only kind marker, to save bytes.
- A navigation-bound fixture must fail its hidden evaluator before the change
  and pass with the reference, like v1's `verifyFixtures` checks.
