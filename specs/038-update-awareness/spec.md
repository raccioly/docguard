# Feature Specification: Update Awareness Without Network Calls

**Feature Branch**: `feat/update-awareness`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.update-awareness`

**Lineage**: #455 follow-up. Related: `docguard.mcp-doc-tools` (the MCP
server this adds an instruction to), `docguard.symbol-map` (the context pack
this adds a section to; its SC-003 byte-identity holds wherever the hint is
absent, which includes every source-checkout run).

**Input**: User description: "How can the tool always check for updates in
each person's install and suggest the AI update it, without forcing it, so at
least the AI reading knows and suggests the update to the user?"

Maintainer decisions (2026-09-30): an age hint with no network call, so
Constitution VIII stays as written; shown when the running version's release
is more than 14 days old; surfaced in the MCP server's initialize
instructions, the guard text footer, the context pack and the DocGuard skills.

## Problem

People install DocGuard globally, pin it in a project, or keep one MCP server
running for weeks. Nothing tells them, or the agent working for them, that the
version in use is old. `docguard upgrade` can check npm, but only a person who
already suspects an update runs it.

DocGuard cannot check npm on its own: the deterministic core makes no network
calls (Constitution VIII, `PRIVACY.md`). It can still say how old it is. Each
release's date is in the shipped `CHANGELOG.md`, so a version can tell its own
age with no network call. The agent reading that can suggest the check, and
the user decides.

`PRIVACY.md` also misses one outbound action that exists today:
`docguard upgrade` fetches `registry.npmjs.org` when run.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The agent learns the install is old and asks the user (Priority: P1)

An agent connects to DocGuard's MCP server, or reads guard's text output or
the context pack. The running DocGuard was released more than 14 days ago. The
agent sees one short note naming the version, its release date and how to
check for a newer one, and asks the user whether to check. It does not upgrade
on its own.

**Why this priority**: This is the request: the reader knows, and suggests.

**Independent Test**: Run each surface with the clock set 15 days after the
running version's release date and confirm the note appears; set it to 14
days and confirm it does not.

**Acceptance Scenarios**:

1. **Given** a release more than 14 days old, **When** an MCP client
   initializes, **Then** the server's instructions contain the note.
2. **Given** the same, **When** `docguard guard` prints text, **Then** the
   last lines contain the note.
3. **Given** the same, **When** `docguard memory --pack` writes the pack,
   **Then** the pack contains the note as its own section, naming the release
   date and not a day count, so a pack written on two different days reads the
   same.
4. **Given** a release 14 or fewer days old, **Then** no surface shows the
   note.
5. **Given** the note, **Then** it names the version and release date, says a
   newer version *may* exist (never that one does), and names
   `docguard upgrade` as the way to check. On the guard footer and MCP
   instructions it also gives the age in days.

### User Story 2 - The skills tell the agent what to do with the note (Priority: P1)

An agent using a DocGuard skill reads, in the skill's own text, what to do when
DocGuard reports that it is old: tell the user, offer to run
`docguard upgrade` (which contacts npm only when run), and never upgrade
without the user's yes.

**Why this priority**: The note alone could be ignored or over-acted on; the
skill states the expected behavior once, in the place agents read for
DocGuard procedures.

**Independent Test**: Read each shipped DocGuard skill and confirm the
instruction is present and identical.

**Acceptance Scenarios**:

1. **Given** any shipped DocGuard skill, **Then** it contains the same short
   instruction about the age note.
2. **Given** the instruction, **Then** it says to ask before upgrading and
   never to upgrade unasked.

### User Story 3 - The note never breaks a contract, a pipeline or a test (Priority: P1)

Machine outputs and CI stay exactly as they are.

**Acceptance Scenarios**:

1. **Given** any clock, **Then** `guard --format json`, SARIF, JUnit and
   every MCP tool result are byte-identical to what they would be without
   this feature.
2. **Given** the `CI` environment variable is set, **Then** the guard footer
   shows no note (a CI job pins its version on purpose, as the GitHub Action
   does).
3. **Given** `DOCGUARD_NO_UPDATE_HINT=1`, **Then** no surface shows the note.
4. **Given** DocGuard running from its own source checkout, **Then** no
   surface shows the note, so contributors, this repository's tests and its
   budgets see no change.

### User Story 4 - The privacy statement lists every outbound action (Priority: P2)

A reader of `PRIVACY.md` learns that `docguard upgrade` contacts
`registry.npmjs.org` when, and only when, it is run, and that the age note
makes no network call.

### Edge Cases

- `CHANGELOG.md` is absent from the install, has no heading for exactly the
  running version, or the heading's date does not parse: no note. DocGuard
  never guesses a date.
- The machine clock is earlier than the release date: no note.
- The running version is a pre-release or a local build whose heading is
  `[Unreleased]`: no heading matches, so no note.
- A version heading appears inside a code block or quoted text: only a real
  second-level heading at the start of a line counts.
- The MCP server runs for days: the note is computed when a client
  initializes, so a new session sees the current age.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DocGuard MUST derive the running version's release date only
  from the shipped `CHANGELOG.md` heading for exactly that version
  (`## [X.Y.Z] - YYYY-MM-DD`), and MUST make no network call to do so.
  Missing file, missing heading, an unparseable date, or a clock before the
  release date MUST produce no note.
