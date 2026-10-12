# Tasks: Quoted TODO Forms Are Not Annotations

**Spec**: `specs/073-todo-quoted-forms/spec.md`
**Plan**: `specs/073-todo-quoted-forms/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/todo-tracking.test.mjs`: US1 scenarios 1–6 (FR-001, FR-002), including a span whose content is the whole annotation text and an unmatched backtick; run them and see the quotation cases fail
- [x] T002 `tests/todo-tracking.test.mjs`: US2 scenarios 1–5 (FR-003, FR-004): JS string, URL and template; Python and Go strings beside real comments; a block comment's third line reported at its own number; a `.vue` file still scanned; see the string cases fail
- [x] T003 `tests/todo-tracking.test.mjs`: US3 (FR-005): the validator's own source, copied into a fixture project and scanned in place through `changedFiles`, reports no TDO finding either way; see the copy case fail

## Phase 2: Implementation

- [x] T004 FR-001, FR-002: `cli/validators/todo-tracking.mjs` `maskCodeSpans`, `annotationOn`
- [x] T005 FR-003, FR-004: `commentLines` over `realComments` and `languageOf`, line scanner for the rest; `_scanTodoFile` reads through it
- [x] T006 FR-005: remove `SELF_PATH` and `isSelfPath`
- [x] T007 FR-007: TDO002 help in `cli/findings.mjs`; `npm run docs:reference`

## Phase 3: Docs and verification

- [x] T008 `CHANGELOG.md` [Unreleased] Fixed; `npm run llms`
- [x] T009 [P] TestGuard claim `TODO-QUOTED-FORMS` in `testguard.claims.json`, `source.ref` `req:docguard.todo-quoted-forms#FR-00n`; probe it with `--confirm 3 --serial`
- [x] T010 Re-accept the requirement-anchor links of every changed file that carries tags, file by file with a reason (`docguard anchors --state suspect`, `anchors accept --file … --bulk`)
- [x] T011 SC-002: A/B of `guard --format json` on a `git archive` export of the candidate: 0.44.3, the main CLI at the base commit, and the candidate
- [x] T012 SC-003: the same A/B, main CLI against the candidate, on other real repositories; inspect every TDO difference
- [x] T013 SC-001, SC-004: `npm test`; `npm run benchmark`; `docguard specs --write`; `docguard guard` PASS with no findings; `docguard specs --check`

## Verification

- **SC-001.** `tests/todo-tracking.test.mjs`: 12 spec 073 cases beside the spec 019 cases, which run unchanged (33 in the file).
  - Before the change, the eight quotation, string and install-location cases failed for the intended reason; the real-annotation and block-comment cases passed both before and after.
  - Full suite at 60a7697: 3,776 tests, 0 failures, 1 pre-existing skip.
- **SC-002.** `git archive` export of 60a7697, `guard --format json`:
  - main CLI at 4aefbee against the candidate: identical apart from the two TDO002 on the quoted forms in `cli/validators/todo-tracking.mjs` (lines 58 and 65 of the new file, 51 and 58 before);
  - the candidate from this worktree against the candidate run in place inside the export: identical (FR-005);
  - 0.44.3 against the candidate: the same two TDO002, plus differences already present between 0.44.3 and main: SPR001 (spec 070's FR-005 projection), MET001 ×2 (the validator count, 34 with `requirementAnchors`), and 24 ANC003 that come from the export having no Git (dot directories are not walked), which main reports too;
  - `docguard guard` in the worktree: PASS, no findings; `docguard anchors`: 137 reviewed, 563 baselined.
- **SC-003.** Other local repositories, each exported with `git archive` at its HEAD:
  - TODO-Tracking alone, per keyword-bearing source file through `changedFiles` (so the five-finding cap hides nothing), main against the candidate: 30 repositories, 90 files, 36 TDO messages, no difference;
  - full guard, a fresh export per CLI and nothing else running: 22 repositories with a `.docguard.json` (testguard, web-security-validator and 20 local projects), 1,160 findings, no difference.
  - A first, non-hermetic pass reported 7 PSR002 on one repository in the base run only. Cause: `gitIgnoredPaths()` returns null on a spawn error under load, and PSR002 then reports every unresolved pointer. Pre-existing and unrelated to this spec; the hermetic rerun is identical.
- **SC-004.** `npm run benchmark`: 17 cases, verdicts identical to main (both Go TODO cases PASS; `eval-python-unsupported` UNSUPPORTED by design in both). `tests/benchmark-runner.test.mjs` pins the TODO cases.
- **Budget.** `node tools/budget.mjs ab --base <main export> --head .`: PASS. A first run failed `guard-ms` on `python-layered-control` by 21 ms over budget; no file there contains a keyword, so no new code runs on it, and the rerun and seven interleaved runs show no difference.
- **T009.** TestGuard 0.15.0 `--confirm 3 --serial` at cf5f295: `TODO-QUOTED-FORMS` 9/9 faults killed; `TODO-BARE-FORM-PRECISION` and `FIELD-WARNING-PRECISION`, which mutate the same file, 6/6.
