# Tasks: Test Git Hermeticity

**Status**: Complete. SC-001: under the hostile config the suite went from 189 failures to the 6 spec 065 owns; the demo reproduction failed before its fix. SC-002: full suite and guard below.
**Spec**: `specs/066-test-git-hermeticity/spec.md`
**Plan**: `specs/066-test-git-hermeticity/plan.md`

## Phase 1: Reproduce and test first

- [x] T001 Run the suite under a hostile `GIT_CONFIG_GLOBAL` (failing hooks, mandatory signing through `/usr/bin/false`, `init.defaultBranch=trunk`) and record the failures (SC-001).
- [x] T002 `tests/test-git-hermeticity.test.mjs`: the helper against a hostile config with a control (FR-001), a failing fixture step (FR-002), the bypass scan (FR-004), `demo` on a hostile machine (FR-005, fails before the fix), the CI job (FR-006).

## Phase 2: Implementation

- [x] T003 FR-001, FR-002: `tests/helpers/git.mjs`; route every fixture git call in `tests/` through it, checking setup status.
- [x] T004 FR-005: `cli/commands/demo.mjs`, `benchmarks/agent-context/run.mjs`.
- [x] T005 FR-006: the `hermeticity` job in `.github/workflows/ci.yml`.

## Phase 3: Docs and verification

- [x] T006 FR-007: `CONTRIBUTING.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`.
- [x] T007 The suite under the hostile config again (SC-001); `npm test`; `docguard specs --write`; `docguard guard` (SC-002).
