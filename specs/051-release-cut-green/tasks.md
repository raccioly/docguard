# Tasks: A Release Cut That Passes Its Own Suite

**Status**: In progress.
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

## Phase 3: Docs and verification

- [ ] T006 Replay the cut on a scratch worktree and run the full suite (SC-001).
- [ ] T007 `CHANGELOG.md`; `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard` (SC-002).
