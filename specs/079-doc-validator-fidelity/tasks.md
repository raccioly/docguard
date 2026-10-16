# Tasks: Document Validators Agree With Each Other and Do Not Score a Blank Template

**Status**: Complete (implementation outcomes are recorded after merge).

**Spec**: `specs/079-doc-validator-fidelity/spec.md`
**Plan**: `specs/079-doc-validator-fidelity/plan.md`

## Phase 1 — Failing tests first (SC-001)

- [x] T001 [US1] `tests/doc-validator-fidelity.test.mjs`: sentence-case, numbered, synonym and Prerequisites headings for ENV001/ENV002; absence still reported; ENV and STR003 agree on the same heading list (FR-001).
- [x] T002 [US2] Same file: `expandBraces` units (groups, empty alternative, nested, unbalanced, no comma, cap) and fixtures for the six brace scenarios through `validateDocsDiff` and `diffTests` (FR-002).
- [x] T003 [US3] Same file: the seven sentences of the report, `replaced…with`, the clause-break cases, Revision History/Changelog rows and the Tech Stack counter-case, one fixture each (FR-003 to FR-005).
- [x] T004 [US4] Same file: `isUneditedScaffold` units (every shipped template is a scaffold of itself, one prose line edits it, comments/headings removed still a scaffold, owner/status filled still a scaffold, unknown document never) and fixtures for STR006, docQuality, Legible and Machine markers (FR-006 to FR-010).
- [x] T004b [US5] Same file: `constructor` in three cases, every exception word, a reference-length document with `constructor` has finite metrics and the same DQ findings as with a three-syllable stand-in (FR-012).
- [x] T005 Run the file against the base CLI; record which cases fail (expected: every case that expects a different result).

## Phase 2 — Implementation

- [x] T006 [US1] `cli/validators/environment.mjs`: use `docHasSection` for ENV001/ENV002.
- [x] T006b [US5] `cli/validators/doc-quality.mjs`: own-property lookup; export `countSyllables`.
- [x] T007 [US2] `cli/validators/docs-diff.mjs`: `expandBraces`, wired into `extractDocumentedTests`.
- [x] T008 [US3] `cli/validators/docs-diff.mjs`: prefix-based negation, list scope, removal verbs, `withoutChangeRecords`.
- [x] T009 [US4] `cli/shared-scaffold.mjs`; STR006 in `cli/findings.mjs` and `cli/validators/structure.mjs`; `cli/commands/score.mjs` (`calcDocQualityScore`); `cli/scanners/agent-readability.mjs` (marker-presence).
- [x] T010 `tests/generated-docs-e2e.test.mjs`: STR006 in `FILL_THE_TEMPLATE` only; assert the `generate` and `init-plan` flows report none (SC-003).
- [x] T011 Check the other doc-side copies of this logic (the `diff`, `sync-tests`, `fix`, `diagnose` and `generate` commands) for their own heading, brace or negation logic. Only `diff` had one (its documented-test matcher), now routed through `documentedTestRegex`; the others read code, not documents.

## Phase 3 — Docs and generated files (FR-011)

- [x] T012 `cli/commands/explain.mjs`; help text in `cli/findings.mjs`; `npm run docs:reference`.
- [x] T013 `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md` (Unreleased); `npm run llms`.
- [x] T014 `docguard specs --write`; `docguard anchors accept` for touched files only, with a reason.

## Phase 4 — Proof (SC-002, SC-003)

- [x] T015 `npm test`, guard on this repository, `npm run budget -- --base <base-worktree>`, TestGuard gate and claim `find` strings for the edited files.
- [x] T016 Hermetic A/B (base CLI vs new CLI, one fresh `git archive` per CLI, no concurrent load) on this repository and the local projects; record every changed finding and score here.
- [x] T017 Hand-review at least 20 changed findings across every changed project; record false positives and their exclusion.
- [x] T018 Fill the Implementation Outcomes block; PR body names `specs/079-doc-validator-fidelity`; `docguard specs require --since origin/main` passes.

## Phase 5 — Independent review round (2026-10-15)

- [x] T019 An independent review of the full diff found 8 problems; each is fixed and pinned by a test in `tests/doc-validator-fidelity.test.mjs` (`review findings` block): (1) a `#` line in a code fence (or a heading in a comment) started a change-record skip that hid the rest of ARCHITECTURE.md — now fence- and comment-aware; (2) Machine markers ignored `docs.roles`, so a remapped scaffold counted as marked — `scaffoldTemplateName`; (3) list negation and removal verbs hid real drift (`No Docker, Express serves the API`, `Removed all Redis keys`, `replaced the Redis client library`, `No changes to PostgreSQL, Redis or Express`) — the list must hold on both sides of the technology, prepositions stop it, `and` is not a coordinator, and a removal verb negates only its object; (4) the list pattern backtracked exponentially (36 coordinators: 7 s) — disjoint separators, linear; (5) `no longer use the Terraform modules` was not negated — added; (6) `## Configuration Files` / `## Production environment` satisfied ENV002 (and STR003) — `environment` and `configuration` now count only as the whole heading; (7) `explain constructor` and `hooks --type constructor` crashed, and an MCP tool named `constructor` reached `Object` — every dictionary indexed by outside input is null-prototype; (8) `?` in a documented glob was a regex quantifier and `{alpha, beta}` with spaces was not extracted — both fixed. A reasoned section N/A marker now owns a document (no STR006, normal score) instead of leaving a permanent penalty.
- [x] T020 The first version of fix (6) applied the whole-heading rule to every one-word synonym; the A/B caught `## 2. Architecture Layers` no longer counting as Layer Boundaries on a real project (architecture score 75 → 50). Narrowed to the two generic words; the A/B below is clean.
- [x] T021 TestGuard claim `DOC-VALIDATOR-FIDELITY` extended to 20 faults (one per review fix) and the stale `ANCHOR-IMPORTERS-READ-ONLY/F7` anchor re-pointed after `STRICTDOC_SCOPE` became null-prototype.

