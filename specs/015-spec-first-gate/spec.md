# Feature Specification: Spec-First Change Gate

**Feature Branch**: `feat/spec-first-gate`

**Created**: 2026-09-29

**Status**: Draft

**Spec ID**: `docguard.spec-first-gate`

**Lineage**: enforces Constitution X (Spec-First Development); builds on
`docguard.document-lifecycle` (spec identities and registry). Tracking issue #455.

**Input**: User description: "Guarantee every change runs through Spec Kit: a change that
touches governed code must reference its spec or declare an exemption with a reason, and CI must
hard-fail otherwise."

## Problem

A repository can install Spec Kit and still bypass it. DocGuard's own history shows this:
about 6 of its last 40 merged changes touched `specs/`, while the rest changed code with no
specification at all. Nothing noticed, because nothing asks the question "which spec governs
this change?" at the moment a change is proposed. Validators check specs that exist; none
notice the spec that was never written.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Block an unspecified code change (Priority: P1)

A maintainer configures which paths are governed. When a proposed change modifies a governed
path without naming a spec, the check fails and says exactly how to satisfy it.

**Why this priority**: This is the enforcement the constitution promises; without it the
spec-first rule is advisory.

**Independent Test**: In a repository with governed path `cli/**`, commit a change to
`cli/a.mjs` with a message that names no spec; the check exits non-zero and lists the ungoverned
path and both ways to pass.

**Acceptance Scenarios**:

1. **Given** a change to a governed path and no spec reference, **When** the check runs,
   **Then** it fails, lists the governed paths changed, and shows the reference and exemption
   formats.
2. **Given** a change that touches only ungoverned paths (documentation, tests), **When** the
   check runs, **Then** it passes as "not governed".

---

### User Story 2 - Pass by referencing the governing spec (Priority: P1)

A contributor names the spec that governs the change, either in the pull request description
or in a commit message, or changes that spec's files in the same change.

**Why this priority**: The normal path must be cheap, or contributors route around it.

**Independent Test**: The same change passes when its description contains
`specs/015-spec-first-gate` or the spec ID `docguard.spec-first-gate`.

**Acceptance Scenarios**:

1. **Given** a description naming an existing spec directory or a registered spec ID, **When**
   the check runs, **Then** it passes and reports which spec it matched.
2. **Given** a description naming a spec that does not exist, **When** the check runs, **Then**
   it fails and names the unresolved reference; an invented reference never satisfies the gate.
3. **Given** a change that edits files inside a spec directory, **When** the check runs,
   **Then** that spec counts as referenced.

---

### User Story 3 - Declare a justified exemption (Priority: P2)

Some governed changes legitimately have no spec: an automated release cut, a dependency bump,
a typo fix, a test-only change. The contributor declares the kind and a reason on one line.

**Why this priority**: A gate without a sanctioned escape hatch gets disabled; an escape hatch
without a reason becomes a habit.

**Independent Test**: The unspecified change passes with
`Spec-Exempt: typo — fix a misspelled flag name in help text`, and fails with an unknown kind
or an empty reason.

**Acceptance Scenarios**:

1. **Given** an exemption line with an allowed kind and a reason of at least 10 characters,
   **When** the check runs, **Then** it passes as "exempt" and reports the kind and reason.
2. **Given** an exemption with an unknown kind or a missing reason, **When** the check runs,
   **Then** it fails and names the allowed kinds.

### Edge Cases

- The comparison ref is unknown, history is shallow, or Git fails: the result is
  inconclusive (distinct exit code), never a pass.
- A very large change exceeds the changed-path budget: inconclusive, never a pass.
- The description arrives through an untrusted pull request body: it is read from a file, never
  interpolated into a shell command.
- Several specs referenced: all resolved references are reported; one resolved reference
  suffices.
- Renamed or deleted governed files count as changed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DocGuard MUST provide a check that compares the current revision against a given
  base revision (merge base) and lists the changed paths that match the configured governed
  path patterns.
- **FR-002**: Governed patterns MUST be configurable. When unconfigured, every changed path is
  governed except Markdown files, the `specs/` tree, and test files recognized by DocGuard's
  test patterns.
- **FR-003**: A change MUST count as specified when any of: the supplied description text or a
  commit message in the range names an existing `specs/<dir>` path; names a spec ID present in
  the spec registry; or the change modifies files inside a spec directory.
- **FR-004**: A named spec that does not resolve MUST be reported and MUST NOT satisfy the check.
- **FR-005**: A change MUST count as exempt when the description or a commit message contains
  one line `Spec-Exempt: <kind> — <reason>` whose kind is allowed (default: `release`, `deps`,
  `typo`, `test-only`; configurable) and whose reason has at least 10 characters.
- **FR-006**: The check MUST report one of: covered, exempt, not governed, uncovered,
  inconclusive, with exit codes 0, 0, 0, 1 and 2 respectively, in human and JSON output.
- **FR-007**: The description text MUST be read from a file path argument, so CI can pass an
  untrusted pull request body without shell interpolation.
- **FR-008**: This repository MUST run the check in CI on every pull request to `main`, with
  governed pattern `cli/**`, and the automated release workflow MUST declare its exemption.
- **FR-009**: `AGENTS.md` MUST state the spec-first rule, the reference and exemption formats,
  and the command.
- **FR-010**: The DocGuard GitHub Action MUST offer the check as a command that reads the pull
  request description and base branch from the event context through environment variables
  only, and fails the job on uncovered and inconclusive results.

### Key Entities

- **Governed change**: a changed path matching the governed patterns.
- **Spec reference**: a resolved spec directory or spec ID found in the description, commit
  messages, or the change's own spec-file edits.
- **Exemption**: a declared kind plus reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of pull requests to `main` that change a governed path without a resolved
  reference or valid exemption fail CI.
- **SC-002**: A contributor satisfies the check by adding one line to the pull request
  description.
- **SC-003**: No input path (malformed ref, shallow history, oversized change) yields a pass
  without evidence.
- **SC-004**: Running the check against this repository's last 40 merged changes classifies
  every one (covered, exempt-eligible, not governed, uncovered) — reproducing the audit that
  motivated it.

## Assumptions

- Pull request descriptions are the primary carrier; commit messages cover local use and
  squash-merged history.
- The check establishes that a change *names* a governing spec, not that the spec's
  requirements are met; requirement coverage stays with traceability and reconciliation.
- On non-pull-request events the Action's check compares against the default branch and
  reads commit messages only.
