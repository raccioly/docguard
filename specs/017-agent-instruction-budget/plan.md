# Implementation Plan: Agent Instruction Budget and Spec Number Collisions

**Branch**: `feat/agent-budget-spec-collisions` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

`cli/scanners/agent-instructions.mjs` walks the repository for `AGENTS.md` and
`AGENTS.override.md`, respecting DocGuard's ignore sets, builds each chain from the root to the
file's directory, and returns byte totals. The Structure validator turns over-budget chains into
`STR004` and slack allowances into `STR005`. `detectSpecNumberCollisions()` in
`cli/scanners/speckit.mjs` groups top-level `specs/` feature directories by numeric prefix, and
the Spec-Kit validator emits `SPK012`.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new; `walkFiles`, `loadIgnorePatterns`
**Testing**: `node:test`
**Project Type**: CLI

## Constitution Check

| Principle | Assessment |
|-----------|-----------|
| II | No dependencies. Pass. |
| IV | The scanner is shared; both validators import scanners only. Pass. |
| VII | SPK012 extends the Spec-Kit validator. Pass. |
| IX | STR004 is an escalation; STR005 is informational. Byte counts are exact. Pass. |

**Rejected**: using the finding baseline as the ratchet. The baseline normalizes digits in
messages, so a chain growing from 40 KiB to 60 KiB would stay suppressed. An explicit allowance
in `.docguard.json` makes every increase a reviewed diff.

## Project Structure

```text
cli/scanners/agent-instructions.mjs     # NEW
cli/validators/structure.mjs            # STR004 / STR005
cli/scanners/speckit.mjs                # detectSpecNumberCollisions, SPK012
cli/findings.mjs                        # STR004, STR005, SPK012
schemas/docguard-config.schema.json     # agentInstructions
tests/agent-instruction-budget.test.mjs # NEW
```
