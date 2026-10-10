# Implementation Plan: Deterministic Budget Timing Tests

**Branch**: `spec/062-budget-deterministic` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | `tests/budget.test.mjs` scripts each guard sample's wall time with a seeded generator: 1000 ms plus up to 50 ms of jitter, and a 1–5 s burst on two of the head's five samples. Ten seeds pass base-vs-base and fail with the head 30% slower. A one-sample comparison with a 400 ms burst fails. |
| FR-002 | The same file records the order in which the scripted source is called (base, head, head, base, …) and scripts a drift of 100 ms per sample, under which the medians are 1400 and 1500 ms. |
| FR-003 | One test keeps real processes: `measurePair` on 100 ms and 400 ms stub trees, asserting each median is at least the stub's busy-wait, the static measures are read, and the verdict is PASS or FAIL. |
| FR-004 | `tools/budget.mjs` moves the interleaved sampling loop out of `measurePair` into an exported `guardPair(base, head, targets, { samples, sample = guardSample })`. |
| FR-005 | `docs-canonical/CI-RECIPES.md` Recipe 3e states the noise model. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/budget.test.mjs` (timing section rewritten). The budget CI job keeps exercising the real path on every pull request.

## Research decisions

- **The flake is in the test, not the tool.** The failing case passed `samples: 1`, which removes the median the tool relies on, and its 60 ms stub left the 150 ms floor as the only margin against process start-up delay. The CI configuration (`budgets.json` `samples: 5`) keeps both protections. Four base-vs-base A/Bs of this repository with the tool's own sampling (three of them beside 18 busy-loop processes) passed every target with a largest median ratio of ×1.054, while single rounds inside them differed by up to ×1.34 (`tasks.md` T006). That is the evidence for leaving the method alone.
- **Inject the sampler, not a clock.** Guard time is measured around a child process (`spawnSync` between two `performance.now()` calls). A fake clock would still spawn the process and would have to script `performance.now()` call pairs. The sampler (`guardSample(tree, targets) → { target: ms }`) is the narrowest unit that owns a measurement, and replacing it removes every process from the timing tests.
- **Extract `guardPair` rather than add an option to `measurePair`.** `measurePair` also collects static measures by spawning each tree's CLI and `npm pack`, about a second per call. A seam on `measurePair` would keep that cost in every scripted comparison. `guardPair` holds exactly the logic under test, interleaving and medians, and `measurePair` calls it.
- **Seeded noise, worst case placed on purpose.** Bursts land on the head only and on two of five samples, the most a median of five can absorb. A generator with a fixed seed makes "ten runs never fail" a fact about the statistic, not about the machine.
- **Rejected: more samples or a longer stub in the real-time test.** Wider margins make a race rarer, not impossible, and make the file slower (the old timing section took about 14 s; the new one about 3 s).
- **Rejected: changing the statistic (paired per-round ratios, trimmed means, a minimum of three samples).** Each changes reports that CI already publishes, and the measurement gives no case where five interleaved medians misjudge. The CI recipe documents the limit instead: fewer than three samples have no outlier margin.

## Test seams

| Seam | Default | Used by |
|---|---|---|
| `guardPair(…, { sample })` | `guardSample` (spawns the tree's CLI, wall time per target) | `measurePair`; tests pass a scripted sampler |

`cli/` does not import `tools/budget.mjs`; the tool's CLI (`main`) calls `measurePair`, which never passes `sample`.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | A test passes because the statistic holds, not because the machine was fast enough. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
tools/budget.mjs                       # FR-004 (guardPair seam)
tests/budget.test.mjs                  # FR-001, FR-002, FR-003
docs-canonical/CI-RECIPES.md           # FR-005 (Recipe 3e noise model)
docs-canonical/TEST-SPEC.md            # budget note
llms-full.txt                          # regenerated (npm run llms)
CHANGELOG.md
```
