# Tasks: Document Lifecycle and Reconciliation

**Status**: Verified; living specification maintenance continues
**Spec**: `specs/006-document-lifecycle/spec.md`

## Phase 1: Safe retirement

- [x] T001 Define lifecycle dimensions, recovery manifest, and fail-closed boundaries.
- [x] T002 Add read-only candidate planning and JSON output.
- [x] T003 Add `--check` exit semantics.
- [x] T004 Add explicit repeatable-path archival with reason and replacement metadata.
- [x] T005 Reject dirty, untracked, required, protected, symlinked, and out-of-root paths.
- [x] T006 Add focused disposable-repository tests.
- [x] T007 Retire DocGuard's superseded specs and planning documents with the command.
- [x] T008 Update current README, architecture, test policy, agent guidance, and generated indexes.
- [x] T009 Run full regression, guard, and packaging checks; hold the release until the registry increment is implemented and planned-work warnings are cleared.
- [x] T010 Open and merge reviewed PR #349, publish v0.37.0, and verify every
  distribution artifact independently.

## Phase 2: Registry and preflight

- [x] T011 Define the versioned registry schema and transition invariants with immutable spec IDs, tombstones, orthogonal lifecycle dimensions, split reviewed control fields, observed projections, and cross-ledger consistency.
- [x] T012 Extract the existing feature-trace calculation into a reusable evidence builder.
- [x] T013 Add a pure registry projector and dedicated `docguard specs --write|--check` flows; no other command may write lifecycle state.
- [x] T014 Add `docguard specs preflight` with an advisory pre-specification briefing plus a generated-spec gate with structural blockers, review-only semantic overlap, and mandatory Spec Kit `before_specify`/`before_tasks` hooks.
- [x] T015 Add manifest integrity, reciprocal lineage, `supersededBy` currentness, and lifecycle-state validation.

## Phase 3: Completion and post-hoc reconciliation (R2)

These tasks completed the post-v0.37.0 lifecycle increment and passed their
evidence gates before v0.38.0.

- [x] T016 Add staged registry/recovery transactions with rollback, status
  adapters, and monorepo fixtures before enabling completion writes.
- [x] T017 Specify the reconcile JSON graph and confidence model.
- [x] T018 Classify mechanical facts, approved intent, decisions, and unsupported evidence.
- [x] T019 Implement `reconcile --since <ref>` as a read-only plan.
- [x] T020 Add intentional-change, regression, unrelated-change, and ambiguity fixtures.
- [x] T021 Add opt-in reviewed writes for mechanical facts only.
- [x] T022 Implement `docguard specs complete` as the `implemented → verified` transaction and outcome record.
- [x] T023 Regenerate active AI context and add Spec Kit lifecycle hooks after verification.
