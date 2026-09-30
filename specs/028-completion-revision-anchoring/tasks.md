# Tasks: Completion Revision Anchoring

**Status**: Complete. SC-003 is demonstrated by the completion commit made from `main`'s tip after this merged: it re-anchors the dangling specs and verifies specs 014–029 at one revision on `main`.
**Spec**: `specs/028-completion-revision-anchoring/spec.md`
**Plan**: `specs/028-completion-revision-anchoring/plan.md`

## Phase 1: Tests

- [x] T001 `tests/completion-revision-anchoring.test.mjs`: batch completion (SC-001), a non-lifecycle change still blocks, SPR008 on a simulated squash merge (SC-002), shallow → partial, reanchor search/refusal/attested, and the warning.

## Phase 2: Implementation

- [x] T002 `cli/writers/spec-outcomes.mjs`, `cli/commands/specs.mjs`: lifecycle-only dirtiness (FR-001) and the warning (FR-004).
- [x] T003 `cli/scanners/revision-anchor.mjs`, `cli/validators/spec-registry.mjs`, `cli/findings.mjs`: SPR008 (FR-002).
- [x] T004 `cli/commands/specs.mjs`, `cli/docguard.mjs`, `schemas/docguard-specs.schema.json`: `specs reanchor` (FR-003).

## Phase 3: Docs, adoption and verification

- [x] T005 `docs/commands.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/CI-RECIPES.md`, `CHANGELOG.md` (FR-005).
- [x] T006 `testguard.claims.json`; probe; gate; `npm test`; `npm run llms`; stage, then `docguard specs --write`.
