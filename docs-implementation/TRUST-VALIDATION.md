# Documentation trust: validation record

Reviewed September 11, 2026 against base commit 246daf2 on branch codex/documentation-trust. This record covers the local uncommitted implementation; it is not a published-release attestation.

This is the first implementation phase. See [enterprise precision validation](PRECISION-VALIDATION.md) for the subsequent field-driven changes and final combined test matrix.

## First-phase integrated checks

All supported runtime jobs passed the full suite with the final code and CI regression tests. The original baseline contained 1,050 tests; the changed suite contains 1,284, an increase of 234. Tests ran locally on macOS, with zero failures, cancellations, or skipped tests.

| Node | Passed | Failed | Duration (seconds) |
|---|---:|---:|---:|
| 18.20.8 | 1284 | 0 | 24.00 |
| 20.20.2 | 1284 | 0 | 23.91 |
| 22.23.2 | 1284 | 0 | 23.19 |
| 24.18.0 | 1284 | 0 | 23.09 |

Guard: PASS, 301/301 checks, zero errors or warnings. Ten extracted semantic claims remain explicitly unverified. Score stays 100/A+ for structural maturity, with factual accuracy null.

Python distribution wrapper imports successfully. The npm package dry run contains 178 files and excludes backup and private-directory paths. Diff whitespace checks pass. No dependencies were added. All independently reproduced review findings described below were fixed and received regression coverage.

## Independent review

Separate reviewers inspected cache/provenance, output assurance/feedback, and workflow integration. Reproducing probes found defects that the initial passing suite missed: disk-promotion eviction, malformed cached document records, misleading empty-report wording, unverified ALCOA rendering, feedback write failure reporting, workflow expression scope, and an ineffective baseline assertion. These findings were corrected and regression-tested before the final matrix.

## Cache performance

Five-trial medians from an isolated baseline/current comparison, using 1,001 synthetic files totaling approximately 1.34 MiB. Both versions used the same installed parser. Fresh-process measurements include parser availability probing. Cold process does not mean a flushed operating-system file cache. The benchmark preceded the final cache-shape and eviction corrections; these numbers describe the content-invalidation design rather than a release performance guarantee.

| Measurement (milliseconds) | Base Node 24 | Changed Node 24 | Base Node 18 | Changed Node 18 |
|---|---:|---:|---:|---:|
| Cold build | 229 | 270 | 293 | 342 |
| Warm in-process cache | <0.01 | 21.4 | <0.01 | 23.5 |
| Fresh-process disk lookup | 9.1 | 58.4 | 9.4 | 62.1 |
| Source edit, disk lookup | 8.0 (stale) | 170.7 (updated) | 8.2 (stale) | 185.7 (updated) |

The old cache won timings by reusing stale results. The changed cache checks source content on reuse, increasing cold cost by roughly 17–18%. Warm hits save approximately 84% against an uncached scan in this synthetic workload. These results justify the correctness trade-off; they do not establish performance on large monorepos. The next optimization should use measured dependency-scoped invalidation while retaining fresh-process correctness and conservative cache misses.

## Limits and rollout

Local automated tests establish tested behavior only. Hosted GitHub Actions, branch-protection settings, real consumer installations, large-repository performance, and AI task outcomes still require their respective environment or pilot. No release, remote submission, or repository-protection change was performed.

Existing installed hooks need regeneration. Machine consumers must preserve nullable factual accuracy and feedback persistence errors. Generated workflows use reviewed fixed versions and must be upgraded deliberately. Semantic claim extraction remains heuristic and narrower than the general documentation inventory; unextracted prose is unverified.

The [trust roadmap](TRUST-ROADMAP.md) defines the evaluation corpus, contribution workflow, claim records, agent-context experiments, specialist adapters, and operational ownership work that follow this foundation.
