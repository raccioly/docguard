# Tasks: Deterministic Watch Reliability Tests

**Status**: Complete. SC-001: four of the six rewritten tests failed before the seam (the default-timer characterization passed before and after, as intended); the file passed 20/20 sequential and 20/20 concurrent-under-load runs before and after, and 48/48 sixteen-wide; SC-002: `npm test` ran 2959 tests, 2958 passing; the one failure was `llms-full.txt` drift from the TEST-SPEC edit, fixed by `npm run llms` and re-run green (12/12 with the watch file). Guard: no findings beyond the expected DLC002 for this spec.
**Spec**: `specs/055-watch-deterministic/spec.md`
**Plan**: `specs/055-watch-deterministic/plan.md`

## Phase 1: Tests first

- [x] T001 Measure the current file: 20 sequential runs, five rounds of four concurrent runs under CPU load.
- [x] T002 `tests/watch-reliability.test.mjs`: fake clock and `flush()`, console capture in `beforeEach`, no `delay()`; coalescing at exact window edges and queued-check paths (FR-001), open-window wait (FR-001), default global timers with 500 ms (FR-003). Confirm they fail without the seam.

## Phase 2: Implementation

- [x] T003 FR-003: `cli/commands/watch.mjs` reads `runtime.setTimeout` / `runtime.clearTimeout`, defaulting to the globals.

## Phase 3: Verification

- [x] T004 Repeat the T001 measurement on the new file (SC-001).
- [x] T005 `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`; `docguard specs --write`; `docguard guard`; `npm test` (SC-002).

## Phase 4: Amendment (2026-10-12)

- [x] T006 FR-004, SC-003: both waits in the `docguard watch` block of `tests/commands.test.mjs` use the last asserted pattern (`docguard fix --doc`, `/Changed: .*index\.js/`); the block passes 10 sequential and 3×4 concurrent runs; `CHANGELOG.md`; `npm run llms`; `docguard specs --write`; `docguard guard`; `npm test`. Found by the session fixing the race (CI run 38300989325) and folded into the 0.45.0 combined PR.
