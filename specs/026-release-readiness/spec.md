# Feature Specification: Release Readiness

**Feature Branch**: `chore/release-prep-0.43`

**Created**: 2026-09-29

**Status**: Draft

**Spec ID**: `docguard.release-readiness`

**Lineage**: extends `docguard.tokenless-scheduled-releases` and
`docguard.release-dispatch-window`. Comes from the pre-release audit of 0.43.0
(#455): every surface a release publishes must say what the code does.

**Input**: User description: "Do the release-prep PR: everything the audit found
before publishing a new release."

## Problem

The audit before 0.43.0 found that the release machinery would ship the wrong
thing without anyone noticing:

- The weekly scheduler defaults to a **patch** bump. An unattended Monday cut
  of a release that adds commands and finding codes would have published 0.42.2.
- The changelog splice put a raw commit list and a second `### Changed` heading
  above the curated notes in every automated release.
- The GitHub Action installed `docguard-cli@latest`, so pinning
  `raccioly/docguard@vX.Y.Z` did not pin the CLI it ran.
- The Homebrew formula is maintained by hand. The live tap stopped at 0.40.0,
  and the README's copyable Action examples pinned v0.12.0.
- Top-level `--help` omitted `generate --spec` and `specs complete|require`.
- A finding's help told users to set `specKit.untouchedClaimCheck`, which the
  config schema did not declare.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An unattended release cuts the right version (Priority: P1)

**Acceptance Scenarios**:

1. **Given** an `[Unreleased]` section with `### Added` entries, **When** the
   scheduler runs with its default input, **Then** it cuts the next minor.
2. **Given** only `### Fixed`/`### Changed`/`### Security` entries, **Then** it
   cuts the next patch. An explicit `patch` or `minor` input still wins.

### User Story 2 - The published notes are the reviewed notes (Priority: P1)

1. **Given** a curated `[Unreleased]` section, **When** the release is cut,
   **Then** that body appears under `## [x.y.z] - date` unchanged, the merged
   commit subjects follow under `### Commits`, no heading appears twice, and
   `[Unreleased]` is left empty.

### User Story 3 - Pinning the action pins the CLI (Priority: P1)

1. **Given** `uses: raccioly/docguard@vX.Y.Z`, **Then** the action installs
   `docguard-cli@X.Y.Z`. **Given** `docguard-version: latest`, it installs the
   latest.

### User Story 4 - Homebrew users get the release (Priority: P2)

1. **Given** a published npm tarball and the tap deploy key, **When** the
   release workflow runs, **Then** the tap formula carries that version and the
   sha256 of the tarball npm serves, verified against `dist.integrity`.
2. **Given** no deploy key, **Then** the job warns once and skips; the sweep does
   not warn every 10 minutes.

### Edge Cases

- A version section that already exists is never overwritten.
- A template missing a placeholder, a non-semver version or a malformed hash
  stops the render.
- The tarball can take minutes to appear after `npm publish`; the render waits,
  bounded.
- The `docguard-version` input reaches the shell through an environment
  variable, never interpolated into the script.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The scheduled release MUST default to an `auto` bump: minor when
  the curated `[Unreleased]` section has a populated Added, Removed or
  Deprecated heading, patch otherwise. A maintainer MAY force `patch` or
  `minor`.
- **FR-002**: The release cut MUST move the curated `[Unreleased]` body under
  the new version heading unchanged, list merged commit subjects under
  `### Commits`, and refuse to cut a version that already has a section.
- **FR-003**: The GitHub Action MUST install the CLI version it was released
  with. Release version sync MUST keep that pin and the copyable
  `raccioly/docguard@vX.Y.Z` examples in `README.md` and
  `docs/ai-integration.md` equal to `package.json`. A `docguard-version` input
  MAY override the pin.
- **FR-004**: The release workflow MUST render the Homebrew formula from the
  published npm tarball, after verifying it against npm's `dist.integrity`, and
  publish it to `raccioly/homebrew-tap` with a deploy key scoped to the tap. It
  MUST retry while the tap is behind, and skip with one warning when the key is
  absent.
- **FR-005**: The top-level `--help` line of a command MUST name every
  subcommand and mode its own `--help` lists.
- **FR-006**: The config schema MUST declare every configuration key that a
  finding's help text tells users to set.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With this repository's `[Unreleased]` section, the scheduler's
  default input cuts 0.43.0, not 0.42.2.
- **SC-002**: A simulated cut produces a version section with each heading once,
  followed by `### Commits`.

## Assumptions

- The tap deploy key is a one-time maintainer setup. DocGuard cannot create
  credentials.
- 0.x semver: a new command or finding code is a minor release; so is a
  behaviour change announced under Removed or Deprecated.
