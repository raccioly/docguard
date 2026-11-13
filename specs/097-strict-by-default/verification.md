# Verification: Stage A proof (T016, T017)

**Spec**: [spec.md](spec.md) (`docguard.strict-by-default`)

**Measured**: 2026-11-12 on the tip of `spec/097-strict-by-default` (merge of PR 649) against the v0.47.0 tag.

This is the public summary. The repositories are described by kind only. The audit corpus is a holdout: nothing here tunes a rule.

## Corpus

| Label | Kind |
|---|---|
| R1 | A public Node CLI tool with a mutation-testing engine and no HTTP API |
| R2 | A Python HTTP service with a React front end |
| R3 | A TypeScript API on a serverless edge runtime, with a large test suite |
| R4 | A pnpm monorepo: mobile/web apps, a TypeScript service and shared packages |
| R5 | A Next.js application on AWS with a DynamoDB data layer |
| R6 | A large multi-tenant Next.js application with a Postgres data layer |
| R7 | A client-side React and Phaser game for iOS and web, with no HTTP routes |
| R8 | DocGuard itself, target checked out at the tip |

## Method

- Two CLIs from a fresh `git archive` each (v0.47.0 and the tip), the repository's `node_modules` linked.
- Each run used its own APFS clone of a pristine copy (tracked files with working-tree content, plus `.git`). The R8 target is a clone checked out at the tip rather than a `git archive`, because history validators read `.git`. `guard` has no `--no-cache` option, so isolation came from the fresh copy.
- Every comparison ran twice. Across 64 guard runs there was no run-to-run difference in exit code, findings or verdicts, so a difference in one run is a difference.
- Part 1 compared findings (validator, code, severity, effective severity, location, message), verdicts and exit codes. Part 2 added `"enforcement": "strict"` to each configuration (all eight already had one). Each reported validator then got one fix in a fresh copy, with a mutation check where the fix creates something that can drift.
- The originals were never run in or written to. Before and after, HEAD, status line count and stash count were recorded for each; see the notes at the end.

## Part 1: `standard` equals v0.47.0 (SC-003)

Exit code is 2 under both CLIs on all eight. Writing `"enforcement": "standard"` explicitly gives the same findings, verdicts and exit codes as the absent key, with `enforcement.source` `config` instead of `default`.

| Difference | Where | Attribution |
|---|---|---|
| FRS002 removed from a root pointer file | R1, R3, R4 | Spec 094 (the three files were opened: each only says to follow `AGENTS.md`) |
| New FRS002 on other agent-instruction files | R2, R3, R4, R5, R7 | Spec 094 |
| Cross-Reference `pass` to `empty` | R5 | FR-004: v0.47.0 reported 2 of 2 with no document linking another |
| **Generated-Staleness `empty` to `fail` (two GST001)** | R3 | **Not on FR-019's list.** Commit 49b53db makes the validator read the marker `<!-- docguard:status draft -->` that DocGuard's generators write. Two documents carry it with months-old dates, so the finding is literally true. Reproduction: a canonical document with that marker and an old `last-reviewed` date; v0.47.0 is silent, the tip reports GST001, under `standard` |
| **STR003 new (Doc-Sections `empty` to `fail`)** | R6 | **Not on FR-019's list and not from spec 097.** Spec 093 (merged to main after the v0.47.0 tag) resolves a configured canonical document in a subfolder. The finding is true: the required section is absent. Reproduction: `requiredFiles.canonical` naming a document in a subfolder that lacks a required section |

No other difference. R8 shows none. **The two bold rows are regressions by FR-019's wording**: they change findings under `standard` and need a decision (add to the allowed list, or revert the cause).

## Part 2: strict, unexamined validators (SC-001)

Exit code 4 on R1 to R7; R8 exits 2 with nothing unexamined (its own waivers cover the rest). 39 validators were reported unexamined (R1 4, R2 5, R3 6, R4 5, R5 6, R6 7, R7 6).

