# Feature Specification: A Release Cut That Passes Its Own Suite

**Feature Branch**: `fix/changelog-tests-release-cut`

**Created**: 2026-10-01

**Status**: Draft

**Spec ID**: `docguard.release-cut-green`

**Lineage**: Corrects `docguard.release-readiness`, which owns the scheduled cut and `sync-release-version.mjs`. Found when the v0.43.0 cut (run 36819182434) failed its "Verify the tree is still green" step with 11 failures, so nothing was tagged or published. Related: `docguard.spec-kit-integration-honesty` (048), which gave `ensureSkills` a required `surface` argument.

**Input**: "Merge everything and cut the release; verify everything we claim."

## Problem

The cut moves `[Unreleased]` under the new version, synchronizes release surfaces, and then runs the full suite. Two kinds of failure stop it:

1. **Tests read only `[Unreleased]`.** Nine tests check that the CHANGELOG describes their change by reading the `[Unreleased]` section. After the cut that section is empty, so they fail on the exact commit being released, and they would fail again on every later cut.
2. **The `.agent/` mirrors are not refreshed, and the release commit leaves files out.** The workflow refreshes the checked-in `.agent/skills` copies by calling `ensureSkills(root, flags)`. Since spec 048 that function needs a third `surface` argument. The call throws, the JSON-mode caller swallows the error, and the copies keep the old version marker. The parity test then fails. `.agent/commands` mirrors `commands/` and is never refreshed, so its `docguard-cli@` pins go stale without any test noticing. The release commit's `git add` also omits `commands/`, whose pins the synchronization rewrites. The release PR's own CI would then fail the pin test.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The release commit passes the suite (Priority: P1)

1. **Given** main with populated `[Unreleased]` notes, **When** the cut's bump, CHANGELOG and synchronization steps run, **Then** the full suite passes on the resulting tree.
2. **Given** a later release that moves this release's notes below a newer version, **Then** the same tests still pass.

### User Story 2 - Mirrors move with their sources (Priority: P1)

1. **Given** the release synchronization, **Then** every `.agent/skills/<name>/SKILL.md` equals the synchronized extension skill and every `.agent/commands/<file>` equals the synchronized `commands/<file>`.
2. **Given** a source with no mirror yet, **Then** the mirror is created. **Given** a repository with no `.agent/` directory, **Then** nothing is mirrored and nothing fails.

## Requirements *(mandatory)*

