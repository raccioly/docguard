# Tasks: A Project's First Spec Can Pass Preflight

**Status**: Complete. SC-001: a fresh repository's first spec is READY with no registry and after `specs --write`, and `specs --check` is CURRENT; SC-002: draft to verified with `specs approve` and `specs complete`, no hand edit to approval or delivery; SC-003: `explain` exits 0 for SPC001–SPC008. Claim FIRST-SPEC-PREFLIGHT-PASSES: PROBE_RESULT.
**Spec**: `specs/040-spec-preflight-first-spec/spec.md`
**Plan**: `specs/040-spec-preflight-first-spec/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/first-spec-preflight.test.mjs`: git fixtures for the first
  spec without a registry, after `specs --write`, a stale registry for another
  spec, a registered second spec, and the briefing count with and without
  `--path` (FR-001–FR-004, SC-001).
- [x] T002 `tests/first-spec-preflight.test.mjs`: `specs approve` plan and
  write, delivery rules, refusals, SPC002 hint, and a draft-to-verified run
  with no hand edit (FR-005, FR-006, SC-002).
- [x] T003 `tests/first-spec-preflight.test.mjs`: `explain` for every SPC code
  in the CLI source, MCP explain, `findingSeverity` rejection (FR-007, SC-003);
  spec-first hint and labelled unresolved IDs (FR-008); completion
  transitions (FR-009); `reanchor --to HEAD` and a leading `-` (FR-010); docs
  (FR-011).

## Phase 2: Implementation

- [x] T004 `cli/scanners/spec-registry.mjs`: `currentExceptDraft`; preflight (FR-001–FR-004).
- [x] T005 `cli/commands/specs.mjs`, `cli/docguard.mjs`: `specs approve`; SPC002 hint (FR-005, FR-006).
- [x] T006 `cli/findings.mjs`, `cli/commands/explain.mjs`, `cli/commands/mcp.mjs`: `BLOCKER_CODES` (FR-007).
- [x] T007 `cli/scanners/spec-first.mjs`, `cli/commands/specs.mjs`: hint and unresolved IDs (FR-008); transition (FR-009).
- [x] T008 `cli/scanners/revision-anchor.mjs`, `cli/commands/specs.mjs`: `resolveCommit` for `reanchor --to` (FR-010).

## Phase 3: Docs and verification

- [x] T009 `docs/commands.md`, `README.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/SECURITY.md`, `docs/configuration.md`, `extensions/spec-kit-docguard/commands/complete.md`, `CHANGELOG.md` (FR-011).
- [x] T010 `testguard.claims.json`: claim FIRST-SPEC-PREFLIGHT-PASSES, probed `--confirm 3`; gate; `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard`.
