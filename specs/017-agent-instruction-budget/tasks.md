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
