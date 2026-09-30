# Feature Specification: Completion Revision Anchoring

**Feature Branch**: `fix/completion-revision-anchoring`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.completion-revision-anchoring`

**Lineage**: refines `docguard.document-lifecycle` (completion transaction and
reviewed revisions). Found while verifying specs 014–027 for 0.43.0 (#455).

**Input**: User description (dogfood finding): "`specs complete` records a
revision that a squash merge discards, and a batch of completions cannot share
one revision."

## Problem

`specs complete --write` records the current `HEAD` as
`reconciliation.lastReviewedRevision`, as each outcome's `revision`, and in the
active context's `generatedFrom`. The next maintenance completion reconciles
from that revision. Two things break under the squash-merge workflow that this
repository and most GitHub projects use:

1. **The recorded revision disappears.** A completion committed on a PR branch
   records that branch's commit, and the squash merge never puts it on `main`.
   Four specs in this repository already point at commits that are not on
   `main` (`evidence-scoped-verification`, `language-repository-coverage`,
   `precision-evidence-loop`, `task-specific-agent-context`). A shallow or fresh
   clone cannot resolve them, so their next maintenance completion cannot
   reconcile.
2. **A batch cannot share one anchor.** Completion requires a clean tracked
   tree, so the second completion in a session needs the first committed, which
   moves `HEAD` off the default branch. Completing 12 specs produced 12 branch
   revisions, none of which would survive the merge.

Nothing reports either condition. The registry says "verified at X" whether or
not X exists.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete several specs against one revision (Priority: P1)

A maintainer branches from `main`, runs `specs complete --write` for several
specs in a row, and commits once. Every outcome records `main`'s tip.

**Acceptance Scenarios**:

1. **Given** a clean tree at revision R, **When** two completions run back to
   back, **Then** both succeed and both record R.
2. **Given** a tracked change outside the lifecycle files (source, test, docs,
   or spec prose outside the outcomes block), **Then** completion is still
   blocked (SPC001).

### User Story 2 - A dangling revision is reported (Priority: P1)

1. **Given** a registry revision that does not resolve or is not an ancestor of
   `HEAD`, **When** guard runs, **Then** SPR008 names the spec, the revision and
   the re-anchor command.
2. **Given** a shallow clone, **Then** the check reports `partial` coverage
   instead of a finding, because ancestry cannot be known.

### User Story 3 - Re-anchor without inventing evidence (Priority: P1)

1. **Given** a dangling revision that still resolves locally, **When**
   `specs reanchor --id <id> --write` runs, **Then** DocGuard finds the oldest
   first-parent commit of `HEAD` after the merge base whose blobs for every
   evidence file equal those at the old revision. It moves the spec's
   `lastReviewedRevision` and matching outcome revisions there, in one
   transaction, and records `reanchoredFrom`.
2. **Given** no such commit, **Then** nothing is written and the differing
   files are listed.
3. **Given** an old revision that no longer resolves, **Then** re-anchoring
   requires `--to <rev> --reason <text>` and records that the evidence
   equivalence was attested, not checked.
4. **Given** a target whose evidence differs from the reviewed bytes (the PR
   kept changing after its completion), **When** `--to <rev> --reason <text>`
   is passed, **Then** the anchor moves as attested and the differing evidence
   files are recorded. Without `--reason` nothing is written.

### User Story 4 - Warned before it happens (Priority: P2)

1. **Given** `HEAD` not reachable from the remote default branch, **When**
   `specs complete --write` runs, **Then** it succeeds and prints a warning: a
   squash merge will discard this revision; complete on a branch at the default
   branch's tip, or re-anchor after merging.

### Edge Cases

- A spec whose outcome block was hand-edited alongside a completion is not
  "lifecycle-only"; the whole spec file then counts as a tracked change.
- A repository with no remote, or no `origin/HEAD`, skips the User Story 4
  warning. It never guesses a default branch.
- Re-anchoring never changes an outcome's reason, evidence or deviations.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The completion clean-tree check MUST ignore tracked changes
  confined to the lifecycle files completion writes:
  - the spec registry;
  - the active context file;
  - a spec file whose content, with its implementation-outcomes block removed,
    equals the committed content with its block removed.
- **FR-002**: The Spec-Registry validator MUST emit SPR008 (warn) for each spec
  whose `lastReviewedRevision` or outcome revision does not resolve or is not an
  ancestor of `HEAD`. In a shallow repository it MUST report partial coverage
  instead.
- **FR-003**: `specs reanchor --id <id> [--to <rev>] [--write --reason <text>]`
  MUST find, or accept, a target revision that is an ancestor of `HEAD` and
  whose evidence blobs equal the old revision's, or accept an attested target
  (`--to` with `--reason`) whose differing evidence files it records. It MUST rewrite
  `lastReviewedRevision`, the affected outcome revisions (registry and spec
  outcome block) and `reanchoredFrom` through `commitFileTransaction`. Without a
  resolvable old revision it MUST require both `--to` and `--reason`.
- **FR-004**: `specs complete --write` MUST warn when `HEAD` is not reachable
  from the remote default branch.
- **FR-005**: `docs/commands.md`, DATA-MODEL (`reanchoredFrom`) and CI-RECIPES
  (the completion workflow under squash merges) MUST document the behaviour.
- **FR-006**: `specs reanchor --from <revision>` MUST limit the command to that
  one dangling revision (a unique prefix of at least 7 characters). One spec's
  dangling revisions can come from different merges, and a single `--to` would
  otherwise attest all of them to one merge. Other dangling revisions MUST stay
  untouched.

## Success Criteria *(mandatory)*

- **SC-001**: In a fixture, three completions run back to back without
  intermediate commits all record the same revision, and the registry is
  CURRENT after one commit.
- **SC-002**: A fixture that squash-merges a completion branch reports SPR008,
  and `specs reanchor --write` clears it by moving the anchor to the squash
  commit.
- **SC-003**: This repository's dangling specs, and the completions of the
  specs delivered since, end with every recorded revision on `main`.

## Assumptions

- Blob equality of every evidence file is the right equivalence. The outcome's
  evidence list is what the review looked at.
- `origin/HEAD` names the default branch when present.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `dfa1385749b66184c93bf65f5dde127192037711` — Reviewed at dfa1385 on main: all 6 tasks are checked and were delivered by #472, #473, #475, #483; the full suite (2368 tests) passes and guard reports 0 errors at this revision. Deviations from the plan are recorded in the task notes. Evidence: `cli/commands/specs.mjs`, `cli/scanners/revision-anchor.mjs`, `cli/validators/spec-registry.mjs`, `cli/writers/spec-outcomes.mjs`, `docs-canonical/CI-RECIPES.md`, `docs-canonical/DATA-MODEL.md`, `tests/completion-revision-anchoring.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
