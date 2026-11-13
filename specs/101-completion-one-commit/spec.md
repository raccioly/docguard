# Feature Specification: Close a Spec in One Commit

**Feature Branch**: `feat/101-completion-one-commit`

**Created**: 2026-11-13

**Status**: Active

**Spec ID**: `docguard.completion-one-commit`

**Lineage**: Amends `docguard.completion-revision-anchoring` (spec 028: FR-001 the clean-tree rule, FR-002 SPR008, FR-003 reanchor, FR-004 the squash warning), `docguard.first-spec-preflight` (spec 040: its Out of Scope line that kept `persistenceModel` and `canonicalDocs` hand-edited) and `docguard.enforcement-ladder` (spec 083: SC-003's note that DLC002 "fires by design" between a merge and the completion record). Each carries a dated amendment note. Reported by an adopter that runs strict enforcement with a gate that runs `docguard guard` on every commit and fails on warnings. Number 100 belongs to another branch.

**Input**: "Closing a spec cannot land cleanly under a per-commit gate, and the record of the review does not survive a squash merge or a rebase."

## Problem

An adopter whose gate runs `guard` on every commit, and fails on warnings, cannot close a spec. This repository pays the same costs on every completion. Four defects, each reproduced:

1. **P1: two commits, and the first is red.** `specs complete` refuses to run while the spec's last task tick is uncommitted (SPC001: `tasks.md` changed), so the tick is committed first, and that commit raises DLC002 (all tasks checked, no completion record). A per-commit gate fails on it.
2. **P2: two hand edits of the registry.** `complete` requires `reviewed.scope.canonicalDocs` (SPC005), and DLC002 clears only for a spec whose `reviewed.lifecycle.persistenceModel` is `living`. Neither has a command-line flag, so both are edited by hand in `.docguard-specs.json`: about 30 such commits in this repository's history. Adopters reasonably forbid hand edits of the registry.
3. **P3: a second "reanchor" commit after every squash or rebase.** The record stores a commit id (`revision`, `lastReviewedRevision`). After a squash merge or a rebase (same tree, new ids) that id is not an ancestor of `HEAD`: SPR008 fires and `tests/completion-revision-anchoring.test.mjs` fails on `main` until a second commit lands. This repository paid it on `864eacb` then `9fea8e5`.
4. **P4: a blind spot.** Hand-setting `delivery: verified` and `living` with no recorded outcome silences DLC002 and guard reports nothing.

Reproduction of P1 and P3 (strict enforcement, one spec `acme.alpha` with `T2` open, a source file with `@implements`, a test with `@req`, `docs-canonical/ARCHITECTURE.md`):

```
docguard specs --write && docguard specs approve --id acme.alpha --delivery in_progress --write
# today: hand-edit canonicalDocs and persistenceModel, commit
# tick T2; docguard specs --write
docguard specs complete --id acme.alpha --since HEAD~1 --reason done --write   # SPC001: tasks.md changed
git commit -am tick                                                             # guard: DLC002
docguard specs complete --id acme.alpha --since HEAD~1 --reason done --write   # records the parent
git commit -am record                                                           # guard: clean
git reset --soft HEAD~2 && git commit -m squashed                               # guard: SPR008
```

## What the evidence says

The outcome's `evidence` is the sorted list of the implementation files, test files and canonical documents. It excludes `spec.md`, `tasks.md` and the registry, so a hash of the evidence cannot refer to itself. A commit id is truly needed only as a diff base (`--since`, `narrowedFrom`, "changed since the last review"). SPR008 and `reanchor` only need to know that what was reviewed is what is on this history, which blob equality of every evidence file already defines (spec 028 FR-003: "whose evidence blobs equal the old revision's").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One commit closes a spec (Priority: P1)

1. **Given** a spec with one open task, **When** the maintainer ticks it, runs `specs --write`, then `specs complete --id <id> --canonical-doc <path> --write --reason <text>`, **Then** nothing blocks, and one commit holds the tick, the registry record and the outcome block.
2. **Given** that commit and every commit before it, **When** `guard` runs at each, **Then** none reports a DLC, SPC or SPR finding.
3. **Given** a tick plus any other content change in that `tasks.md`, **Or** a tick in another spec's `tasks.md`, **Then** completion is still blocked (SPC001).

### User Story 2 - No hand edit of the registry (Priority: P1)

1. **Given** `specs approve --id <id> --persistence living --canonical-doc <path> --write`, **Then** the registry holds `persistenceModel: living` and the sorted, deduplicated paths, and approval is not reported as unchanged.
2. **Given** a `--canonical-doc` that does not exist, or a `--persistence` outside the schema's values, **Then** the command is refused and writes nothing.
3. **Given** SPC005, **Then** its message names `--canonical-doc`.

### User Story 3 - The record survives a squash or a rebase (Priority: P1)

1. **Given** a completion committed on a branch, **When** the branch is squash-merged, or rebased onto a moved base, **Then** SPR008 does not fire, `tests/completion-revision-anchoring.test.mjs` needs no reanchor commit, and the next `complete` finds its diff base without `--since`.
2. **Given** evidence that changed between review and landing, **Then** SPR008 fires and names the files that differ.
3. **Given** a record written by a version without content anchors, **Then** behavior is exactly as before: SPR008 on a dangling revision, and `specs reanchor` fixes it.
4. **Given** a later commit on `main` that legitimately edits an evidence file, **Then** SPR008 does not fire.

### User Story 4 - A hand-set verified state is reported (Priority: P2)

1. **Given** a current spec whose delivery is `verified` or `released` and that has no recorded outcome, **Then** guard reports it (SPR010), and `specs --check` lists it.

### User Story 5 - Both directions are compatible (Priority: P1)

1. **Given** a registry written by 0.48.0, **Then** this version loads it unchanged. **Given** a registry written by this version, **Then** 0.48.0 loads it with the same findings as before the completion.

## Requirements *(mandatory)*

- **FR-001** *(amends spec 028 FR-001)*: `specs complete --id X` MUST treat X's own `tasks.md` as a lifecycle file: an uncommitted change that only changes task checkbox state (`[ ]`, `[x]`, `[X]`) in that file does not block. Any other content change in it, and any change to another spec's `tasks.md`, MUST still block with SPC001.
- **FR-002**: `specs complete` and `specs approve` MUST accept `--canonical-doc <path>`, repeatable. Each path MUST exist and be a safe repository-relative path outside `.local`. The list is stored sorted and deduplicated and replaces the recorded list when given. A missing path MUST be refused, and nothing written.
- **FR-003**: `specs complete` and `specs approve` MUST accept `--persistence living|flow_forward|flow_back`, the values the registry schema allows. Any other value MUST be refused. `approve` MUST NOT report CURRENT when `--persistence` or `--canonical-doc` would change the registry.
- **FR-004**: SPC005's message MUST name `--canonical-doc`, and `docguard specs --help`, `docs/commands.md` and `DATA-MODEL.md` MUST describe both flags.
- **FR-005** *(amends spec 028 FR-003's record)*: Each outcome `specs complete --write` records MUST also record, for every evidence file, the git blob id it had at completion. The record is the spec's machine-owned outcome line in `spec.md` (`Blobs:` after the cleaned fields), written in the same transaction as the registry. The registry's own shape does not change (FR-010). One read helper and one write helper in `cli/writers/spec-outcomes.mjs` are the only code that knows the carrier.
- **FR-006** *(amends spec 028 FR-002)*: SPR008 MUST NOT fire for a recorded revision that is an ancestor of `HEAD`, or that is not, when its outcome carries blob ids and the first-parent commit that introduced the revision into the registry has exactly those blobs at those paths. It fires otherwise, and its message names the evidence files that differ from what was reviewed. A shallow clone keeps reporting partial coverage.
- **FR-007**: The diff base for the next `specs complete` (the default of `--since`, and the check of an explicit `--since`) MUST be the recorded revision when it is an ancestor of `HEAD`, otherwise the commit FR-006 found. When neither exists and the record has blob ids, `--since` is required and the message says so. A record without blob ids behaves as before.
- **FR-008** *(amends spec 028 FR-003)*: `specs reanchor` MUST keep working for records without blob ids and for attestations. When it moves a revision by blob equality, it MUST backfill the blob ids for the moved record's latest outcome.
- **FR-009**: The FR-006 search MUST cost at most a fixed number of git processes per spec (one history query and one blob lookup), and its result MUST be cached under `.docguard/`, keyed by the registry entry and `HEAD`, so a guard run does not repeat it. A cache that cannot be read or written MUST NOT change a verdict.
- **FR-010**: A registry written by 0.48.0 MUST load unchanged. A registry and specs written by this version MUST load in 0.48.0 with the same finding set as the same repository before the completion, and no configuration or schema error. Hence the registry carries no new key (see the plan's "Disagreement with the brief").
- **FR-011**: A current spec whose delivery is `verified` or `released` and whose registry entry has no outcome MUST be reported: by SPR010 (warn) in the Spec-Registry validator, and in `specs --check` text and JSON (`unrecordedCompletions`).
- **FR-012** *(amends spec 028 FR-004)*: The warning `specs complete --write` prints when `HEAD` is not on the remote default branch MUST say that a squash merge discards that commit and that the record stays anchored by its evidence blobs, and MUST keep recommending `specs reanchor` only for a record that has none.
- **FR-013**: This repository's `AGENTS.md`, `CONTRIBUTING.md` and every document that describes the reanchor step or hand-editing `canonicalDocs` MUST describe the one-commit flow.

## Success Criteria *(mandatory)*

- **SC-001**: The adopter scenario runs end to end with no hand edit of the registry, in one commit, and `guard` reports no DLC, SPC or SPR finding at that commit or at any earlier commit of the fixture.
- **SC-002**: After a squash and after a rebase onto a moved base, SPR008 does not fire and no reanchor commit is needed. After evidence changes between review and landing, it fires and names the files.
- **SC-003**: This specification is completed with the new flow in its own pull request, and a local simulation of the squash merge leaves `guard` and `tests/completion-revision-anchoring.test.mjs` green with no second commit.

Reported in the pull request, not as criteria: which tests of `tests/spec-completion-one-commit.test.mjs` fail on `main`, which existing test changed and why, and how many specs SPR010 would flag on this repository and on other repositories with a registry, measured before it was wired in.

## Edge Cases

- A record with a revision that does not resolve in a clone that has the commit pruned: blob ids still answer, because the search needs no old commit.
- A spec with more than 100 evidence files: the outcome already caps evidence at 100; blob ids follow the same cap.
- An evidence file deleted after review: its blob id is absent at the landing commit, so it counts as differing and is named.
- Two outcomes of one spec at one revision: the later line replaces the earlier, as today.
- A spec that is not `living`: `complete` still records the outcome; DLC002 follows spec 006's rule (the spec is a retirement candidate).
- `--canonical-doc` given on a dry run: the plan applies it in memory and writes nothing.

## Out of Scope

- Commands for `relations` and `sourcePaths`, and for `assetPaths`: `complete` requires none of them, so they stay reviewed edits.
- Moving the SPR008 or DLC002 gate itself: they stay warnings under the same rules.
- Retiring or archiving a completed spec.
- A `schemaVersion` bump: 0.48.0 refuses it.
