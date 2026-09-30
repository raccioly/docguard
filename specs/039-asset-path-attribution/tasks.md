# Tasks: Reviewed Asset Paths for Spec Reconciliation

**Spec**: `specs/039-asset-path-attribution/spec.md`
**Plan**: `specs/039-asset-path-attribution/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/asset-path-attribution.test.mjs`:
  - registry validation: valid directory and file entries; absolute, `..`,
    `.local` and wildcard entries are SPR003; sorted and unique; absent
    means unchanged serialization (FR-001, FR-004, SC-002);
  - `assetPathCovers` semantics;
  - a git fixture where an unannotated file under an asset path links to its
    spec and a file outside stays `unsupported_or_ambiguous` (FR-002);
  - SPR009 for a path that covers no tracked file (FR-003).
- [ ] T002 `tests/asset-path-attribution.test.mjs`: this repository's
  `docguard.agent-instruction-budget` maintenance plan reports no `benchmarks/`
  file as unresolved, and removing 036's `assetPaths` brings them back
  (FR-005, SC-001).

## Phase 2: Implementation

- [ ] T003 `cli/scanners/spec-registry.mjs`: `assetPaths` validation and serialization; `assetPathCovers` (FR-001, FR-004).
- [ ] T004 `cli/scanners/reconciliation.mjs`: asset-path links (FR-002).
- [ ] T005 `cli/validators/spec-registry.mjs`, `cli/findings.mjs`: SPR009 (FR-003).
- [ ] T006 `schemas/docguard-specs.schema.json`; `.docguard-specs.json`: spec 036's seven frozen assets (FR-001, FR-005).

## Phase 3: Docs and verification

- [ ] T007 `docs-canonical/DATA-MODEL.md`, `docs/commands.md`, `CHANGELOG.md` (FR-006).
- [ ] T008 `testguard.claims.json`: claim ASSET-PATHS-ATTRIBUTE-EXACTLY, probed `--confirm 3`; gate; `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard`; budgets.
