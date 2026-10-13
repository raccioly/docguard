# Tasks: Completion Revision Anchoring

**Status**: Complete. SC-005 is demonstrated by this spec's maintenance completion on `main` after FR-008–FR-010 merge. SC-003 is demonstrated by the completion commit made from `main`'s tip after this merged: it re-anchors the dangling specs and verifies specs 014–029 at one revision on `main`.
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

## Phase 4: Canonical completion outcomes (FR-007)

- [x] T007 `tests/completion-revision-anchoring.test.mjs`: deviations in reverse order complete and are recorded sorted; whitespace-only duplicates collapse and the outcome line follows the registry order; the bound of 20 counts distinct deviations; evidence whose code-unit and projection orders differ completes and the plan shows the recorded order; re-anchoring keeps the recorded deviations. Written first; four failed with the rollback and one on the plan's order.
- [x] T008 `cli/scanners/spec-registry.mjs`, `cli/commands/specs.mjs`, `cli/writers/spec-outcomes.mjs`: one canonical outcome form, used by the projection and by completion (FR-007).
- [x] T009 `docs-canonical/DATA-MODEL.md`, `docs/commands.md`, `CHANGELOG.md`, `testguard.claims.json`; `npm test`; `docguard guard`; `docguard specs --write`.

## Phase 5: Ranges past the diff budget (FR-008–FR-010)

- [x] T010 `tests/completion-revision-anchoring.test.mjs`, `tests/shared-git.test.mjs`: a fixture whose recorded range exceeds a small test budget reconciles completely in batches and completes; a rename stays paired across batches; one file over the budget blocks without `--since` and records `narrowedFrom` with it; a newer `--since` over a reconcilable range, an unrelated `--since` and an unresolvable recorded revision block; an older `--since` widens. Written first.
- [x] T011 `cli/shared-git.mjs`, `cli/scanners/reconciliation.mjs`: batched patch reading with per-file facts (FR-008).
- [x] T012 `cli/commands/specs.mjs`, `cli/scanners/spec-registry.mjs`, `cli/writers/spec-outcomes.mjs`, `schemas/docguard-specs.schema.json`: the `--since` rule and `narrowedFrom` (FR-009).
- [x] T013 `cli/docguard.mjs`, `docs/commands.md`, `docs-canonical/DATA-MODEL.md`, `CHANGELOG.md`, `testguard.claims.json`; `npm test`; `npm run llms`; `docguard guard`; `docguard specs --write`; anchors reviewed (FR-010).
