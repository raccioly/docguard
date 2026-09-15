# Implementation Plan: Tokenless Scheduled Releases

**Status**: Corrective live verification pending
**Spec**: `specs/011-tokenless-scheduled-releases/spec.md`

## Summary

Replace the long-lived release PR credential with a repository-token PR and one
explicit maintainer workflow approval. Keep the privileged merge step
metadata-only, move release identity checks into a pure default-branch policy
module, and add missing-tag recovery before any new bump.

## Technical Context

- Runtime: GitHub-hosted Ubuntu runners, Node.js 20 for scheduled preparation,
  and `actions/github-script` for privileged API operations.
- Trust boundary: the `workflow_run` gate restores code from `main`; release
  branch content is fetched as bytes and parsed, never executed by the
  privileged gate.
- Permissions: the scheduler receives `contents`, `pull-requests`, and `actions`
  write; the merge gate retains those scopes plus check metadata.
- Recovery: `release.yml` remains tag-driven and idempotent. A missing current
  tag is dispatched before the scheduler considers another version.

## Project Structure

```text
cli/release-pr-policy.mjs                pure candidate and CI-run policy
.github/workflows/scheduled-release.yml  tokenless PR and dispatch orchestration
.github/workflows/auto-merge.yml         metadata-only privileged merge gate
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
held pull-request workflows in GitHub. Once ordinary CI passes, let
`auto-merge.yml` restore policy from `main`, validate the candidate as inert
metadata, merge, and dispatch `release.yml`.

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
also closed without merge. The final design retains one explicit maintainer
workflow approval instead of weakening branch protection or storing a credential.
