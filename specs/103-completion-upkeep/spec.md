# Feature Specification: Keep Completions Current

**Feature Branch**: `feat/103-completion-upkeep`

**Created**: 2026-11-13

**Status**: Active

**Spec ID**: `docguard.completion-upkeep`

**Lineage**: Amends `docguard.completion-one-commit` (spec 101: FR-001 the clean-tree rule gains tag-only edits, FR-005 the evidence blobs are also read after landing, FR-007 the diff base is also searched in the rest of HEAD's ancestry), which amended `docguard.completion-revision-anchoring` (spec 028). Each carries a dated amendment note. Closes the first-use report in issue 684. Numbers 100 and 102 belong to other branches.

**Input**: "A pull request that edits a completed spec's evidence files without closing the spec again is invisible to CI: on the merge ref the record landed with the main branch's squash commit, so its blobs match and SPR008 stays silent. The drift appears only for a developer who merges main into a branch. Guard should warn about it, and one command should close every spec that drifted. Also fix the friction in issue 684."

## Problem

1. **A closed spec drifts without a signal.** Spec 101 made a record carry the git blob of every evidence file. SPR008 compares those blobs with the commit that landed the record, so a squash merge or a rebase cannot strand it. That is also why a later edit is not seen: on a pull request's merge ref the landing commit of the record is main's squash commit, whose blobs match, and nothing compares the record with the files as they are now. Reproduced with a fixture: complete a spec on branch A, squash-merge A to main, edit an implementation file of the spec on branch B, and run guard on the merge of B into main. Guard reports nothing. The same edit is reported (SPR008) by a developer who merges main into the branch, because then the landing commit is an ancestor. Issue 684's first real use hit it: a stage-2 pull request changed the evidence of specs 093, 094 and 095 and only a local pre-push run noticed.
2. **Closing again is one command per spec, and each runs guard.** `specs complete` plans and writes one spec, and runs the whole guard for each. A change that touches the evidence of eight specs is eight runs.
3. **Six friction points from the first use of the one-commit flow** (issue 684): tagging and closing take two commits; there is no recipe for requirements without a code target (SPC004); SPC006 lists a wall of files and does not say which later `--since` would resolve them; a wide range is slow (over 120 seconds); `complete --write` prints nothing about what it wrote; the `**Status**:` header of the spec is not updated. An unknown spec ID gives no "did you mean" hint.

### Measured before the warning was wired in

Replay of the 30 squash commits on main that end at the performance change merged on 2026-11-13, each against its parent. A spec is counted when its latest outcome was not rewritten by that commit and the commit changed one of the files that outcome lists. One run of one script produced every figure below.

| Counted evidence | Median specs per commit | Mean | Max | Commits with more than 3 | Commits with none |
|---|---|---|---|---|---|
| All evidence, canonical documents included | 2 | 27.4 | 85 | 14 of 30 | 10 |
| Without the spec's canonical documents | 2 | 9.9 | 81 | 13 of 30 | 10 |
| Without them, and without edits that only touch tag lines of other specs | 2 | 9.9 | 81 | 13 of 30 | 10 |

Among the 20 commits that change any evidence the median is 10 specs without canonical documents (51 with them). Counting canonical documents byte for byte nearly triples the mean (27.4 against 9.9): one edit to `ARCHITECTURE.md` would flag every spec that lists it. Excluding tag-only edits changes nothing (0 of 30 commits). Only four records carry blobs today (093, 094, 095, 101), so as specified the warning would have flagged none of those 30 commits and flags no spec on the tip of main; the table is the steady state each `--stale` run moves the repository toward.

#### Hub files

A median of 10 over the commits that change evidence is too high: a completion re-closed that often stops meaning a review. The files that cause it are shared by many specs. Specs per evidence file (latest outcomes, canonical documents aside, 393 files): 289 belong to one spec, 78 to two or three, 24 to four to seven, 1 to eight to fourteen, 1 to fifteen or more (`tests/program-verification.test.mjs`, 15; then `cli/scanners/routes.mjs`, 8). Two narrower rules were replayed on the same 30 commits (median over the commits that change evidence, mean over all 30, max, commits over 3):

| Rule | Evidence-changing commits | Median | Mean | Max | Over 3 |
|---|---|---|---|---|---|
| none (canonical documents excluded) | 20 | 10 | 9.9 | 81 | 13 |
| (a) a file shared by 4 or more specs is not compared | 18 | **3** | 6.5 | 80 | 7 |
| (a) 5 or more | 18 | 5 | 7.8 | 80 | 11 |
| (a) 6 or more | 18 | 7 | 8.7 | 81 | 11 |
| (a) 10 or more | 18 | 8 | 9.2 | 81 | 11 |
| (b) a file shared by 4 or more specs counts for a spec only when that spec's anchor in it is suspect (ANC001 or ANC002 against the lock as it was before the commit) | 18 | 6 | 7.8 | 80 | 11 |
| (b) 6 or more | 18 | 8 | 8.8 | 81 | 11 |
| (b) 10 or more | 18 | 8 | 9.2 | 81 | 11 |

Rule (a) with a threshold of 4 is the only one that brings the median to 3. It is shipped (FR-018); 26 of 393 files (6.6%) are hubs. What it does not hide: the per-link anchor lock still reports a hub's linked code that changed (ANC001), and guard JSON lists the hubs (`files.completionHubs`). What it does hide: in a project that does not use the anchor lock, an edit of a hub flags no spec. Rule (b) was not shipped: it leaves the median at 6, and it ties SPR011 to a lock that a project may not keep. The maximum (80) is a repository-wide test sweep, where every spec's own test files changed: a real change to each of those specs.

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
- **FR-002**: SPR011 MUST NOT compare the spec's canonical documents (`reviewed.scope.canonicalDocs`) or a hub file (FR-018), and MUST NOT judge an outcome that records no blobs. A file whose only change is to tag lines for other specs is compared like any other: the replay measured no effect (0 of 30 commits), so that exemption is not built.
- **FR-003**: SPR011 MUST read only `HEAD`'s tree, with one `git cat-file --batch-check` for every spec, so it works in a shallow clone and adds a constant number of git calls. When git cannot answer, it MUST report nothing.
- **FR-004**: `docguard specs complete --stale --reason <text> [--write]` MUST close again every spec SPR011 flags, each as a maintenance completion that keeps its recorded `canonicalDocs` and `persistenceModel`. It MUST refuse `--id`, `--since`, `--canonical-doc`, `--persistence` and `--successor`, and report CURRENT, writing nothing, when no spec is flagged.
- **FR-005**: `--stale` MUST plan every spec before writing anything, against one guard run, and write the registry, the active context and every spec in one transaction. When any spec is blocked it MUST write nothing and list every blocker with its spec ID.
- **FR-006**: Planning several completions MUST run guard once, project the registry once, compute the reconciliation once per distinct base revision and the anchor status once. What remains per spec (the recorded-base lookup and the evidence blobs) grows with the number of specs; the plan states the measured slope.
- **FR-007** *(amends spec 101 FR-001)*: `specs complete` MUST NOT be blocked by an uncommitted change that adds at least one `@implements` or `@req` tag for a requirement of the spec being completed and changes nothing else (not a blank line, not a closing comment marker, not a statement). Any other edit MUST still block with SPC001. The blob recorded for such a file MUST be the working-tree content, so that after the commit neither SPR008 nor SPR011 fires.
- **FR-008**: SPC004's help text and `AGENTS.md` MUST describe the pattern for a requirement with no code target (a documentation requirement, a one-time outcome): a test that asserts the document's terms (`describes()`) or the recorded result in the spec's Verification Notes (`recorded()`), tagged `@req`, as `tests/program-verification.test.mjs` does.
- **FR-009**: SPC006's "Unresolved changed files" message MUST name the earliest commit after which no unresolved file remains, found with one bounded `git log`, and say what choosing it skips.
- **FR-010**: `specs complete --write` MUST print what it wrote: the registry fields it changed, the outcome line and the number of evidence blobs recorded. `--format json` carries the same.
- **FR-011**: `specs complete --write` MUST set the spec's `**Status**:` header to `Active` when it reads `Draft`, `In Progress`, `Planned`, `Proposed` or `WIP`, and leave any other value, so a completed-like value (`Active`, `Implemented`, `Complete`) is never rewritten. Among this repository's closed specs the deliberately set values are `Active` (33) and `Implemented` (2); `Draft` (57) is the value nobody updated. The clean-tree check MUST ignore a change confined to that line, as it ignores the outcomes block.
- **FR-012**: An unknown spec ID in `complete`, `approve` and `reanchor` MUST list the closest recorded IDs (at most three).
- **FR-013**: SPR011 MUST be registered with a title and help (`docguard explain`), in the generated findings reference and in `docs/commands.md`, and `CHANGELOG.md` MUST say it adds a warning to strict.
- **FR-014**: Wide-range completion MUST NOT run guard or the reconciliation once per spec (FR-005, FR-006); the plan records what made a wide range slow and what changed.
- **FR-015** *(amends spec 101 FR-007)*: When a spec's recorded revision is not an ancestor of `HEAD` and the first-parent search finds no commit that carries its blobs, `specs complete` (with or without `--stale`) MUST look in the rest of `HEAD`'s ancestry for the commit whose registry change introduced the revision and whose files are the recorded blobs, and use it as the diff base, so that a branch that merged the base branch does not need `--since`. The oldest twenty candidates are checked. Only when none matches does the record count as lost and `--since` stays required.
- **FR-016**: `specs complete --stale` MUST NOT be blocked by a tick-only change (checkbox state) to the `tasks.md` of a spec in the batch, so the person who ticks the last task of a spec can close the batch in the same tree. A tick in a spec outside the batch MUST still block with SPC001.
- **FR-017** *(amends spec 101 FR-001)*: `specs complete --id` and `--stale` MUST NOT be blocked by an uncommitted modification of an implementation or test file that the completing spec (or a spec of the batch) lists as evidence in the committed registry, and MUST record the blob of its working-tree content. `--stale` MUST judge drift against that working-tree content, and a maintenance completion MUST count such a modification as the new linked change it requires. The code edit and the completion that reviews it therefore land in one commit, and a gate that runs guard on every commit and fails on warnings passes at every commit of the branch and after the squash. Any other modification, and a modification of a file that is not committed evidence, MUST still block with SPC001 (a new tag is judged by FR-007).
- **FR-018**: A file that at least four current closed specs list in their latest outcome's evidence (`HUB_THRESHOLD`; canonical documents aside) is a hub: SPR011 MUST NOT byte-compare it. Guard JSON MUST list the hubs, with their spec counts, under `files.completionHubs`. The per-link anchor lock (spec 070) keeps watching a hub's linked code.

## Success Criteria *(mandatory)*

- **SC-001**: The pull-request fixture of User Story 1 reports SPR011 on this version and nothing on main's code (where the check does not exist); after `specs complete --stale --write` guard is clean, and a squash of the branch onto main stays clean.
- **SC-002**: A batch with one blocked spec writes no byte.
- **SC-004**: Spec 101's per-commit loop passes with an evidence edit: a closed spec, a branch whose last commit edits one of its implementation files and closes it again, guard clean at every commit and after the squash, for `--id` and `--stale`; the test fails without FR-017.
- **SC-003**: SPR011 flags nothing on the tip of main, and this specification is closed with the flow it describes, with a `--stale` run for every spec whose evidence it edits.

## Edge Cases

- A spec closed twice: only the latest outcome is read.
- A file deleted after review: counted as changed, named.
- A spec that is not `living`: `--stale` cannot close it again (SPC002) and refuses the batch, naming it.
- Evidence edited and the spec closed again in the same branch: the new blobs match, SPR011 is silent.
- A branch that merges main after main re-closed the spec: the record is main's and matches main's files.

## Out of Scope

- Comparing canonical documents byte for byte (Freshness and requirement anchors cover them).
- A tag-line exemption for other specs' tags: measured at no effect.
- Accepting uncommitted changes to the anchor lock in `complete`.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `355eb1715c51e4fc9cdbbe46771c86b13da77fe8` — Spec 103 reviewed: SPR011 compares the latest recorded evidence blobs with HEAD (canonical documents left out, measured on the last 30 squash commits); specs complete --stale closes every flagged spec in one transaction against one guard run; tag-only edits, working-tree blobs, the written summary, the Status header, the did-you-mean and earliest-ref hints and the SPC004 recipe are in; the wide-range slowness is the guard run and is not changed. Nothing is flagged on main's tip. Evidence: `cli/commands/specs.mjs`, `cli/scanners/revision-anchor.mjs`, `cli/scanners/stale-completions.mjs`, `cli/validators/spec-registry.mjs`, `cli/writers/spec-outcomes.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/CI-RECIPES.md`, `tests/completion-upkeep.test.mjs`. Accepted deviations: none. Successor: none. Blobs: `cli/commands/specs.mjs`=`6ce7761477c752306fde3c3cbc8c8db38f4b522b`, `cli/scanners/revision-anchor.mjs`=`df4a36b5bcfa2824d2d0c5c1918ed166c018d5a8`, `cli/scanners/stale-completions.mjs`=`8b18b5d7062e8c1ffac4b187d5144ea331b80d6a`, `cli/validators/spec-registry.mjs`=`050036271ee56914f6299c1cb0f8471ef2e44c0f`, `cli/writers/spec-outcomes.mjs`=`89fd6dcaf24766303d0590486b75c76f43830454`, `docs-canonical/ARCHITECTURE.md`=`0219a5ea940932abeeffb081e25d63582012d3d9`, `docs-canonical/CI-RECIPES.md`=`9044bdf3a34145a010e5340c59b095109ecf02c8`, `tests/completion-upkeep.test.mjs`=`5b2f184beeaa00a9140868e6981cf8260e67da1a`.
- `4304055c63bb94d21901aa9b0b8e1204ea7aca93` — Reviewed specs 101 and 103 against the stricter tag-only rule (a tag must be added and nothing else may change), the any-ancestry search of the oldest twenty candidates (FR-015, amending 101 FR-007), the shared projection and task ticks in a batch (FR-016) and the new tests; the one-commit flow, SPR008, SPR010 and SPR011 behave as specified Evidence: `cli/commands/specs.mjs`, `cli/scanners/revision-anchor.mjs`, `cli/scanners/stale-completions.mjs`, `cli/validators/spec-registry.mjs`, `cli/writers/spec-outcomes.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/CI-RECIPES.md`, `tests/completion-upkeep.test.mjs`. Accepted deviations: none. Successor: none. Blobs: `cli/commands/specs.mjs`=`bd67e6564cbe14eba3a4f89d3455d6ed76579bc4`, `cli/scanners/revision-anchor.mjs`=`041d24ad311ff9ad8787c276377636fe31f317f7`, `cli/scanners/stale-completions.mjs`=`8b18b5d7062e8c1ffac4b187d5144ea331b80d6a`, `cli/validators/spec-registry.mjs`=`050036271ee56914f6299c1cb0f8471ef2e44c0f`, `cli/writers/spec-outcomes.mjs`=`89fd6dcaf24766303d0590486b75c76f43830454`, `docs-canonical/ARCHITECTURE.md`=`0219a5ea940932abeeffb081e25d63582012d3d9`, `docs-canonical/CI-RECIPES.md`=`9044bdf3a34145a010e5340c59b095109ecf02c8`, `tests/completion-upkeep.test.mjs`=`033dd09386fd5b00f2d0f72d289cd364c5eaa6f5`.
<!-- docguard:implementation-outcomes:end -->
