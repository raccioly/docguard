# Tasks: Test Temporary Directories

**Spec**: `specs/098-test-temp-dirs/spec.md`
**Plan**: `specs/098-test-temp-dirs/plan.md`

## Phase 1: Measure and test first

- [x] T001 Run the suite on `main` with `TMPDIR` at an empty folder and record what is left (SC-001, before).
- [x] T002 `tests/test-temp-dirs.test.mjs`: removal on test end, throw, `process.exit`, SIGINT, SIGTERM; refusal of a stranger, an outside path and a symlink target; the scan and its control; the leak check (FR-001 to FR-005).

## Phase 2: Implementation

- [x] T003 FR-001 to FR-003, FR-006: `tests/helpers/temp-dir.mjs`.
- [x] T004 FR-001: replace every direct `mkdtempSync(join(tmpdir(), …))` in `tests/`, `benchmarks/` and `tools/`.
- [x] T005 FR-005: `tools/check-temp-leaks.mjs`, `npm run test:temp-leaks`, the `hermeticity` job.

## Phase 3: Verification

- [ ] T006 `npm test` twice; `node cli/docguard.mjs guard`; the leak check (SC-001, after); suite wall time before and after (SC-002).
