# Tasks: Canonical Requirement Links

**Status**: Complete. SC-001 and SC-002 hold.
**Spec**: `specs/027-canonical-requirement-links/spec.md`
**Plan**: `specs/027-canonical-requirement-links/plan.md`

## Phase 1: Tests

- [x] T001 `tests/canonical-requirement-links.test.mjs`: linked, intentional, undeclared/missing/escape, unchanged output; two fail on the previous reconciler (SC-001).

## Phase 2: Reconciler

- [x] T002 `cli/scanners/reconciliation.mjs`: canonical links, disposition, nodes and edges (FR-001, FR-002).

## Phase 3: Docs and verification

- [x] T003 `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, `testguard.claims.json`; `npm run llms`; stage, then `docguard specs --write`.
