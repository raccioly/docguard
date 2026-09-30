# Feature Specification: Unreadable Git Metadata

**Feature Branch**: `fix/unreadable-git-metadata`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.unreadable-git-metadata`

**Lineage**: extends `docguard.calibrated-finding-channels` FR-020 (headline coverage must not
read non-coverage as success). Item 8 of #455, from the ai-jail review.

**Input**: User description: "Run DocGuard inside an agent sandbox: git-based checks must fail
clearly, not look like a clean pass."

## Problem

Agent sandboxes such as ai-jail mount the project directory but, by default, hide a linked
worktree's git metadata: `.git` is a file pointing at a gitdir outside the sandbox. Every git
command then fails. DocGuard's git-dependent checks (Freshness, Diff-Suspicion,
Reference-Existence, and the untouched-task check SPK010) treat that the same way as a project
with no repository at all. They report `no-matches` ("ran and found nothing applicable"), which
keeps the top badge grade. Reproduced on this repository: a sandboxed worktree printed `PASS —
All 608 checks passed`, and three validators silently did nothing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A sandboxed run says what it could not check (Priority: P1)

**Independent Test**: In a linked worktree whose `.git` points at a missing gitdir, guard
reports Freshness, Diff-Suspicion and Reference-Existence as `missing-prerequisite`, with a
reason naming unreadable git metadata and the sandbox remedy, and the badge is not
`brightgreen`.

**Acceptance Scenarios**:

1. **Given** a `.git` file or directory in the project or an ancestor, and git commands
   failing, **When** guard runs, **Then** each git-dependent validator is `missing-prerequisite`,
   with the reason `Git metadata is present but unreadable (<git's message>)` and a sandbox hint.
2. **Given** a project with no `.git` anywhere, **When** guard runs, **Then** behaviour is
   unchanged. A project without version control has nothing to hide.
3. **Given** unreadable metadata, **When** the Spec-Kit validator runs its untouched-task
   check, **Then** it reports `partial` with the same reason instead of passing silently.

### Edge Cases

- `git` not installed at all: `missing-prerequisite`, reason "git is not installed".
- A shallow clone is readable metadata, and is out of scope here.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DocGuard MUST distinguish three git states: readable, absent (no `.git` in the
  project or any ancestor), and unreadable (a `.git` exists but git fails, or git is not
  installed).
- **FR-002**: Freshness, Diff-Suspicion and Reference-Existence MUST report
  `missing-prerequisite` when the state is unreadable, and keep their current behaviour when it
  is absent.
- **FR-003**: The Spec-Kit validator MUST report `partial` when the untouched-task check cannot
  read git history because metadata is unreadable.
- **FR-004**: The reason MUST include git's own first error line and a remedy that names
  sandboxes (for example ai-jail's `--worktree`).
- **FR-005**: Freshness MUST use the shared git helper instead of its private copy.
- **FR-006**: `docs-canonical/ENVIRONMENT.md` MUST document running DocGuard inside an agent
  sandbox: what needs to be mounted, and what degrades without it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The reproduction reports 3 missing prerequisites and 1 partial, and never a
  top-grade badge.
- **SC-002**: A project with no `.git` produces byte-identical guard JSON coverage before and
  after this change.

## Assumptions

- `missing-prerequisite` already caps the badge colour (calibrated-finding-channels FR-020), so
  no badge logic changes.
