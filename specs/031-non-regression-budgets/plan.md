# Implementation Plan: Non-Regression Budgets

**Branch**: `feat/non-regression-budgets` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

`tools/budget.mjs` has two subcommands:

- `measure` runs each metric as a child process of that tree's
  `cli/docguard.mjs`, so base and head are measured by their own code.
- `compare` applies `budgets.json` and the PR's `Budget-Exempt` lines.

A new CI job, `budget`, checks out base and head side by side, installs
`node_modules` once (the dependency set is itself a metric), interleaves 5 guard
runs per tree, and writes the summary table.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test` against synthetic reports, plus one real measure of
the current tree
**Constraints**: the job stays within 3 minutes (SC-002). MCP responses are
read over stdio with fixed JSON-RPC requests.

## Constitution Check

- IX (honest assurance): an unmeasurable base is inconclusive, never a pass.
- VIII: no network beyond `actions/checkout`.
- Supply chain: SHA-pinned actions only.

Pass.

## Project Structure

```text
tools/budget.mjs                   # NEW: measure | compare
budgets.json                       # NEW: ratios, floors, fixed task strings and MCP requests
.github/workflows/ci.yml           # NEW job: budget
package.json                       # script: budget
AGENTS.md                          # budget rule
tests/budget.test.mjs              # NEW
testguard.claims.json              # BUDGET-CATCHES-REGRESSIONS
```