| Result | Count |
|---|---|
| Judged applicable | 32 |
| Judged not applicable | 5 |
| Judged unsure | 2 |
| Fix produced a real check (the mutation was caught where run) | 26 |
| Fix produced a check on a document generated from the same scan (passes by construction) | 3 |
| Fix applied, validator still unexamined | 3 |
| Fix could not be applied (no text, or the text cannot be followed honestly) | 7 |

**SC-001 is not met.** Its target is 100% judged applicable with a fix that works; here 7 of 39 are not judged applicable or unsure, and 13 of 39 have no real-check fix.

### Not applicable or unsure (by kind)

- **Generated-Staleness on R6, not applicable.** It reports "a draft document found" without naming it. The finder matched a published template whose front matter says final and whose body contains the words "Status: Draft / Approved": the draft pattern runs from front matter into body text. The fix text cannot be followed because no draft exists.
- **API-Surface on R7, not applicable.** A client-side game: the evidence is "React declared, route scan read no route". The fix makes it `inconclusive` with zero checks.
- **Metadata-Sync on R5, R6, R7, not applicable.** Private applications with placeholder versions that nobody installs. The fix produces a real check, with invented content (a version line in a README).
- **Metadata-Sync on R3 and R4, unsure.** R3 is an application at 1.0.0 that is not published to a package registry. In R4 the evidence names one workspace package's version while the root declares none.

### Fixes that could not be applied, or did not clear the validator

- **Docs-Sync on R2 and R3** (layout not read). `sourceRoot` cannot make it read Python files or a handlers folder; only moving product code would. On R2 the text says it reads an `app/api` location, yet source files under that location were not read.
- **Architecture and API-Surface on R2** (`inconclusive`, partial). Architecture checked 419 import edges and API-Surface compared 37 endpoints, yet both are listed as examined nothing, with cause and fix text null. The only way out is a waiver.
- **API-Surface on R3 and R4.** `docguard generate` creates the reference and 65 and 2 endpoints are compared, but some serverless routes cannot be read statically, so the verdict stays `inconclusive`.
- **Schema-Sync on R5.** The data layer is DynamoDB through the AWS SDK; the text asks for a Knex, Prisma or SQL model form, and writing one would be fake.
- **Spec-Registry on R7.** `empty` with no cause and no fix text, although the evidence says six specifications were compared (FR-005 defect).

### Defects in the fix texts and evidence (reproductions available)

1. Test-Spec says to add to a "Source-to-Test Map"; a document with the older "Service-to-Test Map" heading is not matched, and a new section appended after it is ignored.
2. Where the project keeps the document elsewhere (R6 has a test, an API and an environment document in a second directory), the text says to create the canonical one. The cause should be `layout-not-recognized`. Mapping the roles with `docs.roles` did not clear Test-Spec or API-Surface in the trial. The generated replacements are checked against the code they were generated from.
3. Requirement-Anchors tells the user to write `<Spec ID>#FR-001` without saying where a Spec ID comes from. A bare ID that several documents declare gives ANC007; R3 and R7 needed a qualified ID. On R3 the evidence counted template placeholder rows among the requirements.
4. Doc-Dependency and Requirement-Anchors use a configuration file (lint, test runner or ORM config) as the example "source code" in six of seven projects, and the `covers=` they print points at it.
5. The existing human section marker was the right place for `covers=` in three projects (the text suggests wrapping a heading that already carries a generated section).
6. Cross-Reference says to move documents under `docs-canonical/`; doing so breaks their relative links (two findings each in R4 and R5).
7. Security and Architecture are `skipped` with no `applies` evidence on R5 and R6: the profile turns them off. Under Stage B (FR-003) both apply and must be proved again.

## Part 3: failing findings under strict (SC-002)

No finding has effective severity `error` on any of the eight, in either run, so no code outside the 0.47.0 closed list fired. SC-002 cannot be measured at Stage A; it moves to T027. The exit code 4 comes only from FR-007.

## Part 4: totals

Verdicts are pass / fail / empty / inconclusive / skipped.

