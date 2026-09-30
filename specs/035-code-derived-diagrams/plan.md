# Implementation Plan: Code-Derived Diagrams

**Branch**: `feat/code-derived-diagrams` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

- `buildImportGraph` and its private helpers (`getFilesRecursive`,
  `extractImports`, `resolveImport`, `addPythonImportGraph`, `posixPath`) move
  from `cli/validators/architecture.mjs` to a new scanner,
  `cli/scanners/import-graph.mjs`. The validator re-exports `buildImportGraph`
  for compatibility; `cli/commands/impact.mjs` imports the scanner. The scanner
  adds a per-process cache keyed by project directory, config key and tree
  state, so guard builds the graph once (FR-008).
- A new scanner, `cli/scanners/module-diagram.mjs`, turns the graph into
  mermaid: group files into modules at a depth, aggregate edges, reduce to the
  node and edge caps, render with path-derived ids and a caption.
- `cli/scanners/memory-plan.mjs` adds the `module-graph` section to the
  ARCHITECTURE plan and the `entity-diagram` section to the DATA-MODEL plan
  (`generateERDiagram` with sorted input). Each section carries a
  `completeness` flag. `_DISK_CACHE_VERSION` moves from `'2'` to `'3'`, and
  `_validCachedPlan` accepts the flag.
- `cli/validators/generated-staleness.mjs` reports a `partial` check instead
  of GST002 when the section is incomplete. `cli/commands/sync.mjs` skips an
  incomplete section unless `--allow-partial`.
- `cli/shared-sync-scope.mjs` adds matchers for the two ids.
- Plan building calls the graph only when the ARCHITECTURE doc has a
  `module-graph` marker or does not exist yet (so `generate --plan --write`
  would create it). The same rule plans `entity-diagram` for DATA-MODEL. An
  existing doc without the marker never gains the section.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Storage**: canonical docs, through the existing section writer
**Testing**: `node:test` fixtures; a synthetic 500-module tree built in a temp
directory (SC-002)
**Performance Goals**: ≤3% guard wall time (SC-003); 500 modules under 1 s
**Constraints**: byte-identical output across platforms; no network

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. No mermaid library; the output grammar is ours and tested. |
| IV (validator isolation) | The graph moves to a scanner, which removes today's reason for a scanner to reach into a validator. |
| V (no prose) | Only `source=code` sections are written, by `sync`, as today. The hand-drawn diagram is untouched. |
| VI (safe writes) | `sync --write` keeps its authorize-then-`safeWrite` flow. |
| VIII (local-first) | No network; Python parsing uses the local interpreter or reports `partial`. |
| IX (honest assurance) | A partial graph is reported as partial, never as current or stale. Reductions are captioned. |

Pass.

## Project Structure

```text
cli/scanners/import-graph.mjs          # NEW: moved buildImportGraph + helpers, per-run cache
cli/scanners/module-diagram.mjs        # NEW: grouping, caps, mermaid rendering, caption
cli/validators/architecture.mjs        # import and re-export from the scanner
cli/commands/impact.mjs                # import from the scanner
cli/scanners/memory-plan.mjs           # module-graph and entity-diagram sections; cache version 3
cli/scanners/schemas.mjs               # generateERDiagram sorts entities and relationships
cli/validators/generated-staleness.mjs # partial instead of GST002 for incomplete sections
cli/commands/sync.mjs                  # skip incomplete sections without --force
cli/shared-sync-scope.mjs              # matchers for module-graph, entity-diagram
schemas/docguard-config.schema.json    # diagrams.moduleGraph.{depth,maxNodes,include}; defaults live in module-diagram.mjs
docs-canonical/ARCHITECTURE.md         # module-graph section (FR-010)
docs/doc-sections.md, docs/configuration.md, README.md
tests/code-derived-diagrams.test.mjs   # NEW
tests/architecture.test.mjs, tests/impact.test.mjs   # unchanged output after the move
testguard.claims.json                  # MODULE-GRAPH-DRIFT-IS-DETECTED
```

## Design notes

- Grouping uses the first `depth` path segments of the file's directory. A
  file shallower than `depth` belongs to its own directory, so `cli/docguard.mjs`
  maps to `cli`.
- Degree for merging counts distinct neighbour modules, not import lines, so
  one busy file does not keep a module alive.
- `SECTION_FILE_MATCHERS` is keyed by the plan's real section ids since
  `docguard.sync-section-scope`, and a test keeps the two sets equal, so the
  two new ids get matchers there.
- The graph cache is per process and validated on every call by each walked
  file's path, size, inode and times (a few milliseconds here, against
  150–300 ms for a build), so a long-lived MCP server never serves a stale
  graph.
- The diagram draws product files only: `isNonProductPath` drops tests,
  fixtures and examples. Only limitations on drawn files make it partial.
