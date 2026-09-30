# Feature Specification: Non-Regression Budgets

**Feature Branch**: `feat/non-regression-budgets`

**Created**: 2026-09-29

**Status**: Draft

**Spec ID**: `docguard.non-regression-budgets`

**Lineage**: #455 follow-up. The maintainer's direction: "as we implement all
the new features, the project improves efficiency and quality instead of
regressing". Builds on `docguard.precision-evidence-loop` (the precision
benchmark gate) and the CI test-duration budget.

**Input**: User description: "Make sure every new feature improves efficiency
and quality instead of regressing."

## Problem

The next specs add a validator, a command and several MCP tools. Today CI
catches two kinds of regression:

- the test suite taking longer than 240 s;
- detector precision falling against the reviewed benchmark baseline.

Nothing catches the regressions that cost users most:

- **Guard wall time.** It runs in pre-commit hooks and on every CI build.
  `guard --timings` exists, but nothing compares it between builds.
- **Noise on real projects.** A change that adds findings on DocGuard's own
  tree is shipped without anyone deciding it was intended.
- **What agents are made to read.** `memory --pack`, `agent --task`, the MCP
  tool responses and `llms.txt` are token costs paid on every agent turn.
  Nothing bounds their growth.
- **Install weight.** Package size, file count and runtime dependencies drift
  without review.

Absolute thresholds would fail on a slower runner and pass a real regression
on a fast one. The comparison has to be **base vs head on the same machine in
the same job**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A slower guard is caught before merge (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a PR whose head makes guard 30% slower on this repository,
   **When** CI runs the budget job, **Then** the job fails, naming the metric,
   base median, head median and the allowed ratio.
2. **Given** a PR with no performance change, **Then** repeated runs pass. The
   noise band must not produce flaky failures.

### User Story 2 - New noise on a real tree is a decision, not an accident (Priority: P1)

1. **Given** a head that adds an error-severity finding on this repository's
   own tree, **Then** the job fails.
2. **Given** a head that adds or removes warning or escalation findings,
   **Then** the job summary lists them by code, and the job passes.

### User Story 3 - Agent-facing output stays lean (Priority: P2)

1. **Given** a head that grows `memory --pack`, `agent --task` output, an MCP
   tool response or `llms.txt` by more than its budget, **Then** the job fails
   unless the PR declares `Budget-Exempt: <metric> — <reason>`.

### User Story 4 - Install weight and dependencies are reviewed (Priority: P2)

1. **Given** a new runtime dependency, **Then** the job fails. The constitution
   requires a reviewed justification, recorded as an exemption.
2. **Given** packed size or file count growing past budget, **Then** the job
   fails unless exempted.

### User Story 5 - Same numbers locally (Priority: P3)

`npm run budget -- --base origin/main` prints the same comparison table the CI
job produces.

### Edge Cases

- The base ref does not build or run: the check reports `inconclusive` and does
  not pass silently.
- Timing noise on a shared runner. Interleave base and head runs, take medians
  of 5, and compare with a ratio plus an absolute floor. A difference below
  the floor is never a regression.
- A metric the base cannot measure (for example, an MCP tool the head adds) is
  reported as new, not as growth.
- The exemption must name the metric, and the reason is required, as with
  `Spec-Exempt`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `tools/budget.mjs measure` MUST emit a JSON metrics report for a
  checked-out tree:
  - guard wall time (median of N runs) on this repository and on the benchmark
    corpus fixtures;
  - self-guard finding counts by code and severity;
  - bytes of `memory --pack`, `agent --task` for fixed task strings, each MCP
    tool's response for fixed inputs, and `llms.txt`;
  - `npm pack --dry-run` size and file count;
  - runtime dependency names.
- **FR-002**: `tools/budget.mjs compare` MUST compare base and head reports
  against budgets in `budgets.json`:
  - guard time: at most ×1.15, with a 150 ms floor;
  - no new error-severity self-findings;
  - agent-facing bytes: at most +10% each;
  - packed size: at most +10%;
  - no new runtime dependency.

  It MUST exit 1 on a breach, 2 when inconclusive, and 0 otherwise.
- **FR-003**: A `Budget-Exempt: <metric> — <reason>` line in the PR body MUST
  waive exactly that metric. The job MUST still print the numbers.
- **FR-004**: CI MUST run base and head in the same job, interleaved, and write
  a job summary table: metric, base, head, delta, budget, verdict.
- **FR-005**: The precision benchmark gate MUST stay a required check. This
  spec adds to it and does not replace it.
- **FR-006**: `npm run budget` MUST reproduce the comparison locally.
- **FR-007**: `AGENTS.md` MUST state the budget rule next to the spec-first rule.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An injected 30% slowdown (a synthetic busy-wait in a validator,
  used only in the test) fails `compare`. Ten repeated base-vs-base runs never
  fail.
- **SC-002**: The budget job adds no more than 3 minutes to CI.
- **SC-003**: Every spec merged after this one records its budget table in its PR.

## Assumptions

- Budgets start from the current tree, and a merged exemption moves the
  baseline forward. That is the ratchet: each accepted cost is a recorded
  decision.
- Comparing within one job removes runner-speed variance. The 150 ms floor
  absorbs process-start noise.
