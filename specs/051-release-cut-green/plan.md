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

### FR-007 revision (2026-10-13): a per-test ceiling at reference speed

- `tools/suite-runtime-budget.mjs` (new):
  - `parseTap` reads the suite total and each top-level test's own `duration_ms` from node:test TAP on Node 18–24.
  - `speedFactor` takes the median of observed ÷ reference over shared tests of at least 50ms; names that repeat across files are summed.
  - `evaluate` applies the ceiling and fails closed.
  - `buildReference` normalizes each input by its own speed factor, takes per-test medians, and rescales to the median runner.
  - The CLI has two commands: `check` (for CI) and `reference` (for a refresh).
- `tools/suite-runtime-reference.json` (new): built from the TAP of the 40 latest-code CI jobs (runs 38316463730 to 38332304538).
- `tests/fixtures/suite-runtime-runs.json` (new): the fastest and the slowest of those inputs, for the backtest in the test.
- `.github/workflows/ci.yml`:
  - "Run Tests (with runtime budget)" runs the suite, then `check`, with `TEST_CEILING_MS: 100000`.
  - The TAP output is uploaded as an artifact so the reference can be refreshed from a main run.
- `tests/release-cut-green.test.mjs` (FR-007, SC-003): ceiling headroom and trip bounds against the reference's recorded speed factors, and the recorded runs pass and fail as SC-003 says.
- `tests/suite-runtime-budget.test.mjs` (new): unit tests for the parser and the rule's failure modes.
- `tests/ci-reproducibility.test.mjs`: the CI step's exit codes with a real TAP stub.

Research decisions:
- **The reference is self-normalizing.** Each input is divided by its own speed factor before the per-test medians are taken, so inputs from fast and slow runners do not blur one test's duration. The result is then rescaled to the median input. That keeps "100s" meaning the same thing after a refresh, provided the inputs span the runner fleet (every leg of several runs), as the tool header says.
- **Top-level tests, not files.** node:test TAP reports no per-file duration. A top-level `describe` or `it` is the smallest unit a runaway lands in. Splitting a slow test lowers its duration, and that is the intended fix when one approaches the ceiling.
- **Medians over at least 50ms.** Shorter tests measure timer and scheduler noise. A median is unmoved by a runaway in a few tests, which is what keeps the runaway visible.

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
