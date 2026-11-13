# Implementation Plan: Anchor Lock Merges Cleanly

**Spec**: [spec.md](spec.md) (`docguard.anchor-lock-merge`)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-005 | `cli/scanners/anchor-lock.mjs`: a pure `parseAnchorLock(raw, { markers })` that returns every distinct line per key in file order (`variants`), the number of collapsed lines and the markers removed. `readAnchorLock` wraps it strictly (markers are ANC005 naming `anchors merge --write`) and keeps `links`, `dispositions` and an empty `conflicts` for existing callers. |
| FR-002 | `cli/scanners/anchors.mjs`: `resolveEntry(candidates, link)` (pure, uses `compareEntry`) and `resolveLockLinks(lock, linksByKey)`. `computeAnchorStatus` reads entries from the resolved map and returns it as `lockEntries`. |
| FR-003 | `readResolvedLock(projectDir, config)`: the lock with every key resolved against the current links (computed without the cache only when a key has variants). `accept`, `accept --remove` and `disposition` write from it. |
| FR-004, FR-005, FR-010 | `cli/commands/anchors.mjs`: the `merge` action, `--check` and `--write`. `cli/docguard.mjs`: help text. `docs/commands.md`, generated reference. |
| FR-006 | `cli/validators/requirement-anchors.mjs`: ANC009 leaves the code map and `suggestionFor`. `cli/findings.mjs`: the entry stays, with "no longer reported" text. |
| FR-007 | A note in `computeAnchorStatus` when `lock.collapsed > 0`. |
| FR-008 | No schema change. A test runs `git archive v0.48.0`. |
| FR-009 | `AGENTS.md`, `CONTRIBUTING.md`, `docs/commands.md`, the `anchor-lock.mjs` header comment, and a dated amendment note in spec 070 (FR-016/017/018, scenario 8, the ANC009 rows) and its contract. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18. **Primary Dependencies**: none. **Testing**: `node:test`; `tests/anchor-lock-merge.test.mjs`, real git through `fixtureGit`.

## Research decisions

- **Resolve in the reader, keep union.** A merge driver needs per-clone git config; union works on every clone. The cost is duplicates, which the reader and every writer resolve.
- **The reader returns candidates; `anchors.mjs` resolves.** Deciding "matches current content" needs the link (`compareEntry`), and `anchor-lock.mjs` cannot import `anchors.mjs` (cycle). `compareEntry` already handles a tier change (floor) and a null requirement fingerprint, so raw hash equality is not used.
- **Never drop a key.** With no matching candidate the newest still stands, so ANC001 or ANC002 fires with a revision for the `git diff` hint. Before this change, ANC009 alone fired, and writers lost the key.
- **No timestamp.** `date` is a day, so same-day candidates fall to file order. Ordering on the canonical line text would remove the file-order dependence; it was rejected because it picks an arbitrary winner where the last line is the one a human reviewed last in the merged file. Either choice cannot change a verdict, only which reason is kept.
- **`--check` exits 2** like `specs`, `retire` and `reconcile`.
- **ANC009 is kept in the registry.** `config.mjs` rejects a `findingSeverity` key that is not a known code, so deleting it would break an adopter's configuration. No earlier code was retired, so there is no precedent to follow; the entry stays with help text that says it is no longer reported.
- **Rejected: a `git merge` driver; a timestamp field; making guard rewrite the lock** (guard never writes, spec 070 FR-022).

## Project Structure

```text
cli/scanners/anchor-lock.mjs        parseAnchorLock, readAnchorLock (variants), newestEntry
cli/scanners/anchors.mjs            resolveEntry, resolveLockLinks, readResolvedLock, computeAnchorStatus
cli/commands/anchors.mjs            accept / disposition write the resolved set; the merge action
cli/validators/requirement-anchors.mjs  ANC009 leaves the code map; ANC005 suggestion
cli/findings.mjs                    ANC009 registry entry (no longer reported)
tests/anchor-lock-merge.test.mjs    real-git merge and rebase, resolver, writers, merge command, 0.48.0
```
