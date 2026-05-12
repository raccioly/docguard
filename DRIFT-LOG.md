# Drift Log

> Documents conscious deviations from canonical specifications.
> Every `// DRIFT: reason` in code must have a corresponding entry here.

| Date | File | Canonical Doc | Drift Description | Severity | Resolution |
|------|------|---------------|-------------------|----------|------------|
| 2026-03-13 | `cli/commands/generate.mjs` | ARCHITECTURE.md | AGENTS.md template includes `// DRIFT: reason` as an instruction pattern for end users. These are template strings, not actual code deviations. | Info | By design — template content |
| 2026-03-13 | `cli/commands/generate.mjs` | ARCHITECTURE.md | DRIFT-LOG.md template includes `// DRIFT: reason` as placeholder text. | Info | By design — template content |
| 2026-03-13 | `cli/commands/agents.mjs` | ARCHITECTURE.md | Agent config generators include `// DRIFT: reason` as instruction text for AI agents. 3 occurrences across Windsurf, Cursor, and generic agent configs. | Info | By design — instruction content |
| 2026-03-13 | `cli/validators/drift.mjs` | ARCHITECTURE.md | Drift validator references `// DRIFT:` pattern in JSDoc and regex. | Info | By design — validator implementation |
| 2026-05-12 | `tests/drift.test.mjs` | ARCHITECTURE.md | Drift validator tests use `// DRIFT:` comments to simulate project files having drift comments. | Info | By design — test implementation |
