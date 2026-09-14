# Tasks: Document Lifecycle and Reconciliation

**Status**: Active
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
- [x] T009 Run full regression, guard, and packaging checks; release remains held while the registry increment is unimplemented and guard reports planned-work warnings.
- [ ] T010 Open and merge a reviewed pull request.

## Phase 2: Registry and lifecycle follow-up

- [ ] T011 Define the versioned registry schema and transition invariants with immutable spec IDs, tombstones, orthogonal lifecycle dimensions, split reviewed control fields, observed projections, and cross-ledger consistency.
- [ ] T012 Extract the existing feature-trace calculation into a reusable evidence builder.
- [ ] T013 Add a pure registry projector and dedicated `docguard specs --write|--check` flows; no other command may write lifecycle state.
- [ ] T014 Add `docguard specs preflight` with an advisory pre-specification briefing plus a generated-spec gate with structural blockers and review-only semantic overlap.
- [ ] T015 Add manifest integrity, `supersededBy` currentness, and lifecycle-transition validation.
- [ ] T016 Add transactional registry/recovery writes with rollback, then status adapters and monorepo fixtures contributed by users.

## Phase 3: Post-hoc reconciliation

- [ ] T017 Specify the reconcile JSON graph and confidence model.
- [ ] T018 Classify mechanical facts, approved intent, decisions, and unsupported evidence.
- [ ] T019 Implement `reconcile --since <ref>` as a read-only plan.
- [ ] T020 Add intentional-change, regression, unrelated-change, and ambiguity fixtures.
- [ ] T021 Add opt-in reviewed writes for mechanical facts only.
- [ ] T022 Implement `docguard specs complete` as the `implemented → verified` transaction and outcome record.
- [ ] T023 Regenerate active AI context and add Spec Kit lifecycle hooks after verification.
