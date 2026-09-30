# Tasks: Doc Dependency Lock

**Status**: Planned. The spec is ready for approval; implementation follows `docguard.non-regression-budgets`, so FR-008 can be measured.
**Spec**: `specs/030-doc-dependency-lock/spec.md`
**Plan**: `specs/030-doc-dependency-lock/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/doc-dependency-lock.test.mjs`: fixtures for SC-001 (a semantic edit plus five non-semantic ones), SC-004 (same-size edits), FR-007/SC-002 (byte-identical without `covers`), every DLK code, and review accept/prune/suggest/refusal.

## Phase 2: Core

- [ ] T002 `cli/writers/sections.mjs`: expose a parsed `covers` list (FR-001).
- [ ] T003 `cli/scanners/doc-deps.mjs`: resolve, fingerprint with tiers, glob sets, parse cache, lock load and compare (FR-002, FR-003, FR-008).
- [ ] T004 `schemas/docguard-doc-lock.schema.json` (FR-003).
- [ ] T005 `cli/validators/doc-dependency.mjs`, `cli/findings.mjs`, `cli/commands/guard.mjs`: DLK001–DLK005 (FR-004).
- [ ] T006 `cli/commands/review.mjs`, `cli/docguard.mjs`: list, accept, prune, suggest (FR-005, FR-006).

## Phase 3: Adoption and docs

- [ ] T007 `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`: declare `covers` on module-specific sections and accept them (FR-009).
- [ ] T008 `README.md`, `docs/commands.md`, `docs/configuration.md`, `extensions/spec-kit-docguard/commands/review.md` (FR-010).

## Phase 4: Verification

- [ ] T009 `testguard.claims.json`: claim DOC-LOCK-FLAGS-CHANGED-DEPENDENCIES; probe `--confirm 3 --serial`; gate.
- [ ] T010 Non-regression budgets (`docguard.non-regression-budgets`): A/B guard timing ≤5% (SC-003); precision benchmark PASS; `npm test`; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
