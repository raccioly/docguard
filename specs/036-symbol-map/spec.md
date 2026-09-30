# Feature Specification: Symbol Map in the Context Pack

**Feature Branch**: `feat/symbol-map`

**Created**: 2026-09-29

**Status**: Draft

**Spec ID**: `docguard.symbol-map`

**Lineage**: #455 follow-up, from research into OpenHands, DeepWiki/Devin, Aider
and Cursor (ADAPT, size M–L, benchmark-gated). Adapts Aider's repo map (symbols
ranked by PageRank over the file graph, cut to a token budget) to
`memory --pack`. Gated by a new, predeclared protocol of the agent-context
benchmark from `docguard.task-specific-agent-context` (FR-011–FR-015). Uses the
import-graph scanner from `docguard.code-derived-diagrams` (FR-001). Measured
by `docguard.non-regression-budgets`.

**Input**: User description: "Add a token-budgeted symbol section to
`memory --pack`, built from the existing AST scanners and ranked
deterministically. Ship it only if the agent-context benchmark shows no
regression."

## Problem

`memory --pack` (`runMemoryPack` in `cli/commands/memory.mjs`) gives an agent
the guard status, provenance, counts of modules, endpoints, entities and env
vars, the canonical doc list and the rules from `AGENTS.md`. It names no code.
An agent that must find where a behavior lives starts by listing and grepping
files.

Aider's answer is a repo map: the most-referenced files and their top-level
symbols, cut to a budget (1k tokens by default). RepoGraph (arXiv 2410.14684)
reports a gain of 2 to 2.7 points on SWE-bench from repository-level graph
context. The evidence is not one-sided. A 2026 ETH study (arXiv 2602.11988)
found that repository overviews can raise cost without raising task success.

DocGuard has its own evidence that more context is not free. In the frozen v1
agent-context benchmark (`benchmarks/agent-context/results/README.md`), the
context pack used fewer uncached input tokens than the targeted packet, while
the targeted packet used fewer steps and less time. Each condition won on a
different measure. A symbol map adds bytes to every session that loads the
pack. It must earn them on a benchmark that could show it failing.

The v1 protocol cannot be that benchmark. `loadManifest`
(`benchmarks/agent-context/run.mjs`) freezes its three conditions and three
tasks, and its results README says later claims need a new, predeclared
protocol. Its fixtures have one to three source files each, where a map of
symbols has nothing to point at.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The pack names the code that matters most (Priority: P1)

An agent loads `.docguard/context-pack.md` generated with `--symbols`. A
"Symbol map" section lists the most central source files and their top-level
exported symbols, within a fixed byte budget.

**Independent Test**: A fixture with one hub module imported by five others
and eight leaf modules. The hub is listed first, each file shows its exported
names, and the section fits its budget.

**Acceptance Scenarios**:

1. **Given** `memory --pack --symbols`, **When** it runs, **Then** the pack
   has a `## Symbol map` section with one line per file, in rank order, each
   naming the file and its exported or top-level symbols.
2. **Given** the budget is reached, **Then** the section stops at a whole
   line and states how many ranked files were left out.
3. **Given** a JS/TS file the AST tier cannot parse, or Python without an
   interpreter, **Then** the file is listed without symbols and the section
   names the degraded tier.
4. **Given** the same tree, **Then** repeated runs produce a byte-identical
   section.

### User Story 2 - The decision to ship is made by a benchmark (Priority: P1)

Before the section becomes part of the default pack, the maintainer freezes a
v2 protocol that compares the pack with and without the symbol map, runs it,
and records the result. The analysis code applies the predeclared rule.

**Acceptance Scenarios**:

1. **Given** the v2 manifest is committed and frozen, **When** its conditions,
   tasks, thresholds or seed change afterward, **Then** `loadManifest` rejects
   it.
2. **Given** the results, **When** the symbol map meets the promotion rule
   (FR-008), **Then** the section may be enabled by default in the same PR
   that records the result.
3. **Given** results that are non-inferior but show no predeclared benefit,
   **Then** the section stays behind `--symbols`.
4. **Given** results that show a regression, **Then** the feature is not
   released, and the spec's outcome records "not promoted" with the numbers.

### User Story 3 - The benchmark can see a benefit if there is one (Priority: P2)

1. **Given** the v2 tasks, **Then** at least three are navigation-bound: the
   fixture has 25 or more modules, and the prompt names a requirement, not the
   file to change.