- **FR-001**: A test that checks the CHANGELOG describes a change MUST read the notes added since the last release before that change (from `## [Unreleased]` down to that version's heading), not the `[Unreleased]` section alone.
- **FR-002**: The release-readiness check that "this repository's notes cut a minor release" MUST hold both before and after the cut.
- **FR-003**: `sync-release-version.mjs` MUST write the `.agent/skills` and `.agent/commands` mirrors from the synchronized sources in the same fail-closed transaction. If `.agent/` is absent, it MUST skip the mirrors.
- **FR-004**: The release workflow MUST NOT call `ensureSkills` to refresh repository mirrors.
- **FR-005**: `ensureSkills` MUST reject a missing `surface` argument with an error, instead of swallowing the resulting failure.
- **FR-006**: The release commit MUST stage, and the release-candidate policy MUST admit, every path the synchronization rewrites. That includes `commands/docguard.*.md` (pinned since spec 048 but never staged) and both `.agent/` mirrors.
- **FR-007**: The CI test runtime budget MUST stay above normal runs, with room for runner noise, and MUST still trip on a PR #328-class regression (+165s). This PR's Node 18 run failed at 241.5s against 240s with every test passing; normal runs are now 211–241s. The budget becomes 360s, and the measurements are recorded beside it.
  *Maintenance (2026-10-12):* the 0.45.0 batch (specs 070–078) put normal runs at 193–369s (median 305s over 25 runs); #574 failed on Node 18 at 368.7s with every test passing. The budget becomes 465s: 1.26× the slowest normal run, and the PR #328 class on a typical run (470s) still trips it. With noise this wide, the margin over the slowest run drops from 1.4× to 1.25× so the regression check can hold.
  *Revision (2026-10-13):* the budget applies to each top-level test, not to the suite total. A total cannot keep both properties as the suite grows (see *Runtime budget measurements*):
  - Runner speed is the noise. Dividing a run by one speed factor leaves 0.5% variation.
  - The total hides the PR #328 class. Test files run about 2.8 at a time, so a test that gains 165s adds about 59s to the wall clock.
  - The total grows with every test added.

  The rule:
  - **Speed factor.** Each run's speed factor is the median ratio of its top-level test durations to the same tests in a committed reference (`tools/suite-runtime-reference.json`). The reference is in the units of the median runner among its inputs: every leg of 10 runs, with speed factors 0.60–1.17.
  - **Ceiling.** No top-level test may exceed `TEST_CEILING_MS` (100s) after dividing by the speed factor.
  - **Fail closed.** The step fails when the TAP total is missing, when no top-level durations are found, or when fewer than 100 tests are shared with the reference.
  - **Headroom.** The ceiling stays at least 1.5× the slowest normalized test of the reference's recorded runs.
  - **Trip.** The ceiling stays at most 165s divided by the slowest recorded speed factor, so a 165s runaway trips even when it does not scale with runner speed.
  - **Report only.** The suite total, raw and at reference speed, goes to the log and the job summary but is not gated.
  - **Refresh.** The reference is refreshed only when fewer than 100 tests remain shared with it. Its durations feed only the speed factor, so a stale reference stays accurate.

- **FR-008** (amendment, 2026-10-10): A test MUST fail on every pull request, not only on the release commit, when it reads the repository CHANGELOG through `[Unreleased]` alone. The first v0.44.0 cut failed on two such tests added after this spec.

## Success Criteria *(mandatory)*

- **SC-001**: Replaying the cut locally (version bump, `release-changelog.mjs cut`, `sync-release-version.mjs`) on a scratch copy of main gives a full suite with 0 failures. `validate-release-candidate.mjs` accepts the resulting diff.
- **SC-002**: The full suite passes on main, and guard on this repository is unchanged.

- **SC-003** (FR-007 revision): the rule passes every normal CI run recorded in *Runtime budget measurements*. It fails each of those runs once a synthetic 165s runaway is added to one test, whether the runaway scales with runner speed or not.

## Runtime budget measurements

Collected 2026-10-13 from the `test` jobs of the last 120 CI runs (445 jobs, 2026-10-10 to 10-13, 2,997–3,915 tests, every leg passing its tests). Two jobs, #571 and #574 on Node 18, failed only the 360s budget then in force. The figures are the TAP `# duration_ms`, in seconds.

| Node | Jobs | Min | Median | Max | Latest code (≥ 3,902 tests): min / median / max |
|---|---:|---:|---:|---:|---|
| 18 | 110 | 149.9 | 264.9 | 370.4 | 231.3 / 345.5 / 368.7 |
| 20 | 111 | 146.2 | 248.5 | 350.7 | 260.6 / 340.7 / 350.7 |
| 22 | 112 | 137.4 | 235.4 | 324.4 | 212.9 / 321.4 / 324.4 |
| 24 | 112 | 136.9 | 229.4 | 319.1 | 187.7 / 309.8 / 319.1 |

**The spread is the runner.**
- **One speed factor explains it.** The four Node versions overlap almost entirely, and identical code spans 188–369s within a single run's matrix. Speed factors range from 0.55 to 1.20 (2.2×).
- **Dividing it out leaves almost nothing.** For the 40 latest-code jobs, the wall time varies by 14.9% (coefficient of variation). Divided by each job's speed factor it varies by 0.5% (312–319s at reference speed), and so does the sum of top-level test durations.
- **That sum is a constant multiple of the wall time.** It is 2.79–2.80× the wall time in every job, so files effectively run about 2.8 at a time.

**Backtest** of the 100s ceiling, using a reference built from the 40 latest-code jobs and applied to all 445:
- **Normal runs.** All 445 pass. The slowest normalized test is 56.9s ("benchmark runner"), so the ceiling is 1.76× above it. At least 359 tests are shared with the reference in every job, including runs made three days and 900 tests before it.
- **A single 165s runaway.** It is caught in 445 of 445 jobs, whether it scales with the runner or is a raw 165s.
- **The 465s total misses that runaway in all 445 jobs.** Modelled as a wall-time increase of 165 × speed factor ÷ 2.8, the extra time keeps every job under 465s.
- **The wall-time model holds on a real run.** On a macOS laptop (Node 24, `--test-concurrency=3`), a synthetic test that busy-waits 60s raised the suite from 320.8s to 349.6s. Wall time rose by 29s, not 60s, and the sum of top-level test durations stayed 2.7× the wall time.
  - The same runs show the speed factor is a CI measure. On macOS, process and filesystem costs do not scale like a CI runner: the slowest real test reached 70–87s at reference speed, against at most 56.9s in CI.
  - Local runs are not gated.
- **A spread slowdown is caught by neither rule.** Neither the ceiling nor the 465s total catches 165s spread over 100 tests (0 of 445 each). See *Out of Scope*.

Rejected alternatives:
- **Per-Node-version budgets.** Every version spans the same runner range, so the spread is not per version.
- **A ratio against the base commit's suite on the same runner.** It doubles the suite's CI time and does not exist for pushes to main. The committed reference measures runner speed just as well, at no cost.
- **A fixed reference workload.** It cannot be backtested against recorded runs, and it might not scale with the suite's mix of CPU, process and filesystem work. The suite's own tests can be backtested and do scale with it.
- **A normalized total, or a per-test excess over the reference.** Both are nearly noise-free, but they move with legitimate change. The excess over tests shared with a 3-day-old reference drifted by up to 90s, so the reference would need refreshing about weekly.

## Out of Scope

- Changing what the CHANGELOG says, or the cut's ordering of steps.
- A slowdown spread thinly across many tests. No rule computed from one run can tell it apart from legitimate growth. The spec 031 base-vs-head budget job still covers slower guard runs.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `f130626775eb829f12f5ed8795b0f091af29bbc5` — Reviewed at f130626 on main: all 9 tasks are checked and were delivered by #510; the full suite (2920 tests) passes on Node 18, 20, 22 and 24 in CI, a local replay of the v0.43.0 cut passes the suite, guard and the candidate validation, and guard reports 0 errors at this revision. Evidence: `.github/scripts/sync-release-version.mjs`, `cli/release-pr-policy.mjs`, `docs-canonical/CI-RECIPES.md`, `tests/release-cut-green.test.mjs`, `tests/release-version-sync.test.mjs`. Accepted deviations: none. Successor: none.
- `3790177e60ccd360e94e2193579a8209efe146ea` — Maintenance review at 3790177: release-cut guarantees extended, none weakened. #543 lints out [Unreleased]-only CHANGELOG reads; #522 widened the version sync; #536 made budget timing deterministic; #546 made its fixture git hermetic; #549 moved CI-RECIPES to the least-privilege layout. v0.44.1 and v0.44.2 cut green end to end; typeof-only tests replaced by behaviour tests (#556). Deviations: none. Evidence: `.github/scripts/sync-release-version.mjs`, `cli/release-pr-policy.mjs`, `docs-canonical/CI-RECIPES.md`, `tests/release-cut-green.test.mjs`, `tests/release-version-sync.test.mjs`. Accepted deviations: none. Successor: none.
- `4f46e9f6571abbd257c8c781b87cf6aaec9e3b52` — Maintenance reviewed at 4f46e9f: FR-007 recalibration (#574). Normal suite runs 193-369s over 25 CI runs (median 305s) after specs 070-078; the budget becomes 465s, 1.26x the slowest normal run, and the PR #328 class on a typical run (470s) still trips it. tests/release-cut-green.test.mjs records the measurements. Evidence: `.github/scripts/sync-release-version.mjs`, `cli/release-pr-policy.mjs`, `docs-canonical/CI-RECIPES.md`, `tests/release-cut-green.test.mjs`, `tests/release-version-sync.test.mjs`. Accepted deviations: none. Successor: none.
- `014f7a2228d4364eb5a2cb07a8c3a4e45823312f` — Maintenance reviewed at 014f7a2: FR-007 revised by #579. The CI runtime budget is a per-test ceiling at reference-runner speed (TEST_CEILING_MS 100000, tools/suite-runtime-budget.mjs); the suite total is reported, not gated. Backtest over 445 jobs: every normal run passes (slowest test 56.9s), every replayed +165s runaway is caught. TestGuard CI-RUNTIME-BUDGET-PER-TEST 7/7. Evidence: `.github/scripts/sync-release-version.mjs`, `cli/release-pr-policy.mjs`, `docs-canonical/CI-RECIPES.md`, `tests/ci-reproducibility.test.mjs`, `tests/release-cut-green.test.mjs`, `tests/release-version-sync.test.mjs`, `tests/suite-runtime-budget.test.mjs`, `tools/suite-runtime-budget.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
