# Tasks: Fixes From Dogfooding Real Repositories

**Status**: Complete. SC-001: each reproduction passes and each control holds; SC-002: full suite and guard below.
**Spec**: `specs/050-dogfood-findings/spec.md`
**Plan**: `specs/050-dogfood-findings/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/dogfood-findings.test.mjs`: reproduce the string agent-file crash (score, score --format json, fix), the nested DATA-MODEL SCH001, and the scoring-table MET004; controls for an ambiguous nested name, an explicit role mapping, and a count table (FR-001–FR-003, SC-001).

## Phase 2: Implementation

- [x] T002 `cli/config.mjs`: normalize `requiredFiles.agentFile` (FR-001).
- [x] T003 `cli/shared-doc-roles.mjs`: unique same-named canonical fallback (FR-002).
- [x] T004 `cli/validators/metrics-consistency.mjs`: header-qualified dependency rows (FR-003).

## Phase 3: Docs and verification

- [x] T005 `CHANGELOG.md` (FR-004); `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard` (SC-002).