| | v0.47.0 exit | `standard` exit | `strict` exit | v0.47.0 | `standard` | `strict` | Unexamined |
|---|---|---|---|---|---|---|---|
| R1 | 2 | 2 | 4 | 17/4/15/1/0 | 17/4/15/1/0 | 17/4/4/0/12 | 4 |
| R2 | 2 | 2 | 4 | 14/5/16/2/0 | 13/6/16/2/0 | 13/6/3/2/13 | 5 |
| R3 | 2 | 2 | 4 | 8/11/17/1/0 | 8/12/16/1/0 | 8/12/5/1/11 | 6 |
| R4 | 2 | 2 | 4 | 16/5/15/1/0 | 16/5/15/1/0 | 16/5/4/1/11 | 5 |
| R5 | 2 | 2 | 4 | 9/11/15/0/2 | 8/11/16/0/2 | 8/11/6/0/12 | 6 |
| R6 | 2 | 2 | 4 | 8/9/15/3/2 | 8/10/14/3/2 | 8/10/4/3/12 | 7 |
| R7 | 2 | 2 | 4 | 13/5/16/1/2 | 12/6/16/1/2 | 12/6/5/1/13 | 6 |
| R8 | 2 | 2 | 2 | 26/3/7/0/1 | 26/3/7/0/1 | 26/3/0/0/8 | 0 |

## Decisions this leaves open

- Whether the two unlisted `standard` differences are accepted into FR-019 or reverted.
- Whether Architecture and API-Surface partial results (`inconclusive` with checks performed) belong in "applies here, examined nothing".
- The seven defects above go back to T012 before the default changes.

## Not verified

- Mutation checks were not run for Cross-Reference, Docs-Sync, the generated documents, or Requirement-Anchors on three projects; for those "real" rests on the check having performed.
- One public repository in the corpus showed a changed `git status` (one modified file to clean) between the before and after snapshots at the same HEAD. No write command was run in it by this proof; another session or the maintainer changed it. Every other original is unchanged in HEAD, status and stash count. Stash contents were only counted before the runs.
- `docguard-self` unexamined is 0 because its configuration already waives or disables the rest; that is T015's result, not this proof's.

---

# Second run (T018e): after the fixes from the first run

**Measured**: 2026-11-12 on `spec/097-strict-by-default` at the merge of PR 652, same corpus (R1 to R8), same method. Bases: the v0.47.0 tag, `main`, and the tip. The first run above stays as the record; numbers compare.

Added to the method: before and after the runs, HEAD, a hash of the full `git status --short`, a hash of `git stash list` and a hash of `git stash show -p` of every entry were recorded for the eight originals and the shared DocGuard checkout. All are identical before and after. 48 guard runs (`main` and tip under `standard`, tip under `strict`, twice each) showed no run-to-run difference. The three Requirement-Anchors mutation scripts first ran without their helper library; they were fixed and rerun, and the numbers below are from the rerun.

## Part 1: `standard` (SC-003)

Exit code 2 under v0.47.0, `main` and the tip on all eight.

| Difference tip vs `main` | Where | Attribution |
|---|---|---|
| GST001 on two documents carrying the generator's draft marker, Generated-Staleness `empty` to `fail` | R3 | The draft-marker fix; accepted by the amended FR-019 |
| Cross-Reference `pass` to `empty` | R5 | FR-004 |
| Spec-Registry `empty` to `pass` (six specifications now counted as performed checks) | R7 | **Verdict only, no finding or exit change; not on FR-019's list.** Recommend adding "verdicts that become `pass` because a validator now counts what it compared" |

Nothing else against `main`. Against the v0.47.0 tag, the first run's explained differences remain (spec 094 on Freshness, spec 093 on Doc-Sections); both are on `main`, so they no longer show against it. The R8 target changed with the new tip; against `main` it shows no finding difference.

**SC-003 is met**, with the one verdict-only change above to be added to FR-019.

## Part 2: strict

