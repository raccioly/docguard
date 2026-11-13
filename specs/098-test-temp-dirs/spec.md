# Feature Specification: Test Temporary Directories

**Feature Branch**: `fix/662-test-temp-dirs`

**Created**: 2026-11-13

**Status**: Draft

**Spec ID**: `docguard.test-temp-dirs`

**Lineage**: Fixes issue 662. Follows the shape of `docguard.test-git-hermeticity` (spec 066): one shared helper under `tests/helpers/`, a scan that keeps new code on it, and a CI job that proves it. The sibling project fixed the same defect first (testguard issue 311).

**Input**: "Tests, benchmarks and tools create fixtures with `mkdtempSync(join(tmpdir(), 'dg-…'))` and many never remove them, or lose them when a test fails or is interrupted. One machine accumulated 626 such directories (84 MB) in a day."

## Problem

1. **Cleanup is each file's own job, and many files skip it.** 446 direct `mkdtempSync(join(tmpdir(), …))` calls in 286 files under `tests/`, `benchmarks/` and `tools/`. Some collect paths in an array and remove them in an `after` hook; most do not remove them at all.
2. **A hook does not survive a failure.** A test that throws before its `rmSync`, a process that is killed, and a run that is interrupted with Ctrl-C leave the directory behind.
3. **Nothing keeps it fixed.** A new test can call `mkdtempSync` and leak again, and nothing measures a clean run.

Measured on `main` at v0.48.0 (macOS, Node 24, 4,958 tests, all passing): one full `npm test` run with `TMPDIR` at a fresh, empty folder left 13 entries (7 named `dg-*` or `docguard-*`, 6 named `mcp-registry-*`; 2.6 MB), and entries in the same folder came from files that already removed most of their directories. The real temporary folder of the machine that ran it held 2,052 `dg-*` and `docguard-*` entries from earlier runs, which this change does not remove.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A suite run leaves nothing behind (Priority: P1)

1. **Given** an empty temporary folder, **When** the whole suite runs to the end, **Then** the folder is empty afterward (Node's own `node-compile-cache` aside).
2. **Given** a test that fails, **Then** its directory is removed anyway.
3. **Given** a run interrupted with Ctrl-C or killed with SIGTERM, **Then** every directory created so far is removed.

### User Story 2 - A benchmark or tool cleans up after itself (Priority: P1)

1. **Given** a benchmark or tool run, **When** it finishes, fails or is interrupted, **Then** the directories it created are removed, unless the caller asked to keep them (`--keep`).

### User Story 3 - A new test cannot reintroduce the leak (Priority: P1)

1. **Given** a file under `tests/`, `benchmarks/` or `tools/` that calls `mkdtemp` or `mkdtempSync` outside the helper, **Then** the suite fails and names the file and line.

### User Story 4 - The helper cannot delete the wrong thing (Priority: P1)

1. **Given** a path the helper did not create, a path outside the OS temporary directory, or a symlink inside a fixture, **Then** removal leaves it alone.

## Requirements *(mandatory)*

- **FR-001**: Every temporary directory a test, benchmark or tool creates MUST come from `makeTempDir` in `tests/helpers/temp-dir.mjs`, and MUST be removed when it finishes, fails or is interrupted. Given a test context, its `after` removes the directory when that test ends. Under the Node test runner, one file-level `after` removes whatever is left when the file's tests end, so a directory kept for a later test in the same file lives until then.
- **FR-002**: One process `exit` handler MUST remove, synchronously, every directory still registered. SIGINT and SIGTERM MUST exit through it (status 130 and 143), unless the process already handles that signal itself. Removal MUST never throw into a test. The helper MUST NOT import the test runner statically, so `benchmarks/` and `tools/` use it as plain code and call `removeTempDir` in a `finally`.
- **FR-003**: The helper MUST remove only a path it created and whose real path is inside the real path of `os.tmpdir()`. It MUST NOT follow a symlink out of the directory it removes.
- **FR-004**: The suite MUST fail when any file under `tests/`, `benchmarks/` or `tools/`, other than the helper, calls `mkdtemp` or `mkdtempSync`. The failure names the file and line.
- **FR-005**: `tools/check-temp-leaks.mjs` (`npm run test:temp-leaks`) MUST run the suite with `TMPDIR` pointed at a fresh empty folder and fail if anything is left there afterward. CI MUST check the folder its single suite run used as `TMPDIR` (`--check <dir>`), in the `hermeticity` job, so suite time does not double.
- **FR-006**: A caller that retains its output on request (`benchmarks/lib/runner.mjs` with `keep`) MUST be able to ask for a directory the helper does not register for removal.

## Success Criteria *(mandatory)*

- **SC-001**: A full suite run leaves 0 entries in a fresh temporary folder (13 before this change).
- **SC-002**: `npm test` and `node cli/docguard.mjs guard` pass; the suite's wall time does not regress noticeably.
- **SC-003**: Each requirement has a test: the helper removes on test end, on throw, on `process.exit`, on SIGINT and SIGTERM; it refuses a stranger, a path outside the temporary directory and a symlink target; the scan sees a violation; the leak check fails on a left-behind directory and passes a clean run.

## Out of Scope

- Product code under `cli/` that creates temporary directories (`cli/commands/demo.mjs`, `cli/commands/sensor.mjs`, `cli/commands/feedback.mjs`). Whether each removes its directory is product behavior, not test hygiene; any leak found there is reported in the pull request, not fixed here.
- Directories already left in a machine's temporary folder by earlier runs. They are not cleaned.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `864eacbc38b44abb9761497df349b4eab0ceebc8` — Reviewed at main after #677: npm test passes twice (exit 0, 363 s and 381 s); the leak check finds 0 entries left in a fresh TMPDIR (13 before); guard has no errors. The 118 converted files carry a reconciliation-only @implements reference; the baseline is the revision that tags them, since a range with docs-coverage.test.mjs (raw NUL byte before) reads as binary. Wall time not re-measured before the change. Evidence: `benchmarks/history-replay/run.mjs`, `docs-canonical/TEST-SPEC.md`, `tests/test-temp-dirs.test.mjs`, `tools/check-temp-leaks.mjs`. Accepted deviations: none. Successor: none.
- `864eacbc38b44abb9761497df349b4eab0ceebc8` — Reviewed at main after #677: npm test passes without any git override (exit 0, 5,006 tests, 323 s); the leak check finds 0 entries left in a fresh TMPDIR (13 before); guard has no errors. FIXTURE_GIT now turns background git maintenance off (spec 066 task T008), which removed an intermittent maintenance.lock failure in the spec 097 snapshot tests. Wall time was not measured before the change. Evidence: `docs-canonical/TEST-SPEC.md`, `tests/test-temp-dirs.test.mjs`, `tools/check-temp-leaks.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
