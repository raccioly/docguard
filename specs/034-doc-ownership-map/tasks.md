# Tasks: Doc Ownership Map

**Status**: Complete. SC-002 holds: every tracked source file under this repository's five roots has exactly one owner (0 OWN findings, 25 ms).
**Spec**: `specs/034-doc-ownership-map/spec.md`
**Plan**: `specs/034-doc-ownership-map/plan.md`

## Phase 1: Tests first and format check

- [x] T001 `tests/doc-ownership.test.mjs` (fixtures built in temp git repos): every OWN code seeded once (SC-001); specificity wins and ties (User Story 2); highest unowned directory; ignored and non-product paths; no-block project unchanged (FR-007); `trace --owners` JSON; `--suggest` writes nothing.
- [x] T002 Verify `.devin/wiki.json` field names and limits against Devin's current documentation; record them with the date in the limits constant and `docs/configuration.md` (FR-006).

## Phase 2: Scanner and validator

- [x] T003 Reuse `listTrackedFiles` (added by spec 033) and `extractHeadings` (moved to `cli/shared-headings.mjs` by spec 032); neither file needed a change.
- [x] T004 `cli/scanners/doc-ownership.mjs`: load, resolve, report, wiki lint, process cache (FR-001, FR-002, FR-004, FR-006).
- [x] T005 `cli/validators/doc-ownership.mjs`, `cli/findings.mjs`, `cli/commands/guard.mjs`, `cli/commands/explain.mjs`, `cli/config.mjs`, `schemas/docguard-config.schema.json` (with `devinWiki.maxPages`): OWN001–OWN007 (FR-003, FR-007).

## Phase 3: Consumers

- [x] T006 `cli/commands/trace.mjs`, `cli/docguard.mjs`: `--owners`, `--owners --suggest`, owner line in `--reverse` (FR-005).
- [x] T007 `cli/scanners/doc-references.mjs` (the `owner` field `docguard_docs_for_path` returns; `cli/commands/mcp.mjs` needed no change) and `cli/commands/review.mjs` (`covers` candidates) (FR-004).

## Phase 4: Adoption and docs

- [x] T008 `.docguard.json`: ownership for `cli/`, `extensions/`, `tools/`, `benchmarks/`, `tests/` with zero OWN001/OWN002 (FR-008, SC-002).
- [x] T009 `README.md`, `VALIDATION.md`, `docs/quickstart.md`, `docs/configuration.md`, `docs/commands.md` (a new `trace` section), `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md` (FR-009).

## Phase 5: Verification

- [x] T010 `testguard.claims.json`: claim DOC-OWNERSHIP-ONE-OWNER-PER-PATH; probe `--confirm 3 --serial`; gate.
- [x] T011 Non-regression budgets (`docguard.non-regression-budgets`): guard A/B time ≤3% (SC-003); no new error-severity self-findings after adoption; `docguard_docs_for_path` response bytes within budget; precision benchmark PASS; `npm test`; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
