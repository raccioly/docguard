# Tasks: Quoted TODO Forms Are Not Annotations

**Spec**: `specs/073-todo-quoted-forms/spec.md`
**Plan**: `specs/073-todo-quoted-forms/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/todo-tracking.test.mjs`: US1 scenarios 1–6 (FR-001, FR-002), including a span whose content is the whole annotation text and an unmatched backtick; run them and see the quotation cases fail
- [ ] T002 `tests/todo-tracking.test.mjs`: US2 scenarios 1–5 (FR-003, FR-004): JS string, URL and template; Python and Go strings beside real comments; a block comment's third line reported at its own number; a `.vue` file still scanned; see the string cases fail
- [ ] T003 `tests/todo-tracking.test.mjs`: US3 (FR-005): the validator's own source, copied into a fixture project and scanned in place through `changedFiles`, reports no TDO finding either way; see the copy case fail

## Phase 2: Implementation

- [ ] T004 FR-001, FR-002: `cli/validators/todo-tracking.mjs` `maskCodeSpans`, `annotationOn`
- [ ] T005 FR-003, FR-004: `commentLines` over `realComments` and `languageOf`, line scanner for the rest; `_scanTodoFile` reads through it
- [ ] T006 FR-005: remove `SELF_PATH` and `isSelfPath`
- [ ] T007 FR-007: TDO002 help in `cli/findings.mjs`; `npm run docs:reference`

## Phase 3: Docs and verification

- [ ] T008 `CHANGELOG.md` [Unreleased] Fixed; `npm run llms`
- [ ] T009 [P] TestGuard claim `TODO-QUOTED-FORMS` in `testguard.claims.json`, `source.ref` `req:docguard.todo-quoted-forms#FR-00n`; probe it with `--confirm 3 --serial`
- [ ] T010 Re-accept the requirement-anchor links of every changed file that carries tags, file by file with a reason (`docguard anchors --state suspect`, `anchors accept --file … --bulk`)
- [ ] T011 SC-002: A/B of `guard --format json` on a `git archive` export of the candidate: 0.44.3, the main CLI at the base commit, and the candidate
- [ ] T012 SC-003: the same A/B, main CLI against the candidate, on other real repositories; inspect every TDO difference
- [ ] T013 SC-001, SC-004: `npm test`; `npm run benchmark`; `docguard specs --write`; `docguard guard` PASS with no findings; `docguard specs --check`
