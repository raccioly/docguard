# Enterprise precision: validation record

September 11, 2026. Local uncommitted implementation on `codex/documentation-trust`, based on v0.35.0 (`246daf2`). This record supersedes the final-state numbers in the earlier [trust validation](TRUST-VALIDATION.md), while retaining that first phase's historical measurements.

## Automated validation

All four tested runtimes pass the final combined suite. There are 1,481 tests, up from the original baseline's 1,050 and the first phase's 1,284. Every completed final run has zero failures, cancellations, skipped tests, or TODO tests. No dependency was added.

| Node major | Passed | Failed | Seconds | Execution |
|---|---:|---:|---:|---|
| 18 | 1481 | 0 | 50.57 | 4 concurrent test files |
| 20 | 1481 | 0 | 21.83 | Default test concurrency |
| 22 | 1481 | 0 | 27.38 | Default test concurrency |
| 24 | 1481 | 0 | 22.24 | Default test concurrency |

Versions: Node 18.20.8, 20.20.2, 22.23.2, and 24.18.0 on macOS. Commands: `fnm exec --using=<major> node --test tests/*.test.mjs`; the final Node 18 run adds `--test-concurrency=4`. Initial simultaneous matrix runs exposed a shared-temp-directory race and an ESM cleanup error in demo tests. The tests now isolate each invocation's temporary root and use `finally` cleanup. Node 18 also stalled twice at default concurrency during demo subprocess execution; those runs were terminated, not counted as passes. The bounded run passes, but the default-concurrency stall is not established as fixed.

Self-guard: PASS, 301/301 configured checks, zero errors or warnings. Its coverage separately reports 20 checked validators, one missing prerequisite, and six unmatched detectors; a passing gate is not universal coverage. Python distribution wrapper imports successfully with bytecode writing disabled. npm dry-run packaging contains 180 files, with no backup or private-directory paths. Diff whitespace checks pass. Hosted CI and a published installation have not been exercised in this phase.

## Paired field comparison

Six private repositories were copied into disposable snapshots. Both the baseline CLI from `246daf2` and the changed CLI used the same snapshot content and history. The original applications were not executed or edited, and no dependencies were installed in them. Snapshots excluded private local directories, dependency trees, actual environment-value files, symlinks, and files over 20 MiB. Results therefore describe the sampled source, not those excluded inputs. Baseline/current comparisons did not add suppressions or change consumer configuration.

Labels below intentionally omit private repository names and source content. Counts are tool findings, not independently verified defect counts. Projects span JavaScript/TypeScript applications, infrastructure, Python, and a Worker service.

| Sample | Baseline errors / warnings | Changed errors / warnings | Observed behavior |
|---|---:|---:|---|
| A: large application | 17 / 114 | 17 / 118 | Diff-suspicion warnings 12→4; skip warnings 4→1. Sixteen API omissions now identify the OpenAPI authority and acknowledge routes extracted from code. More explicit review-scope findings keep the total elevated. |
| B: application | 0 / 3 | 0 / 8 | Final findings are freshness/review signals. Missing or old review evidence does not establish incorrect documentation. |
| C: application and infrastructure | 0 / 73 | 0 / 78 | Formatting and negated-list technology noise removed. Nested skipped suites and additional requirement links produce new review findings. |
| D: administrative application | 0 / 66 | 0 / 65 | Skip warnings 7→1 and formatting warning 1→0; expanded explicitly configured freshness scope adds review tasks. |
| E: Python | 0 / 3 | 0 / 0 | Formatting-only warnings removed. Python architecture relationships remain explicitly unsupported, with other missing/unmatched coverage shown. |
| F: Worker/spec layout | 7 / 8 | 7 / 33 | Existing layout errors remain without configuration changes. Spec discovery adds 24 annotation-link warnings and one additional review signal; they do not establish missing behavioral tests. |

Five original repositories had identical sampled file hashes, HEAD, and Git status at verification. The sixth received a concurrent commit and one changed sampled file outside this assessment; no attempt was made to restore it. Of 3,178 sampled files, 3,177 retained their hashes. Both versions still used that repository's identical saved snapshot. Temporary source copies and raw field output were removed after verification.

Field timings were collected while local tests were running and are not a speed benchmark. Correctness now includes additional parsing, source checks, and evidence work. No real-project performance improvement is claimed.

## What the tests protect

- API contract omissions must not be described as absent implementation when matching routes are extracted. Automatic removal requires additional code evidence and refuses ambiguous cases.
- Formatting-equivalent Python and JavaScript changes stay quiet; genuine removed declarations remain detectable even when a same-named call survives.
- Negated, historical, and coordinated-list technology statements stay distinct from affirmative use. Affirmative statements later in the same prose remain checked.
- Explicit synthetic mock expectation values and static skip explanations avoid their demonstrated false alarms. Arbitrary passwords, real provider-key patterns, unexplained neighboring skips, nested skipped suites, and empty/dynamic reasons remain controls.
- Worker bindings respect tested lexical scopes, shadowing, strings, and regular expressions through the existing optional Babel parser and a conservative fallback. No alias/dataflow or dynamic-name completeness is claimed.
- Custom document roles work for validation, scoring, and read-only plans. Direct readers reject mapped symlinks/private aliases; CLI and direct automatic writers refuse unsupported custom layouts before mutation.
- Freshness is a low-confidence review heuristic. Explicit historical/superseded/deprecated artifacts retain historical intent. Missing test annotations leave behavioral coverage unknown, and non-test configuration files are not offered as test matches.
- Coverage output distinguishes checked, partial, disabled, not applicable, missing prerequisites, unsupported, no matches, and errors. JSON consumers retain that distinction.

## Remaining adoption work

Sample F demonstrates a real limitation: finding spec definitions outside the old canonical layout improves visibility, but annotation-centric traceability can produce a new warning burden. Requirement-to-test links in tables or external manifests, duplicate-ID scoping, and draft lifecycle policy need independently tested support. This pass does not solve them by suppressing the findings.

Custom role mapping removes a hardcoded read-layout constraint, but automatic generation/sync/fix for custom layouts is deliberately unavailable until section ownership and preservation are proven. Python architecture coverage, complex Worker binding forms, and semantic prose correctness remain incomplete. Freshness still uses repository-wide history where precise dependencies are unavailable.

These six related private projects are a discovery corpus, not proof of enterprise-wide precision or superiority. The [roadmap](TRUST-ROADMAP.md) defines broader evaluation and the next acceptance gates. Feedback remains voluntary and metadata-only by default; minimized synthetic reproductions can become paired regression fixtures without disclosing enterprise source. No release, commit, push, consumer-hook installation, or remote contribution submission was performed.
