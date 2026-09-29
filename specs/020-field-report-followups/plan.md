# Implementation Plan: Field Report Follow-ups

**Branch**: `fix/field-report-followups` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

Four small, independent fixes:
- **guard.mjs.** The claims badge falls back to `unknown`. `baselineBySeverity` is counted inside
  the existing suppression filter.
- **upgrade.mjs.** A test covers the path where the CLI install fails, the schema is still
  migrated, and the next guard run prints no nudge.
- **hooks.mjs.** `detectHookManager()` runs before the install loop and replaces the `--force`
  path with guidance when a manager owns the hook.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`
**Project Type**: CLI

## Constitution Check

IX (honest assurance): the claims caveat can no longer be dropped. VI (safe writes): a hook
manager's dispatcher is never overwritten. Pass.

## Project Structure

```text
cli/commands/guard.mjs
cli/commands/hooks.mjs        # detectHookManager()
tests/field-report-followups.test.mjs   # NEW
```
