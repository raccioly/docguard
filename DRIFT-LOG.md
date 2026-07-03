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
| 2026-05-26 | `tests/scoping-extended.test.mjs` | ARCHITECTURE.md | v0.15 P3 test fixture builds `// D' + 'RIFT:` strings via concat to test changed-files scoping without false-positiving the outer scan. | Info | By design — test implementation; mitigated by v0.15.1 hotfix that skips test files by default in Drift-Comments |
| 2026-05-26 | `cli/validators/drift.mjs` | ARCHITECTURE.md | Drift-Comments validator v0.15.1+ skips test files by default (matches TODO-Tracking's pattern). Opt in via `config.drift.includeTestFiles` if your project genuinely uses DRIFT markers in test code. | Info | By design — defensive default to prevent fixture false-positives |
| 2026-05-26 | `CHANGELOG.md` / `extensions/spec-kit-docguard/skills/*` | None | v0.12-v0.15 changelogs and release notes reference `// DRIFT:` in feature descriptions (e.g. K-3 .docguardignore, v0.13 sync, v0.14 P3 scoping). Documentation prose only, not actionable drift. | Info | By design — release notes |
| 2026-07-03 | `templates/commands/*`, `CHANGELOG.md`, `docs/ai-integration.md` | None | v0.29 batch audit: the DRIFT mentions in recently-committed files are the known by-design classes above (template instruction text, validator docstrings, changelog prose, and the new AI-integration guide's workflow step 6 teaching the drift protocol). No new code deviations from canonical docs were introduced by the findings migration, generate split, or integration-surface work. | Info | Audited — no actionable drift |
| 2026-07-03 | post-v0.29 batch (`cli/scanners/speckit.mjs`, `tests/speckit-phantom.test.mjs`, `packaging/*`) | None | Post-release batch audit (phantom detection, instruction audit, trace --features, distribution files): DRIFT mentions are validator/test/doc prose of the by-design classes above. No new code deviations. | Info | Audited — no actionable drift |