Exit code 4 on R1 to R7 and 2 on R8 (nothing blocking). **25 validators block** (R1 4, R2 2, R3 5, R4 3, R5 3, R6 5, R7 3) and **8 are "could not read"** (R2 3, R3 1, R4 1, R5 2, R6 1) and do not change the exit code.

### (a) What makes the run exit 4

| Result | Count |
|---|---|
| Judged applicable | 24 |
| Judged unsure | 1 |
| Judged not applicable | 0 |
| Fix produced a real check (mutation caught where run) | 20 |
| Fix is a document `docguard generate` drafted from the code it is compared with (a real fix under the amended SC-001) | 5 (R6 environment, docs-diff and API-surface; R3 and R4 API-surface, which then leave the list because some routes cannot be read) |
| Fix could not be applied | 0 |

Applying every blocking fix in one copy per repository gives exit 2 on all seven, with 0 blocking and no error-level finding. Fixes were applied as the text says: Requirement-Anchors with a Spec ID declared in the spec and a qualified tag; Test-Spec, API-Surface and Docs-Diff through `docs.roles` where the project already keeps the document (R6), otherwise `docguard generate`; Doc-Dependency with `covers=` added to the section marker the document already had.

- **Unsure (the one row that stops SC-001):** Metadata-Sync on R3, a worker application at 1.0.0 that is not marked private and not published. DocGuard cannot tell whether anyone installs it, and the fix writes a version line for a package nobody quotes.
- **R6 API-Surface through `docs.roles`:** the existing reference is a prose overview with no endpoint rows, so the validator stays blocking with a new, accurate text ("list every endpoint as `METHOD /path`"; 164 routes). The text's other branch (`docguard generate`) clears it but duplicates a document the project already has.
- **Docs-Diff on R6:** the text maps only the test document through `docs.roles`; the project's architecture document sits in a subfolder and is not offered.

### (b) "Could not read" (8)

| Kind | Item | Belongs? |
|---|---|---|
| R2 Python service | Docs-Sync: Python files under the API folders not read | Yes, a layout DocGuard does not read; the text lists what it reads and asks for no move |
| R2 | Architecture: 419 import edges followed, a runtime path mutation not resolved | Yes, partial |
| R2 | API-Surface: 37 endpoints compared, one serverless route unreadable | Yes, partial |
| R3 serverless API | Docs-Sync: handlers folder unread | Yes, layout |
| R4 monorepo | Cross-Reference: two documents outside `docs-canonical/` link each other | Yes, layout; the text says the documents stay and their links keep resolving |
| R5 Next.js on AWS | Schema-Sync: DynamoDB through the SDK | Yes, a limit of DocGuard; the text asks for no model file |
| R5 | Cross-Reference: same layout as R4 | Yes |
| R6 large Next.js | Requirement-Anchors: 37 "requirement-like IDs" (decision, open-item and task IDs) in a form the scanner does not read | **No: should not apply.** They are not requirements; the project declares none. It was skipped in the first run; the `requirementPattern` fix text would make DocGuard read decision IDs as requirements. Non-blocking, so SC-001 is not affected |

## Where the first run's 39 landed

| Kind | Validator | Now |
|---|---|---|
| R1 CLI | Metadata-Sync, Doc-Dependency, Requirement-Anchors, Surface-Sync | Still blocking (all four) |
| R2 Python service | Docs-Sync, Architecture, API-Surface | Could not read |
| R2 | Doc-Dependency, Requirement-Anchors | Still blocking |
| R3 serverless API | Docs-Sync | Could not read |
| R3 | Test-Spec, API-Surface, Metadata-Sync, Doc-Dependency, Requirement-Anchors | Still blocking |
| R4 monorepo | Cross-Reference | Could not read |
| R4 | Metadata-Sync | Not applicable (skipped: every versioned workspace package is private) |
| R4 | API-Surface, Doc-Dependency, Requirement-Anchors | Still blocking |
| R5 Next.js on AWS | Schema-Sync, Cross-Reference | Could not read |
| R5 | Metadata-Sync | Not applicable (private, unpublished) |
| R5 | Test-Spec, Doc-Dependency, Requirement-Anchors | Still blocking |
| R6 large Next.js | Metadata-Sync | Not applicable (private) |
| R6 | Generated-Staleness | Not applicable (skipped: no draft document exists) |
| R6 | Test-Spec, Environment, Docs-Diff, API-Surface, Doc-Dependency | Still blocking |
| R7 game | Metadata-Sync, API-Surface | Not applicable (private; UI framework with no route) |
| R7 | Spec-Registry | Gone (`pass`, 16 examined) |
| R7 | Test-Spec, Doc-Dependency, Requirement-Anchors | Still blocking |

