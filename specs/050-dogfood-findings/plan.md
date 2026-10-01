# Implementation Plan: Fixes From Dogfooding Real Repositories

**Branch**: `fix/dogfood-findings` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/config.mjs`: after merging, `requiredFiles.agentFile` becomes an array when it is a string (FR-001).
- `cli/shared-doc-roles.mjs`: `resolveDocRole` falls back to a unique same-named canonical document, found in `requiredFiles.canonical` or by `listCanonicalDocs`, only when there is no explicit mapping and the default path is missing (FR-002).
- `cli/validators/metrics-consistency.mjs`: a `Dependencies` table row counts only when the table's header cell for that column is a count word (FR-003).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; temp-project reproductions of each defect with controls

## Research decisions

- **Normalize once, at load.** Every reader (`score`, `fix`, `retire`) then sees an array; rejected: guarding each call site, which leaves the next reader to crash.
- **Unique name match, never a guess.** Two `DATA-MODEL.md` files make the role ambiguous; the default path keeps today's behaviour. An explicit `docs.roles` mapping still wins.
- **Header-qualified table rows.** A row's meaning comes from its column header; a scoring or weighting table is not a count.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | Fewer false findings; no claim is loosened beyond its evidence. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/config.mjs                          # agentFile normalization
cli/shared-doc-roles.mjs                # unique same-named canonical fallback
cli/validators/metrics-consistency.mjs  # header-qualified dependency rows
tests/dogfood-findings.test.mjs         # NEW
CHANGELOG.md
```
