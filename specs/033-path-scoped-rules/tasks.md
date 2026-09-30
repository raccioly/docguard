# Tasks: Path-Scoped Agent Rules

**Status**: Planned. T002 must record the verified harness formats before T004 starts.
**Spec**: `specs/033-path-scoped-rules/spec.md`
**Plan**: `specs/033-path-scoped-rules/plan.md`

## Phase 1: Tests first and format check

- [ ] T001 `tests/path-scoped-rules.test.mjs`, `tests/fixtures/path-scoped-rules/`: one rule file per harness; every PSR code seeded once (SC-001); a 10-path expected table for `rules --for` (SC-002); partial coverage without git; a machine-local file marked `local`; no-scope project unchanged (FR-007, SC-004); `.cursor/rules/cdd.mdc` from `docguard agents` parses (FR-009).
- [ ] T002 Verify the scope field for Claude Code rules (`paths:`), Cursor (`globs:`, `alwaysApply:`), Copilot (`applyTo:`), Agent Skills and OpenHands against each harness's current documentation. Record the result and date in `docs/ai-integration.md`; adjust the fixture (FR-002).

## Phase 2: Scanners

- [ ] T003 `cli/shared-git.mjs`: `listTrackedFiles` with a walk fallback.
- [ ] T004 `cli/scanners/instruction-scopes.mjs`: discovery, frontmatter subset reader, scope derivation, `resolveInstructionsFor` (FR-001, FR-002, FR-008); `cli/scanners/agent-instructions.mjs`: nested `CLAUDE.md` chains.
- [ ] T005 `cli/scanners/instruction-audit.mjs`: export pointer helpers; `extractInstructionPointers` covering tables and links (FR-003 PSR002, FR-006).

## Phase 3: Validator and command

- [ ] T006 `cli/validators/path-scoped-rules.mjs`, `cli/findings.mjs`, `cli/commands/guard.mjs`, `cli/config.mjs`, `schemas/docguard-config.schema.json`: PSR001–PSR004 (FR-003, FR-004, FR-007).
- [ ] T007 `cli/commands/rules.mjs`, `cli/docguard.mjs`: `rules --for`, `--harness`, `--format json` (FR-005, FR-006).

## Phase 4: Docs

- [ ] T008 `README.md` (command and validator counts), `docs/commands.md`, `docs/configuration.md`, `docs/ai-integration.md`, `docs-canonical/ARCHITECTURE.md` (FR-010).

## Phase 5: Verification

- [ ] T009 `testguard.claims.json`: claim PATH-SCOPED-RULES-REPORT-DEAD-SCOPES; probe `--confirm 3 --serial`; gate.
- [ ] T010 Non-regression budgets (`docguard.non-regression-budgets`): guard A/B time ≤3% (SC-003); no new error-severity self-findings; package size within budget; precision benchmark PASS; `npm test`; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
