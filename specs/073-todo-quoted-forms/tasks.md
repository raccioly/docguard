# Tasks: Quoted TODO Forms Are Not Annotations

**Spec**: `specs/073-todo-quoted-forms/spec.md`
**Plan**: `specs/073-todo-quoted-forms/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/todo-tracking.test.mjs`: US1 scenarios 1–6 (FR-001, FR-002), including a span whose content is the whole annotation text and an unmatched backtick; run them and see the quotation cases fail
- [x] T002 `tests/todo-tracking.test.mjs`: US2 scenarios 1–5 (FR-003, FR-004): JS string, URL and template; Python and Go strings beside real comments; a block comment's third line reported at its own number; a `.vue` file still scanned; see the string cases fail
- [x] T003 `tests/todo-tracking.test.mjs`: US3 (FR-005): the validator's own source, copied into a fixture project and scanned in place through `changedFiles`, reports no TDO finding either way; see the copy case fail

## Phase 2: Implementation

- [x] T004 FR-001, FR-002: `cli/validators/todo-tracking.mjs` `annotationOn` over `maskCodeSpans` from `cli/shared-html-comments.mjs` (spec 074's rule, exported with a `fill`)
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

Final run at 834002a, on main 9170060.

- **SC-001.** `tests/todo-tracking.test.mjs`: 12 spec 073 cases beside the spec 019 cases, which run unchanged.
  - Before the change, the eight quotation, string and install-location cases failed for the intended reason; the real-annotation and block-comment cases passed both before and after.
  - Full suite: 3,794 tests, 0 failures, 1 pre-existing skip. A run under a load average above 90 from other sessions timed out six spawn-heavy files; all 140 tests in them pass at normal load, and so does the full rerun.
- **SC-002.** `git archive` export of 834002a, `guard --format json`, a fresh copy per run:
  - main CLI at 9170060 against the candidate: identical apart from the two TDO002 on the quoted forms in `cli/validators/todo-tracking.mjs` (lines 59 and 66 of the new file, 51 and 58 at c9934dd);
  - the candidate from this worktree against the candidate run in place inside the export: identical (FR-005);
  - 0.44.3 against the candidate: the same two TDO002, plus what main already changes against 0.44.3: SPR001 (spec 070's FR-005 projection), MET001 ×2 (the validator count, 34 with `requirementAnchors`), TRC005 ×3 (spec 074's IDs, which 0.44.3's parser loses behind a quoted HTML comment opener), and ANC003 links in dot directories, which an export without Git does not walk;
  - `docguard guard` in the worktree: one DLC002 on this spec, the review signal every implemented, not yet verified spec carries until `specs complete`; `docguard anchors`: 157 reviewed, 548 baselined.
- **SC-003.** Other local repositories, each exported with `git archive` at its HEAD, main 9170060 against the candidate:
  - TODO-Tracking alone, per keyword-bearing source file through `changedFiles` (so the five-finding cap hides nothing): 30 repositories, 90 files, 36 TDO messages, no difference;
  - full guard, a fresh export per CLI and nothing else running: 22 repositories with a `.docguard.json` (testguard, web-security-validator and 20 local projects), 1,160 findings, no difference.
  - An earlier, non-hermetic pass reported 7 PSR002 on one repository in the base run only. Cause: `gitIgnoredPaths()` returns null when a spawn fails under load, and PSR002 then reports every unresolved pointer. Pre-existing and unrelated to this spec.
- **SC-004.** `npm run benchmark`: 17 cases, verdicts identical to main (both Go TODO cases PASS; `eval-python-unsupported` UNSUPPORTED by design in both). `tests/benchmark-runner.test.mjs` pins the TODO cases.
- **Budget.** `node tools/budget.mjs ab --base <main export> --head .`: PASS. A first run failed `guard-ms` on `python-layered-control` by 21 ms; no file there contains a keyword, so no new code runs on it, and the rerun and seven interleaved runs show no difference.
- **T009.** TestGuard 0.15.0 `--confirm 3 --serial` at 834002a: 23 of 23 faults killed across `TODO-QUOTED-FORMS` (10, two of them in the shared masker), spec 074's `QUOTED-COMMENT-OPENER-HIDES-NOTHING`, and `TODO-BARE-FORM-PRECISION` and `FIELD-WARNING-PRECISION`, which mutate the same files.