Totals: 25 still blocking, 7 could not read, 7 not applicable or gone. New in the list: R6 Requirement-Anchors (could not read, judged should not apply).

## Checks on the fix texts

- **Never tells the project to move code or documents:** true for every blocking and could-not-read text (the one textual hit is "when package.json moves on").
- **Says where a required identifier or mapping comes from:** Requirement-Anchors says a Spec ID is declared in the spec (`**Spec ID**:` line or comment, `docguard specs --write`); API-Surface, Test-Spec and Docs-Diff name `docs.roles` with the existing file when one looks right.
- **Residual:** the Docs-Diff text omits the architecture mapping; the R3 Test-Spec text names only the newer map heading although the older is accepted; the Doc-Dependency example for R7 names a generated platform shell file.

## Mutation checks that were missing in the first run

All caught: Cross-Reference (a broken link where it reads, R7), Docs-Sync (a new service file, R5), generated Environment (an undocumented variable, R6), generated API reference (an undocumented route, R6), Requirement-Anchors on three projects (a change inside the tagged function). The first run's Cross-Reference and Docs-Sync fixes no longer exist; the checks ran on repositories where those validators already perform.

## Parts 3 and 4

No error-level finding on any repository, in the plain strict runs or the combined-fix runs: SC-002 still cannot be measured at Stage A (T027). Verdicts are pass / fail / empty / inconclusive / skipped.

| | v0.47.0 exit | `main` exit | tip `standard` exit | tip `strict` exit | v0.47.0 | tip `standard` | tip `strict` | Blocking | Could not read |
|---|---|---|---|---|---|---|---|---|---|
| R1 | 2 | 2 | 2 | 4 | 17/4/15/1/0 | 17/4/15/1/0 | 17/4/4/0/12 | 4 | 0 |
| R2 | 2 | 2 | 2 | 4 | 14/5/16/2/0 | 13/6/16/2/0 | 13/6/3/2/13 | 2 | 3 |
| R3 | 2 | 2 | 2 | 4 | 8/11/17/1/0 | 8/12/16/1/0 | 8/12/5/1/11 | 5 | 1 |
| R4 | 2 | 2 | 2 | 4 | 16/5/15/1/0 | 16/5/15/1/0 | 16/5/3/1/12 | 3 | 1 |
| R5 | 2 | 2 | 2 | 4 | 9/11/15/0/2 | 8/11/16/0/2 | 8/11/5/0/13 | 3 | 2 |
| R6 | 2 | 2 | 2 | 4 | 8/9/15/3/2 | 8/10/14/3/2 | 8/10/3/3/13 | 5 | 1 |
| R7 | 2 | 2 | 2 | 4 | 13/5/16/1/2 | 13/6/15/1/2 | 13/6/3/0/15 | 3 | 0 |
| R8 | 2 | 2 | 2 | 2 | 26/3/7/0/1 | 25/4/0/0/8 | 25/4/0/0/8 | 0 | 0 |

R8 exits 2 under `strict` with nothing blocking, nothing could-not-read and eight validators `skipped` with evidence; one is waived with a reason. In all eight, no validator that is `empty`, `inconclusive` or `blocked` is missing from both lists: nothing is unexamined and silent. Security and Architecture are still `skipped` by the profile on R5, R6 and R7 (Stage B, FR-003).

## Criteria

