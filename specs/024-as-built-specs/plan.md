# Implementation Plan: As-Built Specifications

**Branch**: `feat/as-built-specs` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/scanners/as-built.mjs` collects the facts under an area from existing scanners:
  `scanRoutesDeep` for routes, AST exports through `parseJsTs`, `grepEnvUsage` (new `within`
  option) for env vars, and `scanSchemasDeep` for entities. It renders the Spec Kit-shaped
  skeleton and checks sync in both directions.
- `cli/commands/generate-as-built.mjs` implements `generate --spec <area> [--id] [--write]
  [--format json]`. It writes the spec, then the registry entry with `origin: as_built` and
  `sourcePaths`, and rolls back the spec if the registry step fails.
- `cli/scanners/spec-registry.mjs` accepts the two optional fields and serializes them only
  when set.
- `cli/validators/spec-registry.mjs` emits SPR007.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (the optional `@babel/parser` for the export AST)
**Testing**: `node:test` with temporary Git repositories
**Project Type**: CLI

## Research

The community extensions were compared on 2026-09-29 (#455).
- Brownfield Bootstrap and Time Machine build specs from LLM prompts and validate nothing
  against code. Time Machine also re-runs `/speckit.implement` over existing code.
- BrownKit's "spec seeds" are not Spec Kit specs.
- Blueprint Index validates a directory map, not requirements.

Nobody checks FR-level facts both ways, so that is DocGuard's contribution. Two ideas were
rejected: a prose `Status: As-built` field as the source of truth (the registry already carries
lifecycle state), and per-FR `Evidence:` path lines (`@implements` is stronger).

## Constitution Check

| Principle | Assessment |
|-----------|-----------|
| V. AI as author | DocGuard writes no requirement text. Every statement is an agent task. Pass. |
| VI. Safe writes | A new file only. The registry write rolls the spec back on failure. Pass. |
| VII / X | Output is a Spec Kit spec in the next free feature directory. Pass. |
| IX | SPR007 is an escalation. Facts are deterministic scanner output. Pass. |

## Project Structure

```text
cli/scanners/as-built.mjs              # NEW
cli/commands/generate-as-built.mjs     # NEW
cli/commands/generate.mjs              # --spec dispatch
cli/docguard.mjs                       # --spec flag, help
cli/scanners/spec-registry.mjs         # origin, sourcePaths
cli/validators/spec-registry.mjs       # SPR007
cli/shared-source.mjs                  # grepEnvUsage within
cli/findings.mjs                       # SPR007
schemas/docguard-specs.schema.json
tests/as-built-specs.test.mjs          # NEW
```
