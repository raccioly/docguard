# Implementation Plan: Staleness Visibility

**Branch**: `feat/096-staleness-visibility` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | `cli/validator-coverage.mjs`: `CONFIGURE_HINTS`, `howToConfigure()`. `cli/commands/guard.mjs`: a hint line under empty and missing-prerequisite rows; `emptyValidators[]` in JSON. |
| FR-002 | `cli/validators/canonical-sync.mjs`: the "not DocGuard" gate returns `applicability: not-applicable` with its reason. |
| FR-003 | `cli/commands/guard.mjs`: `rankFrs002()`, `FRS002_SHOWN`, one summary line; `renderableItems` carries `location` and `staleness`. |
| FR-004 | `cli/scanners/recorded-review-signals.mjs`: `excerptStaleness()`. `cli/scanners/task-context.mjs` attaches it; `cli/commands/agent.mjs` prints it; `schemas/docguard-task-context.schema.json` defines it. |

## Project Structure

```text
cli/validator-coverage.mjs, cli/commands/{guard,agent}.mjs, cli/validators/canonical-sync.mjs
cli/scanners/{recorded-review-signals,task-context}.mjs
schemas/docguard-task-context.schema.json
tests/staleness-visibility.test.mjs
```

## Research decisions

- **One hint table, not a constant per validator module.** The draft said "owned by each validator". A table keyed by validator, with a test that every registered key has an entry, gives the same guarantee without touching 38 modules.
- **The excerpt note covers only references on lines inside the excerpt.** A document-level note would warn on every excerpt of a long document.
- **Rejected:** dropping FRS002 when FRS006 exists for the same document. The two answer different questions, and spec 095 kept both.

## Verification

`npm test`; guard on DocGuard; `npm run budget` (agent-facing bytes); the TestGuard f89ca46 demo; A/B on the local projects.
