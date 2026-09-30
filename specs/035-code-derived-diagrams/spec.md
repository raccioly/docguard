# Feature Specification: Code-Derived Diagrams

**Feature Branch**: `feat/code-derived-diagrams`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.code-derived-diagrams`

**Lineage**: #455 follow-up, from research into OpenHands, DeepWiki/Devin, Aider
and Cursor (ADAPT, size M). DeepWiki draws architecture diagrams with an LLM
and regenerates them about weekly. This spec draws them from the import graph
of `docguard.language-repository-coverage` (FR-002–FR-005) and keeps them in
`source=code` sections, so the existing Generated-Staleness check (GST002) and
`sync` cover them.

**Input**: User description: "Generate mermaid module and dependency diagrams
from the import graph inside `source=code` sections. Drift is a regenerated
diagram that differs from the committed one; `sync` refreshes it; the node
count is bounded."

## Problem

Architecture diagrams are the part of a doc that goes stale first, and nothing
tells anyone:

- `generate` writes ARCHITECTURE diagrams from a fixed template
  (`generateArchitecture` in `cli/writers/doc-generators.mjs`): Client → API →
  Services → Database, whatever the project is. They are placeholders.
- This repository's own "Layer graph" in `docs-canonical/ARCHITECTURE.md`
  shows the entry point, shared constants, commands and validators. It has no
  scanners, writers or evidence layer, although the table above it lists all
  three.
- The only diagram check is Canonical-Sync's CSY004. It compares two numbers
  in README's mermaid block ("Commands (N)", "Validators (N)") for DocGuard's
  own repository. It does not look at edges.

The facts are already computed. `buildImportGraph`
(`cli/validators/architecture.mjs`) builds the static JS/TS and Python import
graph for the Architecture validator and for `impact`. The DATA-MODEL
generator already turns schema scans into an `erDiagram`
(`generateERDiagram` in `cli/scanners/schemas.mjs`), but only once, at
`generate` time, so it drifts too.

`buildImportGraph` lives in a validator. A scanner such as the memory plan
cannot import it without breaking validator isolation (Constitution IV).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A module diagram that stays true (Priority: P1)

A maintainer adds an empty
`<!-- docguard:section id=module-graph source=code -->` block to
`ARCHITECTURE.md` and runs `docguard sync --write`. The block now holds a
mermaid graph of the project's modules and their static imports. When a new
import crosses modules, guard reports the section stale (GST002) and
`sync --write` updates it.

**Independent Test**: A fixture with four directories and known imports.
`sync --write` produces the expected graph byte for byte. Adding one
cross-directory import makes GST002 fire; `sync --write` clears it. Adding an
import inside one directory changes nothing.

**Acceptance Scenarios**:

1. **Given** an empty `module-graph` section, **When** `sync --write` runs,
   **Then** the section holds a mermaid `graph LR` with one node per module
   and one edge per module pair with at least one static import.
2. **Given** a committed diagram and unchanged imports, **Then** guard reports
   nothing for it, and `sync` reports it current.
3. **Given** a new import between two modules, **Then** GST002 names the doc
   and the `module-graph` section.
4. **Given** an import that exists only as a dynamic `import()`, **Then** the
   edge is drawn dashed.
5. **Given** a project without a `module-graph` marker, **Then** no graph is
   built for this purpose and nothing is written.

### User Story 2 - Large projects stay readable (Priority: P1)

1. **Given** more modules than the node limit (default 30), **When** the
   diagram is generated, **Then** modules are grouped one directory level
   higher until they fit.
2. **Given** that the top level alone exceeds the limit, **Then** the modules
   with the most edges are kept and the rest are merged into one node that
   says how many it holds.
3. **Given** any truncation, **Then** a caption line under the diagram says
   what was grouped or merged.

### User Story 3 - An entity diagram that stays true (Priority: P2)

1. **Given** an `entity-diagram` section in `DATA-MODEL.md`, **When**
   `sync --write` runs, **Then** it holds the `erDiagram` built from the same
   schema scan as the `entities` table, with entities and relationships in a
   fixed order.
2. **Given** a new field or relationship, **Then** GST002 fires and `sync`
   refreshes it.

### User Story 4 - This repository shows its real layers (Priority: P2)

`docs-canonical/ARCHITECTURE.md` gains a `module-graph` section. It shows
`cli/commands`, `cli/validators`, `cli/scanners`, `cli/writers`,
`cli/evidence` and the shared modules, with their real edges.

### Edge Cases

- Python edges need `python3`. When it is missing, the graph cannot be
  complete. Guard reports the section as `partial` and does not raise GST002
  for it, so a runner without Python does not flip the result. `sync` refuses
  to rewrite the section from a partial graph unless `--allow-partial` is
  given. (`--force` already means "sync docs not marked generated", which
  this repository passes routinely, so it must not also accept a partial
  graph.)
- Node ids are derived from module paths (`cli/commands` → `m_cli_commands`),
  not from positions. Adding a module adds lines; it does not renumber the
  diagram. Paths that sanitize to the same id each take a suffix from their
  own path.
- A module name with characters mermaid treats specially is quoted in the
  node label.
- Files under test, fixture, generated and ignored paths are not modules
  (`isNonProductPath`, `.docguardignore`, `config.ignore`).
- An import that leaves the project, or resolves to nothing, is not an edge.
- A pinned section (`pinned` attribute) is never rewritten, as today.
- Self-edges (imports within one module) are not drawn.
- The edge list is capped at 150. Over the cap, edges that touch the merged
  node are dropped first, then edges in reverse path order. The caption says
  how many were left out.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The import graph builder MUST move from the Architecture
  validator to a scanner. The validator and `impact` MUST import it from
  there, and their output MUST not change.
- **FR-002**: The memory plan MUST offer a `module-graph` code section for
  ARCHITECTURE: a mermaid `graph LR` whose nodes are modules (directories at
  a configured depth, default 2) and whose edges are aggregated static
  imports, with dynamic-only edges dashed.
- **FR-003**: Output MUST be deterministic: nodes and edges sorted by path,
  ids derived from paths, POSIX separators, and no timestamps or counts that
  change without a graph change. Two runs on the same tree MUST be
  byte-identical on Linux, macOS and Windows.
- **FR-004**: The diagram MUST respect `diagrams.moduleGraph.maxNodes`
  (default 30, hard cap 60) and draw only the directories in
  `diagrams.moduleGraph.include` when it is set, by grouping to shallower depths, then by merging
  the lowest-degree modules into one counted node. Edges MUST be capped at
  150. Every reduction MUST be stated in a caption line.
- **FR-005**: The memory plan MUST offer an `entity-diagram` code section for
  DATA-MODEL, built by `generateERDiagram` from the entity scan, with entities
  and relationships sorted.
- **FR-006**: Drift MUST be reported by the existing GST002 finding, and
  `sync --write` MUST refresh both sections through the existing section
  writer. No new finding code is added.
- **FR-007**: When the graph is partial (Python interpreter unavailable, a
  Python file that cannot be parsed, or an unreadable source file), guard MUST
  report the section's check as `partial` instead of GST002, and
  `sync --write` MUST NOT rewrite it without `--allow-partial`. Gaps that come
  from the code itself (a dynamic Python import, a `sys.path` change) draw the
  same on every machine, so they are captioned, not partial.
- **FR-008**: The import graph MUST be built at most once per guard run and
  only when a canonical doc contains a `module-graph` marker, the doc is about
  to be created by `generate --plan --write`, or the Architecture validator
  needs it.
- **FR-009**: `sync --since` MUST map `module-graph` to code-file changes and
  `entity-diagram` to model and schema changes.
- **FR-010**: This repository MUST add a `module-graph` section to
  `docs-canonical/ARCHITECTURE.md`. The hand-drawn "Layer graph" stays; it is
  human-owned.
- **FR-011**: `docs/doc-sections.md`, `docs/configuration.md`, README and
  ARCHITECTURE MUST document the two section ids and the options.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the fixture, one cross-module import yields exactly one
  GST002; one same-module import yields none.
- **SC-002**: A synthetic tree of 500 modules produces a diagram with at most
  60 nodes and 150 edges, in under 1 second.
- **SC-003**: Guard's wall time on this repository grows by 3% or less after
  adoption (median of 5 A/B runs).
- **SC-004**: With the Python interpreter hidden, guard on a mixed JS/Python
  fixture reports `partial`, not GST002, and `sync --write` leaves the file
  unchanged.

## Assumptions

- Directory-level modules are the useful unit. File-level graphs of real
  projects are too large to read.
- The diagram shows imports, not intent. Layer rules stay in the Architecture
  validator's `layers` config and in the prose.
- Mermaid rendering is the reader's tool (GitHub renders it). DocGuard does
  not render or validate mermaid beyond its own output grammar.

## Out of Scope

- Call graphs, sequence diagrams or C4 diagrams inferred from code.
- Replacing hand-drawn diagrams or README's diagram (CSY004 stays).
- Colouring edges that break configured layers. That can follow once the
  graph is in a scanner.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `dfa1385749b66184c93bf65f5dde127192037711` — Reviewed at dfa1385 on main: all 12 tasks are checked and were delivered by #474, #480; the full suite (2368 tests) passes and guard reports 0 errors at this revision. Deviations from the plan are recorded in the task notes. Evidence: `cli/commands/sync.mjs`, `cli/scanners/import-graph.mjs`, `cli/scanners/memory-plan.mjs`, `cli/scanners/module-diagram.mjs`, `cli/shared-sync-scope.mjs`, `cli/validators/generated-staleness.mjs`, `docs-canonical/ARCHITECTURE.md`, `tests/code-derived-diagrams.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
