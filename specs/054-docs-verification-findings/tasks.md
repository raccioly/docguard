# Tasks: Defects Found While Documenting DocGuard

**Status**: Complete. SC-001: each defect has a reproduction that failed before the fix; SC-002: full suite and guard below, release replay test passes.
**Spec**: `specs/054-docs-verification-findings/spec.md`
**Plan**: `specs/054-docs-verification-findings/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/docs-verification-findings.test.mjs`: Koa label and routes (FR-001), marked agent files (FR-002), `agents --sync` without init (FR-003), schema `sourceRoot` (FR-004), PSR002 against an ignored target (FR-007); `tests/release-version-sync.test.mjs`: the new pinned examples (FR-005).

## Phase 2: Implementation

- [x] T002 FR-001: `project-type.mjs`, `routes.mjs`
- [x] T003 FR-002, FR-003: `agents.mjs`, `docguard.mjs`
- [x] T004 FR-004: config schema
- [x] T005 FR-005: release sync, policy, workflow, current examples
- [x] T006 FR-006, FR-007: `mcp.mjs` comment, `path-scoped-rules.mjs`

## Phase 3: Verification

- [x] T007 `CHANGELOG.md`; `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard`; release-cut replay (SC-002)
