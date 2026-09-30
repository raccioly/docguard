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
cli/writers/spec-outcomes.mjs          # strip/rewrite outcome blocks
cli/validators/spec-registry.mjs       # SPR008
cli/findings.mjs                       # SPR008
cli/docguard.mjs                       # reanchor help
schemas/docguard-specs.schema.json     # reanchoredFrom
docs/commands.md, docs-canonical/DATA-MODEL.md, docs-canonical/CI-RECIPES.md
tests/completion-revision-anchoring.test.mjs  # NEW
testguard.claims.json                  # COMPLETION-ANCHORS-SURVIVE-SQUASH
```
