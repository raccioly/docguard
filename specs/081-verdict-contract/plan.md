# Implementation Plan: Every Check Ends in a Verdict, and an Observation It Could Not Make Is Never a Pass or a Finding

**Branch**: `claude/docguard-aws-comparison-077b3f` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 to FR-003 | `cli/validator-coverage.mjs`: `APPLICABILITY_CLASS` (state → class), `deriveVerdict(result)` (the six-step precedence of FR-001), and `summarizeVerdicts(results)` (counts plus gaps). `describeCheckCoverage` adds `class` to the applicability it returns and keeps every existing state and reason. |
| FR-004, FR-009 | New `cli/observations.mjs`. It holds a stack of per-validator gap lists, exported as `openObservations()`, `recordGap(gap)` (a no-op when no list is open) and `closeObservations()`. `cli/shared-git.mjs` gets one `runGit(dir, args, opts)` wrapper for `execFileSync` and `spawnSync`. It retries once on `EAGAIN`, `EMFILE`, `ENFILE` and `ETIMEDOUT`. On a spawn error, timeout or signal, or on an exit status the helper documents as a failure, it records a gap, but only when `gitMetadataStatus(dir).status === 'ok'`, which it caches per directory per run. That keeps the whole-run cases owned by spec 022. |
| FR-005 | `cli/commands/guard.mjs` `runGuardInternal`: open and close a list around every validator, including Canonical-Sync and Metrics-Consistency, and attach it as `result.observations`. In `describeCheckCoverage`, gaps on a `checked` or `no-matches` result turn it `partial`, with a reason that names each operation and count. A more specific state is kept. |
| FR-006 | `cli/validators/path-scoped-rules.mjs`: a `null` from `gitIgnoredPaths` withholds every unresolved pointer. The count is added to the limitation, and the helper has already recorded the gap. Pointers resolved without git are unaffected. |
| FR-007 | `listTrackedFiles` consumers: `doc-references` (agent-instruction scan) falls back to the working-tree walk the way `path-scoped-rules` does. I'll audit `doc-deps`, `doc-ownership` and `anchors` (both calls); each already falls back or records its limitation, and the audit is recorded in the inventory. |
| FR-008 | `tests/verdict-contract.test.mjs` holds `GIT_CALL_SITES`, a reviewed table of file → helper → handling. A scan of `cli/validators/` and `cli/scanners/` for calls to every `shared-git.mjs` export that can return no answer must match the table exactly. |
| FR-010 | The three `catch` branches in `runGuardInternal` keep their result shape and add nothing. `deriveVerdict` reads a result whose applicability status is `error` and that has no structured findings as `blocked`. |
| FR-011 | `cli/docguard.mjs`: parse `--fail-on-inconclusive`. In guard, `exitFor` returns 2 when there is no error and `flags.failOnInconclusive` is set and any verdict is `inconclusive` or `blocked`. `cli/commands/ci.mjs` gets the same gate, and `action.yml` adds an input `fail-on-inconclusive` that passes the flag. Help text in both places. |
| FR-012 | `runGuardInternal` returns `verdicts: { counts, gaps }`, where each gap carries its validator key. `cli/shared-guard-json.mjs` `compactGuardResult` keeps `verdict` on each validator, replaces `observations` with `observationCount`, and keeps `verdicts.gaps` once. |
| FR-013 | `cli/writers/sarif.mjs`: `runs[0].invocations[0]` gets `executionSuccessful` (false when any verdict is `blocked`) and `toolExecutionNotifications`, one per `blocked` (`error`) or `inconclusive` (`warning`) validator. Each notification carries `descriptor.id` = the validator key and `message.text` = the reason. |
| FR-014 | `cli/writers/junit.mjs`: branch on `v.verdict` first. `blocked` → `<error type="docguard.blocked">`; `inconclusive` and `empty` → `<skipped message="…"/>`; `skipped` → `<skipped/>`. The existing branches remain the fallback for a result with no verdict (older JSON piped in). |
| FR-015 | Guard human output: one line, `Verdicts: N pass · N fail · N empty · N inconclusive · N blocked · N skipped`, printed after the validator list. The `na` row prints its reason whenever the verdict is `inconclusive`; `empty` keeps today's dim row. |
| FR-016 | Additive fields only. The hermetic A/B (SC-004) diffs findings by (code, location, message) multiset and statuses by key. |
| FR-017 | `docs-canonical/DATA-MODEL.md` (validator result fields, observation gap), `ARCHITECTURE.md` (component row), `TEST-SPEC.md` (rows for the new test file), `docs/reference/` (regenerated plus the hand-written output-format pages), `extensions/spec-kit-docguard/commands/guard.md`, `CHANGELOG.md` `[Unreleased]`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (Constitution II)
**Testing**: `node:test`. `tests/verdict-contract.test.mjs` holds:
- the PATH-stub git fixture (a `git` script that fails `check-ignore`, or `ls-files`, or both, and execs the real git for everything else);
- the six-verdict fixture asserted in five formats;
- the call-site inventory;
- the retry case (the stub fails the first `check-ignore` call only).

