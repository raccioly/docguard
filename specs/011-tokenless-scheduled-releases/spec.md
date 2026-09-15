# Feature Specification: Tokenless Scheduled Releases

**Status**: Active
**Spec ID**: `docguard.tokenless-scheduled-releases`
**Created**: 2026-09-14
**Owner**: DocGuard maintainers

## Problem

DocGuard's scheduled release workflow needs to open a protected release pull
request, obtain four required CI results, merge it, and start publication. A
long-lived personal or GitHub App credential can make the pull-request event run
normally, but it also adds secret storage, rotation, revocation, and account
ownership risk to an otherwise repository-local process.

GitHub guarantees that `workflow_dispatch` events created with the ephemeral
repository `GITHUB_TOKEN` start workflow runs. DocGuard can use that supported
exception while preserving the existing metadata-only `workflow_run` security
boundary. The change must fail closed when branch, author, version, changed
files, CI provenance, or publication state is unexpected.

## User Scenarios & Testing

### US1 — Release without a long-lived credential

As a maintainer, I can let the weekly workflow open and validate a release pull
request using only job-scoped repository tokens. No personal token or app private
key needs to remain in repository secrets.

### US2 — Preserve the protected review boundary

As a security reviewer, I can see that the privileged merge workflow reads PR
metadata and files through the API, executes policy code only from the default
branch, and never checks out or executes the release branch.

### US3 — Recover interrupted publication

As a maintainer, I can rely on the next scheduled run to detect a package version
whose tag is missing and dispatch the idempotent release workflow before it
considers another version bump.

## Functional Requirements

- **FR-001**: Scheduled release pull requests MUST use the ephemeral repository
  `GITHUB_TOKEN`; the workflow MUST NOT require a personal token, app private key,
  or other long-lived release credential.
- **FR-002**: The scheduler MUST retain explicit `contents`, `pull-requests`, and
  `actions` write scopes only, and MUST dispatch the existing read-only CI
  workflow against the pushed release branch.
- **FR-003**: A current package version without a matching remote tag MUST trigger
  publication recovery and MUST NOT be incremented again by the scheduler.
- **FR-004**: Re-running the scheduler MUST reuse an open release PR for the same
  branch and dispatch fresh CI only when that branch contains current `main`.
  A stale branch or same-name remote branch without an open PR MUST fail closed
  instead of being overwritten or omitting newly merged work.
- **FR-005**: A release candidate MUST come from the base repository, target the
  default branch, use an exact `release/vX.Y.Z` branch and matching title, and be
  authored by `github-actions[bot]`.
- **FR-006**: The candidate MUST modify only the explicit version, changelog,
  generated extension, template, and mirrored skill surfaces already owned by
  the release synchronizer.
- **FR-007**: Branch, title, package manifest, package lock root, package lock
  package entry, Python package, MCP server, and Spec Kit extension versions MUST
  agree exactly. The version MUST be the next patch or next minor from the base
  package version, and its release tag MUST not exist.
- **FR-008**: Auto-merge MUST accept dispatched CI only for a qualifying release
  candidate and MUST verify the exact triggering run ID, current PR head SHA, and
  successful Node 18, 20, 22, and 24 jobs.
- **FR-009**: The privileged `workflow_run` job MUST NOT execute code from the PR.
  Any imported release policy MUST be checked out explicitly from the repository
  default branch with persisted credentials disabled.
- **FR-010**: After a successful release PR merge, the gate MUST dispatch the
  existing idempotent release workflow on the default branch. Dispatch failure
  MUST fail visibly, and the scheduler's missing-tag recovery MUST provide a
  later retry path.
- **FR-011**: Existing Dependabot and Jules auto-merge policies MUST preserve
  their current pull-request-only behavior and file/version restrictions.
- **FR-012**: All executable third-party actions MUST remain pinned to reviewed
  commit SHAs, and no workflow may use `pull_request_target`.

## Success Criteria

- **SC-001**: Pure policy tests accept one exact patch and minor candidate and
  reject wrong authors, repositories, bases, versions, tags, paths, and CI jobs.
- **SC-002**: Workflow contract tests prove tokenless dispatch, missing-tag
  recovery, stale-branch refusal, default-branch policy checkout, and publication
  dispatch.
- **SC-003**: The complete Node 18, 20, 22, and 24 CI matrix, supply-chain scan,
  self-guard, and action-pin checks pass.
- **SC-004**: A live temporary non-release PR plus dispatched CI proves the
  `workflow_dispatch → workflow_run` chain while the privileged gate refuses to
  merge that non-release PR.

## Non-Goals

- Publishing a new DocGuard package solely to test release automation.
- Bypassing branch protection or required status checks.
- Executing release-branch scripts in the privileged workflow.
- Managing credentials for npm, PyPI, or container publication.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

No reviewed implementation outcome has been recorded yet.
<!-- docguard:implementation-outcomes:end -->
