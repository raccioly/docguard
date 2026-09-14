# Task-specific agent context — protocol v1 result

<!-- docguard:last-reviewed 2026-09-14 -->

The frozen 27-run evaluation supports promoting task-specific context as an
explicit, opt-in DocGuard interface. All three conditions completed all nine
trials with no hidden requirement failures, visible-test regressions, or edits
outside the task allowlist. The targeted packet reduced median agent steps by
50% and median latency by 17% against the existing repository context pack,
clearing the predeclared 15% efficiency gate.

| Condition | Success | Requirement violations | Unnecessary edits | Median steps | Median uncached input | Median latency |
|---|---:|---:|---:|---:|---:|---:|
| Task only | 9/9 | 0 | 0 | 8 | 16,197 | 14,973 ms |
| Context pack | 9/9 | 0 | 0 | 10 | 9,823 | 16,659 ms |
| Targeted packet | 9/9 | 0 | 0 | 5 | 17,640 | 13,829 ms |

The result is mixed rather than uniformly cheaper. Targeted packets used 80%
more median uncached input tokens than context packs. They earned promotion
through fewer tool steps and lower latency, while preserving every measured
behavior. The feature should therefore remain opt-in, bounded, and explicit
about retrieval-only assurance. Teams optimizing primarily for token spend may
prefer the existing context pack.

`observed-v1.json` separates the deterministic protocol core and aggregate from
environment metadata and individual model observations. It retains every run,
including latency, usage, steps, changed files, patch digest, and failure state;
it does not retain prompts, source patches, or model prose. The manifest,
fixtures, hidden evaluators, reference behavior, and shuffled order are versioned
beside the harness.

The result records separate digests for the selector, the executor that produced
the observations, and the current analysis logic. The observation harness is
recoverable at its full Git revision. A later Node 18 portability fix expanded
the already-frozen visible-test glob before spawning Node, and a scoring fix made
infrastructure failures categorically ineligible for promotion. Reapplying the
fixed analysis to the original 27 completed observations preserves the promotion
decision; the quota-limited diagnostic rerun was discarded.

Reproduce fixture controls without invoking a model:

```sh
node benchmarks/agent-context/run.mjs
```

Run the frozen model matrix explicitly:

```sh
node benchmarks/agent-context/run.mjs --run --concurrency 3
```

This synthetic benchmark establishes the v1 promotion decision only. It does
not prove a general productivity improvement across models, repository sizes,
languages, or task classes. Future claims require a new predeclared protocol;
the v1 thresholds and observations must not be rewritten around later results.
