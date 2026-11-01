# Feature Specification: Counts, Untouched Claims, Diff Overlap and Router Auth Say Only What They Can Prove

**Feature Branch**: `claude/regular-issue-pr-review-4c9b53`

**Created**: 2026-10-31

**Status**: Draft

**Spec ID**: `docguard.consumer-report-precision`

**Lineage**: Corrects five defects reported against 0.45.1 from a consumer project (issues 593, 594, 596, 597, 598) and one found by the Jules bug-hunt routine (PR 595). It also fixes the Jules test-gaps PR 599, whose new tests failed on every CI runner.
- It narrows the count patterns of `docguard.spec-kit-artifact-coverage` (FR-004 to FR-006) and the suite-claim binding of `docguard.dogfood-findings` (FR-006).
- It applies the "silent when unknowable" rule of `docguard.calibrated-finding-channels` (FR-021) and `docguard.spk010-directory-claims` to files git cannot see.
- It keeps the two-signal rule of the diff-overlap validator (v0.31.0) and the whole-token reference matcher of `docguard.whole-token-sibling-matchers` (FR-004).
- It applies `docguard.js-route-shapes` FR-001 (a `use()` path covers that path) and FR-005 (a path the reader cannot resolve is recorded, never guessed) to auth middleware.

**Input**: Five open bug reports filed 2026-10-16 to 2026-10-27, each with a reproduction against the installed 0.45.1 package, and two open Jules pull requests.

