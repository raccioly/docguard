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

GitHub places workflows for a pull request created by the ephemeral repository
`GITHUB_TOKEN` into an approval-required state. Separately dispatched jobs run,
but do not satisfy the protected branch's required pull-request contexts, and a
bot-authored dispatch does not produce the downstream `workflow_run` needed by
the merge gate. DocGuard therefore requires one maintainer workflow approval per
generated release PR. GitHub does not emit a second `workflow_run` completion
after that approval, so the release continuation must use protected native
auto-merge rather than wait for a callback that never arrives. The change must
fail closed when branch, author, version, changed files, CI state, approval state,
or publication state is unexpected.

## User Scenarios & Testing

### US1 — Release without a long-lived credential

As a maintainer, I can let the weekly workflow open and validate a release pull
request using only job-scoped repository tokens. No personal token or app private
key needs to remain in repository secrets.

### US2 — Preserve the protected review boundary

As a security reviewer, I can see that the trusted scheduler validates the exact
candidate before push and GitHub branch protection applies all required checks to
the current release head before native auto-merge can proceed.

### US3 — Recover interrupted publication

As a maintainer, I can rely on the next scheduled run to detect a package version
whose tag is missing and dispatch the idempotent release workflow before it
considers another version bump.

## Functional Requirements

- **FR-001**: Scheduled release pull requests MUST use the ephemeral repository
  `GITHUB_TOKEN`; the workflow MUST NOT require a personal token, app private key,
  or other long-lived release credential.
- **FR-002**: The scheduler MUST retain explicit `contents`, `pull-requests`, and
  `actions` write scopes only. It MUST expose GitHub's maintainer workflow
  approval as an explicit release step and MUST NOT substitute dispatched jobs
  that do not satisfy required pull-request checks.
- **FR-003**: A current package version without a matching remote tag MUST trigger
  publication recovery and MUST NOT be incremented again by the scheduler.
- **FR-004**: Re-running the scheduler MUST reuse an open release PR for the same
  branch only when that branch contains current `main`. A stale branch or
  same-name remote branch without an open PR MUST fail closed instead of being
  overwritten or omitting newly merged work.
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
- **FR-008**: The scheduler MUST arm native squash auto-merge for the release PR.
  Auto-merge MUST remain blocked until maintainer-approved pull-request CI reports
  successful Node 18, 20, 22, and 24 required checks for the current head.
- **FR-009**: The trusted scheduler MUST run the pure release-candidate policy
  before pushing the branch. Candidate identity, synchronized version surfaces,
  and the changed-file allowlist MUST fail closed without executing code supplied
  by a previously opened release branch.
- **FR-010**: After arming native auto-merge, the scheduler MUST wait for a
  bounded interval and dispatch the existing idempotent release workflow when
  the PR merges. An hourly tag-driven sweep MUST recover later approvals and
  interrupted publication before another version increment.
- **FR-011**: Existing Dependabot and Jules auto-merge policies MUST preserve
  their current pull-request-only behavior and file/version restrictions.
- **FR-012**: All executable third-party actions MUST remain pinned to reviewed
  commit SHAs, and no workflow may use `pull_request_target`.

## Success Criteria

- **SC-001**: Pure policy tests accept one exact patch and minor candidate and
  reject wrong authors, repositories, bases, versions, tags, paths, and CI jobs.
- **SC-002**: Workflow contract tests prove the explicit maintainer-approval
  boundary, absence of a stored release credential, missing-tag recovery,
  stale-branch refusal, pre-push candidate validation, protected native
  auto-merge, bounded publication dispatch, and hourly missing-tag recovery.
- **SC-003**: The complete Node 18, 20, 22, and 24 CI matrix, supply-chain scan,
  self-guard, and action-pin checks pass.
- **SC-004**: A live repository-token-generated release PR proves that one
  maintainer approval starts required CI, after which protected native auto-merge
  merges the exact green head and starts publication without a stored credential.

## Non-Goals

- Publishing a new DocGuard package solely to test release automation.
- Bypassing branch protection or required status checks.
- Executing release-branch scripts in the privileged workflow.
- Managing credentials for npm, PyPI, or container publication.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `46531e4918f9479b81ffb52e6e27c24b533575da` — Reviewed tokenless scheduled-release policy, exact-run gates, missing-tag recovery, Node 18/20/22/24 CI, supply-chain scan, live dispatch-chain refusal probe, and durable evidence approval with no accepted deviations. Evidence: `cli/release-pr-policy.mjs`, `docs-canonical/CI-RECIPES.md`, `tests/scheduled-release.test.mjs`. Accepted deviations: none. Successor: none.
- `f4bb00638da2d1a53ad1a67928e35e1dfe1b401d` — Verified v0.40.3 repository-token release PR #386: scheduled run 34922506777 armed native auto-merge; approved CI 34922605581 and supply-chain 34922605917 passed; merge e27d6bf triggered publication run 34922784629; npm, PyPI, GHCR, GitHub Release, extension ZIP, MCPB, and catalog reminder completed with no accepted deviations. Evidence: `.github/scripts/validate-release-candidate.mjs`, `cli/release-pr-policy.mjs`, `docs-canonical/CI-RECIPES.md`, `tests/scheduled-release.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
