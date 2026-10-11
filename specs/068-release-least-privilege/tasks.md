# Tasks: Release Workflows Run Code Without Write Tokens

**Status**: In progress
**Spec**: `specs/068-release-least-privilege/spec.md`
**Plan**: `specs/068-release-least-privilege/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/workflow-permissions.test.mjs`: FR-001–FR-003 over every workflow, FR-004–FR-006 on the release workflows, FR-008 docs, and a violating sample the checker must reject; record the failures on the current workflows (SC-001).

## Phase 2: Implementation

- [ ] T002 FR-001–FR-004, FR-006: `release.yml` (read default, read-only `test`, artifact-built assets, `attach-assets`, `build-pypi`, GHCR login order)
- [ ] T003 FR-005: `scheduled-release.yml` (`cut`, `verify`, `open-pr`, `recover`)
- [ ] T004 FR-002: `ci.yml` checkouts
- [ ] T005 Existing release-workflow tests follow the new layout

## Phase 3: Docs and verification

- [ ] T006 FR-008: SECURITY, ARCHITECTURE, CONTRIBUTING, CHANGELOG; `npm test`; `docguard specs --write`; `docguard guard` (SC-002)
