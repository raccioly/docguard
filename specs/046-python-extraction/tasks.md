# Tasks: Accurate Python Web Extraction

**Status**: Complete. SC-001/SC-002: both reference projects report every ground-truth route, entity, relationship and environment variable with no extra ones, through the AST tier and the pattern tier; SC-003: pattern-tier plans, as-built specs and SPR007 findings carry `regex-fallback` and low confidence; SC-004: removing one route removes exactly its fact.
**Spec**: `specs/046-python-extraction/spec.md`
**Plan**: `specs/046-python-extraction/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/python-extraction.test.mjs`: the FastAPI and Django
  reference projects with written ground truth; reproduce every bug before
  the fix, through the AST tier (skipped without `python3`) and the pattern
  tier (child process without `python3` on `PATH`):
  - routes, auth and incomplete prefixes (FR-001, FR-002, FR-003, SC-001,
    SC-002, SC-004);
  - `normalizePath` for `<int:pk>` (FR-004);
  - entities, relationships, types, schema-sync agreement (FR-005 to FR-008);
  - environment variables (FR-009).
- [x] T002 `tests/python-extraction.test.mjs`: `init --skip-prompts` project
  type and plain `init` smart mode (FR-010, FR-011); `generate --plan` text
  and JSON, `generate --spec` and SPR007 without `python3`; the module graph
  message (FR-012 to FR-014, SC-003); the as-built test list, module-level
  symbols and PEP 621 extras (FR-015 to FR-017); the docs (FR-018).
- [x] T003 `tests/py-ast.test.mjs`: assert routes and schemas through the new
  resolvers; relationship attributes are not columns.

## Phase 2: Implementation

- [x] T004 `cli/scanners/py-ast.mjs`: outline in the extractor, module-level
  symbols, per-content cache (FR-016).
- [x] T005 `cli/scanners/py-outline.mjs`: pattern-tier outline.
- [x] T006 `cli/scanners/python-routes.mjs`, `cli/scanners/routes.mjs`,
  `cli/scanners/api-doc.mjs` (FR-001 to FR-004).
- [x] T007 `cli/scanners/python-models.mjs`, `cli/scanners/schemas.mjs`,
  `cli/validators/schema-sync.mjs` (FR-005 to FR-008).
- [x] T008 `cli/scanners/py-env.mjs`, `cli/shared-source.mjs` (FR-009).
- [x] T009 `cli/config.mjs`, `cli/commands/init.mjs`, `cli/commands/generate.mjs`,
  `cli/scanners/project-type.mjs` (FR-010, FR-011, FR-017).
- [x] T010 `cli/scanners/memory-plan.mjs`, `cli/commands/generate.mjs`,
  `cli/scanners/as-built.mjs`, `cli/commands/generate-as-built.mjs`,
  `cli/validators/spec-registry.mjs`, `cli/scanners/module-diagram.mjs`
  (FR-012 to FR-015).

## Phase 3: Docs and verification

- [x] T011 `docs-canonical/ARCHITECTURE.md`, `docs-canonical/ENVIRONMENT.md`,
  `docs/configuration.md`, `docs/commands.md`, `CHANGELOG.md` (FR-018).
- [x] T012 `testguard.claims.json`: claim PYTHON-EXTRACTION-IS-ACCURATE, probed
  `--confirm 3`; gate; `npm test`; `npm run llms`; `docguard specs --write`;
  `docguard guard`; benchmarks.
