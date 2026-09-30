# Tasks: Path-Scoped Agent Rules

**Status**: Complete. SC-001 and SC-002 hold on the five-harness fixture; on this repository the validator checks 12 pointers and 0 scopes and reports nothing.
**Spec**: `specs/033-path-scoped-rules/spec.md`
**Plan**: `specs/033-path-scoped-rules/plan.md`

## Phase 1: Tests first and format check

- [x] T001 `tests/path-scoped-rules.test.mjs`: builds the five-harness fixture in a temp git repo (a checked-in fixture would put dot-directories of rules inside this repository); every PSR code seeded once (SC-001); a 10-path expected table for `rules --for` (SC-002); partial coverage without git; a machine-local file marked `local`; no-instruction project unchanged (FR-007, SC-004); `.cursor/rules/cdd.mdc` from `docguard agents` parses (FR-009).
- [x] T002 Verify the scope field for Claude Code rules (`paths:`), Cursor (`globs:`, `alwaysApply:`), Copilot (`applyTo:`), Agent Skills and OpenHands against each harness's current documentation. Record the result and date in `docs/ai-integration.md`; adjust the fixture (FR-002). Findings changed the design: OpenHands moved to `.agents/skills` with `paths:` and basename matching; Cursor ignores `.md`; Claude Code loads a rule with unparseable frontmatter always.

## Phase 2: Scanners

- [x] T003 `cli/shared-git.mjs`: `listTrackedFiles` (tracked only; the walk fallback lives in the validator) and `gitIgnoredPaths`.
- [x] T004 `cli/scanners/instruction-scopes.mjs`, `cli/scanners/frontmatter.mjs`: classification, frontmatter subset reader, scope derivation, `applicableFor` (FR-001, FR-002, FR-008). Nested `CLAUDE.md` chains are directory entries in the new scanner, so `measureInstructionChains` (STR004) is unchanged.
- [x] T005 `cli/scanners/instruction-audit.mjs`: export pointer helpers; `extractInstructionPointers` covering tables and links (FR-003 PSR002, FR-006).

## Phase 3: Validator and command

- [x] T006 `cli/validators/path-scoped-rules.mjs`, `cli/findings.mjs`, `cli/commands/guard.mjs`, `cli/commands/explain.mjs`, `cli/config.mjs`, `schemas/docguard-config.schema.json`: PSR001–PSR004 (FR-003, FR-004, FR-007).
- [x] T007 `cli/commands/rules.mjs`, `cli/docguard.mjs`: `rules --for`, `--harness`, `--format json` (FR-005, FR-006).

## Phase 4: Docs

- [x] T008 `README.md` (command and validator counts), `VALIDATION.md`, `docs/quickstart.md`, `docs/commands.md`, `docs/configuration.md`, `docs/ai-integration.md`, `docs-canonical/ARCHITECTURE.md` (FR-010).

## Phase 5: Verification

- [x] T009 `testguard.claims.json`: claim PATH-SCOPED-RULES-REPORT-DEAD-SCOPES; probe `--confirm 3 --serial`; gate.
- [x] T010 Non-regression budgets (`docguard.non-regression-budgets`): guard A/B time ≤3% (SC-003); no new error-severity self-findings; package size within budget; precision benchmark PASS; `npm test`; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
