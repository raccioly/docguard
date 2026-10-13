# Tasks: A Release Cut That Passes Its Own Suite

**Status**: Complete. SC-001: the replayed cut passes 2,920/2,920 tests, guard exits 0, the candidate validates (42 files), and the release add stages every changed file; SC-002: below.
**Spec**: `specs/051-release-cut-green/spec.md`
**Plan**: `specs/051-release-cut-green/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/release-cut-green.test.mjs`: tests on a temp tree for:
  - `notesSince` before and after a cut, and after a second cut (FR-001);
  - the mirrors written, created, and skipped without `.agent/` (FR-003);
  - the workflow not calling `ensureSkills` (FR-004);
  - `ensureSkills` without `surface` throwing (FR-005).

## Phase 2: Implementation

- [x] T002 `tests/fixtures/changelog-notes.mjs`; switch the nine CHANGELOG tests and the release-readiness SC-001 check to it (FR-001, FR-002).
- [x] T003 `.github/scripts/sync-release-version.mjs`: `.agent/` mirrors (FR-003).
- [x] T004 `.github/workflows/scheduled-release.yml`: remove the `ensureSkills` refresh (FR-004).
- [x] T005 `cli/ensure-skills.mjs`: required `surface` (FR-005).
- [x] T009 `.github/workflows/ci.yml`: runtime budget 360s with its measurements (FR-007).
- [x] T008 Workflow `git add` includes `commands/`; `RELEASE_PATH_ALLOWLIST` admits `.agent/commands`; tests check that every synchronized path is staged and admitted (FR-006).

## Phase 3: Docs and verification

- [x] T006 Replay the cut on a scratch worktree and run the full suite (SC-001).
- [x] T007 `CHANGELOG.md`; `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard` (SC-002).

## Phase 4: Amendment (2026-10-10)

- [x] T010 FR-008: lint test in `tests/release-cut-green.test.mjs`; `tests/js-framework-routes.test.mjs` and `tests/js-route-shapes.test.mjs` read `notesSince(…, '0.43.1')`.

## Phase 5: FR-007 revision (2026-10-13)

- [x] T011 Measure: per-Node duration distribution of the last 120 CI runs (445 jobs); per-test speed factor and residual noise; recorded in spec.md *Runtime budget measurements*.
- [x] T012 `tests/suite-runtime-budget.test.mjs` and the FR-007/SC-003 block of `tests/release-cut-green.test.mjs` (red first).
- [x] T013 `tools/suite-runtime-budget.mjs`, `tools/suite-runtime-reference.json`, `tests/fixtures/suite-runtime-runs.json`.
- [x] T014 `.github/workflows/ci.yml`: the check step, `TEST_CEILING_MS`, and the TAP artifact; `tests/ci-reproducibility.test.mjs`.
- [x] T015 `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`, `npm run llms`; `npm test`; `docguard guard`; `docguard specs --check`; anchor review on `ci.yml`.
