# Implementation Plan: Spec Kit Artifact Coverage

**Branch**: `feat/constitution-validation` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

Teach the three document-reading surfaces that Spec Kit artifacts exist:
- guard's coverage map gains a `specKit` tier (top-level `specs/**/*.md` plus the detected
  constitution);
- Metrics-Consistency and Reference-Existence read the constitution;
- Metrics-Consistency gains `MET004` for runtime-dependency count claims against
  `package.json`.

`findAllOpenApiSpecs` moves from `cli/validators/api-surface.mjs` to
`cli/shared-openapi.mjs`. `api-surface` re-exports it so existing importers keep working. A new
repository test enforces validator isolation.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`
**Project Type**: CLI
**Constraints**: coverage JSON changes are additive only (Constitution IX, 013 FR-001)

## Constitution Check

| Principle | Assessment |
|-----------|-----------|
| III. Docs as truth | The constitution becomes a checked document. Pass. |
| IV. Validator isolation | Fixed in code and enforced by a test. Pass. |
| VII. Spec Kit integration | Spec Kit artifacts become first-class in coverage and claim checks. Standing rule (maintainer, 2026-09-29): every DocGuard surface that enumerates or reads project documents MUST account for Spec Kit artifacts. Pass. |
| IX. Honest assurance | `MET004` is an escalation, with no mechanical fix. Missing manifest means not applicable, never zero. Pass. |

## Design

- `cli/scanners/speckit.mjs`: add `findConstitution(projectDir)` → `{ abs, rel } | null` built on
  `detectSpecKit`.
- `cli/commands/guard.mjs` `computeDocCoverage`: before the canonical/home/root tests, a file
  under top-level `specs/<dir>/` counts as `specKit`. The constitution is appended to the
  discovered set when the walker missed it. The tier line prints `N spec-kit`.
- `cli/validators/metrics-consistency.mjs`: `findMarkdownFiles` adds the constitution. `MET004`
  regexes:
  - qualified: `\b(zero|no|none|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:runtime|production|npm|package|external|third-party)\s+dependenc(?:y|ies)\b`
  - label: `^\s*(?:[-*|]\s*)?\**Dependencies\**\s*[:|]\s*\**\s*(none|zero|no|\d+)\b`

  The actual count is `Object.keys(package.json.dependencies || {}).length`.
- `cli/validators/reference-existence.mjs` `indexDocs`: push the constitution.
- `tests/validator-isolation.test.mjs`: parse `import … from './x.mjs'` in each validator file;
  the target must not be a sibling validator.

## Project Structure

```text
cli/shared-openapi.mjs                    # NEW (moved findAllOpenApiSpecs)
cli/validators/api-surface.mjs            # imports + re-exports
cli/validators/docs-sync.mjs              # imports from shared
cli/scanners/speckit.mjs                  # findConstitution()
cli/commands/guard.mjs                    # specKit tier
cli/validators/metrics-consistency.mjs    # constitution + MET004
cli/validators/reference-existence.mjs    # constitution
cli/findings.mjs                          # MET004 code registration
tests/spec-kit-artifact-coverage.test.mjs # NEW
tests/validator-isolation.test.mjs        # NEW
```
