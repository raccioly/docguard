# Feature Specification: A Project's First Spec Can Pass Preflight

**Feature Branch**: `fix/first-spec-preflight`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.first-spec-preflight`

**Lineage**:
- Corrects `docguard.document-lifecycle`, which defined the two-stage preflight
  (FR-012 to FR-015) and the `docguard specs` command family (FR-020).
- Touches `docguard.spec-first-gate` (the gate's fix hint and unresolved
  references) and `docguard.completion-revision-anchoring` (`reanchor --to`).

**Input**: Bug report: "The first spec in a project can never pass the
generated-spec preflight", with five related defects found while reproducing it.

## Problem

The Spec Kit `before_tasks` hook runs `docguard specs preflight --path <spec>`
and is mandatory. In a project whose first spec is being drafted it always
blocks:

- With no registry, preflight reports SPR001 "Refresh the committed registry",
  although the briefing says a missing registry is valid when there are no
  prior specs.
- After `docguard specs --write`, preflight reports SPR004 "Registry spec … is
  absent from the working tree" and SPR001, while `specs --check` says CURRENT.

Preflight builds its baseline without the draft. The draft's own registry
entry then reads as a spec that disappeared, and a missing registry never
counts as current when a path is given. The same happens to any later spec
once `specs --write` has registered it.

Five smaller defects sit on the same path:

1. Approving a spec means hand-editing `.docguard-specs.json`. `specs complete`
   blocks with SPC002 "Only an approved spec can become verified" and does not
   say how to approve.
2. `docguard explain SPC001` answers "No matching validator". No SPC code is
   explainable.
3. The spec-first gate's fix hint names DocGuard's own
   `specs/015-spec-first-gate` in every project. An unknown Spec ID reference
   is silently ignored, while an unknown path is listed. The 10-character
   minimum for an exemption reason is not in the command docs.
4. `specs complete` prints `implemented→verified` whatever the delivery state.
5. `specs reanchor --to HEAD` fails with "must be a full revision".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The first spec passes preflight (Priority: P1)

A team adopts DocGuard and Spec Kit and drafts its first spec. The mandatory
preflight lets them continue to tasks.

**Acceptance Scenarios**:

1. **Given** a repository with no registry whose only spec is the draft,
   **When** preflight runs with `--path` on the draft, **Then** it is READY.
2. **Given** the same repository after `specs --write` and a commit, **When**
   preflight runs again, **Then** it is READY and `specs --check` is CURRENT.
3. **Given** a registry that is stale for another spec, **When** preflight runs
   with `--path`, **Then** it blocks with SPR001, as today.
4. **Given** a second spec, registered or not, **When** preflight runs on it,
   **Then** it is READY when the registry is current for every other spec.

### User Story 2 - Approve a spec with a command (Priority: P1)

A maintainer approves a spec and records its delivery state without editing
JSON by hand.

**Acceptance Scenarios**:

1. **Given** a draft spec in a current registry, **When** the maintainer runs
   `docguard specs approve --id <id> --write`, **Then** the registry records
   `approval: approved` and nothing else changes.
2. **Given** `--delivery implemented`, **Then** delivery is recorded as
   `implemented`, and `specs complete` no longer blocks on SPC002.
3. **Given** `--delivery verified`, or a verified spec and an earlier delivery,
   **Then** the command blocks: verification belongs to `specs complete`.
4. **Given** a spec that is not approved, **When** `specs complete` runs,
   **Then** SPC002 names `docguard specs approve`.

### User Story 3 - Every blocker code is explained (Priority: P2)

**Acceptance Scenarios**:

1. **Given** any code SPC001 to SPC008, **When** `docguard explain <code>`
   runs, **Then** it prints what the code means and how to clear it.

### Edge Cases

- **The draft's Spec ID changes after it was registered:** the registry entry
  at the draft's path is still the draft's own entry and is not reported.
- **The draft reuses another spec's ID:** SPR002, as today.
- **No registry, and an archive already records retired specs:** the project
  has prior specs, so SPR001 still blocks.
- **`specs approve` on a retired spec, an unknown ID, or with a stale
  registry:** blocked with SPC001.
- **`reanchor --to` with a value that starts with `-`:** refused; it is never
  passed to git as an option.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `specs preflight --path <draft>` MUST judge the registry against
  every spec except the draft. The draft's own registry entry, present or
  absent, current or stale, MUST NOT produce SPR001 or SPR004.
- **FR-002**: With no registry, `specs preflight --path` MUST NOT report SPR001
  when the draft is the only spec and the archive records no retired spec.
- **FR-003**: A registry that is missing or stale for any spec other than the
  draft MUST still block with SPR001. Identity (SPR002), path (SPR003) and
  lineage (SPR004) blockers are unchanged.
- **FR-004**: The briefing (`Current specs: N`) MUST list the same specs with
  and without `--path`.
- **FR-005**: `docguard specs approve --id <id> [--delivery
  planned|in_progress|implemented] [--write]` MUST record `approval: approved`
  and, when given, the delivery state, for a current spec in a current
  registry. It plans by default and writes only with `--write`. It MUST refuse
  `verified` and `released`, and MUST refuse to move a verified or released
  spec to an earlier state. It MUST NOT read approval from the spec's prose.
- **FR-006**: SPC002 messages from `specs complete` MUST name the
  `docguard specs approve` command that clears them.
- **FR-007**: `docguard explain` and the MCP `docguard_explain` tool MUST
  explain every SPC code. SPC codes are command blockers, not findings:
  `findingSeverity` MUST keep rejecting them.
- **FR-008**: The spec-first gate's fix hint MUST NOT name a DocGuard spec. A
  Spec ID written after `Spec:` or `Spec ID:` that matches no spec MUST be
  listed as an unresolved reference.
- **FR-009**: `specs complete` MUST report the transition from the spec's
  recorded delivery state (for example `planned→verified`,
  `verified→verified`), and none for an unknown spec.
- **FR-010**: `specs reanchor --to <revision>` MUST accept any revision git
  resolves to a commit (a branch, tag, `HEAD`, or an abbreviated SHA) and
  record the full SHA. A value starting with `-` MUST be refused.
- **FR-011**: `docs/commands.md`, the README command table, DATA-MODEL's
  registry section, SECURITY's write table and the CHANGELOG MUST describe
  `specs approve`, the first-spec preflight, the exemption reason's
  10-character minimum and the revisions `reanchor --to` accepts.

## Success Criteria *(mandatory)*

- **SC-001**: In a fresh repository whose only spec is the draft, preflight
  with `--path` is READY before and after `specs --write`, and
  `specs --check` is CURRENT after the write.
- **SC-002**: A spec goes from draft to verified using only DocGuard commands,
  with no hand edit to `.docguard-specs.json`.
- **SC-003**: `docguard explain` exits 0 for every SPC code used by the CLI.

## Assumptions

- Reviewed registry fields are attested by the person who changes them and
  reviewed in the pull request that commits the registry. A command that
  writes them replaces the hand edit, not the review.
- "Retired spec recorded by the archive" means a tombstone in the projection.

## Out of Scope

- Reading `**Status**: Approved` from spec prose (rejected: spec prose is
  generated by agents and observed by the projection; a reviewed field would
  then be derived from content an agent writes).
- Recording an approval rationale in the registry (it has no field for one;
  adding it is a schema change).
- Commands for `persistenceModel`, `canonicalDocs` and relations; they stay
  hand-reviewed edits.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `d17dee0a5924795582cae3b0fcd97bfdbad93c76` — Reviewed at d17dee0 on main: all 10 tasks are checked and were delivered by #499; the full suite (2909 tests) passes and guard reports 0 errors at this revision. Evidence: `cli/commands/explain.mjs`, `cli/commands/mcp.mjs`, `cli/commands/specs.mjs`, `cli/findings.mjs`, `cli/scanners/revision-anchor.mjs`, `cli/scanners/spec-first.mjs`, `cli/scanners/spec-registry.mjs`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/SECURITY.md`, `tests/first-spec-preflight.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
