# Tasks: JS/TS Import Edges from the Syntax Tree

**Spec**: `specs/076-js-import-edges/spec.md`
**Plan**: `specs/076-js-import-edges/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/js-import-edges.test.mjs`: at the tree tier and the fallback, multi-line named imports, `import type` on one line and over several, default plus named, namespace, side-effect, the re-export forms, `require()`, TypeScript `import = require()`, `import()` (FR-001, FR-003); comments, strings and template literals are not edges, a JSDoc `import()` is a dynamic edge (FR-001, FR-002); a clause never crosses a statement at the fallback (FR-003); the bound names, including a comment inside a multi-line clause, unknown forms and side-effect imports (FR-004); run it and see each fail
- [x] T002 [P] Same file: graph-level cases. A cycle through a multi-line import is ARC002 and one through `import()` is not; a multi-line import crossing a declared layer is ARC003 and one crossing configured `layers` is ARC001 (FR-002, FR-005); a multi-line import draws its module edge and is a reverse-import ancestor for `diff --since` (US2); edges carry `tier`, findings carry `parserTier`, and the two fallback causes make Architecture partial and only the parser-unavailable one makes the diagram partial (FR-008)

## Phase 2: Implementation

- [x] T003 FR-001, FR-002, FR-004: `cli/scanners/import-graph.mjs` `importsFromSyntaxTree` and `readImports`
- [x] T004 FR-003: `extractImportsFromText` (newline-spanning clause bounded by `;` and quotes, re-exports)
- [x] T005 FR-005, FR-008: `buildUncached` uses `readImports`, records `tier` on edges and the two limitations; `extractImports(content, filename)`; `cli/validators/architecture.mjs` passes the file name, labels the limitations and sets `parserTier`; `cli/scanners/module-diagram.mjs` treats `js-parser-unavailable` as partial

## Phase 3: Docs and verification

- [x] T006 FR-007: `docs-canonical/ARCHITECTURE.md`, `docs/reference/languages.md`, `docs-canonical/TEST-SPEC.md`; `npm run llms`
- [x] T007 FR-006, SC-002, SC-003: count script before and after; `docguard guard` before and after; module-graph section diff; CHANGELOG `### Fixed`
- [x] T008 [P] TestGuard claim `JS-IMPORT-EDGES` in `testguard.claims.json` with `req:docguard.js-import-edges#FR-00n` sources; probe it with `--confirm 3 --serial`
- [x] T009 Verification gates: the non-regression budget A/B against the base commit's worktree; the precision benchmark against its committed baseline; re-accept the anchors of the files this spec touched; refresh the spec registry; guard; the full suite

## Verification

- **SC-001.** `tests/js-import-edges.test.mjs` (28 tests). Before the change the file failed to load (`readImports` and `extractImportsFromText` did not exist); the per-requirement faults of TestGuard claim `JS-IMPORT-EDGES` show each test discriminates (T008).
- **SC-002.** Graph A/B on the code at c9934dd, base CLI against head CLI:
  - 1,382 → 1,441 edges: 61 gained (15 in `cli/`, 29 in `tests/`, 17 re-exports in `benchmarks/agent-context/fixtures/ledger-service`), 2 lost (`cli/feedback-fixture.mjs` → `cli/commands/guard.mjs` and → itself, both from test-file source in a template literal);
  - in `cli/`: 13 multi-line imports that resolve to project files (the other 3 import `node:fs`) and 2 re-exports.
- **SC-003.** `docguard guard` before (c9934dd) and after: no Architecture finding either way (Architecture stays `partial` for the existing `python-path-mutation` limitation), and the module-graph section of `docs-canonical/ARCHITECTURE.md` renders byte-identical, so GST002 stays clean. Recorded in the CHANGELOG under `### Fixed`.
- **Adopters.** The same graph A/B on twelve local projects with a `.docguard.json`: edges gained in ten (up to 339), lost only in one (10: seven self-edges from usage examples in doc comments, three dynamic edges from a commented-out block), no new or removed Architecture finding, no applicability change, no parse-failure limitation; two module diagrams change, and neither project has a committed `module-graph` section.
- **Budgets.** `npm run budget -- --base <c9934dd worktree>`: PASS on every metric. Guard on this repository 15,736 → 14,621 ms (median, interleaved); fixtures +25 ms and +61 ms against a 150 ms floor; no new error finding; agent-facing bytes within ±1 byte except `llms-full.txt` (+1,436, the doc changes); package +3,231 bytes; dependencies unchanged.
- **Benchmark.** `node benchmarks/run.mjs --baseline benchmarks/baseline.json`: core PASS, no regressions.
- **Suite.** `npm test`: 3,779 tests, all passing except the anchors-review test before the suspect links were re-accepted; re-run after acceptance below.
