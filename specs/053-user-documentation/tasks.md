# Tasks: User Documentation a Large Project Would Ship

**Status**: Complete. SC-001: every page is reachable from the landing page and every link resolves; SC-002: full suite 2,949/2,949, guard PASS, Pages build `built` with sidebar and search.
**Spec**: `specs/053-user-documentation/spec.md`
**Plan**: `specs/053-user-documentation/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/user-docs.test.mjs`: generated-reference drift (FR-004), relative links (FR-008, SC-001), mentioned commands exist (FR-008), front matter (FR-006, FR-008).

## Phase 2: Pages

- [x] T002 `docs/guides/existing-projects.md` (FR-001)
- [x] T003 `docs/reference/languages.md` (FR-002)
- [x] T004 `docs/reference/agents.md` (FR-003)
- [x] T005 `tools/generate-docs-reference.mjs`, `docs/reference/findings.md`, `npm run docs:reference` (FR-004)
- [x] T006 `docs/installation.md`, `docs/guides/{ci,monorepo,upgrading,troubleshooting,spec-kit}.md`, `docs/reference/mcp.md` (FR-005)
- [x] T007 `docs/_config.yml`, `docs/index.md`, section index pages, front matter on existing pages (FR-006)
- [x] T008 README, README.es.md, README.pt-BR.md links (FR-007)
- [x] T010 Corrections to existing docs and CLI help found while verifying the new pages (FR-009)

## Phase 3: Verification

- [x] T009 `CHANGELOG.md`; `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard`; Pages build after merge (SC-002)
