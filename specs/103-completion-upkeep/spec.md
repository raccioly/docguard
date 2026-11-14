# Feature Specification: Keep Completions Current

**Feature Branch**: `feat/103-completion-upkeep`

**Created**: 2026-11-13

**Status**: Draft

**Spec ID**: `docguard.completion-upkeep`

**Lineage**: Amends `docguard.completion-one-commit` (spec 101: FR-001 the clean-tree rule gains tag-only edits, FR-005 the evidence blobs are also read after landing), which amended `docguard.completion-revision-anchoring` (spec 028). Each carries a dated amendment note. Closes the first-use report in issue 684. Numbers 100 and 102 belong to other branches.

**Input**: "A pull request that edits a completed spec's evidence files without closing the spec again is invisible to CI: on the merge ref the record landed with the main branch's squash commit, so its blobs match and SPR008 stays silent. The drift appears only for a developer who merges main into a branch. Guard should warn about it, and one command should close every spec that drifted. Also fix the friction in issue 684."

## Problem

1. **A closed spec drifts without a signal.** Spec 101 made a record carry the git blob of every evidence file. SPR008 compares those blobs with the commit that landed the record, so a squash merge or a rebase cannot strand it. That is also why a later edit is not seen: on a pull request's merge ref the landing commit of the record is main's squash commit, whose blobs match, and nothing compares the record with the files as they are now. Reproduced with a fixture: complete a spec on branch A, squash-merge A to main, edit an implementation file of the spec on branch B, and run guard on the merge of B into main. Guard reports nothing. The same edit is reported (SPR008) by a developer who merges main into the branch, because then the landing commit is an ancestor. Issue 684's first real use hit it: a stage-2 pull request changed the evidence of specs 093, 094 and 095 and only a local pre-push run noticed.
2. **Closing again is one command per spec, and each runs guard.** `specs complete` plans and writes one spec, and runs the whole guard for each. A change that touches the evidence of eight specs is eight runs.
3. **Six friction points from the first use of the one-commit flow** (issue 684): tagging and closing take two commits; there is no recipe for requirements without a code target (SPC004); SPC006 lists a wall of files and does not say which later `--since` would resolve them; a wide range is slow (over 120 seconds); `complete --write` prints nothing about what it wrote; the `**Status**:` header of the spec is not updated. An unknown spec ID gives no "did you mean" hint.

### Measured before the warning was wired in

Replay of the last 30 squash commits on main, each against its parent. A spec is counted when its latest outcome was not rewritten by that commit and the commit changed one of the files that outcome lists.

| Counted evidence | Median specs per commit | Mean | Max | Commits with more than 3 | Commits with none |
|---|---|---|---|---|---|
| All evidence, canonical documents included | 2 | 27.2 | 85 | 13 of 30 | 11 |
| Without the spec's canonical documents | 2 | 9.7 | 81 | 12 of 30 | 11 |
| Without them, and without edits that only touch tag lines of other specs | 2 | 9.7 | 81 | 12 of 30 | 11 |

Among the 19 commits that change any evidence the median is 8 specs. Counting canonical documents byte for byte nearly triples the mean (27.2 against 9.7): one edit to `ARCHITECTURE.md` would flag every spec that lists it. Excluding tag-only edits changes nothing (0 of 30 commits). The files that flag most are shared hubs: `cli/findings.mjs` (28 spec-commit pairs), `tests/program-verification.test.mjs` (23), `cli/docguard.mjs` (15). Only four records carry blobs today (093, 094, 095, 101), so as specified the warning would have flagged none of those 30 commits and flags no spec on the tip of main; the table is the steady state each `--stale` run moves the repository toward.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A pull request that edits a closed spec's evidence is warned (Priority: P1)

1. **Given** a spec completed on a branch and squash-merged to main, **When** another branch edits one of its implementation files and guard runs on that branch's merge ref, **Then** SPR011 names the spec, the changed file and the command that closes it again.
2. **Given** the same branch where only a canonical document the spec lists changed, **Then** nothing is reported.
3. **Given** a record written before blobs existed, **Then** it is not judged.

### User Story 2 - One command closes every spec that drifted (Priority: P1)

1. **Given** several specs flagged by SPR011, **When** `docguard specs complete --stale --reason "<text>" --write` runs, **Then** each is closed again, keeping its canonical documents and persistence, in one transaction, and guard is clean afterwards.
2. **Given** one of them is blocked, **Then** nothing is written and every blocker is listed with its spec.
3. **Given** the branch is then squash-merged onto main, **Then** SPR008 and SPR011 stay silent.

### User Story 3 - Tagging and closing take one commit (Priority: P2)

1. **Given** uncommitted edits that only add `@implements` or `@req` tags for the spec being completed, **When** `specs complete` runs, **Then** it is not blocked, and the recorded blobs are the files' content as committed afterwards.

### User Story 4 - The first-use friction is gone (Priority: P2)

