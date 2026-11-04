# Implementation Plan: Required Checks and Evidence-Based Rule Promotion

**Branch**: `claude/docguard-aws-comparison-077b3f` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002, FR-003 | New `cli/required-checks.mjs` (shared, so `guard` and `ci` read one rule): `requiredCheckStatus(config, results)` returns `{ undecided[], findings[] }`. `undecided` lists required validators whose verdict is not `pass`, `fail` or `skipped`. A required check that is `skipped` because `validators[key] === false` (status `skipped`, applicability `disabled`) gives `REQ001`. A key that matches no validator gives `REQ002`. In `runGuardInternal`, the REQ findings are attached to a synthetic `requiredChecks` result. That result is added only when `requiredChecks` is configured, so the validator list is unchanged otherwise. `exitFor` returns 4 when `undecided` is non-empty, after errors. Each undecided check is printed with its verdict and reason, as `--fail-on-inconclusive` does. |
| FR-004 | `cli/assessment.mjs`: reason `CI_REQUIRED_CHECK_UNDECIDED` and `requiredUndecided[]` in the assessment; the summary names them. |
| FR-005 | `cli/commands/ci.mjs`: the history entry gains `docguardVersion` (`CLI_VERSION`), `codes` (code → `{ n, level }` from `guardData.findings` after baseline, `level` = `effectiveSeverity`) and `verdicts` (`guardData.verdicts.counts` plus `gaps: guardData.verdicts.gaps.length`). |
| FR-006 to FR-010 | New `cli/commands/policy.mjs`, a pure `buildPolicyReport(projectDir, config, { window })`. It reads `.docguard/history.jsonl` through `readHistory` (`cli/writers/history.mjs`), keeps usable entries (FR-009: has `codes`, `verdicts.gaps === 0`, and a `docguardVersion` at or above the version that introduced the code; a code with no recorded `since` counts as known to every version), and takes the last `window`. For every `CODES` entry it computes: configured enforcement (`findingSeverity`, else the validator's `severity`, else `defaultLevel`), last observed level, runs, hits, and its category (`ready-to-promote`, `noisy-blocking`, `insufficient-evidence`, `steady`). Text and `--format json` render it; the command writes nothing. |
| FR-011 | `schemas/docguard-config.schema.json` (`requiredChecks`: an array of strings, unique items); `cli/findings.mjs` `REQ001` (error, validator `requiredChecks`) and `REQ002` (warn); `npm run docs:reference`; `cli/docguard.mjs` dispatch, help and `COMMAND_HELP.policy`; `docs/commands.md`; `docs/configuration.md`; `CHANGELOG.md`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `tests/enforcement-ladder.test.mjs`. It covers:
- required checks with CLI exit codes (pass, inconclusive, empty, declared N/A, disabled, unknown key);
- `ci` readiness;
- history entry fields;
- `policy` with synthetic history files (promote, noisy, insufficient, gap-excluded, old-version-excluded).

**Constraints**: without `requiredChecks`, guard's validator list, findings and exit codes are unchanged (SC-002).

## Research decisions

- **What exists.** `severity.<validator>` and `findingSeverity.<CODE>` (`resolveFindingEnforcement`), `codeDefaultLevel`, ci history (`appendHistory`, `readHistory`), the verdicts and exit 4 of spec 081.
- **Why a synthetic result for REQ findings.** Constitution IV forbids a validator reading other validators' results. Guard composes REQ findings after the loop, as Canonical-Sync and Metrics-Consistency already do with `results`, so they flow through baseline, severity, SARIF and JUnit with no special path.
- **Why `empty` holds a required check.** That is AI-DLC's rule: only a declared NOT_APPLICABLE bypasses a blocking sensor. A team that names a check as required has said it applies, so finding nothing is a reason to look, not a pass. The in-repo N/A marker is the declaration that bypasses it.
- **Why history stores the level.** The effective level of a code that did not fire cannot be read from config alone: it depends on the intrinsic severity at emission. The level recorded when it last fired is the honest evidence.
- **`since` per code.** `CODES` has no introduction version today. FR-009's version filter applies only to codes that gain a `since` field. Every existing code counts as known to every version, which is true for every entry written by a version with `codes` (0.46.0 onward).
- **Rejected:** automatic promotion (writes config: Constitution V); a confidence threshold for promotion (the window is evidence, not a probability, and the report says so).

## Project Structure

```text
cli/required-checks.mjs        FR-001 to FR-003 (new)
cli/commands/guard.mjs         FR-001 (synthetic result, exit 4, text)
cli/assessment.mjs             FR-004
cli/commands/ci.mjs            FR-004, FR-005
cli/commands/policy.mjs        FR-006 to FR-010 (new)
cli/docguard.mjs               FR-006, FR-011
cli/findings.mjs, docs/reference/findings.md, schemas/docguard-config.schema.json, docs/*.md, CHANGELOG.md  FR-011
tests/enforcement-ladder.test.mjs
```

## Risks

- **Validator surface tests** (`validator-surface-invariant`, `validator-naming`) may enumerate result keys. The synthetic key `requiredChecks` appears only when configured, and is registered where those tests require it.
- **History growth**: `codes` adds one small object per code that fired. 1,000 entries remain far below the trim threshold's byte budget.

## Verification

1. `npm test`, `guard`, `npm run budget`.
2. Hermetic A/B (SC-002) with the shared harness, against the 081 commit.
3. SC-003 on this repository after five recorded `ci` runs.
