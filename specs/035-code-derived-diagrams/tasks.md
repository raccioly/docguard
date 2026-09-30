# Tasks: Code-Derived Diagrams

**Status**: Complete. SC-001, SC-002 and SC-004 hold in tests; SC-003 measured +0.7% guard time on this repository (target ≤3%).
**Spec**: `specs/035-code-derived-diagrams/spec.md`
**Plan**: `specs/035-code-derived-diagrams/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/code-derived-diagrams.test.mjs`: four-directory fixture with the expected diagram byte for byte; cross-module vs same-module import (SC-001); dashed dynamic edge; grouping, merging and caption (User Story 2); 500-module synthetic tree (SC-002); Python hidden → `partial`, file unchanged (SC-004); entity diagram order; pinned section untouched.
- [x] T002 Pin current output across the move: the existing architecture, impact and Python import-graph suites pass unchanged before and after it (25/25), and `tests/code-derived-diagrams.test.mjs` pins the re-export (FR-001).

## Phase 2: Scanners

- [x] T003 `cli/scanners/import-graph.mjs`, `cli/validators/architecture.mjs`, `cli/commands/impact.mjs`: move the builder, re-export, per-run cache (FR-001, FR-008).
- [x] T004 `cli/scanners/module-diagram.mjs`: grouping, caps, rendering, caption (FR-002, FR-003, FR-004).
- [x] T005 `cli/scanners/schemas.mjs`: sorted `generateERDiagram` input (FR-005).

## Phase 3: Sections, drift and sync

- [x] T006 `cli/scanners/memory-plan.mjs`: `module-graph`, `entity-diagram`, `completeness`, cache version 3 (FR-002, FR-005); `tests/plan-disk-cache.test.mjs` expects version 3.
- [x] T007 `cli/validators/generated-staleness.mjs`, `cli/commands/sync.mjs`, `cli/docguard.mjs`, `cli/shared-sync-scope.mjs`: GST002 or `partial`, `--allow-partial`, `--since` matchers (FR-006, FR-007, FR-009).
- [x] T008 `schemas/docguard-config.schema.json`: `diagrams.moduleGraph` options (`depth`, `maxNodes`, `include`). Defaults and bounds live in `cli/scanners/module-diagram.mjs` (`moduleGraphOptions`), so `cli/config.mjs` is unchanged.

## Phase 4: Adoption and docs

- [x] T009 `docs-canonical/ARCHITECTURE.md`: add the `module-graph` section and run `sync --write` (FR-010).
- [x] T010 `docs/doc-sections.md`, `docs/configuration.md`, `README.md`, `docs-canonical/ARCHITECTURE.md` component map (FR-011).

## Phase 5: Verification

- [x] T011 `testguard.claims.json`: claim MODULE-GRAPH-DRIFT-IS-DETECTED; probe `--confirm 3 --serial`; gate.
- [x] T012 Non-regression budgets (`docguard.non-regression-budgets`): guard A/B time ≤3% (SC-003); no new error-severity self-findings; `memory --pack` and `agent --task` bytes unchanged (the diagram lives in docs, not in the pack); precision benchmark PASS; `npm test`; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
