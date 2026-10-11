# Tasks: Git Hooks Stay Inside the Repository

**Status**: Complete. SC-001: 16 of 18 new cases failed before the fix (the 2 that passed guard unchanged behaviour); SC-002: full suite and guard below.
**Spec**: `specs/065-hooks-repo-scope/spec.md`
**Plan**: `specs/065-hooks-repo-scope/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/hooks-repo-scope.test.mjs`: global, system and outside-repo `core.hooksPath` refuse install/`--force`/`--remove`; `--list` read-only; repo-local and worktree folders unchanged (FR-001–FR-003); setup in a linked worktree and with a global path (FR-004); `upgrade --pr` rollback on commit, push and `gh` failure (FR-005).

## Phase 2: Implementation

- [x] T002 FR-001–FR-003: `resolveHooksTarget` in `cli/shared-git.mjs`; `cli/commands/hooks.mjs`
- [x] T003 FR-004: `cli/commands/setup.mjs`
- [x] T004 FR-005: `cli/commands/upgrade.mjs`
- [x] T005 FR-006: hook-installing tests isolate the global configuration

## Phase 3: Docs and verification

- [x] T006 `docs/commands.md`, `docs/guides/upgrading.md`, `docs/guides/troubleshooting.md`, REQUIREMENTS FR-024, `CHANGELOG.md`; `npm test`; `docguard specs --write`; `docguard guard` (SC-002)
