# Implementation Plan: Sync Section Scope

**Branch**: `fix/sync-section-scope` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

Re-key `SECTION_FILE_MATCHERS` by the plan's section IDs with conservative
matchers, and replace the vacuous test with one that reads the plan's IDs from
`cli/scanners/memory-plan.mjs`.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new

## Constitution Check

IX: a matcher that never matches was a silent no-op; the test now proves the
table and the plan agree. Pass.

## Project Structure

```text
cli/shared-sync-scope.mjs      # matcher table
cli/validators/api-surface.mjs # comment that pointed at the old table
tests/sync-since.test.mjs      # real matcher tests
```
