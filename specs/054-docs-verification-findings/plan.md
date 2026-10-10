# Implementation Plan: Defects Found While Documenting DocGuard

**Branch**: `fix/docs-verification-findings` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | `cli/scanners/project-type.mjs` labels a Koa-only project `Koa`. `cli/scanners/routes.mjs` reads Koa routes with the existing method-shorthand scanner, with `source: 'koa'`. |
| FR-002 | `cli/commands/agents.mjs` stamps the sync marker on every file it generates. |
| FR-003 | `cli/docguard.mjs` sends `agents --sync`, like `--check`, straight to `runAgents`. |
| FR-004 | `schemas/docguard-config.schema.json` `sourceRoot` accepts a string or an array of strings. |
| FR-005 | `.github/scripts/sync-release-version.mjs` updates the README's pre-commit `rev:`, `.pre-commit-hooks.yaml`'s usage comments and the GitLab component's version. `RELEASE_PATH_ALLOWLIST` and the release `git add` admit the new paths. The current examples are set to 0.43.1. |
| FR-006 | The MCP Origin comment in `cli/commands/mcp.mjs`. |
| FR-007 | `cli/validators/path-scoped-rules.mjs` resolves pointers against the unfiltered file list. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. One reproduction per defect (`tests/docs-verification-findings.test.mjs`), plus the release sync fixture in `tests/release-version-sync.test.mjs`.

## Research decisions

- **Koa keeps the shorthand scanner.** `app.get('/x')` and `router.get('/x')` from `@koa/router` are the shapes it already reads. Only the label and the `source` change, so no route a Koa project reports today is lost.
- **Mark generated agent files; do not adopt existing ones.** A file DocGuard writes is DocGuard's to regenerate. A file that already exists unmarked may be hand-written, and adopting it stays an explicit `--force`.
- **Pointer existence is a fact about the repository, not about validation scope.** `.docguardignore` keeps a file out of validation; it does not delete the file.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| VI (safe writes) | The release sync keeps its fail-closed transaction. The agent-file write path is unchanged apart from the marker. |
| IX (honest assurance) | Labels and findings say what is true. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/project-type.mjs, cli/scanners/routes.mjs   # FR-001
cli/commands/agents.mjs                                  # FR-002
cli/docguard.mjs                                         # FR-003
schemas/docguard-config.schema.json                      # FR-004
.github/scripts/sync-release-version.mjs, cli/release-pr-policy.mjs, .github/workflows/scheduled-release.yml, README.md, .pre-commit-hooks.yaml, templates/ci/gitlab-component.yml   # FR-005
cli/commands/mcp.mjs                                     # FR-006
cli/validators/path-scoped-rules.mjs                     # FR-007
tests/docs-verification-findings.test.mjs                # NEW
tests/release-version-sync.test.mjs
CHANGELOG.md
```
