# Implementation Plan: Deterministic Watch Reliability Tests

**Branch**: `spec/055-watch-deterministic` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | `tests/watch-reliability.test.mjs` drives the debounce with a fake clock (`advance(ms)` fires due timers in order) and asserts the coalescing and queued-check behaviour at exact window edges (499 ms vs 500 ms). A new case covers a save that lands while the queued check's window is open. |
| FR-002 | The same file replaces every `delay()` with the fake clock plus `flush()` (one `setImmediate`, which runs only after all queued promise callbacks). `console.log` / `console.error` are captured in `beforeEach` for every test. |
| FR-003 | `cli/commands/watch.mjs` reads `runtime.setTimeout` / `runtime.clearTimeout`, defaulting to the globals. A test mocks the global timers (no fake runtime) to prove the default path schedules through them with a 500 ms delay. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/watch-reliability.test.mjs` (rewritten). The real-timer, real-`fs.watch` path stays covered by the spawn tests in `tests/commands.test.mjs`.

## Research decisions

- **Inject the timer functions through `runtime`.** `runWatch` already takes `watch`, `guard` and `clearCache` through its fourth argument for exactly this purpose; two more optional keys follow that pattern and leave the CLI path untouched.
- **Rejected: `t.mock.timers` (node:test MockTimers).** Its availability and API vary across the Node 18–24 range CI runs, and it replaces the global timers for the whole test. An explicit seam is narrower and identical on every supported version.
- **Rejected: a watcher event (`onCheckStart` / `onCheckDone`).** Check completion is already observable without one: the stubbed guard resolves when the test says so, and everything after it in `check()` is promise continuations, which `flush()` drains. An event would add product surface only tests use.
- **Rejected: longer sleeps or retries.** Wider margins make a race rarer, not impossible, and make the file slower.
- **Capture console output in every test.** Under `node --test`, a test file's stdout carries the runner's serialized messages; the watcher's banner and results have no reason to share it. Capturing also lets the coalescing test assert the paths the queued check reports.

## Test seams

| Seam | Default | Used by |
|---|---|---|
| `runtime.setTimeout(fn, ms)` | global `setTimeout` | debounce scheduling in `changed()` |
| `runtime.clearTimeout(handle)` | global `clearTimeout` | debounce restart in `changed()`, teardown in `stop()` |

Both are read once when `runWatch` starts. `cli/docguard.mjs`, the only caller, calls `runWatch(projectDir, config, flags)` without a runtime, so the CLI always uses the globals.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | A test passes because the behaviour holds, not because the machine was fast enough. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/commands/watch.mjs                 # FR-003 (timer seam)
tests/watch-reliability.test.mjs       # FR-001, FR-002, FR-003
docs-canonical/TEST-SPEC.md            # watch row and note
llms-full.txt                          # regenerated (npm run llms)
CHANGELOG.md
```