## Evidence

- **SC-001.** `tests/doc-validator-fidelity.test.mjs` (64 tests) was written first. Against the base code, 27 of its first 47 cases failed: every case that expects a different result (8 ENV, 4 brace, 7 negation including the report's `no CDK, Terraform or Pulumi stacks`, `removed`, `migrated off`, `dropped`, `replaced by`, 8 scaffold, and the two #588 `constructor` cases failed once added); the cases that expect an unchanged result passed on both. A one-document project with a blank template scored docQuality **100%** on the base, as the report said.
- **Suite.** `npm test` on the final commit: 4,051 tests, 4,050 pass, 1 skipped, 0 fail (4,025 before the review round). `node cli/docguard.mjs guard` on this repository: the same single warning as `main` (SPK010, spec 070 tasks), nothing added.
- **Budget.** `npm run budget -- --base <main>`: every metric PASS (guard wall time 15.2 s → 16.4 s against a 17.5 s limit, no new error findings, dependencies unchanged, package +6.7 KB).
- **TestGuard.** Claim `DOC-VALIDATOR-FIDELITY` with 11 faults across the 8 edited source files: 11 of 11 killed (the first probe left F6, the generated-section exemption, alive because its fixture also added a table row; the fixture now adds only the marker). `gate --changed origin/main`: 12 covered, 0 uncovered. The 19 existing claim anchors in the edited files still match exactly once.
- **SC-002, per project.** Each CLI ran `guard --format json` and `score --format json` on its own `git archive` copy (or a copy without `.git`) of 44 local projects, one at a time with no other load. Totals: **2,602 findings on the base, 2,606 on the head (−4, +8)**; re-run after the review round on the final commit: 2,638 → 2,642 (the projects themselves moved on in between), the same 13 changes and nothing else. No other project changed in findings, status or score.

  | Project | Change | Review |
  |---|---|---|
  | connections-copilot | −1 DDF002 (5 documented brace paths "not found") | Every expansion exists on disk (`packages/domain/test/{brief-template,generator,classify}.test.ts` and the `packages/engine/test/files/*` group). False positive removed. |
  | markitdown-skill | −1 DDF001 (`Terraform` documented but not found) | The document says "No CDK, Terraform, Pulumi, SAM, or Serverless Framework artifacts are expected". The report's list case. |
  | agent-wallet-ui | −2 (DQ004, DQ005 on SECRETS-PROVIDER.md, Flesch `NaN`, grade `NaN`) | The word `constructor`: issue 588 reproduced on a real document. |
  | jabuti-site | +4 STR006, docQuality 80 → 27, score 82 → 71 | DATA-MODEL, SECURITY, TEST-SPEC and ENVIRONMENT differ from the shipped templates only by dates (diffed). True positives. |
  | video_editor | +4 STR006, docQuality 80 → 27, score 82 → 72 | Same, diffed. True positives. |
  | THIS-REPO and 37 others | none | |

  A first A/B on an earlier commit also showed `scales-of-prophecy` and `scales-of-prophecy-grid4` gaining one DDF002 each: the document names `src/**/*.test.{js,jsx}` and the absent `.jsx` alternative was reported. That was a defect in this change (a brace glob is one pattern, not a list); it is fixed (spec FR-002, scenario 7, `documentedTestRegex`), pinned by tests, and the A/B above is the re-run on the final commit.
- **Review of every changed finding.** All 5 removals and all 8 additions were read by hand (table above); 0 false positives. The 20-finding sample the spec asks for cannot be met: only 13 findings changed across the 44 projects, and all 13 were reviewed.
- **Deviations from the issues.** Issue 584 suggested a finding on a placeholder owner and on a status that still contains `|`. `generate --plan --write` leaves both in place (checked), and spec 044 SC-001 requires a clean guard after it, so they are evidence in the STR006 message and never a trigger. The report's likely cause (DQ sentence ratios over zero sentences) is not the path: the DQ validators emit findings only; the scores are the defect. After `init` then `generate --plan --write`, SECURITY.md stays the template because the plan has no code-derived section for it; STR006 names it there and the e2e test allows exactly that document.
