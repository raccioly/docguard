# Implementation Plan: Compact Guard Response for Agents

**Branch**: `feat/compact-guard-response` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/shared-guard-json.mjs` (new) exports `compactGuardResult(full)`: a pure
  projection of the full result. Findings are copied once without `evidence`,
  intrinsic `enforcement` and null `redactedContext`; evidence goes to
  `evidenceByCode`; `validators[]` keep status, counts and applicability.
- `cli/commands/mcp.mjs`: `docguard_guard` takes `detail` (`compact` default,
  `full`) and returns the projection or the full result.
- `cli/commands/guard.mjs` and `cli/docguard.mjs`: `--compact` with
  `--format json`.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; a reconstruction test over this repository and the
benchmark fixtures
**Performance Goals**: at least 30% fewer bytes (SC-001, SC-002)
**Constraints**: the CLI JSON contract is unchanged

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | Nothing is dropped that is not derivable; evidence stays per code; the form names itself and points to the full contract. |

Pass.

## Project Structure

```text
cli/shared-guard-json.mjs          # NEW: compactGuardResult
cli/commands/mcp.mjs               # detail argument, compact default
cli/commands/guard.mjs             # --compact with --format json
cli/docguard.mjs                   # --compact flag and help
tests/compact-guard-response.test.mjs   # NEW
server.json, packaging MCPB manifest, smithery.yaml   # tool description if listed
README.md, docs/ai-integration.md, docs/commands.md, CHANGELOG.md
testguard.claims.json              # COMPACT-GUARD-LOSES-NOTHING
```
