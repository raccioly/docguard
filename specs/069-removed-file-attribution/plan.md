# Implementation Plan: Removed Files Are Attributed to the Spec That Removes Them

**Branch**: `fix/deleted-file-attribution` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001–FR-003 | `cli/scanners/reconciliation.mjs`: the deleted paths come from the name-status inventory (`D`); for a deleted path with no direct link, `removalLinks` returns the current, approved specs whose artifact text names the path as a whole token, or a containing `dir/` under which HEAD tracks nothing. |
| FR-004 | `docs-canonical/ARCHITECTURE.md` (Reconciliation graph row), SPC006 help in `cli/findings.mjs`, `docs/reference/findings.md` (generated), `CHANGELOG.md`. No registry field changes, so `DATA-MODEL.md` is unchanged. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; `tests/removed-file-attribution.test.mjs` builds a Spec Kit fixture repository and runs `buildReconciliationPlan`.

## Research decisions

- **Name the removal in the spec, not in the registry.** The spec's own text is the reviewed record of intent ("the root `.jules-setup.sh` MUST be removed"). *Rejected:* `assetPaths` for deleted files: an entry that covers no tracked file is stale by design (SPR009), and it would have to be added and then removed again. *Rejected:* reading the registry at the base revision to find the file's old evidence: costly, and a file with no annotation (a shell script) would still not link.
- **Deleted files only.** A file that still exists can carry an annotation; letting prose attribute it would weaken the evidence rule.
- **Whole-token match.** A path counts when it is delimited by start/end of text, whitespace, a backtick, a quote, parentheses, brackets, a comma or a sentence period, so `old.sh` does not match `fold.sh` or `old.sh.bak`. A token ending in `/` covers files under it, as in `assetPaths`.
- **Current and approved specs only.** A draft or retired spec's mention is not approval to remove.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | A deletion is linked only to a spec that names it; changed files still need evidence. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/reconciliation.mjs          # FR-001–FR-003
cli/findings.mjs                         # FR-004 (SPC006 help)
docs/reference/findings.md               # generated
docs-canonical/ARCHITECTURE.md, CHANGELOG.md   # FR-004
tests/removed-file-attribution.test.mjs  # NEW
```
