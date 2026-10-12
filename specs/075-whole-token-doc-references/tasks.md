# Tasks: Doc References Match Whole File Names

**Status**: Complete. SC-001: before the change the 15 User Story 1 cases failed (SECURITY.md and AGENTS.md were reported for `src/b.mjs` by every consumer) and the 18 User Story 2 cases passed; after it all pass. SC-002: on this repository's 624 tracked code files and 34 documents, the old matcher found 894 references and the new one 828; none was added, and each of the 66 removed is a name inside a longer file name (63 with a file-name character before it, 1 after it, 2 both: `docguard.mjs`, `shared-git.mjs`, `server.json`, `vitest.config.ts`, …). One reference changed kind, from `basename` to `module`, because its line also backticks the module name. All 579 full-path mentions are still `path` references. On four other local projects of mixed stacks, 1 of 1,514 references was removed, also a name inside a longer file name, and doc-to-doc edges were unchanged (88 of 88).
**Spec**: `specs/075-whole-token-doc-references/spec.md`
**Plan**: `specs/075-whole-token-doc-references/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/doc-reference-tokens.test.mjs`: names inside longer file names on either side are not references; every User Story 2 form still is, with today's kind; the input fixture through `impact` (direct and indirect), `trace --reverse` and `docsForPath`; the `SPEC.md` / `TEST-SPEC.md` blast radius; confirm the User Story 1 cases fail before the change (FR-001–FR-004, SC-001).

## Phase 2: Implementation

- [x] T002 FR-001, FR-002: `namesToken` and `referenceKind` in `cli/scanners/doc-references.mjs`
- [x] T003 FR-004: `docsReferencing` in `cli/commands/impact.mjs`

## Phase 3: Proof, docs and verification

- [x] T004 SC-002: compare the old and new matchers over this repository's tracked code files and the documents the consumers read; record the counts and review every removed reference. A repository test checks that every full-path mention is still a `path` reference.
- [x] T005 FR-005: the existing impact, ripple and relocation suites pass unchanged; the reverse-walk statement anchor keeps its code fingerprint.
- [x] T006 FR-006: `docs/commands.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, `npm run llms`.
- [x] T007 TestGuard: a claim for FR-001 and FR-004; `MCP-DOC-TOOLS-EXACT-AND-BOUNDED` F1 follows the new basename line; probe both and `ANCHOR-RIPPLE-NAME-FILTERED`.
- [x] T008 `npm test`; `docguard specs --write`; requirement anchors reviewed; `docguard guard`.
