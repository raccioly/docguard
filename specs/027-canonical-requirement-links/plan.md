# Implementation Plan: Canonical Requirement Links

**Branch**: `chore/release-prep-0.43` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

`cli/scanners/reconciliation.mjs` scans each changed source and test file's
diff text for `docs-canonical/<doc>.md#<ID>`. It verifies the ID with
`collectRequirementIdsFromContent`, caching each document once per run, and
records `canonical` on the item. The item then routes through the same
disposition rules a spec link uses. Requirement nodes and
`canonical_requirement` edges extend the graph.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test` git fixtures

## Constitution Check

IX: only declared identities count, so an invented citation cannot clear a
completion. IV: the scanner imports a shared module only. Pass.

## Project Structure

```text
cli/scanners/reconciliation.mjs               # canonical links
tests/canonical-requirement-links.test.mjs    # NEW
docs-canonical/ARCHITECTURE.md                # reconcile row
```