- **SC-003: met** (see Part 1).
- **SC-001: not met by the letter.** 24 of 25 blocking validators are judged applicable and all 25 have a fix that works, but one is unsure: Metadata-Sync on R3 (above). It would be met if that validator treated an unpublished, unmarked worker application as not applicable, or if the project's own declaration were accepted as the answer.

## Not verified

- One fix per copy was run once (48 baseline runs showed no instability).
- Mutation checks were not run for the five generated documents' Docs-Diff or for the Surface-Sync and Metadata-Sync fixes beyond the ones listed; Metadata-Sync and Surface-Sync were mutated in the first run.
- The public CLI repository was clean at the start of this run at the same HEAD; the modified file seen at the start of the first run was gone. Its reflog shows no HEAD movement after a fast-forward before the first run, and other sessions had the folder open. The change itself cannot be determined from git state.
- Stage B (FR-003: every validator runs regardless of profile) is not exercised by this run.

---

# Third run (T018f re-check)

**Measured**: 2026-11-12 on `spec/097-strict-by-default` at "spec(097): task T018f done". A targeted re-check of what T018f touched, one run per repository (no number differed from the second run in an untouched row). Before and after, the originals' HEAD, full-status hash, stash-list hash and every stash entry's content hash are identical.

## Metadata-Sync

| Kind | Second run | Now |
|---|---|---|
| R3 serverless API | Blocking, unsure | **Skipped**: "declares 1.0.0, and no document states a version in a form Metadata-Sync compares, so there is nothing that can drift" |
| R1 public CLI | Blocking | **Still blocking**, and the applicability is false (below) |
| R2 (no version), R4, R5, R6, R7 (private) | Skipped | Skipped |
| R8 DocGuard | Pass | Pass, 38 version references compared; its documents do state the version, so the check is real |

R1's evidence: the manifest version and "a document states a version (3.2.0)". That number is the minimum version of the pre-commit framework in a hook guide, not this package's version. The text says to make it match the manifest or remove it. Matching writes a false statement (the pass is real, the content is not); removing deletes a true sentence. Judgment: **not applicable**. Only R1 and R8 have documents that state a version.

## Requirement-Anchors

Blocking on R1, R2, R3, R4, R5, R7 with evidence "N FR/NFR/SC/REQ requirement ID(s) are declared", so the kinds counted are now named. Two residues: R3's count still includes the placeholder rows of a requirements template, and R7's list names one ID twice.

R6 (large Next.js) is still "could not read" with "37 requirement-like ID(s) in a form the scanner does not read (D-7, OI-001, T-7 …)". The fix did not take effect there: decision, open-item and task identifiers are still named and the validator still applies. The project declares no FR/NFR/SC/REQ identifier, so the right answer is skipped, as in the first run. Non-blocking.

## Docs-Diff and Test-Spec texts

Test-Spec now names both map headings in every repository where it blocks (R3, R5, R6, R7). Docs-Diff on R6 is unchanged: it maps only the test document; the architecture document sits in a subfolder under a name the offer did not recognize.

## Strict and standard, all eight

`standard` against `main`: exit 2 on all, findings identical (the two accepted draft-marker findings on R3 only); verdict-only changes as in the second run.

| | strict exit | Blocking | Could not read | Against run 2 |
|---|---|---|---|---|
| R1 | 4 | 4 | 0 | same |
| R2 | 4 | 2 | 3 | same |
| R3 | 4 | 4 | 1 | Metadata-Sync no longer blocks |
| R4 | 4 | 3 | 1 | same |
| R5 | 4 | 3 | 2 | same |
| R6 | 4 | 5 | 1 | same |
| R7 | 4 | 3 | 0 | same |
| R8 | 2 | 0 | 0 | same |

24 validators block; no error-level finding anywhere.

## Final SC-001 table