- **FR-002**: The note MUST appear when, and only when, the release is more
  than 14 days old and none of the suppressions in FR-005 apply.
- **FR-003**: The note MUST name the version and its release date, say that a
  newer version may exist without claiming one does, and name
  `docguard upgrade` as the way to check. The guard footer and MCP
  instructions MUST also give the age in whole days; the context pack MUST
  NOT (so a committed pack does not change daily).
- **FR-004**: The note MUST appear in the MCP server's initialize
  `instructions`, as the last line of guard's text output, and as its own
  section at the end of the context pack. It MUST NOT appear in
  `guard --format json`, SARIF, JUnit, any MCP tool result, or any other
  machine-readable output.
- **FR-005**: Every surface MUST omit the note when `DOCGUARD_NO_UPDATE_HINT=1`,
  or when DocGuard runs from its own source checkout (a `.git` beside its
  `package.json`). The guard footer MUST also stay silent when `CI` is set.
- **FR-006**: Every shipped DocGuard skill MUST carry the same instruction:
  when DocGuard says it is old, tell the user, offer `docguard upgrade`, and
  never upgrade without the user's agreement.
- **FR-007**: `PRIVACY.md` MUST list `docguard upgrade`'s registry fetch as a
  user-initiated outbound action and state that the age note makes no network
  call.
- **FR-008**: The README, `docs/configuration.md` (the opt-out),
  `docs/ai-integration.md` and the CHANGELOG MUST describe the note, its
  threshold and how to turn it off.

### Key Entities

- **Release age**: the running version, its release date from the shipped
  CHANGELOG, the age in whole days at the time of reading, and whether the
  note is shown and why not when it is not (for tests and debugging).

## Success Criteria *(mandatory)*

- **SC-001**: With the clock 15 days after a version's release, each of the
  three runtime surfaces shows the note; at 14 days none does.
- **SC-002**: Across every clock the test sweeps, the machine outputs in
  FR-004 are byte-identical to a build without this feature.
- **SC-003**: The feature adds no network call: a run with networking
  disabled produces the same note as one with it.
- **SC-004**: On this repository (a source checkout), guard text, the context
  pack and the agent-facing budget rows are unchanged.

## Assumptions

- Release prep writes `## [X.Y.Z] - YYYY-MM-DD` for every release, and the
  release workflow reads the same heading for its release notes.
- Every distribution channel built from `npm pack` (npm, MCPB, GHCR,
  Homebrew) ships `CHANGELOG.md`. A channel without it shows no note, which is
  the safe failure.
- 14 days is a maintainer decision, fixed, not configurable.

## Out of Scope

- Any network call outside `docguard upgrade`.
- Upgrading automatically, or prompting interactively.
- A configurable threshold.
- Telling the user which newer version exists (that needs the network; run
  `docguard upgrade`).

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `7f7921f8390140b97f59231500b987be8cbd02f1` — Reviewed at 7f7921f on main: all 10 tasks are checked and were delivered by #490, #491; the full suite (2425 tests) passes and guard reports 0 errors at this revision. #491 added the FR-008 docs test, which caught a README row that did not name docguard upgrade. Evidence: `cli/release-age.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/ENVIRONMENT.md`, `docs-canonical/SECURITY.md`, `tests/update-awareness.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
