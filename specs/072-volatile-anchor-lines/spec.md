# Feature Specification: Volatile Lines in Requirement Anchors

**Feature Branch**: `feat/volatile-anchor-lines`

**Created**: 2026-10-11

**Status**: Draft

**Spec ID**: `docguard.volatile-anchor-lines`

**Lineage**: Found by the 0.45.0 release gate of `docguard.requirement-anchors` (spec 070). A dry run of the scheduled release cut on main 711c2ac left `docguard guard` with four ANC001 warnings that main does not have: the cut rewrites the version in `action.yml` and `extensions/spec-kit-docguard/extension.yml`, and both files carry file-scope requirement tags, so their whole-file fingerprints change on every release. Extends the fingerprints of spec 070 (FR-010, FR-011, the `dg1` algorithm); it does not change the doc lock (`doclock-v0`, spec 030).

**Input**: "Line marker, then release: a line carrying a DocGuard marker comment is fingerprinted as a fixed placeholder, so its value can change without making links suspect. Adding or removing the marker still changes the fingerprint, so it can't be used to hide a change. Mark the two version lines. Works for users' own version lines too."

## Problem

A requirement anchor turns suspect when the code under it changes after review. For a file with no parser (YAML, TOML, shell) the anchor is the whole file, so any edit counts, including the version string a release tool rewrites. On this repository every release would turn four reviewed links suspect, and `docguard guard` on main would warn where it passed before spec 070. A project that tags its `pyproject.toml`, `Chart.yaml` or an action manifest meets the same noise every release. Clearing it by hand each time teaches people to clear suspects without reading them, which is the habit the anchors exist to prevent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A release-managed value does not make a link suspect (Priority: P1)

A maintainer tags `action.yml` with `# @implements acme.ci#FR-010` and the release tool rewrites `DOCGUARD_RELEASED_VERSION: '1.2.3'` every release. They add `# docguard:volatile` to the end of that line and accept the link once.

**Acceptance Scenarios**:

1. **Given** the marked line, **When** the release rewrites the value to `1.3.0`, **Then** the link stays current.
2. **Given** the same file, **When** any other line changes, **Then** the link turns suspect as before.
3. **Given** a reviewed link, **When** someone adds the marker to a line under it, **Then** the link turns suspect: adding the marker is itself a change someone must review.

### User Story 2 - The marker works the same at every tier (Priority: P1)

A Python module, a TypeScript file, a Go file and a Kotlin file each hold a version constant on a marked line under a reviewed anchor.

**Acceptance Scenarios**:

1. **Given** each file, **When** only the value on the marked line changes, **Then** the anchor's exact and floor fingerprints are unchanged, at the Babel, python-ast, pattern and tree-sitter tiers.
2. **Given** a string literal that starts on a marked line and continues onto the next, **When** its text changes, **Then** the fingerprint changes: only what lies wholly on the marked line is replaced.
3. **Given** `x = "docguard:volatile"` (the marker inside a string), **Then** the line is not marked.

### User Story 3 - A marker cannot silence an anchor without saying so (Priority: P2)

A tag anchors to `export const VERSION = '1.2.3'; // docguard:volatile`, a declaration that is entirely on one marked line.

**Acceptance Scenarios**:

1. **Given** that anchor, **When** `docguard anchors` runs, **Then** it lists ANC011: the anchor covers only volatile lines and can never turn suspect.
2. **Given** that anchor, **When** `docguard guard` runs, **Then** ANC011 is not reported (it is informational, like ANC004 and ANC006).

### User Story 4 - DocGuard's own release leaves anchors unchanged (Priority: P1)

The scheduled release cuts a new version on this repository.

**Acceptance Scenarios**:

1. **Given** main with `docguard guard` passing, **When** the release cut is applied (version bump, CHANGELOG cut, version sync), **Then** `docguard guard` on the cut tree reports no ANC001 or ANC002 the main tree does not.
2. **Given** the version sync rewrites a marked line, **Then** the marker comment is still on that line afterwards.

