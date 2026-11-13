# Implementation Plan: Agent-Instruction Copies

**Spec**: [spec.md](spec.md) (`docguard.instruction-copies`)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002 | `cli/shared-agent-instructions.mjs`: `instructionCopyOf(path, config)` returns `{ kind: 'template' \| 'non-product', segment }` or null; `isGoverningOverride(path, config)` reads `agentInstructions.governing`. `computeDocs` drops a non-root file that is a template copy, or a non-product path (unchanged), unless the override names it. Path-Scoped-Rules filters its entries through the same rule. |
| FR-003 | `cli/validators/path-scoped-rules.mjs`: PSR006 over the tracked, not-ignored files, grouped by instruction name. Counted in `total` and in the validator's `applies` evidence. |
| FR-004 | `cli/findings.mjs` (catalog, so `explain` and `docs:reference` follow), `schemas/docguard-config.schema.json`, `docs-canonical/DATA-MODEL.md`, `CHANGELOG.md`. |
| FR-005 | `benchmarks/fixtures/instruction-copies/` plus two corpus cases and the reviewed baseline. |

## Research decisions

- **A role-only rule, not a new `DEFAULT_DETECTION_IGNORE_DIRS` entry.** Routes, schemas, the module diagram, ownership and the symbol map read that set, and `templates/` holds product files in Django, Flask and Jinja projects.
- **The template segment must be an ancestor of the file's folder.** `templates/x/files/AGENTS.md` is a form; `templates/AGENTS.md` and `packages/templates/AGENTS.md` govern the folder they sit in. This is the line between a copy and a monorepo package.
- **Only segments before the first dot-directory count.** Inside `.cursor/rules/` or `.claude/skills/` every file is one the harness loads, whatever its subfolder is called.
- **An include override, not an exclude list.** `.docguardignore` already excludes a file. What is missing is a way to rescue a governing file the rule drops, so the key is `agentInstructions.governing`.
- **Fixture copies are low confidence.** A fixture project often needs the real file name to be a fixture; `.docguardignore` is the alternative the message names.
- **Rejected: detecting copies by `{{placeholders}}`.** Real instruction files document template languages; silently dropping one from review is worse than a warning.
