# Implementation Plan: Completion Revision Anchoring

**Branch**: `fix/completion-revision-anchoring` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/commands/specs.mjs` replaces `trackedDirty` with `nonLifecycleChanges`,
  which lists tracked changes and drops the registry, the context file, and spec
  files whose only change is inside the outcomes block (`spec-outcomes.mjs`
  exposes block stripping).
- `specs complete --write` warns when `git merge-base --is-ancestor HEAD
  origin/HEAD` fails.
- A new `specs reanchor` subcommand lives in `cli/commands/specs.mjs`, backed by
  `cli/scanners/revision-anchor.mjs`, which resolves, checks ancestry, compares
  blobs (`git rev-parse <rev>:<path>`), and searches the first-parent history
  (bounded to 1000 commits).
- The Spec-Registry validator adds SPR008 and reads shallowness from
  `git rev-parse --is-shallow-repository`.
- FR-007: `cli/scanners/spec-registry.mjs` exports `canonicalOutcome` and
  `sortedUnique`, the forms the projection already applied to each recorded
  outcome. `specs complete` builds its outcome with `canonicalOutcome` and its
  evidence list with `sortedUnique`, and `appendImplementationOutcome` renders
  the outcome in the order it is given instead of re-sorting it. Rejected:
  sorting in `completeSpec` with its own comparator, which is the second copy
  that drifted (`.sort()` orders by code unit, the projection by
  `localeCompare`, so `README.md` and `cli/…` swap). Rejected: having the
  writer import the scanner to sort again; one normalization, applied once, is
  rendered by both the registry and the outcome line.
- FR-008: `cli/shared-git.mjs` adds `readPatchBatches(dir, ref, files, visit,
  options)`. It splits the changed files into batches of at most 200 paths
  (a rename's or copy's old and new path together, `--literal-pathspecs` so a
  path is never a pattern), runs one `git diff` per batch under the existing
  per-call `maxPatchBytes` and timeout, halves a batch that overflows, and
  stops at a single path that overflows on its own or at `maxRangePatchBytes`
  (64 MiB) read in total. `buildReconciliationPlan` keeps its single read when
  it fits; when the snapshot's patch stage failed (`commitCount` is set, the
  convention `spec-first.mjs` already reads), it reads batches and reduces
  each to per-file facts — the specs whose requirement identities the changed
  lines name and the canonical requirement links — before the next batch, so
  memory stays bounded by one batch. `range.batches` reports the reads.
  Rejected: raising `maxPatchBytes`. It moves the cliff; the next long gap
  falls off it, and the cap exists so one read cannot exhaust memory.
  Rejected: reconciling only the spec's linked paths. The links come from the
  patch text (`@implements` identities, canonical citations, deletions named
  in spec prose), so restricting the read to already-known evidence paths
  drops exactly the files whose links changed.
- FR-009: `planSpecCompletion` compares `--since` with the recorded revision
  (`resolveCommit`, `isAncestorOf` from `revision-anchor.mjs`). Equal or older
  reconciles as asked. Newer reconciles the recorded range first; only a
  BLOCKED range whose `range.status` is `too-large` or `timeout` permits it,
  and the plan carries `narrowedFrom` with `git rev-list --count` of the
  skipped commits. `completeSpec` passes it to `canonicalOutcome`, the
  validator accepts the key, `appendImplementationOutcome` renders it, and the
  schema declares it. Rejected: a separate `--narrow` flag. The ref is already
  explicit, and the record — not a second flag — is what keeps it from being
  silent. Rejected: refusing every newer `--since`. A range past every budget
  would then never be maintainable again.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test` git fixtures, including a simulated squash merge
**Constraints**: every git call uses argv arrays; the history walk is bounded

## Constitution Check

- VI: re-anchor writes through `commitFileTransaction`.
- IX: an attested re-anchor is recorded as attested, never as checked.
- IV: the validator imports the scanner only.

Pass.

## Project Structure

```text
cli/commands/specs.mjs                 # lifecycle-only dirtiness, warning, reanchor
cli/scanners/revision-anchor.mjs       # NEW
cli/writers/spec-outcomes.mjs          # strip/rewrite outcome blocks; render canonical order (FR-007); narrowedFrom (FR-009)
cli/shared-git.mjs                     # readPatchBatches (FR-008)
cli/scanners/reconciliation.mjs        # batched reconciliation, per-file facts (FR-008)
cli/scanners/spec-registry.mjs         # canonicalOutcome, sortedUnique (FR-007)
cli/validators/spec-registry.mjs       # SPR008
cli/findings.mjs                       # SPR008
cli/docguard.mjs                       # reanchor help
schemas/docguard-specs.schema.json     # reanchoredFrom, narrowedFrom
docs/commands.md, docs-canonical/DATA-MODEL.md, docs-canonical/CI-RECIPES.md
tests/completion-revision-anchoring.test.mjs  # NEW
testguard.claims.json                  # COMPLETION-ANCHORS-SURVIVE-SQUASH
```
