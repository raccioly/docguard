# Feature Specification: A Release Cut That Passes Its Own Suite

**Feature Branch**: `fix/changelog-tests-release-cut`

**Created**: 2026-10-01

**Status**: Draft

**Spec ID**: `docguard.release-cut-green`

**Lineage**: Corrects `docguard.release-readiness`, which owns the scheduled cut and `sync-release-version.mjs`. Found when the v0.43.0 cut (run 36819182434) failed its "Verify the tree is still green" step with 11 failures, so nothing was tagged or published. Related: `docguard.spec-kit-integration-honesty` (048), which gave `ensureSkills` a required `surface` argument.

**Input**: "Merge everything and cut the release; verify everything we claim."

## Problem

The cut moves `[Unreleased]` under the new version, synchronizes release surfaces, and then runs the full suite. Two kinds of failure stop it:

1. **Tests read only `[Unreleased]`.** Nine tests check that the CHANGELOG describes their change by reading the `[Unreleased]` section. After the cut that section is empty, so they fail on the exact commit being released, and they would fail again on every later cut.
2. **The `.agent/` mirrors are not refreshed, and the release commit leaves files out.** The workflow refreshes the checked-in `.agent/skills` copies by calling `ensureSkills(root, flags)`. Since spec 048 that function needs a third `surface` argument. The call throws, the JSON-mode caller swallows the error, and the copies keep the old version marker. The parity test then fails. `.agent/commands` mirrors `commands/` and is never refreshed, so its `docguard-cli@` pins go stale without any test noticing. The release commit's `git add` also omits `commands/`, whose pins the synchronization rewrites. The release PR's own CI would then fail the pin test.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The release commit passes the suite (Priority: P1)

1. **Given** main with populated `[Unreleased]` notes, **When** the cut's bump, CHANGELOG and synchronization steps run, **Then** the full suite passes on the resulting tree.
2. **Given** a later release that moves this release's notes below a newer version, **Then** the same tests still pass.

### User Story 2 - Mirrors move with their sources (Priority: P1)

1. **Given** the release synchronization, **Then** every `.agent/skills/<name>/SKILL.md` equals the synchronized extension skill and every `.agent/commands/<file>` equals the synchronized `commands/<file>`.
2. **Given** a source with no mirror yet, **Then** the mirror is created. **Given** a repository with no `.agent/` directory, **Then** nothing is mirrored and nothing fails.

## Requirements *(mandatory)*

- **FR-001**: A test that checks the CHANGELOG describes a change MUST read the notes added since the last release before that change (from `## [Unreleased]` down to that version's heading), not the `[Unreleased]` section alone.
- **FR-002**: The release-readiness check that "this repository's notes cut a minor release" MUST hold both before and after the cut.
- **FR-003**: `sync-release-version.mjs` MUST write the `.agent/skills` and `.agent/commands` mirrors from the synchronized sources in the same fail-closed transaction. If `.agent/` is absent, it MUST skip the mirrors.
- **FR-004**: The release workflow MUST NOT call `ensureSkills` to refresh repository mirrors.
- **FR-005**: `ensureSkills` MUST reject a missing `surface` argument with an error, instead of swallowing the resulting failure.
- **FR-006**: The release commit MUST stage, and the release-candidate policy MUST admit, every path the synchronization rewrites. That includes `commands/docguard.*.md` (pinned since spec 048 but never staged) and both `.agent/` mirrors.
- **FR-007**: The CI test runtime budget MUST stay above normal runs, with room for runner noise, and MUST still trip on a PR #328-class regression (+165s). This PR's Node 18 run failed at 241.5s against 240s with every test passing; normal runs are now 211–241s. The budget becomes 360s, and the measurements are recorded beside it.

## Success Criteria *(mandatory)*

- **SC-001**: Replaying the cut locally (version bump, `release-changelog.mjs cut`, `sync-release-version.mjs`) on a scratch copy of main gives a full suite with 0 failures. `validate-release-candidate.mjs` accepts the resulting diff.
- **SC-002**: The full suite passes on main, and guard on this repository is unchanged.

## Out of Scope

- Changing what the CHANGELOG says, or the cut's ordering of steps.
