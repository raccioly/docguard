# Feature Specification: SPK010 Directory Claims

**Feature Branch**: `fix/spk010-directory-mentions`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.spk010-directory-claims`

**Lineage**: refines `docguard.calibrated-finding-channels` FR-021 (untouched checked tasks,
SPK010). Fixes #458, reported by a downstream project running `guard --fail-on-warning` in
pre-push.

**Input**: User description: "SPK010 flags a checked task that mentions a directory as context,
even though the feature changed files inside that directory."

## Problem

SPK010 reports a checked task that names an existing path the feature never changed. It
compares each named path with the files git lists as changed since the spec directory was
introduced. Git lists files, never directories, so a directory named in a task (`src/game/`)
never matches. The finding fires even when the feature added or changed files inside it. The
reporter's real deliverable, `src/game/liveness.js`, was changed and correctly not flagged. Only
the context mention was flagged, and the only workaround was an inline suppression.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A context directory is not an accusation (Priority: P1)

A task marked done names its deliverable file and the directory it lives in. The feature
changed files in that directory. Guard reports nothing for the task.

**Acceptance Scenarios**:

1. **Given** a checked task naming `src/game/liveness.js` and `src/game/`, **When** the
   feature added `src/game/liveness.js`, **Then** SPK010 is silent.
2. **Given** a checked task naming `src/game/`, **When** the feature changed a file nested
   deeper (`src/game/deep/util.js`), **Then** SPK010 is silent.

### User Story 2 - The check keeps its teeth (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a checked task naming `src/game/`, **When** the feature changed nothing inside it,
   **Then** SPK010 still reports `src/game`.
2. **Given** a change only under `src/gameplay/`, **Then** it does not count for `src/game/`.
3. **Given** a checked task naming a file, **When** only a sibling file in the same directory
   changed, **Then** the file claim is still reported.

### Edge Cases

- A path that no longer exists stays SPK008's finding, never SPK010's.
- Deleting a file under the directory counts as a change (git lists deleted paths).
- Uncommitted and untracked work under the directory counts, as it already does for files.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: SPK010 MUST treat a named path that is an existing directory as touched when
  any path changed within the feature's window lies strictly under it.
- **FR-002**: SPK010 MUST keep reporting a directory in which the feature changed nothing, and
  MUST NOT let a change to a file vouch for a different named file or for a sibling directory
  that merely shares a name prefix.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The #458 reproduction produces zero SPK010 findings. It fails on the release
  before this change.
- **SC-002**: The precision cases in User Story 2 each still produce exactly the expected
  finding.

## Assumptions

- A directory is named through the existing claim syntax (a slashed token ending in `/`). Bare
  directory names without a trailing slash are soft tokens and were never claims.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `dfa1385749b66184c93bf65f5dde127192037711` — Reviewed at dfa1385 on main: all 3 tasks are checked and were delivered by #470, #471; the full suite (2368 tests) passes and guard reports 0 errors at this revision. Deviations from the plan are recorded in the task notes. Evidence: `cli/scanners/speckit.mjs`, `docs-canonical/REQUIREMENTS.md`, `tests/spk010-directory-claims.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