The existing guard, SARIF, JUnit, compact JSON, path-scoped-rules and coverage suites run unchanged.
**Constraints**: no finding or status changes when git works. No production test hooks: the stub git on `PATH` is the only seam.

## Research decisions

- **What exists.**
  - Closed applicability states: `cli/validator-coverage.mjs` (spec 008).
  - The incomplete-coverage set: `INCOMPLETE_COVERAGE_STATES` (spec 013 FR-020).
  - Whole-run unreadable git: `gitMetadataStatus` and `unreadableGitApplicability` (spec 022).
  - Crash capture: the three `catch` branches in `runGuardInternal`.

  The verdict is derived from these facts and does not replace any of them.
- **Why a seventh state was refused and a sixth verdict was added.** DocGuard's own run has 6 `no-matches` validators. Drift (no `// DRIFT:` comments) and Diff-Suspicion (no code change in range) are complete checks. Counting them as `inconclusive` would make `--fail-on-inconclusive` demand false N/A declarations. A separate `empty` verdict keeps spec 013's decision, and the applicability class stays `unknown` so spec 083 can still hold a blocking rule on it.
- **Why the ledger lives in a module and not in the call signatures.** Threading a collector through about 20 helper signatures and every scanner would touch most of `cli/`. A synchronous stack is exact here: guard runs validators one at a time with no `await` between open and close. A nested `runGuardInternal` (the `memory` command) opens its own lists. A helper called outside guard (`rules`, `trace`) finds no open list, so `recordGap` does nothing and behavior is unchanged.
- **Why gaps are recorded only when git is readable.** Spec 022 already reports a missing or unreadable git directory once, as `missing-prerequisite`. Recording a gap per call on top would report one cause dozens of times.
- **Which exits are failures.**
  - Spawn errors, timeouts and signals are failures for every helper.
  - An exit status is a failure only where the helper's git command documents its codes: `check-ignore` (0 and 1 are answers) and `ls-files` (0 is the only answer).
  - `fileContentAtRev` returning nothing for a path absent at that revision is an answer, not a gap.
- **Why PSR002 withholds rather than downgrades.** A low-confidence PSR002 would still be a claim that a file is missing, which nobody observed. Withholding with a counted limitation is what spec 013 FR-021 prescribes for an unknowable answer.
- **Rejected:**
  - A per-finding verdict (it duplicates severity, confidence and disposition).
  - Changing the crash `status` to a new value (it would change exit codes and every consumer's `status` switch).
  - A config key for the gate (`ci` and the Action pass flags; a config key would be a second source of the same switch).
  - Retrying every failure (only resource exhaustion is transient).

## Project Structure

```text
cli/observations.mjs                     FR-004, FR-005 (new)
cli/shared-git.mjs                       FR-004, FR-009 (runGit wrapper)
cli/validator-coverage.mjs               FR-001 to FR-003, FR-012
cli/commands/guard.mjs                   FR-005, FR-010, FR-011, FR-012, FR-015
cli/commands/ci.mjs, cli/docguard.mjs    FR-011
action.yml                               FR-011
cli/validators/path-scoped-rules.mjs     FR-006
cli/scanners/doc-references.mjs          FR-007
cli/shared-guard-json.mjs                FR-012
cli/writers/sarif.mjs                    FR-013
cli/writers/junit.mjs                    FR-014
docs-canonical/*.md, docs/reference/, extensions/spec-kit-docguard/commands/guard.md, CHANGELOG.md   FR-017
tests/verdict-contract.test.mjs          SC-001 to SC-003, SC-005
```

## Risks

- **Module state leaking between runs.** A thrown validator could skip its `close`. Mitigation: open and close in a `try`/`finally` around each validator, and a test asserts the stack is empty after a run that crashes one validator.
- **A gap recorded by a helper during an earlier phase** (config resolution, doc roles) before any validator list is open. With no list open it is dropped by design. Those phases already fail loudly when git is missing.
- **Exit-status heuristics.** Treating a non-documented exit as a gap could turn an answer into `inconclusive`. Only `check-ignore` and `ls-files` statuses are classified; every other helper records spawn-level failures only.
- **SARIF consumers rejecting the new invocation fields.** `toolExecutionNotifications` and `executionSuccessful` are SARIF 2.1.0 standard fields. The existing SARIF schema test validates the output.

## Verification

1. `npm test`; `node cli/docguard.mjs guard`; `node cli/docguard.mjs guard --fail-on-inconclusive` (SC-006); `npm run budget`.
2. Hermetic A/B (SC-004): `git archive` of `v0.45.2` and of the branch head as CLIs; one fresh `git archive` copy of each project per CLI; `guard --format json` run serially with no other load; findings diffed by (code, location, message) multiset and statuses by key. Also `git clone --local` copies for history-dependent validators.
3. Fault injection (SC-005): the same project copies with the stub git on `PATH` failing `check-ignore` and `ls-files`. No finding is added, and no affected validator is `pass`.
