# Implementation Plan: Close a Spec in One Commit

**Spec**: [spec.md](spec.md) (`docguard.completion-one-commit`)

## Summary

| FR | Change |
|---|---|
| FR-001 | `nonLifecycleChanges` in `cli/scanners/revision-anchor.mjs` takes `tickOnlyPaths`: a modified path whose committed and working content are equal once every task checkbox is normalized to unchecked is not a change. `planSpecCompletion` and `reanchorSpec` pass the completing spec's own `tasks.md` (from its observed artifacts). |
| FR-002, FR-003, FR-004 | `applyReviewedScope` in `cli/commands/specs.mjs` validates `--canonical-doc` and `--persistence` and applies them to the projected entry; `planSpecCompletion`, `completeSpec` and `approveSpec` call it. `cli/docguard.mjs` parses the repeatable flag and lists both in `--help`. |
| FR-005 | `appendImplementationOutcome` writes `Blobs: \`path\`=\`blob\`, …` after the cleaned fields; `readOutcomeBlobs` reads it from a fixed position. `completeSpec` collects the blobs with one `git ls-tree`. |
| FR-006, FR-007, FR-009 | `locateContentAnchors` in `cli/scanners/revision-anchor.mjs`: one `git rev-list --first-parent` of the registry's commits, one `git log -G` over every revision not cached (oldest commit whose added lines contain it is the landing), one `cat-file --batch-check` for every evidence path. The landing commits are cached in `.docguard/revision-anchors.json` (not in CI). SPR008, `reanchor`, `reviewBaseline` and the default `--since` use it. `danglingRevisions` stays raw, because `reanchor` depends on it. |
| FR-008 | `reanchorSpec` rewrites the outcome line with `backfillOutcomeBlobs` when the move is `blob-equal`. |
| FR-011 | `unrecordedCompletions(registry)` in `cli/scanners/spec-registry.mjs`; SPR010 in the validator; `specs --check` text and JSON. |
| FR-012, FR-013 | Warning text; `AGENTS.md`, `CONTRIBUTING.md`, `docs/commands.md`, `docs-canonical/CI-RECIPES.md`, `DATA-MODEL.md`, the schema description. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; `tests/spec-completion-one-commit.test.mjs` first. It builds repositories with `fixtureGit` and `makeTempDir`, runs the CLI as a subprocess, and runs 0.48.0 from a `git archive` of the tag.

## Project Structure

```
cli/commands/specs.mjs            complete, approve, reanchor; flag validation; the diff base
cli/scanners/revision-anchor.mjs  tick-only task list, evidence blobs, the content anchor and its cache
cli/scanners/spec-registry.mjs    unrecordedCompletions, the persistence values
cli/validators/spec-registry.mjs  SPR008 by content, SPR010
cli/writers/spec-outcomes.mjs     the Blobs segment of an outcome line (one read and one write helper)
cli/findings.mjs, cli/docguard.mjs  SPR010 entry; flags and help
tests/spec-completion-one-commit.test.mjs
```

## Research decisions

