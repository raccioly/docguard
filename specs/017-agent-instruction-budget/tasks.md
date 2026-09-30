# Tasks: Agent Instruction Budget and Spec Number Collisions

**Status**: Complete — SC-003: this repository's root chain is 13,222 bytes (within 32,768)
**Spec**: `specs/017-agent-instruction-budget/spec.md`
**Plan**: `specs/017-agent-instruction-budget/plan.md`

## Phase 1: Instruction budget (US1, US2)

- [x] T001 [US1] `cli/scanners/agent-instructions.mjs`: `measureInstructionChains()` (FR-001).
- [x] T002 [US1] [US2] `cli/validators/structure.mjs`: STR004 and STR005 from the configured budget and allowances (FR-002–FR-004); register both in `cli/findings.mjs`.
- [x] T003 [P] `schemas/docguard-config.schema.json`: `agentInstructions.maxBytes`, `agentInstructions.allowances`.

## Phase 2: Spec number collisions (US3)

- [x] T004 [US3] `cli/scanners/speckit.mjs`: `detectSpecNumberCollisions()` and SPK012 in `validateSpecKitIntegration` (FR-005); register in `cli/findings.mjs`.

## Phase 3: Tests, documentation, verification

- [x] T005 `tests/agent-instruction-budget.test.mjs`: chain composition, override precedence, ignored paths, budget, allowance pass/regrow/slack, SPK012 numeric vs timestamp.
- [x] T006 [P] `README.md` Structure and Spec-Kit rows; `docs-canonical/ARCHITECTURE.md`; `docs-canonical/CI-RECIPES.md` note.
- [x] T007 `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`; `docguard guard`; `npm test`; record SC-003.

## Phase 4: STR005 is informational (FR-004 fix, 2026-09-30)

- [x] T008 `tests/agent-instruction-budget.test.mjs`: STR005 resolves to `info` with enforcement source `code`, stays `info` under `severity.structure: high`, is promoted by `findingSeverity.STR005`, and leaves guard's exit code alone; a lint rejects any literal detector severity other than `error` or `warn`. All five fail on the code before this phase: `mkFinding` read the validator's `severity: 'info'` as `warn`, so slack in an allowance turned guard to WARN (exit 2).
- [x] T009 `cli/findings.mjs`: `CODES.STR005.defaultLevel: 'info'` and `codeDefaultLevel()`; `cli/shared.mjs`: `resolveFindingEnforcement` applies a code's default after exact code policy and intrinsic errors, before validator policy; `cli/validators/structure.mjs` emits `warn` (a finding's own severity stays `error` or `warn`, as DATA-MODEL documents); `cli/commands/guard.mjs` names a code default apart from a config override.
- [x] T010 `docs-canonical/DATA-MODEL.md`, `docs/configuration.md`, `CHANGELOG.md`; `npm test`; `docguard specs --write`; `npm run llms`.
