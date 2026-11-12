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
