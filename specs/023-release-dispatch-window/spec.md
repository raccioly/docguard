# Feature Specification: Release Dispatch Window

**Feature Branch**: `fix/release-dispatch-window`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.release-dispatch-window`

**Lineage**: amends `docguard.tokenless-scheduled-releases`. Implements option C of #447, chosen
by the maintainer on 2026-09-29. Option B (a `workflow_run` dispatcher) is not viable.
`docs-canonical/CI-RECIPES.md` records that release PR #380 proved the listener only sees the
approval-required completion. Approving the held run produces no second event.

**Input**: User description: "Release publication misses its dispatch window as a rule, not an
exception."

## Problem

The weekly release PR needs a maintainer to approve its workflows before CI runs. The
scheduler waits 10 minutes (40 × 15 s) for the merge and then gives up. Approval almost never
happens that fast, so publication nearly always falls through to the hourly tag-driven sweep.
Releases therefore land up to an hour after merge, and the scheduler's notice calls the rule
an exception.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A merged release publishes within minutes (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a release PR merged after the scheduler stopped waiting, **When** the sweep runs,
   **Then** publication starts within 10 minutes of the merge, not up to 60.
2. **Given** no pending release, **When** the sweep runs, **Then** it exits after the
   version check without publishing anything, as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tag-driven release sweep MUST run every 10 minutes.
- **FR-002**: The scheduler's notice, workflow comments, release PR body and CI recipes MUST
  describe the sweep as the normal publication route after late approvals, with its real
  interval.
- **FR-003**: The workflow contract test MUST pin the 10-minute schedule.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The worst-case delay from merge to publication drops from 60 to 10 minutes.

## Assumptions

- Scheduled runs on a public repository cost no Actions minutes. The sweep's no-op path is a
  version comparison.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `dfa1385749b66184c93bf65f5dde127192037711` — Reviewed at dfa1385 on main: all 4 tasks are checked and were delivered by #468, #471; the full suite (2368 tests) passes and guard reports 0 errors at this revision. Deviations from the plan are recorded in the task notes. Evidence: `.github/workflows/release.yml`, `.github/workflows/scheduled-release.yml`, `docs-canonical/CI-RECIPES.md`, `tests/scheduled-release.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
