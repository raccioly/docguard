# Feature Specification: Deterministic Budget Timing Tests

**Feature Branch**: `spec/062-budget-deterministic`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.budget-deterministic`

**Lineage**: Corrects the timing tests of `docguard.non-regression-budgets` (spec 031, `tests/budget.test.mjs`), which compare stub trees through `measurePair` (`tools/budget.mjs`) on real wall-clock time. Follows the pattern of `docguard.watch-deterministic` (spec 055).

**Input**: "`tests/budget.test.mjs` case 'ten base-vs-base comparisons never fail' failed once in a full-suite run under CPU load, and passes alone 14/14."

## Problem

1. **The flaky test measured one sample per tree.** "ten base-vs-base comparisons never fail" ran `measurePair(tree, tree, { samples: 1 })` ten times on a stub whose guard busy-waits 60 ms. With one sample there is no median, so a single head process that the scheduler delays by more than the 150 ms floor fails the run. The stub's run time (60 ms plus Node start-up, about 110 ms) is too short for the ×1.15 ratio to matter: the floor is the only margin, and process start-up on a saturated machine can exceed it. Ten runs gave ten chances. Measured on Node 24.18 (18 cores, load average about 90): 240 one-sample comparisons of that stub against itself differed by up to 100 ms, two thirds of the floor, so a rarer delay crosses it. The original file passed 20/20 sequential runs and 20/20 runs as five rounds of four concurrent copies beside 18 busy-loop processes; the reported failure is that tail, not a reproducible defect.
2. **The other timing tests assert verdicts on real time too.** "an injected 3× slowdown fails" compares three real samples per tree (100 ms against 400 ms stubs); if load delays two of the three base samples by more than about 150 ms, the base median and the limit rise past the head and the test fails. The interleaving test is deterministic but spends about a second spawning processes to observe an order that the sampling loop alone decides.
3. **The tool's method is not the cause.** The CI job compares five interleaved samples per tree by their medians. That statistic ignores up to two slowed samples of either tree, and interleaving holds a steady load drift to one sample slot. The test bypassed both by passing `samples: 1`. Four base-vs-base comparisons of this repository with the tool's own sampling (three guard targets, five samples, one at ambient load and three beside 18 busy-loop processes) all passed, the largest median ratio being ×1.054 against the ×1.15 budget. In one of them, load bursts slowed individual guard runs by up to 90%: the first round alone would have failed all three targets (×1.34, +290 ms, +341 ms), while the medians stayed between ×0.94 and ×1.04 of the base.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The budget tests give the same answer on any machine (Priority: P1)

1. **Given** the budget tests, **When** they run alone, repeatedly, or several copies at once on a CPU-saturated machine, **Then** every run passes, because no verdict depends on how fast the machine is.
2. **Given** a base-vs-base comparison where two of five head samples are hit by a load burst of any size and the rest differ by less than the floor, **Then** the guard-time verdict is PASS.
3. **Given** the same noise and a head 30% slower, **Then** the verdict is FAIL.
4. **Given** one sample per tree and one burst on the head, **Then** the verdict is FAIL. The test records why a single sample is not a measurement.

### User Story 2 - The budget job behaves exactly as before (Priority: P1)

1. **Given** `node tools/budget.mjs ab`, `measure` or `compare`, **Then** the reports and verdicts are computed as before: the same interleaving order, medians, ratios and floors.
2. **Given** a reader of the CI recipe, **Then** it states which noise the guard-time verdict absorbs and which it does not.

## Requirements *(mandatory)*

- **FR-001**: The base-vs-base and slowdown verdicts MUST be tested on a scripted timing source: ten seeded comparisons whose samples carry jitter under the floor and a load burst on two of five head samples MUST pass; the same ten with a 30% head slowdown MUST fail; one sample per tree with one burst MUST fail.
- **FR-002**: The interleaving MUST be tested on the scripted timing source: the tree that runs first alternates between samples, and under a steady drift of 100 ms per sample the two medians are exactly one slot (100 ms) apart.
- **FR-003**: The one test in `tests/budget.test.mjs` that spawns real processes MUST assert only what load cannot break: each tree's guard median is at least its stub's busy-wait, its static measures are read, and the guard-time row has a PASS or FAIL verdict.
- **FR-004**: `tools/budget.mjs` behaviour MUST NOT change. The only product change is a test seam: `guardPair(base, head, targets, { samples, sample })` holds the interleaved sampling loop that `measurePair` used inline, with `sample` defaulting to `guardSample`. `measurePair` calls it without a `sample`. No CLI flag exposes the seam.
- **FR-005**: `docs-canonical/CI-RECIPES.md` (Recipe 3e) MUST state the noise model: medians of N interleaved samples per tree ignore up to (N − 1) / 2 slowed samples of either tree, a steady drift moves the medians one sample apart, and fewer than three samples (`--samples`) have no outlier margin.

## Success Criteria *(mandatory)*

- **SC-001**: The rewritten tests fail before the seam exists and pass after. The file passes 20 sequential runs and 20 runs made as five rounds of four concurrent copies on a CPU-saturated machine.
- **SC-002**: The full suite passes and guard on this repository reports no new findings.

## Out of Scope

- Changing the budget statistic (for example paired per-round ratios, more samples, or a sample-count minimum). The base-vs-base measurement in `tasks.md` gives no evidence that five interleaved samples misjudge a real change; see `plan.md`.
- The CI `budget` job's runner and schedule.
