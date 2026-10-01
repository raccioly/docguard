# Implementation Plan: A Release Cut That Passes Its Own Suite

**Branch**: `fix/changelog-tests-release-cut` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

## Summary

- `tests/fixtures/changelog-notes.mjs` (new): `notesSince(text, version)` returns the CHANGELOG from `## [Unreleased]` down to `## [<version>]`. The nine CHANGELOG tests and the SC-001 bump check use it with `0.42.1` (FR-001, FR-002).
- `.github/scripts/sync-release-version.mjs`: after staging the sources, it stages each `.agent/` mirror from the staged (or current) source and writes everything in the existing loop. Missing mirrors are created (FR-003).
- `.github/workflows/scheduled-release.yml`: the `ensureSkills` one-liner is removed (FR-004), and the release commit stages `commands/` (FR-006).
- `cli/release-pr-policy.mjs`: `RELEASE_PATH_ALLOWLIST` admits `.agent/commands/docguard.*.md` (FR-006).
- `.github/workflows/ci.yml`: `TEST_BUDGET_MS` 240000 → 360000, with the 2026-10-01 measurements (FR-007). Rejected alternatives:
  - Keep 240s: it now fails on runner noise, the failure the budget's own comment says it must avoid.
  - Drop the budget: nothing else catches a test that walks an unintended tree (PR #328).
  - Make the heavy end-to-end tests cheaper: worth doing, but no single test is a runaway. The time is spread across new coverage.
- `cli/ensure-skills.mjs`: `ensureSkills` throws a `TypeError` when `surface` is missing (FR-005).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. Unit tests on a temp tree run the sync script and the cut. The release is replayed on a scratch worktree.

## Research decisions

- **Bound the notes by the previous release, not by "the top section".** "The newest section" breaks again on the next cut. A fixed lower bound (the release before the change) holds for the life of the repository.
- **Mirror in the sync script, not through `ensureSkills`.** The mirrors are repository files, not an agent install. `ensureSkills` resolves the agent surface for the current machine: here that is `.claude/skills`, so it would never write `.agent/`. Keeping the mirrors in the fail-closed transaction means a release writes all surfaces or none.
- **Fail loudly on a missing `surface`.** A silent JSON-mode caller hid this defect. A missing argument is a programming error.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| VI (safe writes) | Mirrors use the existing staged `safeWrite` transaction. |
| IX (honest assurance) | No test is loosened. Each reads the notes its change shipped in. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
tests/fixtures/changelog-notes.mjs        # NEW
tests/release-cut-green.test.mjs          # NEW
tests/release-version-sync.test.mjs        # mirror cases
.github/scripts/sync-release-version.mjs  # .agent mirrors
.github/workflows/scheduled-release.yml   # drop the ensureSkills call
cli/ensure-skills.mjs                     # surface required
cli/release-pr-policy.mjs                 # allowlist admits .agent/commands
tests/{dogfood-findings,fallback-language-coverage,first-spec-preflight,generated-docs-consistency,js-ts-extraction,mcp-project-confinement,output-ux,read-only-commands,spec-kit-integration-honesty,release-readiness}.test.mjs
CHANGELOG.md
```