| Kind | Validator | Judgment | Fix leads to |
|---|---|---|---|
| R1 CLI | **Metadata-Sync** | **Not applicable** (false applies) | A false statement, or deleting a true one |
| R1 | Doc-Dependency, Requirement-Anchors, Surface-Sync | Applicable | Real check |
| R2 Python service | Doc-Dependency, Requirement-Anchors | Applicable | Real check |
| R3 serverless API | Test-Spec, Doc-Dependency, Requirement-Anchors | Applicable | Real check |
| R3 | API-Surface | Applicable | Generated document; then leaves the list (partial) |
| R4 monorepo | Doc-Dependency, Requirement-Anchors | Applicable | Real check |
| R4 | API-Surface | Applicable | Generated document; then leaves the list |
| R5 Next.js on AWS | Test-Spec, Doc-Dependency, Requirement-Anchors | Applicable | Real check |
| R6 large Next.js | Test-Spec, Doc-Dependency | Applicable | Real check |
| R6 | Environment, Docs-Diff, API-Surface | Applicable | Generated document, real afterwards (mutations caught) |
| R7 game | Test-Spec, Doc-Dependency, Requirement-Anchors | Applicable | Real check |

23 applicable, 1 not applicable, 0 unsure; 23 fixes lead to a good check and 1 does not.

- **SC-003: met.**
- **SC-001: not met, by one row**: Metadata-Sync on R1.

## Traceability (report only)

- **Where it applies.** All eight: each has a `docs-canonical/` directory, which is the first test. The branch that says "N document(s) define requirement IDs" counts documents (a root README or one spec suffices) and does not appear in these eight; once the validator performs, that evidence is replaced by "traced N document(s) and requirement(s)", where N adds documents and requirements.
- **What it examines.**

| Kind | Requirements discovered / applicable / traced | Outcome |
|---|---|---|
| R8 DocGuard | 1187 / 1104 / 1104 | Pass |
| R1 CLI | 25 / 25 / 25 | Pass |
| R2 | 178 / 178 / 0 | 178 TRC004 |
| R3 | 142 / 142 / 37 | 105 TRC004 (8 on template placeholder rows) |
| R4 | 127 / 8 / 2 (119 deferred as planned) | 6 TRC004 |
| R5 | 17 / 17 / 16 | 1 TRC004 |
| R7 | 1135 / 1135 / 963 | 1 finding; its total (969) differs from its performed count (1140) |
| R6 | 0 / 0 / 0 | **Pass with 2 checks**: two documents' links to code; none of its 91 canonical documents and no requirement |

- **Is the evidence true?** The applicability is defensible in all eight. The statement of what was examined is not: the "N document(s)" branch counts documents; "performed" adds documents and requirements, so 1140, 1109 and 2 say little; template placeholder rows count as requirements (R3); and on R6 a pass with no requirement reads as coverage the project does not have.

---

# Fourth run (T018g re-check)

**Measured**: 2026-11-12 on `spec/097-strict-by-default` at "merge: group A fixes from the third proof pass (PR 661); task T018g done". One run per repository; the numbers that differ from the third run are all in rows these fixes touch. The originals' HEAD, full-status hash, stash-list hash and every stash entry's content hash are identical before and after.

**Result: SC-001 is met. SC-003 is not met**, by one defect and one missing list entry (below).

## Metadata-Sync

R1 (public CLI) is now **skipped**: "declares a version, and no document states a version for this package in a form Metadata-Sync compares". The pre-commit framework's minimum version no longer counts, and the row no longer blocks. R2 to R7 are unchanged (skipped). R8 passes with 33 version references compared (real).

## Requirement-Anchors

- **R6 (large Next.js): skipped.** "The identifiers found are not requirements (15 decision, 1 open-item, 10 task, 3 other, 28 template identifiers …)".
- **Placeholder rows ignored:** R2 1, R3 7, R4 1, R7 4. Each ID is listed once.
- **Opened three ignored and three counted rows.**
  - Ignored correctly (R3 template): "System MUST [capability]", a row ending "Measured via [tool]", "[Measurable user outcome]".
  - Counted correctly (R3): two real requirements of a feature spec, plus one template default ("All endpoints require authentication | Validated by guard") with no slot, which is still counted and still draws one finding.
  - **Ignored wrongly: real requirements.** R2 loses one requirement and R7 loses four, whose text contains `{file}`, `{name}` or `{count}` (a URL or key template inside prose). R4's single ignored row fits the same pattern. The curly and angle slot rule is too wide.

