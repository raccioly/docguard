# Implementation Plan: Test Temporary Directories

**Spec**: [spec.md](spec.md) (`docguard.test-temp-dirs`)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002, FR-003, FR-006 | New `tests/helpers/temp-dir.mjs`: `makeTempDir(prefix, t, { parent, keep })`, `removeTempDir`, `removeAllTempDirs`. A registry maps each created path to its real path. One `exit` handler, SIGINT and SIGTERM handlers installed on first use, and a file-level `after` registered at module load when `NODE_TEST_CONTEXT` says the Node test runner started the process. 446 direct `mkdtempSync(join(tmpdir(), …))` calls in 286 files become `makeTempDir(prefix)`. |
| FR-004 | `tests/test-temp-dirs.test.mjs` scans `tests/`, `benchmarks/` and `tools/` line by line. |
| FR-005 | `tools/check-temp-leaks.mjs`, the `test:temp-leaks` npm script, and the `hermeticity` job: it sets `TMPDIR` to an empty folder, runs `npm test` once, then runs `--check`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; `tests/test-temp-dirs.test.mjs`, plus the leak check over the full suite.

## Research decisions

- **File-level `after`, not per-test, as the default.** A mechanical replacement cannot know whether a directory is kept for a child process or a later test in the same file; some are. Per-test removal is opt-in by passing `t`. The cost is that a file's directories live until the file ends, which is what the files that removed them in their own `after` already did.
- **`NODE_TEST_CONTEXT`, not a static `node:test` import.** Importing the runner from a benchmark would start a test harness. The variable is set in every process the runner starts, and a module loaded from a test file's top level registers its `after` on that file's root. A process started directly (`node tests/x.test.mjs`) falls back to the `exit` handler.
- **Real-path comparison.** macOS reports `/var/folders/…` for `tmpdir()` and `/private/var/folders/…` for the real path; comparing raw strings would refuse every removal there.
- **The leak check inspects the one suite run; it does not rerun it.** The hermeticity job already runs `npm test` once under a hostile git config; pointing its `TMPDIR` at an empty folder and checking that folder afterward adds the measurement at no cost, and leaves the job's `npm test` step as `tests/test-git-hermeticity.test.mjs` expects it.
- **Rejected: a `beforeEach`/`afterEach` rewrite of each file.** It changes test structure, which this task must not.
