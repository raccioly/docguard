# Implementation Plan: Tokenless Scheduled Releases

**Status**: In progress
**Spec**: `specs/011-tokenless-scheduled-releases/spec.md`

## Summary

Replace the long-lived release PR credential with GitHub's documented
`workflow_dispatch` exception for repository `GITHUB_TOKEN` events. Keep the
privileged merge step metadata-only, move release identity checks into a pure
default-branch policy module, and add missing-tag recovery before any new bump.

## Technical Context

- Runtime: GitHub-hosted Ubuntu runners, Node.js 20 for scheduled preparation,
  and `actions/github-script` for privileged API operations.
- Trust boundary: scheduled and `workflow_run` definitions from `main`; release
  branch content is fetched as bytes and parsed, never executed by the
  privileged job.
- Permissions: scheduled workflow receives `contents`, `pull-requests`, and
  `actions` write; the merge workflow receives those scopes plus check metadata.
- Recovery: `release.yml` remains tag-driven and idempotent. A missing current
  tag is dispatched before the scheduler considers another version.

## Project Structure

```text
cli/release-pr-policy.mjs                pure candidate and CI-run policy
.github/workflows/scheduled-release.yml  tokenless PR and dispatch orchestration
.github/workflows/auto-merge.yml         metadata-only privileged gate
.github/workflows/release.yml            serialized idempotent publication
tests/scheduled-release.test.mjs          policy and workflow contracts
docs-canonical/CI-RECIPES.md              operator trust and recovery model
```

## Phase 1 — Pure release policy

Extract strict release identity, path, version-surface, increment, tag, and CI
job checks into an importable module. Test patch/minor acceptance and each
rejection independently.

## Phase 2 — Tokenless orchestration

Use `GITHUB_TOKEN` to push and open the release PR, then dispatch `ci.yml` on its
branch. Reuse an existing open release PR and reject an orphaned same-name branch.
Let `auto-merge.yml` accept `workflow_dispatch` only for release candidates and
dispatch `release.yml` after a successful merge.

## Phase 3 — Recovery, verification, and closeout

Dispatch publication when the package version lacks a tag, update canonical
guidance, run the complete matrix, and prove the live dispatch chain with a
temporary non-release PR that the gate must refuse to merge.
