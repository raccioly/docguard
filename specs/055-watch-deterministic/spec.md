# Feature Specification: Deterministic Watch Reliability Tests

**Feature Branch**: `spec/055-watch-deterministic`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.watch-deterministic`

**Lineage**: Corrects the watch reliability tests (`tests/watch-reliability.test.mjs`, added with watch hardening in v0.36 / #395), which drive `runWatch` (`cli/commands/watch.mjs`) with wall-clock sleeps. Reported in raccioly/docguard#523.

**Input**: raccioly/docguard#523.

## Problem

1. **The event tests are coupled to the real clock.** "coalesces repeated saves and queues only one check while a guard is active" sleeps 300, 300, 300, 600 and 20 ms around a 500 ms debounce, and two other tests sleep 600 ms and expect the debounce to have fired first. Their assertions hold only through an unstated contract: Node fires expired timers in deadline order, so a 500 ms timer set just before a 600 ms sleep always runs first. Nothing in the test states that dependency, and every run pays about 3.5 seconds of idle time for it. Full local suite runs on a loaded machine (load average 6+) failed this test intermittently, while it passed alone and in CI.
2. **The file writes to stdout.** Three of the four tests let the watcher print its banner and guard results through `console.log`. Under `node --test`, a test file's stdout is also the channel the runner reads its serialized messages from. The reported "Unable to deserialize cloned data" failure failed the whole file at once.
3. **The reported failures did not reproduce locally.** On Node 24.18 (18 cores) the original file passed 20/20 sequential runs, 20/20 runs as five rounds of four concurrent copies beside 40 busy-loop processes, 48/48 runs as three rounds of sixteen concurrent copies beside 36 busy-loop processes, and 10/10 runs with the event loop blocked for 700 ms every 250 ms. The root cause of #523 is therefore unconfirmed; this change removes both suspected inputs (wall-clock timing and stdout output) by construction rather than by widening margins.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The watch tests give the same answer on any machine (Priority: P1)

1. **Given** the watch reliability tests, **When** they run alone, repeatedly, or several copies at once on a CPU-saturated machine, **Then** every run passes, because no assertion waits on wall-clock time.
2. **Given** repeated saves inside the 500 ms debounce window while a guard run is active, **Then** exactly one follow-up check is queued, it runs as soon as the active guard finishes, and it reports every changed path.
3. **Given** a save that lands while a queued check's debounce window is still open, **When** the active guard finishes, **Then** the queued check waits for the window to close.

### User Story 2 - `docguard watch` behaves exactly as before (Priority: P1)

1. **Given** `docguard watch` without injected runtime hooks, **Then** it debounces with the real timers and the same 500 ms window.
2. **Given** a watcher error, **Then** the pending debounce timer is cleared and no further check runs.

## Requirements *(mandatory)*

- **FR-001**: The coalescing behaviour MUST be tested deterministically: a burst of saves inside the debounce window produces one check; changes during an active guard queue exactly one follow-up check, which runs when the guard finishes, lists every changed path, and waits for an open debounce window first.
- **FR-002**: No test in `tests/watch-reliability.test.mjs` MAY depend on wall-clock time: debounce timers run on a clock the test advances, check completion is observed by draining queued promise callbacks, and the watcher's console output is captured so the file writes nothing to stdout.
- **FR-003**: `docguard watch` behaviour MUST NOT change. The only product change is a test seam: `runWatch` accepts optional `setTimeout` / `clearTimeout` in its `runtime` argument (alongside the existing `watch`, `guard` and `clearCache`), defaulting to the global timer functions; the debounce stays 500 ms. No CLI flag or config key exposes the seam.
- **FR-004** (amendment, 2026-10-12): Each spawn-based `docguard watch` test in `tests/commands.test.mjs` MUST wait until its captured output already satisfies the assertions that follow: it waits on the same pattern as the last line it asserts, never on an earlier marker or a weaker condition. The watcher writes one `console.log` per line, so the test can read a line before the next one arrives. CI run 38300989325 (PR #570, Node 24) waited for the `Auto-fix prompts:` header, then asserted `docguard fix --doc` against output that ended at the header. No sleep is added.

## Success Criteria *(mandatory)*

- **SC-001**: The rewritten tests fail before the seam exists and pass after; the file passes 20 sequential runs and 20 runs made as five rounds of four concurrent copies on a CPU-saturated machine.
- **SC-002**: The full suite passes and guard on this repository reports no new findings.
- **SC-003** (amendment, 2026-10-12): Every wait in the `docguard watch` block of `tests/commands.test.mjs` uses the pattern of the last line its test asserts, and the file passes repeated runs locally with no sleep added.

## Out of Scope

- The spawn-based `docguard watch` tests in `tests/commands.test.mjs`, which exercise real `fs.watch` events and real timers end to end with generous deadlines, except what they wait for (FR-004).
- The Node test runner's own stdout framing; this change only keeps this file from writing to stdout.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `cdf35252487a397598f75026daa96b4a8d946e70` — Reviewed at cdf3525 on main: all 5 tasks are checked and were delivered by #528; the full suite (3279 tests) passes at this revision and on Node 18, 20, 22 and 24 in CI, and guard reports 0 errors. Evidence: `cli/commands/watch.mjs`, `docs-canonical/TEST-SPEC.md`, `tests/watch-reliability.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
