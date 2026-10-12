# Tasks: A Quoted Comment Opener Hides Nothing

**Spec**: `specs/074-quoted-comment-openers/spec.md`
**Plan**: `specs/074-quoted-comment-openers/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/quoted-comment-openers.test.mjs`: requirements after a quoted `<!--` (single and double backticks), an unclosed backtick before a real opener, real single- and multi-line comments still hiding, a comment ending at its first `-->` (FR-001, FR-003); instruction pointers after a quoted opener (FR-002); run it and see FR-001 and FR-002 fail

## Phase 2: Implementation

- [x] T002 FR-001, FR-003, FR-004: `cli/shared-html-comments.mjs` `stripHtmlComments`; `cli/shared-requirements.mjs` uses it
- [x] T003 FR-002: `cli/scanners/instruction-audit.mjs` `extractInstructionPointers` uses it

## Phase 3: Docs and verification

- [x] T004 `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`; `npm run llms`
- [ ] T005 SC-002: requirement inventories and instruction pointers on this repository before and after, differences recorded below; anchors re-accepted for the changed files; `docguard specs --write`; `docguard guard`; `npm test`; TestGuard claim probed
