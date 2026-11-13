# Tasks: Close a Spec in One Commit

**Spec**: `specs/101-completion-one-commit/spec.md`
**Plan**: `specs/101-completion-one-commit/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/spec-completion-one-commit.test.mjs`: the adopter scenario with no hand edit (FR-001 to FR-004, SC-001), squash and rebase (FR-005 to FR-007, SC-002), changed evidence, a later edit on `main`, tick plus another change, flag validation, old records, SPR010, 0.48.0 in both directions (FR-010, FR-011). Run on `main` and record which fail.

## Phase 2: Implementation

- [ ] T002 FR-001: tick-only `tasks.md` in `nonLifecycleChanges`; callers in `planSpecCompletion` and `reanchorSpec`.
- [ ] T003 FR-002 to FR-004: `--canonical-doc` and `--persistence` on `complete` and `approve`; flag parsing; help; SPC005 text.
- [ ] T004 FR-005: outcome line `Blobs:` carrier (`readOutcomeBlobs`, `writeOutcomeBlobs`); `completeSpec` records it.
- [ ] T005 FR-006, FR-007, FR-009: `locateContentAnchor`, the cache, SPR008, `reviewBaseline`, the default `--since`.
- [ ] T006 FR-008, FR-012: `reanchor` backfill; the squash warning.
- [ ] T007 FR-011: `unrecordedCompletions`, SPR010 and its finding entry, `specs --check`.
- [ ] T008 FR-013, FR-004: `AGENTS.md`, `CONTRIBUTING.md`, `docs/commands.md`, `CI-RECIPES.md`, `DATA-MODEL.md`, schema, `CHANGELOG.md`; dated amendment notes in specs 028, 040 and 083.

## Phase 3: Verification

- [ ] T009 SPR010 measured on this repository and the other repositories with a registry.
- [ ] T010 `npm test`, the CI lint, `guard`, the benchmark baseline.
- [ ] T011 Complete this spec with the new flow (flags, one commit, no hand edit) and simulate the squash merge in a scratch clone (SC-003).
