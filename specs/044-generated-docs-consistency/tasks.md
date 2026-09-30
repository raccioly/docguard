# Tasks: DocGuard's Generated Docs Pass DocGuard's Own Checks

**Status**: Complete. SC-001: on five fresh projects (Express, Next.js, FastAPI, Django, Go) × five flows, guard and `diff` report only allow-listed project findings and no `.bak` remains; the same 25 runs failed on the base revision (2–22 DocGuard-caused findings each). SC-002: each bug has a reproduction in `tests/generated-docs-consistency.test.mjs`. SC-003: the full suite passes and guard on this repository reports no new finding. Claim GENERATED-DOCS-PASS-OWN-CHECKS: 35/35 faults killed.
**Spec**: `specs/044-generated-docs-consistency/spec.md`
**Plan**: `specs/044-generated-docs-consistency/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/generated-docs-consistency.test.mjs`: a failing reproduction
  per bug:
  - API parser (`/`, `ALL`, `ANY`, written path) (FR-001);
  - `diff` entity table (FR-002);
  - plan headings and init-hosted headings (FR-003);
  - TRC003 marker, TRC002 citation, as-built SC (FR-004);
  - owned dirs in the component map and DCV003, DCV003 root display, DCV001
    registry (FR-005);
  - template placeholders: tech diff, ENV004, ARCHITECTURE and REQUIREMENTS
    templates (FR-006);
  - handler names, Required/default, auth row (FR-007);
  - one env set in generate, plan and `diff` (FR-008);
  - human-section preservation, pinned skip, no `.bak`, `.bak` on a lossy
    write (FR-009);
  - Django entities, tech list, tests and modules in plain generate (FR-010);
  - DQ007 on generated SECURITY and ARCHITECTURE (FR-011);
  - docs describe the change (FR-012).
- [x] T002 `tests/generated-docs-e2e.test.mjs`: five fixture projects × five
  flows, guard + `diff` findings within the allow-list, no `.bak` (SC-001,
  SC-002, SC-003).

## Phase 2: Implementation

- [x] T003 `cli/scanners/api-doc.mjs` (FR-001).
- [x] T004 `cli/commands/diff.mjs`, `cli/validators/docs-diff.mjs` (FR-002, FR-006, FR-008).
- [x] T005 `cli/writers/sections.mjs`, `cli/scanners/memory-plan.mjs`, `cli/commands/generate.mjs`, `cli/writers/generate-io.mjs` (FR-003, FR-009).
- [x] T006 `cli/validators/traceability.mjs`, `cli/scanners/as-built.mjs` (FR-004).
- [x] T007 `cli/shared-ignore.mjs`, `cli/scanners/inventory.mjs`, `cli/validators/docs-coverage.mjs` (FR-005).
- [x] T008 `cli/validators/environment.mjs`, `templates/ARCHITECTURE.md.template`, `templates/REQUIREMENTS.md.template` (FR-006).
- [x] T009 `cli/shared-source.mjs`, `cli/scanners/integrations.mjs`, `cli/writers/doc-generators.mjs` (FR-007, FR-008, FR-010, FR-011).
- [x] T010 `cli/scanners/py-ast.mjs`, `cli/scanners/schemas.mjs`, `cli/validators/api-surface.mjs` (FR-010).

## Phase 3: Docs and verification

- [x] T011 `docs/commands.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md` (FR-012).
- [x] T012 `testguard.claims.json`: claim GENERATED-DOCS-PASS-OWN-CHECKS, probed `--confirm 3`; gate; `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard`.
