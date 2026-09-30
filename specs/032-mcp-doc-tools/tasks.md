# Tasks: MCP Doc Tools

**Status**: Planned. Implement after `docguard.non-regression-budgets`, so the new response bytes are measured from the first PR.
**Spec**: `specs/032-mcp-doc-tools/spec.md`
**Plan**: `specs/032-mcp-doc-tools/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/mcp-doc-tools.test.mjs`: the User Story 1 fixture (SC-003), structure and read by id/anchor/heading, ambiguity, truncation and `nextOffset`, `not-declared` covers, `exists: false`, twenty unsafe paths with a sentinel file (SC-004), byte-identical repeat calls (FR-008), and the listing comparison (SC-005).
- [ ] T002 `tests/trace-reverse.test.mjs`, `tests/impact.test.mjs`: pin current JSON output before the matcher moves (FR-003).

## Phase 2: Shared scanners

- [ ] T003 `cli/shared-headings.mjs`, `cli/validators/cross-reference.mjs`: move `slugifyHeading` and `extractHeadings`, re-export.
- [ ] T004 `cli/scanners/doc-references.mjs`: one matcher; `cli/commands/trace.mjs` and `cli/commands/impact.mjs` call it; `cli/validators/traceability.mjs` takes the `@doc` regex from it (FR-003).
- [ ] T005 `cli/scanners/doc-structure.mjs`: outline, section resolution, caps (FR-004, FR-005, FR-008).

## Phase 3: MCP tools

- [ ] T006 `cli/commands/mcp.mjs`: `docguard_docs_for_path`, `docguard_doc_structure`, `docguard_read_section`, `docguard_task_context` with path checks through `createEvidenceReader` (FR-001, FR-002, FR-006, FR-007, FR-009); `tests/mcp.test.mjs` tool count.

## Phase 4: Listings and docs

- [ ] T007 `server.json`, `mcpb/manifest.template.json`, `smithery.yaml`, `docs/ai-integration.md`, `docs/commands.md`, `README.md` (FR-010).

## Phase 5: Verification

- [ ] T008 `budgets.json`: fixed requests for the four tools (FR-011); SC-001 measured on this repository and recorded in the PR.
- [ ] T009 `testguard.claims.json`: claim MCP-DOC-TOOLS-READ-ONLY-AND-BOUNDED; probe `--confirm 3 --serial`; gate.
- [ ] T010 Non-regression budgets (`docguard.non-regression-budgets`): guard A/B time unchanged within budget; agent-facing bytes for the four new tools recorded as new metrics (SC-002); existing MCP responses unchanged; precision benchmark PASS; `npm test`; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`.