1. MET001 reads `1,183 checks` as `183 checks`, and `docguard fix --write` would then rewrite a correct number (#593).
2. MET003 reads `FR365 tests`, a requirement identifier, as a suite of 365 tests (#594).
3. MET003 reads `400 cases across 20 test files` as a claim of 20 test cases (#596).
4. SPK010 says a checked task names a file "this feature never changed" when the file is a git-ignored diagnostic receipt, which git cannot observe (#597).
5. DSP001 pairs a test file named once in an inventory table with common words from unrelated prose elsewhere in the same document, and blocks `guard --fail-on-warning` (#598).
6. `use(API_PREFIX, requireAuth)` on a Koa or Hono router records nothing, and marks every later route as auth-protected, although the middleware covers only an unknown path (#595).
7. `tests/anchor-cache.test.mjs` asserts the cache is enabled, but the cache turns itself off when `CI` is set, which it is on every runner (#599).

## Problem

Each defect is DocGuard stating something it cannot prove.

- **A count read from the middle of a number.** The checks and validators patterns start a count at a word boundary. A comma is a boundary, so `1,183` yields `183`. The test-count pattern already reads separators; its lookbehind still accepts a letter, so `FR365` yields `365`, and `FR-365`, `#365` and `v3.65` behave the same way.
- **A file count compared with a case count.** `tests?\b` matches the `test` of `test files`. `20 test files` becomes a claim of 20 tests, compared with 400 declared cases.
- **Git's silence read as a fact.** SPK010 asks whether the feature's history touched a named file. An ignored, untracked file never appears in history or in `git status`, whatever happened to it. Its absence proves nothing, yet the finding is reported at high confidence.
- **Overlap read from the whole document.** DSP001 needs two signals: the doc references the changed file, and the doc's wording overlaps tokens removed from it. The second signal is computed over the whole document, so a reference in one section borrows words from every other section and from every other row of an inventory table.
- **An unknown scope widened to everything.** For `use(path, ...middleware)` with a path the reader cannot read, the reader treated the call as having no path, so auth middleware covered every later route. That over-claims protection, which is the direction a security check must never err in.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A count is read whole, and only when it is a count (Priority: P1)

**Independent Test**: The reproductions of #593, #594 and #596 on a throwaway project.

**Acceptance Scenarios**:

1. **Given** `DocGuard currently runs 1,183 checks.` and a guard total of 1183, **Then** there is no MET001 and no fix.
2. **Given** `DocGuard currently runs 1,100 checks.` and a total of 1183, **Then** MET001 quotes `1,100 checks`, and `docguard fix --write` writes `1,183 checks`. A ratio `8/1,100 checks` and an identifier `FR1100 checks` on another line are left alone.
3. **Given** 400 declared cases and `The unit suite guards FR365 tests for held handoffs.` (or `FR-365`, `#365`, `v3.65`), **Then** there is no MET003. `The unit suite contains 365 tests.` still warns.
4. **Given** 20 files of 20 cases and `The Vitest suite passes 400 cases across 20 test files.`, **Then** there is no MET003. `The test suite contains 20 tests.` and `The suite has 20 test cases.` still warn.

### User Story 2 - SPK010 speaks only about files git can see (Priority: P1)

**Independent Test**: The #597 reproduction: a `.wolf/` ignore rule, a checked task naming `.wolf/validate/run/report.json`, the receipt created after the commit.

**Acceptance Scenarios**:

1. **Given** tasks T001 (changed file), T002 (tracked, untouched file) and T003 (ignored receipt), **Then** only T002 is reported.
2. **Given** a tracked file force-added under an ignore rule and never changed, **Then** it is still reported.
3. **Given** a task naming an ignored directory, **Then** it is not reported.

### User Story 3 - DSP001 reads the overlap where the doc names the file (Priority: P1)

**Independent Test**: A test file whose old title held `only`, `child` and `exit`, and a TEST-SPEC that names it once.

**Acceptance Scenarios**:

1. **Given** the file named only in an inventory table, and `only`, `child` and `exit` in another section, **Then** there is no DSP001.
2. **Given** the file's inventory row, and those words in another row of the same table, **Then** there is no DSP001.
3. **Given** a field table in the file's own section whose rows hold those words, **Then** DSP001 is reported.
4. **Given** the file named in a sentence that still describes the removed behavior, **Then** DSP001 is reported.
5. **Given** a heading that names the file and the stale claim in its subsection, **Then** DSP001 is reported.
6. **Given** the reporting project's shape, a single long section of bold-label paragraphs around the inventory row, **Then** there is no DSP001. An inventory row that itself carries the removed words is still reported, and so is a prose reference whose next paragraph does.

### User Story 4 - Auth behind an unreadable path is recorded, not assumed (Priority: P1)

**Independent Test**: A Koa router with `router.use(API_PREFIX, requireAuth)` followed by a route.

**Acceptance Scenarios**:

1. **Given** that router, **Then** the route is not marked auth and `scan.unresolved` holds the `use()` line.
2. **Given** `router.use('/me', requireAuth)` or `router.use(requireAuth)`, **Then** the routes are marked as before and nothing is unresolved.
3. **Given** `router.use(LOGGER)` or `router.use(STATIC_PATH, serve('public'))`, **Then** nothing is recorded.

### Edge Cases

- A range such as `30-40 checks` is not a count; neither number is compared.
- `1,183,000 checks` is read whole. A malformed group such as `1,1833 checks` is not a count.
- When the doc writes the same number twice, once grouped and once not, the fix rewrites both and keeps each spelling.
- If git cannot answer the ignore question (spawn failure, unknown status), SPK010 stays silent for that feature, as it does when git is absent.
- A heading inside a fenced code block (`# run it` in a shell sample) does not end a section.
- A doc with no headings is one section, so a reference in it reads the whole document, as before. A table-row reference in it reads only its row.
- A bulleted inventory is read as prose: its other items stay in the context. The report's inventory is a table.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The MET001, MET002 and MET003 count patterns MUST read a number with thousands separators whole (`1,183` is 1183). A count MUST NOT start after a word character, a separator, a decimal point, `#`, `-` or `/`, so a ratio is still excluded. The finding MUST quote the number as the doc wrote it. The `replace-count` fix MUST match the same way, MUST rewrite either spelling of the stale number, and MUST keep the doc's digit grouping.
- **FR-002**: An identifier or version fragment (`FR365`, `FR-365`, `#365`, `v3.65`) MUST NOT be read as a test, check or validator count. A plain or separated count (`365 tests`, `1,733 tests`) MUST be read as before.
- **FR-003**: `N test files`, `test suites`, `test modules`, `test runs`, `test directories`, `test folders`, `test scripts`, `test fixtures`, `test helpers`, `test jobs` and `test packages` MUST NOT be compared with declared test cases. `N test cases` and `N tests` MUST still be.
- **FR-004**: SPK010 MUST NOT report a named path that git cannot observe: one that is ignored and untracked, or whose ignore status git cannot determine. A tracked path MUST still be reported when the feature never changed it, even if an ignore rule matches it. When git cannot answer the question, SPK010 MUST stay silent for that feature.
- **FR-005**: DSP001 MUST count the overlap only in the reference context of each line that references the file. A table row that references the file is a record, and its context is that row alone. A heading that references the file owns its section and subsections. Any other line reads the smallest heading-bounded section that holds it. The context excludes table rows that name another file, so an inventory row borrows nothing from its neighbors. A field table that names no file stays in the context. Headings inside code fences do not bound sections. Both signals are still required, and the message, confidence and cap are unchanged.
- **FR-006**: In the router reader (Koa, Hono, itty-router), `use(path, ...middleware)` whose path the reader cannot read, with auth middleware among the rest, MUST be recorded in `scan.unresolved` as `router-unresolved-path` and MUST NOT mark any route as auth. A `use()` with one argument, or whose middleware is not auth, MUST record nothing. Literal-path and path-less `use()` calls MUST behave as before.
- **FR-007**: Every finding the reports name as correct MUST still be reported: genuinely stale counts, the untouched tracked deliverable, and a claim beside the reference that names the removed behavior.
- **FR-008**: The finding help (`cli/findings.mjs`, `docs/reference/findings.md`), `docs/reference/languages.md` and `CHANGELOG.md` MUST describe the new behavior.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each of FR-001 to FR-006 has a test that fails on 0.45.1 and passes after, with a positive control for FR-007.
- **SC-002**: A guard A/B (0.45.1 against this change), on this repository and on every other local project, run from one fresh `git archive` copy per CLI, changes only findings that FR-001 to FR-006 explain. Every changed finding is reviewed by hand.
- **SC-003**: Because an archive copy has no history, SPK010 and DSP001 are also compared on `git clone --local` copies. On the reporting project at the reported commit, the #594, #596, #597 and #598 findings disappear and no other finding changes.
- **SC-004**: The anchor-cache tests pass with `CI=true` set, and every fixture git call goes through `tests/helpers/git.mjs` (`docguard.test-git-hermeticity` FR-001).

## Assumptions

- A thousands separator is a comma; a period-grouped number (`1.183`) is outside DocGuard's English-language count patterns.
- Leaving a file-count claim unchecked is the right outcome for #596. Checking it against the file inventory would need a scope rule for dated checkpoints that the report does not ask for.
- Dropping the auth mark under an unreadable path can surface a route as unprotected in the API-surface output. The route already sits behind an unresolved scope, which is now recorded, so the surface reports `partial`.

## Out of Scope

- A stopword list for DSP001. The #598 report rejects it as hiding one instance without fixing the document-wide association.
- A file-count metric (`N test files` against the inventory).
- The single-fingerprint baseline exception the #598 report proposes for the consumer project. Nothing in that project is changed.

## Verification Notes

Verified 2026-10-31 on the branch head.

- **SC-001**: `tests/consumer-report-precision.test.mjs` failed 17 of 27 cases on 0.45.1. Every control passed there, and every case passes here. In `tests/router-routes-unresolved.test.mjs`, the unreadable-path case and the non-auth case fail on the Jules version of #595.
- **Suite**: `npm test` reports 4,115 tests, 4,114 pass, 0 fail, 1 skipped. `guard` passes on this repository; its only warning is the README count this batch raised, which is now updated to 3,316. `npm run budget` passes all 21 metrics against main.
- **SC-002 and SC-003**: the A/B ran 0.45.1 against the branch, with one fresh `git clone --local` per project per CLI, serially. It covered the 44 local git repositories and the reporting project at `619ac675`.
  - 45 runs, 0 errors, 0 findings added. Findings went from 9,440 to 9,419, and every removal is a DSP001.
  - Reporting project at `619ac675`: the #598 finding (`walk-env-safety.test.js`; `only, child, exit`) is gone, and nothing else changed.
  - Project A: an end-to-end test file, with overlap `has, own, team, application, into` from the buglog and unit-tier sections.
  - Project B: a service test, with overlap `uses, match` from the framework section and an unrelated test entry.
  - Project C: two Component Map inventory rows, with overlap from other sections.
  - Project D: one component in two documents. The removed tokens were `console.error` strings, and the matches sat in neighboring rows and other sections.
  - Each removed finding was reviewed by hand, and each is the false-positive shape of #598.
- **What the A/B changed in the design.** The first pass dropped every table row in a section that did not name the file. That removed a DATA-MODEL finding in a fifth project whose words came from the field table under the file's own section. Only rows that name another file are dropped now, and that project is unchanged. The first pass also left the reporting project's finding in place: its TEST-SPEC is one long section, so section scope could not isolate the row. A table-row reference now reads only its row.
- **Not reproducible on the reporting project's history**: the #594 and #596 sentences were never committed to its TEST-SPEC; they appear only in an archived spec, which MET003 skips. The project also freezes findings in `.docguard.baseline.json`. The issue reproductions are the proof for FR-001 to FR-004.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `11b3e7aec70f6fc0f189b0b6fdcf9be6a6643542` — Reviewed at 0d92d59 (#600): MET001-003 thousands separators, identifier fragments and test-file nouns; SPK010 silent on paths git cannot observe; DSP001 overlap scoped to the referencing row or section; router auth use() under an unreadable path recorded, never widened. Suite 4,114/4,115 pass, 1 skip. A/B 45 runs: 0 added, 21 DSP001 removed, all hand-reviewed. Budget 21/21. Deviation: none. Evidence: `cli/scanners/speckit.mjs`, `cli/validators/diff-suspicion.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/TEST-SPEC.md`, `tests/anchor-cache.test.mjs`, `tests/consumer-report-precision.test.mjs`, `tests/router-routes-unresolved.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
