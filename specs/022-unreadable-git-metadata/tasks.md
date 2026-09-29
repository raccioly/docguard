# Tasks: Unreadable Git Metadata

**Status**: Complete — the sandboxed-worktree reproduction reports 3 missing prerequisites and Spec-Kit partial
**Spec**: `specs/022-unreadable-git-metadata/spec.md`
**Plan**: `specs/022-unreadable-git-metadata/plan.md`

## Phase 1: Detection

- [x] T001 `cli/shared-git.mjs`: `gitMetadataStatus()` and `unreadableGitApplicability()` (FR-001, FR-004).

## Phase 2: Validators

- [x] T002 `cli/validators/freshness.mjs` + `cli/commands/guard.mjs`: shared helper; missing-prerequisite on unreadable (FR-002, FR-005).
- [x] T003 `cli/validators/diff-suspicion.mjs`, `cli/validators/reference-existence.mjs`: missing-prerequisite on unreadable (FR-002).
- [x] T004 `cli/scanners/speckit.mjs`: partial when the untouched-task check cannot read history (FR-003).

## Phase 3: Docs, tests, verification

- [x] T005 `docs-canonical/ENVIRONMENT.md`: agent sandbox section (FR-006).
- [x] T006 `tests/unreadable-git-metadata.test.mjs`: the reproduction (SC-001) and the no-`.git` parity check (SC-002).
- [x] T007 `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`; `docguard guard`; `npm test`.
