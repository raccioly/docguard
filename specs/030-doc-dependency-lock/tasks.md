# Tasks: Doc Dependency Lock

**Status**: Complete. SC-001, SC-002 and SC-004 hold; SC-003 is measured by the CI budget job on this PR.
**Spec**: `specs/030-doc-dependency-lock/spec.md`
**Plan**: `specs/030-doc-dependency-lock/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/doc-dependency-lock.test.mjs`: fixtures for SC-001 (a semantic edit plus five non-semantic ones), SC-004 (same-size edits), FR-007/SC-002 (byte-identical without `covers`), every DLK code, and review accept/prune/suggest/refusal.

## Phase 2: Core

- [x] T002 `cli/scanners/doc-deps.mjs`: parse `covers=` from section markers, skipping fenced examples (FR-001).
- [x] T003 `cli/scanners/doc-deps.mjs`: resolve, fingerprint with tiers, glob sets, parse cache, lock load and compare (FR-002, FR-003, FR-008).
- [x] T004 `schemas/docguard-doc-lock.schema.json` (FR-003).
- [x] T005 `cli/validators/doc-dependency.mjs`, `cli/findings.mjs`, `cli/commands/guard.mjs`: DLK001–DLK005 (FR-004).
- [x] T006 `cli/commands/review.mjs`, `cli/docguard.mjs`: list, accept, prune, suggest (FR-005, FR-006).

## Phase 3: Adoption and docs

- [x] T007 `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`: declare `covers` on module-specific sections and accept them (FR-009).
- [x] T008 `README.md`, `docs/commands.md`, `docs/configuration.md`, `extensions/spec-kit-docguard/commands/review.md` (FR-010).

## Phase 4: Verification

- [x] T009 `testguard.claims.json`: claim DOC-LOCK-FLAGS-CHANGED-DEPENDENCIES; probe `--confirm 3 --serial`; gate.
- [x] T010 Non-regression budgets (`docguard.non-regression-budgets`): A/B guard timing ≤5% (SC-003); precision benchmark PASS; `npm test`; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
