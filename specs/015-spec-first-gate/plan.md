# Implementation Plan: Spec-First Change Gate

**Branch**: `feat/spec-first-gate` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

Add `docguard specs require --since <ref> [--message-file <path>]`. A pure scanner
(`cli/scanners/spec-first.mjs`) classifies a change from three inputs: the changed-path
inventory against the merge base (reusing `getDiffSnapshot`, which already fails closed on
timeout, overflow and unreadable history), the commit messages in the range, and an optional
description file. It returns covered / exempt / not-governed / uncovered / inconclusive. This
repository runs it in CI with `specFirst.paths: ["cli/**"]`. The GitHub Action gains
`command: spec-first`, which reads the PR body and base branch through environment variables
only.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new; `cli/shared-git.mjs` (`getDiffSnapshot`), `cli/shared-ignore.mjs` (`globMatch`), `cli/scanners/spec-registry.mjs` (`parseSpecId`, `readSpecRegistry`)
**Storage**: reads `.docguard.json` `specFirst`, `specs/*/spec.md`, `.docguard-specs.json`
**Testing**: `node:test` with temporary Git repositories
**Target Platform**: any Git checkout; GitHub Actions for the CI wiring
**Project Type**: CLI
**Performance Goals**: bounded by `getDiffSnapshot` limits
**Constraints**: untrusted PR body never reaches a shell; no pass without evidence
**Scale/Scope**: 1 scanner, 1 subcommand, 1 config key, 1 CI job, 1 Action branch

## Constitution Check

| Principle | Assessment |
|-----------|-----------|
| I. LLM-first | `--format json` result with stable status names. Pass. |
| II. Dependencies | None. Pass. |
| IV. Validator isolation | Implemented as a scanner + command, not a validator. Pass. |
| VI. Safe writes | Read-only. Pass. |
| VIII. Local-first | Git only; no network. Pass. |
| IX. Honest assurance | Inconclusive is a distinct non-zero result; a reference must resolve. Pass. |
| X. Spec-first | This feature is its enforcement. Pass. |

## Design decisions (research)

- **Merge base, not two-dot**: `git merge-base <ref> HEAD` first, so commits that landed on the
  base after branching do not count as this change's paths.
- **Resolution sources**: spec directories are `specs/<dir>/spec.md` that exist; spec IDs come
  from those files' `Spec ID` headers plus `.docguard-specs.json` (so retired-but-registered IDs
  still resolve). An unregistered, nonexistent reference is reported, never accepted.
- **Exemption grammar**: `^Spec-Exempt:\s*(<kind>)\s*[—–-]+\s*(.+)$`, case-insensitive kind,
  reason ≥ 10 characters after trimming.
- **Default governed set** (no config): every changed path except `*.md`, `specs/**`, and test
  paths (`test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`, plus
  configured `testPatterns`).
- **Rejected**: making this a guard validator. Guard evaluates a tree; this evaluates a change
  between two revisions and needs a PR description, which guard has no input for.

## Project Structure

```text
cli/scanners/spec-first.mjs        # NEW pure classifier + git inventory
cli/commands/specs.mjs             # `require` action, rendering, exit codes
cli/docguard.mjs                   # --message-file flag, help text
action.yml                         # command: spec-first
.github/workflows/ci.yml           # spec-first job (pull_request)
.github/workflows/scheduled-release.yml  # Spec-Exempt line in the release PR body
.docguard.json                     # specFirst.paths = ["cli/**"]
AGENTS.md, docs-canonical/CI-RECIPES.md, docs-canonical/ARCHITECTURE.md, README.md
tests/spec-first.test.mjs          # NEW
```
