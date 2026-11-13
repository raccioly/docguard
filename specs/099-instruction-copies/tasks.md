# Tasks: Agent-Instruction Copies

**Spec**: `specs/099-instruction-copies/spec.md`
**Plan**: `specs/099-instruction-copies/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/instruction-copies.test.mjs`: the reported case (reviewed template + new root script) gives FRS007 on the template before the change; root `AGENTS.md` still flagged (SC-001, US1).
- [x] T002 Same file: PSR006 on a template copy and a fixture copy; no PSR006 for a monorepo package, `templates/AGENTS.md`, a lone template, an ignored copy, a dot-directory rule; `agentInstructions.governing` (US2, US3, FR-002).

## Phase 2: Implementation

- [x] T003 FR-001, FR-002: `cli/shared-agent-instructions.mjs`, the Path-Scoped-Rules entry filter.
- [x] T004 FR-003: PSR006 in `cli/validators/path-scoped-rules.mjs`.
- [x] T005 FR-004: catalog, schema, DATA-MODEL, CHANGELOG, `npm run docs:reference`.
- [x] T006 FR-005: benchmark fixture, corpus cases, baseline.

## Phase 3: Verification

- [ ] T007 `npm test`; `node cli/docguard.mjs guard`; benchmark comparison (SC-002, SC-003).
