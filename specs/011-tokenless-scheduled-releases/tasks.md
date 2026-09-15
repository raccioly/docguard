# Tasks: Tokenless Scheduled Releases

**Status**: Evidence reviewed; lifecycle transaction ready
**Spec**: `specs/011-tokenless-scheduled-releases/spec.md`

## Phase 1: Contract and policy

- [x] T001 Validate GitHub's current `GITHUB_TOKEN`, `workflow_dispatch`, and
  `workflow_run` behavior against primary documentation.
- [x] T002 Add a pure release-candidate and exact-workflow-run policy module.
- [x] T003 Add positive patch/minor and failure-mode policy tests.

## Phase 2: Workflow orchestration

- [x] T004 Replace the long-lived credential with job-scoped `GITHUB_TOKEN` and dispatch CI.
- [x] T005 Reuse matching open PRs and fail on orphaned remote release branches.
- [x] T006 Gate dispatched CI by exact run, head SHA, author, version, and paths.
- [x] T007 Dispatch idempotent publication after merge and recover missing tags.

## Phase 3: Documentation and verification

- [x] T008 Update canonical CI guidance, changelog, and roadmap.
- [x] T009 Run policy, workflow, action-pin, full-suite, and self-guard checks.
- [x] T010 Merge through reviewed CI and execute the live negative wiring probe.
- [x] T011 Review the complete R8 evidence set and approve lifecycle completion
  with no accepted deviations.
