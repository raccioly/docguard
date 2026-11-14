# Implementation Plan: Keep Completions Current

**Spec**: [spec.md](spec.md) (`docguard.completion-upkeep`)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002, FR-003 | `cli/scanners/stale-completions.mjs` (`staleCompletions`): for each current `verified` or `released` spec, read the latest outcome's blobs with `readOutcomeBlobs`, drop the spec's `canonicalDocs`, resolve every remaining path at `HEAD` with one `git cat-file --batch-check`, and report the paths whose blob differs or is absent. `validators/spec-registry.mjs` turns each result into SPR011 (warn, `suppress: null`). `cli/findings.mjs` registers the code. |
| FR-004, FR-005, FR-006 | `completeStale` in `cli/commands/specs.mjs`. It takes `staleCompletions`, runs guard once, plans each spec with `planSpecCompletion` (which now takes `options.shared`: a reconciliation cache keyed by base, the anchor status, counters), refuses when any plan is blocked, and writes through one `commitFileTransaction` (`commitCompletions`). `completeSpec` shares `prepareCompletion` and `commitCompletions` with it. |
| FR-015 | `recordedBase` falls back to `reviewedCommitOnHistory` (any ancestry path, the oldest twenty candidates), because a branch that merged main reaches main's squash commit only through the merge's second parent. It changes `complete --id` too, not only `--stale`, and so amends spec 101 FR-007 (dated note there). |
| FR-016 | `completeStale` passes `shared.anyTaskTicks`, so `planSpecCompletion` lets every spec's task list differ by checkbox state. |
| FR-007 | `nonLifecycleChanges` takes `tagSpecId`; `tagOnlyChange` replaces the spec's own tags by a marker in both texts, drops a comment block or line that held only markers, and requires the rest to be identical and at least one tag to be added (a blank line, a deleted `*/` or an edited statement still differs). `evidenceBlobsInTree` hashes the working-tree content of a file with an uncommitted change. |
| FR-008 | `BLOCKER_CODES.SPC004.help`; `AGENTS.md`. |
| FR-009 | `lastCommitTouching` (one `git log -n1 -- <paths>`, at most 200 paths) and `resolvingRefHint` in `planSpecCompletion`. |
| FR-010, FR-011 | `prepareCompletion` returns `written`; `printResult` prints it. `markSpecActive` and `readSpecStatus` in `writers/spec-outcomes.mjs`; `withoutCompletionWrites` makes the Status line part of what the clean-tree check ignores. |
| FR-012 | `unknownSpecMessage` (edit distance and containment, three at most) in `complete`, `approve`, `reanchor`. |
| FR-013 | `docs/commands.md`, `docs/reference/findings.md` (generated), `docguard explain`, `CHANGELOG.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs-canonical/ARCHITECTURE.md`, `CI-RECIPES.md`. |
| FR-014 | See "Why a wide range is slow" below. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js >= 18. **Dependencies**: none new. **Testing**: `tests/completion-upkeep.test.mjs` first; real repositories built with `fixtureGit` and `makeTempDir`, the real CLI as a subprocess.

## Decisions and rejected alternatives

- **Compare against `HEAD`, not the working tree.** Guard on a merge ref and in CI sees a clean checkout; a pre-commit gate that read the working tree would flag a spec before the person could close it. `HEAD` is also what `complete` records, so a re-closed spec is silent. The one exception is the blob of a file that has an uncommitted tag-only edit, which is hashed from the working tree (FR-007), because that is what the next commit holds.
- **Canonical documents are not compared (measured).** Counting them took the mean from 9.7 to 27.2 specs per commit (spec "Measured before..."). Rejected: comparing them and letting `--stale` absorb the cost; a document shared by dozens of specs would flag all of them on every edit, and Freshness and requirement anchors already track a document's drift.
- **The tag-line exemption is not built.** It changed 0 of 30 commits in the replay.
- **Shared hub files** (`cli/findings.mjs`: 28 spec-commit pairs, `tests/program-verification.test.mjs`: 23, `cli/docguard.mjs`: 15) cause most of the count. Excluding them the way canonical documents are excluded is a design change the owner has not made; it would make SPR011 blind to real edits of those files. Reported, not built.
- **The `**Status**:` value is a judgment call.** Specs 006 to 037 and 101 read `Active`, specs 094 and 095 read `Implemented` (also written by the one-commit flow), and the other completed specs still read `Draft`. FR-011 sets `Active` and rewrites `Implemented`; the owner may prefer the other value, which is one constant.
- **A per-commit gate sees SPR011 on the commit that changes the evidence** and until the commit that closes the spec again, because the check compares with `HEAD`. A merge-ref gate and a pre-push gate see the final state only.
- **`--stale` is one transaction.** Looping `completeSpec` would run guard per spec and leave a half-written batch when the fourth spec blocks.
- **The fallback in `recordedBase` leaves SPR008 alone.** SPR008 still reports a merged-main branch whose evidence moved after landing; it says what differs, and SPR011 says how to close it. Silencing SPR008 there is a separate decision.

## Why a wide range is slow (issue 684 item 4)

Measured on this repository with the machine loaded (load average 14 to 20): `buildReconciliationPlan` takes 0.6 s for 3 commits, 1.0 s for 30 and 2.3 s for 120; `computeAnchorStatus` 0.3 s; `projectSpecRegistry` 0.5 s; `runGuardInternal` 25 s (a `complete` run: 23 s for `--since HEAD~3`, 32 s for `HEAD~150`). The reconciliation does not explain more than 120 seconds; the guard run SPC007 needs does, and it ran once per `complete` (so once per spec of a batch). Changed here: a batch plans against one guard run, one registry projection and one reconciliation per distinct base. What still grows with the number of specs is the recorded-base lookup, the blobs and the reconciliation of each new base: planning 1, 10 and 40 of this repository's specs with a shared guard result took 1.5 s, 12.3 s and 33.4 s on the loaded machine (19 distinct bases for the 40), so roughly one second per further spec; 81 specs would be about a minute plus one guard run. Not changed: the cost of one guard run, which is the budget work merged on the same day; a single `complete` still pays it.

## Project Structure

```text
cli/scanners/stale-completions.mjs     new
cli/scanners/revision-anchor.mjs       tagOnlyChange, evidenceBlobsInTree, lastCommitTouching, reviewedCommitOnHistory
cli/writers/spec-outcomes.mjs          markSpecActive, readSpecStatus
cli/commands/specs.mjs                 completeStale, prepareCompletion, hints, output
cli/validators/spec-registry.mjs       SPR011
cli/findings.mjs                       SPR011, SPC004 help
cli/docguard.mjs                       --stale
tests/completion-upkeep.test.mjs       new
```