2. **Given** v1's three small fixtures are included, **Then** harm on small
   projects is measured too.

### Edge Cases

- A file with more than 12 symbols lists the first 12 in source order and
  `+N more`.
- Tests, fixtures, generated, vendored and ignored files are never ranked.
- A project with no import edges falls back to ranking by the number of
  exported symbols, then path. The section says so.
- A cycle in the import graph does not affect termination. The ranking runs a
  fixed number of iterations.
- The pack's timestamp line already differs per run. The benchmark's
  `normalizePack` strips it, and the symbol section adds no other
  time-dependent text.
- The section is text for an agent to read. It claims nothing about what the
  symbols do.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DocGuard MUST extract top-level symbols per source file from the
  existing parsers: exported names for JS/TS through `parseJsTs`, and
  top-level `def`/`class` names (or `__all__` when present) for Python through
  the interpreter's `ast`. Other languages and parse failures MUST be listed
  without symbols and reported as a degraded tier.
- **FR-002**: Files MUST be ranked deterministically by PageRank over the
  file-level static import graph: damping 0.85, 30 iterations, uniform
  teleport, dangling mass spread uniformly, scores rounded to 9 decimals,
  ties broken by path.
- **FR-003**: The section MUST fit `memory.symbolMap.maxBytes` (default 4096,
  hard cap 16384), stop at a whole line, and report the number of files left
  out.
- **FR-004**: `memory --pack --symbols` MUST add the section. Without the
  flag, `memory --pack` output MUST be byte-identical to today's, apart from
  the timestamp, until FR-008 promotes the section.
- **FR-005**: A v2 agent-context protocol MUST be committed and frozen before
  any v2 model run: `protocol.id` `docguard-agent-context-v2`, conditions
  `task-only`, `context-pack` and `context-pack-symbols`, at least three
  repetitions, the v1 harness and model unless the maintainer records a
  reason, and at least six tasks (User Story 3). The v1 manifest, results and
  thresholds MUST NOT change.
- **FR-006**: `benchmarks/agent-context/run.mjs` MUST load either protocol
  with its own frozen assertions, and build the `context-pack-symbols` prompt
  from `memory --pack --stdout --symbols`.
- **FR-007**: v2 observations MUST be recorded in
  `benchmarks/agent-context/results/observed-v2.json` under the result schema,
  with every run kept, and summarized in the results README.
- **FR-008**: The promotion rule MUST be fixed in the v2 manifest and applied
  by the analysis code, comparing `context-pack-symbols` with `context-pack`:
  - **no regression**: at most one additional failed trial, zero additional
    requirement violations, zero additional unnecessary edits, and median
    uncached input tokens and median steps each no more than 5% higher;
  - **benefit**: more successful trials, or a median reduction of at least
    15% in steps or in latency on the navigation-bound tasks.

  Default-on requires both. `--symbols` stays available only with no
  regression. A regression means the feature is not released.
- **FR-009**: Turning the section on by default MUST be recorded as a
  `Budget-Exempt: memory-pack-bytes — <v2 result>` in its PR, because it
  exceeds the agent-facing byte budget of `docguard.non-regression-budgets`.
- **FR-010**: README, `docs/commands.md`, `docs/configuration.md`,
  `docs/ai-integration.md` and the benchmark README MUST document the flag,
  the budget and the v2 decision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the User Story 1 fixture, the hub module ranks first, and the
  section is byte-identical across three runs.
- **SC-002**: On this repository, the section is within its budget and adds
  no more than 10% to `memory --pack` wall time.
- **SC-003**: Without `--symbols`, the pack is byte-identical to the current
  release's, apart from the timestamp.
- **SC-004**: All v2 trials complete, and the recorded promotion decision is
  the one FR-008 computes from them, with no manual override.

## Assumptions

- Bytes stand in for tokens. DocGuard has no tokenizer and adds none; about
  4 bytes per token puts the default near Aider's 1k tokens.
- Running the model matrix needs the maintainer's own agent CLI, account and
  network. It is development tooling, like the v1 run. DocGuard's
  deterministic core stays offline (Constitution VIII).
- Symbol names, not signatures. Signatures cost more bytes; they can be a
  later protocol's condition.

## Out of Scope

- Adding symbols to `agent --task` packets or to MCP responses.
- Ranking by git churn, tests or doc mentions. One ranking is tested at a
  time.
- Any change to the v1 protocol or its recorded result.