## Traceability, all eight

| Kind | Applies | Requirements examined | TRC004 (third run) |
|---|---|---|---|
| R8 DocGuard | Yes | 1187, pass | 0 |
| R1 CLI | Yes | 25, pass | 0 |
| R2 | Yes | 177, fail | 177 (178): one real requirement lost its finding |
| R3 | Yes | 135, fail | 98 (105): seven template rows gone, correct |
| R4 | Yes | 126, fail | 6 (6) |
| R5 | Yes | 17, fail | 1 (1) |
| R6 | **No** ("a document alone has none"); was a pass on 2 checks | 0 | 0 |
| R7 | Yes | 1131, fail | 1 (1), plus **4 new TRC005** |

The four new TRC005 on R7 are the defect above made visible: tests cite four requirements of a feature spec, and those requirements are now treated as not existing, so each test is reported as an orphan reference, under `standard` too. The inconsistency the build session suspected (only task or decision IDs, findings while `applies()` says no) does not appear: R6 is skipped with no findings.

## Docs-Diff, Test-Spec, Environment, API-Surface on R6

The text now offers the architecture mapping, with candidates, and prints the snippet with a placeholder path. The candidates are three files in the architecture folder; **the project's real architecture document, in that same folder, is not among them** (apparently capped at three) and two of the three are wrong. Test-Spec names the existing testing document and both headings. Environment and API-Surface print the snippet.

## `standard` against `main`

Exit 2 on all eight. Findings equal except:

| Difference | Where | Status |
|---|---|---|
| Seven template-row TRC004 removed; two accepted draft-marker findings added | R3 | The removal is intended; **not on FR-019's list** |
| One real-requirement TRC004 removed | R2 | **Defect** |
| Four TRC005 added | R7 | **Defect** |

Verdict-only: Traceability `pass` to `empty` (R6, the FR-004 case), Spec-Registry `empty` to `pass` (R7), Cross-Reference `pass` to `empty` (R5).

## Strict, all eight

| | strict exit | Blocking (third run) | Could not read (third run) |
|---|---|---|---|
| R1 | 4 | 3 (4) | 0 |
| R2 | 4 | 2 | 3 |
| R3 | 4 | 4 | 1 |
| R4 | 4 | 3 | 1 |
| R5 | 4 | 3 | 2 |
| R6 | 4 | 5 | 0 (1) |
| R7 | 4 | 3 | 0 |
| R8 | 2 | 0 | 0 |

23 validators block; 7 could not read; no error-level finding.

## Final SC-001 table

All 23 are applicable and every fix leads to a good check.

| Kind | Validator | Fix leads to |
|---|---|---|
| R1 CLI | Doc-Dependency, Requirement-Anchors, Surface-Sync | Real check |
| R2 | Doc-Dependency, Requirement-Anchors | Real check |
| R3 | Test-Spec, Doc-Dependency, Requirement-Anchors | Real check |
| R3 | API-Surface | Generated document; then leaves the list (partial) |
| R4 | Doc-Dependency, Requirement-Anchors | Real check |
| R4 | API-Surface | Generated document; then leaves the list |
| R5 | Test-Spec, Doc-Dependency, Requirement-Anchors | Real check |
| R6 | Test-Spec, Doc-Dependency | Real check |
| R6 | Environment, Docs-Diff, API-Surface | Generated document, real afterwards |
| R7 | Test-Spec, Doc-Dependency, Requirement-Anchors | Real check |

## Criteria

- **SC-001: met.** 23 of 23 applicable with a working fix.
- **SC-003: not met.** Exit codes are equal, but the Traceability change moves findings under `standard` beyond FR-019's list:
  1. R2 and R7: the slot rule drops real requirements (one TRC004 lost, four false TRC005 added). Fix the rule so a `{name}` or `<region>` inside prose is not a template slot.
  2. R3: the removal of template-row findings is intended; add it to FR-019.
