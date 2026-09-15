# Tasks: Tokenless Scheduled Releases

**Status**: Corrective live verification pending
**Spec**: `specs/011-tokenless-scheduled-releases/spec.md`

## Phase 1: Contract and policy

- [x] T001 Validate GitHub's current `GITHUB_TOKEN`, `workflow_dispatch`, and
  `workflow_run` behavior against primary documentation.
- [x] T002 Add a pure release-candidate and exact-workflow-run policy module.
- [x] T003 Add positive patch/minor and failure-mode policy tests.

## Phase 2: Workflow orchestration

- [x] T004 Replace the long-lived credential with a job-scoped `GITHUB_TOKEN`
  release PR and an explicit maintainer workflow approval.
- [x] T005 Reuse matching open PRs and fail on orphaned remote release branches.
- [x] T006 Gate approved pull-request CI by exact run, head SHA, author, version,
  and paths.
- [x] T007 Dispatch idempotent publication after merge and recover missing tags.

## Phase 3: Documentation and verification

- [x] T008 Update canonical CI guidance, changelog, and roadmap.
- [x] T009 Run policy, workflow, action-pin, full-suite, and self-guard checks.
- [x] T010 Merge through reviewed CI and execute the live negative wiring probe.
- [x] T011 Review the complete R8 evidence set and approve lifecycle completion
  with no accepted deviations.

## Phase 4: Repository-token provenance correction

- [x] T012 Prove that bot-dispatched jobs neither emit the required downstream
  gate nor satisfy protected pull-request checks, then adopt one explicit
  maintainer workflow approval without weakening branch protection.
- [x] T013 Execute the live v0.40.1 release through approved pull-request checks
  and retain release PR #380, CI run `34920481989`, supply-chain run
  `34920482409`, merge `5b2dfe4`, and publication run `34920702346`.

## Phase 5: Native continuation correction

- [x] T014 Replace the missing post-approval `workflow_run` callback with
  pre-push candidate validation and GitHub protected native auto-merge while
  preserving the separate Dependabot/Jules gate.
- [ ] T015 Prove the repository-token auto-merge arm, bounded publication
  continuation, and end-to-end registries on the next live release, then record
  the exact merge and publication evidence.
