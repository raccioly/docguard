# Implementation Plan: Release Trend Gate

**Spec**: [spec.md](spec.md) · **Spec ID**: `docguard.release-trend-gate`

## Summary

A maintainer tool, `tools/release-ab.mjs`, runs the previous release's CLI and the candidate over a committed corpus and fails unless the CHANGELOG section being released names every finding code that changed. A `release-gate` job in `release.yml` runs it, plus the budgets and the precision benchmark against the previous tag, before `create-release`.

## Technical Context

- Node ESM, zero new dependencies. A maintainer tool beside `tools/budget.mjs`, and it is not shipped in the npm package.
- It reuses the head tree's `fingerprintFinding` (`cli/writers/baseline.mjs`), so a fingerprint change between releases is not read as a finding change.
- Each CLI runs as a child process from its own tree, the same way `budget.mjs ab` measures base with base's code.

## Design

### `tools/release-ab.mjs`

**Corpus**: `release-gate.json` `corpus` lists entries, each a path or `{ path, ignoreCodes }`. A path ending in `/*` expands to its subdirectories. `.` is the repository itself, taken from `git archive HEAD`, so local state never enters the copy.

**Per directory and CLI**:
1. Make a fresh copy and `git init`.
2. Commit once with a fixed author and date, so history-based validators see the same one-commit history for both CLIs.
3. Run `guard --format json` serially.
4. Record the exit code, findings, and each validator's status and verdict.

**Compare**: findings as a multiset of stable fingerprints, giving added and removed per code. Also compare the exit code and each validator's status and verdict. A code in `volatileCodes` is compared by count only.

**Judge**: find the changelog section being released. That is `[<head version>]` when it exists, else `[Unreleased]`.
- Every changed code must appear in that section as a word.
- An exit-code change needs an `Exit codes:` line.
- A directory that could not be compared, because a CLI produced no JSON, fails the gate.

**Output**: a Markdown summary to stdout and, with `--summary`, appended to `$GITHUB_STEP_SUMMARY`. With `--out`, a JSON report. Exit 0 on pass, 1 on fail, 2 on usage error.

### `release-gate.json`

`{ schemaVersion: 1, corpus: [".", "benchmarks/fixtures/*"], volatileCodes: { CODE: reason } }`. A test validates it, and `loadGateConfig` rejects a volatile code without a reason.

### Release workflow

A `release-gate` job in `release.yml`, needed by `create-release`. Before publishing it does four things:
1. Finds the previous tag: `git describe --tags --abbrev=0 --match 'v*'` on the candidate.
2. Extracts that tag with `git archive` into a sibling directory. It shares the candidate's `node_modules` when the runtime dependency pins are identical, and otherwise runs `npm ci --omit=dev --ignore-scripts` there, so the previous release never runs on the candidate's dependencies.
3. Runs `release-ab`, then `budget.mjs ab --base <prev> --head .`.
4. Runs the precision benchmark against `git show <prev>:benchmarks/baseline.json`.

With no previous tag, it prints a notice and skips. The job writes to the step summary.

## Project Structure

- New:
  - `tools/release-ab.mjs`
  - `release-gate.json`
  - `tests/release-trend-gate.test.mjs`
- Changed:
  - `.github/workflows/release.yml`
  - `docs-canonical/CI-RECIPES.md` (or the release section of CONTRIBUTING)
  - `docs-canonical/TEST-SPEC.md`
  - `CHANGELOG.md`

## Risks

- **Runtime**: about 10 directories × 2 CLIs × one guard run each. Guard on this repository takes about 10 s, so the job adds a few minutes.
- **Nondeterminism**: a finding whose message carries a date or a timing goes in `volatileCodes`, with its reason.