- **Disagreement with the brief: the blob ids do not live in the registry.** The brief stores `evidenceBlobs` in each registry outcome. Measured against a `git archive v0.48.0` copy: a registry whose outcome carries the key makes 0.48.0 report `SPR003: Invalid or unbounded reconciliation outcomes for acme.alpha.`, and with the registry invalid it also loses its living-spec suppression, so DLC002 returns. Every level of `.docguard-specs.json` is a closed key set in 0.48.0, and a `schemaVersion` bump is refused. So no new key can go anywhere in the registry, and the brief's D5 and the brief's D3 cannot both hold. D5 is a hard compatibility promise; D3's carrier is a mechanism. The blob ids are therefore recorded in the machine-owned outcome line of `spec.md`, which the registry already digests and which 0.48.0 keeps byte for byte: against 0.48.0 the finding set is identical to a control without blobs, `specs --check` reports CURRENT, and a 0.48.0 `specs complete` leaves the earlier line unchanged. Both ends sit behind `readOutcomeBlobs` and `writeOutcomeBlobs` in `spec-outcomes.mjs`, so a reviewer who prefers another carrier (a tracked sidecar file, or the registry once a floor version allows it) swaps one function.
- **The search targets the landing commit, not a walk of the history.** The brief's search is `findAnchor` without the old commit: a first-parent walk for a commit with equal blobs. `findAnchor` needs `merge-base <old> HEAD`, which cannot work once the old commit is gone, and a walk capped at 1,000 commits starts raising SPR008 on a squash-landed record once more than 1,000 commits sit between the landing and `HEAD` and the evidence has moved since. The landing commit is the first first-parent commit whose registry contains the recorded revision; `git log --first-parent -S<revision> -- .docguard-specs.json` lists the commits where that string appears or disappears, and the oldest is the landing. Comparing blobs at that one commit gives the exact differing files, the right `--since` default, and the same answer however far `HEAD` has moved. A later legitimate edit of an evidence file cannot raise SPR008, as today for an ancestor.
- **Batched, because the cost grows.** Under squash merges every completion's recorded revision stays off the history for good (nobody writes reanchor commits now), so the number of recorded revisions that need the content search only grows, and so does the registry's history. A search per revision would make every guard run, in CI too (which has no cache), cost one `git log` over that history per revision. The search is one `rev-list`, one `log -G` per 200 revisions and one `cat-file --batch-check`. `-G`, not `-S`: a maintenance commit that moves one recorded revision to another can leave the occurrence count unchanged.
- **The cache holds only landing commits.** The brief keys the cache by registry entry and `HEAD`. A landing commit does not depend on `HEAD` while it stays on the first-parent chain, and a cached verdict could be planted (the anchor cache has the same rule), so the file maps a revision to its landing commit, is neither read nor written in CI, and a hit is trusted no further than membership in the chain: the verdict is recomputed from the blobs at that commit.
- **One sequence, written the same in every document.** tick the box, `docguard specs --write`, `docguard specs complete --id <id> --since <ref> --canonical-doc <path> --reason <text> --write`, one `git commit`. The `specs --write` step stays: `complete` requires a current registry, and the tick changes the spec's observed task counts. Making `complete` refresh derived fields itself would loosen a check that guards hand edits.
- **`danglingRevisions` stays raw.** `reanchor` and its tests depend on it; the content-aware check is a separate layer.
- **Rejected: storing a hash of all evidence blobs.** A single digest cannot name the files that differ, which SPR008's message must.
- **Rejected: a flag for `relations`, `sourcePaths` and `assetPaths`.** `complete` requires none of them.

## Verification Notes

Measured on macOS, Node 24, 2026-11-13.

- **Tests first.** `tests/spec-completion-one-commit.test.mjs` run against `main` at `9fea8e5`: 29 of 33 tests fail, 1 passes (a tick plus another change in the same `tasks.md` is blocked, the control for FR-001), and 3 more are the suites that hold them. Most fail first in the fixture, which approves with `--persistence` and `--canonical-doc`; the squash, rebase, changed-evidence, SPR010 and 0.48.0 tests then each fail for their own reason once the flags exist.
- **Against 0.48.0.** A registry whose outcome carries an `evidenceBlobs` key: `SPR003: Invalid or unbounded reconciliation outcomes for acme.alpha.`, and the living-spec suppression is lost, so DLC002 returns. The `Blobs:` segment on the outcome line instead: the same finding set as a control, `specs --check` CURRENT, and a 0.48.0 `specs complete` keeps the earlier line verbatim.
- **SPR010 measured before it was wired in.** This repository: 92 specs, 87 verified or released, 0 without an outcome. Ten other repositories with a registry, by stack: seven Node or TypeScript projects, two Python projects, one with neither (found by a root-level `package.json` or `pyproject.toml`/`requirements.txt`); 0 verified or released specs among them, so 0 flagged. Only this repository can say whether legacy records exist, and it has none, so the evidence is one repository deep. SPR010 therefore ships as a warning whose detection is one function (`unrecordedCompletions`): the validator finding is one block, and `specs --check` reports the same list.
- **Hand-edited reviewed fields found in `git log -p -- .docguard-specs.json`.** `canonicalDocs` and `persistenceModel` (about 30 commits): now flags. `relations.extends`: about 25 additions and removals beyond the defaults written for each new entry; `complete` does not require it, so no flag. `assetPaths`: two or three edits; no flag. `sourcePaths` never appears by hand.
- **Cost of the search.** `git log --first-parent -S<revision> -- .docguard-specs.json` takes 0.1 to 0.3 s on this repository (154 registry commits); it runs only for a recorded revision that is not an ancestor of `HEAD`.
