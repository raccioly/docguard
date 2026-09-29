# Tasks: Release Dispatch Window

**Status**: Complete
**Spec**: `specs/023-release-dispatch-window/spec.md`
**Plan**: `specs/023-release-dispatch-window/plan.md`

## Phase 1: Schedule and wording

- [x] T001 `.github/workflows/release.yml`: `*/10 * * * *` and comment (FR-001).
- [x] T002 `.github/workflows/scheduled-release.yml` notice, header comment and PR body; `docs-canonical/CI-RECIPES.md` (FR-002).

## Phase 2: Contract and verification

- [x] T003 `tests/scheduled-release.test.mjs`: pin the 10-minute schedule and the notice (FR-003).
- [x] T004 `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`; `docguard guard`; `npm test`.