1. A requirement without a code target has a recipe (AGENTS.md, SPC004's help text).
2. SPC006 names the earliest ref after which no unresolved file remains.
3. `complete --write` prints what it wrote; the spec's `**Status**:` header is updated; an unknown spec ID suggests the closest IDs.

## Requirements *(mandatory)*

- **FR-001** *(amends spec 101 FR-005, FR-006)*: The Spec-Registry validator MUST emit SPR011 (warn, not inline-suppressible) for each current spec whose delivery is `verified` or `released` and whose latest outcome carries evidence blobs, when the blob at `HEAD` of any of those files differs from the recorded one, or the file is gone. The message MUST name the spec, each changed file (at most five, then a count) and the command that closes it again. Only the latest outcome is judged.
- **FR-002**: SPR011 MUST NOT compare the spec's canonical documents (`reviewed.scope.canonicalDocs`), and MUST NOT judge an outcome that records no blobs. A file whose only change is to tag lines for other specs is compared like any other: the replay measured no effect (0 of 30 commits), so that exemption is not built.
- **FR-003**: SPR011 MUST read only `HEAD`'s tree, with one `git cat-file --batch-check` for every spec, so it works in a shallow clone and adds a constant number of git calls. When git cannot answer, it MUST report nothing.
- **FR-004**: `docguard specs complete --stale --reason <text> [--write]` MUST close again every spec SPR011 flags, each as a maintenance completion that keeps its recorded `canonicalDocs` and `persistenceModel`. It MUST refuse `--id`, `--since`, `--canonical-doc`, `--persistence` and `--successor`, and report CURRENT, writing nothing, when no spec is flagged.
- **FR-005**: `--stale` MUST plan every spec before writing anything, against one guard run, and write the registry, the active context and every spec in one transaction. When any spec is blocked it MUST write nothing and list every blocker with its spec ID.
- **FR-006**: Planning several completions MUST compute the reconciliation once per distinct base revision and the anchor status once, so the cost does not grow with the number of specs sharing a base.
- **FR-007** *(amends spec 101 FR-001)*: `specs complete` MUST NOT be blocked by an uncommitted change that only adds `@implements` or `@req` tags for requirements of the spec being completed. Any other edit MUST still block with SPC001. The blob recorded for such a file MUST be the working-tree content, so that after the commit neither SPR008 nor SPR011 fires.
- **FR-008**: SPC004's help text and `AGENTS.md` MUST describe the pattern for a requirement with no code target (a documentation requirement, a one-time outcome): a test that asserts the document's terms (`describes()`) or the recorded result in the spec's Verification Notes (`recorded()`), tagged `@req`, as `tests/program-verification.test.mjs` does.
- **FR-009**: SPC006's "Unresolved changed files" message MUST name the earliest commit after which no unresolved file remains, found with one bounded `git log`, and say what choosing it skips.
- **FR-010**: `specs complete --write` MUST print what it wrote: the registry fields it changed, the outcome line and the number of evidence blobs recorded. `--format json` carries the same.
- **FR-011**: `specs complete --write` MUST set the spec's `**Status**:` header to `Active` when it reads `Draft`, `In Progress`, `Implemented` or `Planned`, and leave any other value. The clean-tree check MUST ignore a change confined to that line, as it ignores the outcomes block.
- **FR-012**: An unknown spec ID in `complete`, `approve` and `reanchor` MUST list the closest recorded IDs (at most three).
- **FR-013**: SPR011 MUST be registered with a title and help (`docguard explain`), in the generated findings reference and in `docs/commands.md`, and `CHANGELOG.md` MUST say it adds a warning to strict.
- **FR-014**: Wide-range completion MUST NOT run guard or the reconciliation once per spec (FR-005, FR-006); the plan records what made a wide range slow and what changed.

## Success Criteria *(mandatory)*

- **SC-001**: The pull-request fixture of User Story 1 reports SPR011 on this version and nothing on main's code (where the check does not exist); after `specs complete --stale --write` guard is clean, and a squash of the branch onto main stays clean.
- **SC-002**: A batch with one blocked spec writes no byte.
- **SC-003**: SPR011 flags nothing on the tip of main, and this specification is closed with its own `--stale` run for every spec whose evidence it edits.

## Edge Cases

- A spec closed twice: only the latest outcome is read.
- A file deleted after review: counted as changed, named.
- A spec that is not `living`: `--stale` cannot close it again (SPC002) and refuses the batch, naming it.
- Evidence edited and the spec closed again in the same branch: the new blobs match, SPR011 is silent.
- A branch that merges main after main re-closed the spec: the record is main's and matches main's files.

## Out of Scope

- Comparing canonical documents byte for byte (Freshness and requirement anchors cover them).
- A tag-line exemption for other specs' tags: measured at no effect.
- Exempting shared hub files from SPR011: the replay shows they cause most of the count, and that decision stays with the owner.
- Accepting uncommitted changes to the anchor lock in `complete`.
