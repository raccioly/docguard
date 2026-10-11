# Tasks: Release Workflows Run Code Without Write Tokens

**Status**: Complete. SC-001: the new test reported 16 violations on the workflows before the change and none after; the existing release-workflow tests follow the new layout. SC-002: full suite and guard below; the first release on the new layout is the end-to-end check.
**Spec**: `specs/068-release-least-privilege/spec.md`
**Plan**: `specs/068-release-least-privilege/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/workflow-permissions.test.mjs`: FR-001–FR-003 over every workflow, FR-004–FR-006 on the release workflows, FR-008 docs, and a violating sample the checker must reject; record the failures on the current workflows (SC-001).

## Phase 2: Implementation

- [x] T002 FR-001–FR-004, FR-006: `release.yml` (read default, read-only `test`, artifact-built assets, `attach-assets`, `build-pypi`, GHCR login order)
- [x] T003 FR-005: `scheduled-release.yml` (`cut`, `verify`, `open-pr`, `recover`)
- [x] T004 FR-002: `ci.yml` checkouts
- [x] T005 Existing release-workflow tests follow the new layout

## Phase 3: Docs and verification

- [x] T006 FR-008: SECURITY, CI-RECIPES (Recipe 3a), installation (supply-chain table), TEST-SPEC map, CHANGELOG; `npm test`; `docguard specs --write`; `docguard guard` (SC-002)
