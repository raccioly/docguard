# Tasks: Doc Ownership Map

**Status**: Planned. The `owner` field in `docguard_docs_for_path` and the `review --suggest` candidates land with, or after, specs 031 and 029.
**Spec**: `specs/034-doc-ownership-map/spec.md`
**Plan**: `specs/034-doc-ownership-map/plan.md`

## Phase 1: Tests first and format check

- [ ] T001 `tests/doc-ownership.test.mjs`, `tests/fixtures/doc-ownership/`: every OWN code seeded once (SC-001); specificity wins and ties (User Story 2); highest unowned directory; ignored and non-product paths; no-block project unchanged (FR-007); `trace --owners` JSON; `--suggest` writes nothing.
- [ ] T002 Verify `.devin/wiki.json` field names and limits against Devin's current documentation; record them with the date in the limits constant and `docs/configuration.md` (FR-006).

## Phase 2: Scanner and validator

- [ ] T003 `cli/shared-git.mjs`, `cli/shared-headings.mjs`: add or reuse `listTrackedFiles` and the heading helpers.
- [ ] T004 `cli/scanners/doc-ownership.mjs`: load, resolve, report, wiki lint, process cache (FR-001, FR-002, FR-004, FR-006).
- [ ] T005 `cli/validators/doc-ownership.mjs`, `cli/findings.mjs`, `cli/commands/guard.mjs`, `cli/config.mjs`, `schemas/docguard-config.schema.json`: OWN001–OWN007 (FR-003, FR-007).

## Phase 3: Consumers

- [ ] T006 `cli/commands/trace.mjs`, `cli/docguard.mjs`: `--owners`, `--owners --suggest`, owner line in `--reverse` (FR-005).
- [ ] T007 `cli/commands/mcp.mjs` (`owner` field) and `cli/commands/review.mjs` (`covers` candidates), each only if its spec has landed (FR-004).

## Phase 4: Adoption and docs

- [ ] T008 `.docguard.json`: ownership for `cli/`, `extensions/`, `tools/`, `benchmarks/`, `tests/` with zero OWN001/OWN002 (FR-008, SC-002).
- [ ] T009 `README.md`, `docs/configuration.md`, `docs/commands.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md` (FR-009).

## Phase 5: Verification

- [ ] T010 `testguard.claims.json`: claim DOC-OWNERSHIP-ONE-OWNER-PER-PATH; probe `--confirm 3 --serial`; gate.
- [ ] T011 Non-regression budgets (`docguard.non-regression-budgets`): guard A/B time ≤3% (SC-003); no new error-severity self-findings after adoption; `docguard_docs_for_path` response bytes within budget; precision benchmark PASS; `npm test`; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