### Edge Cases

- A marked line with no code (a comment-only line) marks nothing; fingerprints are unchanged.
- A block comment holding the marker marks the line the comment starts on.
- A marker on a line that only closes brackets hides nothing at the AST tiers, which have no node for punctuation.
- A file with no marker fingerprints exactly as before: no existing lock entry changes.
- Directive comments (`@ts-ignore`, `# type: ignore`, ...) on a marked line still count, as they do anywhere.
- In YAML, a `#` inside a block scalar is read as a comment by the plain comment reader, as it already is for requirement tags.

## Requirements *(mandatory)*

- **FR-001**: A comment whose text contains `docguard:volatile` as a whole word MUST mark the line on which that comment starts. Markers MUST be found by the same comment reader that finds requirement tags, so text inside a string literal, template, regular expression or YAML value is never a marker.
- **FR-002**: In every requirement-anchor fingerprint, exact and floor, at every tier (Babel, python-ast, pattern, tree-sitter, and the file tier of a file with no lexer), what lies wholly on a marked line MUST be fingerprinted as a fixed placeholder: each largest syntax node at the Babel, python-ast and tree-sitter tiers, and the tokens of each marked line, as one placeholder per line, in the floor token stream. A node or token that spans a marked line and any other line MUST be fingerprinted as before. Layout tokens (virtual statement ends, indent and dedent markers) MUST be kept. In the file tier, the marked line's whole text is the placeholder.
- **FR-003**: Adding or removing a marker on a line that carries code MUST change the fingerprint of every anchor covering that line, so the change itself turns a reviewed link suspect.
- **FR-004**: A file that contains no marker MUST fingerprint byte-identically to before this change, at every tier, so no existing lock entry or golden value changes.
- **FR-005**: `docguard anchors` MUST report ANC011, at `info` severity, for an anchor whose every fingerprinted token lies on marked lines. Guard MUST NOT report ANC011.
- **FR-006**: The release version sync MUST keep a marker comment on every line it rewrites, and DocGuard MUST mark its own release-managed version lines in `action.yml` and `extensions/spec-kit-docguard/extension.yml`, so a release cut changes no anchor's state.
- **FR-007**: `docs/commands.md` MUST describe the marker, the placeholder rule and ANC011; `docs-canonical/SECURITY.md` MUST state that marked lines are outside anchor change detection and that adding a marker is itself a detected change; the finding catalog MUST carry ANC011.

## Success Criteria *(mandatory)*

- **SC-001**: Each of FR-001 to FR-006 has a test that fails before the change and passes after it, including one per tier for FR-002 and FR-003.
- **SC-002**: On this repository, applying the release cut for the next version leaves `docguard guard` reporting no requirement-anchor finding that main does not report.
- **SC-003**: `docguard anchors` on this repository reports the same links, tiers and fingerprints as before, except the four links in the two marked files, which are re-accepted once with a reason naming this spec. The full suite and the release gate of spec 070 (items 1, 2 and 9) pass on the release commit.

## Assumptions

- The marker is per line and marks its own line only. A marker for the next line, or for a range, is not needed for release-managed values and would hide more than it states.
- `docguard:volatile` follows the existing `docguard:<directive>` naming (`docguard:ignore`, `docguard:section`).
- The `dg1` algorithm has not been released yet (it ships in 0.45.0), and FR-004 keeps every unmarked file's fingerprint, so the rule joins `dg1` without an algorithm version change.

## Out of Scope

- The doc lock (`.docguard-doc-lock.json`, `doclock-v0`) does not read markers. Its algorithm is released and pinned (spec 030 FR-015).
- Treating values as volatile without a marker (guessing that `version:` lines are release-managed).
- Re-accepting links automatically in the release workflow: the release patch never touches the anchor lock.
