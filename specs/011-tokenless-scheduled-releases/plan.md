# Implementation Plan: Tokenless Scheduled Releases

**Status**: Corrective live verification pending
**Spec**: `specs/011-tokenless-scheduled-releases/spec.md`

## Summary

Replace the long-lived release PR credential with a repository-token PR and one
explicit maintainer workflow approval. Validate release identity in the trusted
scheduler before push, arm protected native auto-merge, and add missing-tag
recovery before any new bump.

## Technical Context

- Runtime: GitHub-hosted Ubuntu runners, Node.js 20 for scheduled preparation,
  and `actions/github-script` for privileged API operations.
- Trust boundary: candidate policy executes in the scheduler's clean default-
  branch checkout before the release branch exists. GitHub branch protection
  owns the later current-head check and merge decision.
- Permissions: the scheduler receives `contents`, `pull-requests`, and `actions`
  write. No release-specific workflow receives a persistent credential.
- Recovery: `release.yml` remains tag-driven and idempotent. A missing current
  tag is checked hourly and before the scheduler considers another version.

## Project Structure

```text
cli/release-pr-policy.mjs                pure candidate and CI-run policy
.github/scripts/validate-release-candidate.mjs  trusted pre-push adapter
.github/workflows/scheduled-release.yml  tokenless PR and dispatch orchestration
.github/workflows/auto-merge.yml         Dependabot/Jules merge policy only
.github/workflows/release.yml            serialized idempotent publication
tests/scheduled-release.test.mjs          policy and workflow contracts
docs-canonical/CI-RECIPES.md              operator trust and recovery model
```

## Phase 1 — Pure release policy

Extract strict release identity, path, version-surface, increment, tag, and CI
job checks into an importable module. Test patch/minor acceptance and each
rejection independently.

## Phase 2 — Tokenless orchestration

Use `GITHUB_TOKEN` to push and open the release PR. Reuse an existing open release
PR and reject an orphaned same-name branch. Require a maintainer to approve the
held pull-request workflows in GitHub. Validate the generated diff before push
and arm GitHub native auto-merge. Once ordinary CI passes all required checks,
native auto-merge updates `main`; the waiting scheduler dispatches `release.yml`.
An hourly tag-driven sweep covers approvals after the bounded wait.

## Phase 3 — Recovery, verification, and closeout

Dispatch publication when the package version lacks a tag, update canonical
guidance, run the complete matrix, and prove the live dispatch chain with a
temporary non-release PR that the gate must refuse to merge.

The retained probe records CI run `34912654565` and privileged gate run
`34912788971`. All four Node jobs passed; the trusted gate identified pull
request #372 as a non-release candidate, refused to merge it, and the disposable
pull request and branch were then closed and deleted. That user-authored probe
validated the fallback gate but did not reproduce repository-token provenance;
release PR #376 exposed the missing scheduler-to-controller handoff and was
closed without merge before publication. Release PR #378 then proved that
successful dispatched jobs do not satisfy required pull-request checks and was
also closed without merge. Release PR #380 proved that approving an
`action_required` run does not emit a second `workflow_run` completion, then
published v0.40.1 through the protected checks and release workflow. The final
design retains one explicit maintainer workflow approval, uses native auto-merge
as the continuation, and avoids weakening branch protection or storing a
credential.

## Phase 4 — Native continuation correction

Enable repository auto-merge only after confirming that `main` requires all four
runtime checks. Prevalidate the release diff in the trusted scheduler, arm squash
auto-merge on both new and reused release PRs, and remove release handling from
the Dependabot/Jules `workflow_run` gate. Prove repository-token provenance with
the next live release before closing corrective verification.

Release PR #383 proved the repository token can arm native auto-merge and that
GitHub merges after approved required checks. It also showed that the resulting
bot-originated push does not trigger publication. Add a ten-minute bounded wait
to dispatch the normal path and an hourly idempotent sweep for later approvals;
prove both continuation and publication on the next live release.
