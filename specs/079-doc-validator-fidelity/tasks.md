# Tasks: Document Validators Agree With Each Other and Do Not Score a Blank Template

**Status**: In progress.

**Spec**: `specs/079-doc-validator-fidelity/spec.md`
**Plan**: `specs/079-doc-validator-fidelity/plan.md`

## Phase 1 — Failing tests first (SC-001)

- [ ] T001 [US1] `tests/doc-validator-fidelity.test.mjs`: sentence-case, numbered, synonym and Prerequisites headings for ENV001/ENV002; absence still reported; ENV and STR003 agree on the same heading list (FR-001).
- [ ] T002 [US2] Same file: `expandBraces` units (groups, empty alternative, nested, unbalanced, no comma, cap) and fixtures for the six brace scenarios through `validateDocsDiff` and `diffTests` (FR-002).
- [ ] T003 [US3] Same file: the seven sentences of the report, `replaced…with`, the clause-break cases, Revision History/Changelog rows and the Tech Stack counter-case, one fixture each (FR-003 to FR-005).
- [ ] T004 [US4] Same file: `isUneditedScaffold` units (every shipped template is a scaffold of itself, one prose line edits it, comments/headings removed still a scaffold, owner/status filled still a scaffold, unknown document never) and fixtures for STR006, docQuality, Legible and Machine markers (FR-006 to FR-010).
- [ ] T004b [US5] Same file: `constructor` in three cases, every exception word, a reference-length document with `constructor` has finite metrics and the same DQ findings as with a three-syllable stand-in (FR-012).
- [ ] T005 Run the file against the base CLI; record which cases fail (expected: every case that expects a different result).

## Phase 2 — Implementation

- [ ] T006 [US1] `cli/validators/environment.mjs`: use `docHasSection` for ENV001/ENV002.
- [ ] T006b [US5] `cli/validators/doc-quality.mjs`: own-property lookup; export `countSyllables`.
- [ ] T007 [US2] `cli/validators/docs-diff.mjs`: `expandBraces`, wired into `extractDocumentedTests`.
- [ ] T008 [US3] `cli/validators/docs-diff.mjs`: prefix-based negation, list scope, removal verbs, `withoutChangeRecords`.
- [ ] T009 [US4] `cli/shared-scaffold.mjs`; STR006 in `cli/findings.mjs` and `cli/validators/structure.mjs`; `cli/commands/score.mjs` (`calcDocQualityScore`); `cli/scanners/agent-readability.mjs` (marker-presence).
- [ ] T010 `tests/generated-docs-e2e.test.mjs`: STR006 in `FILL_THE_TEMPLATE` only; assert the `generate` and `init-plan` flows report none (SC-003).
- [ ] T011 Check the other copies: `cli/commands/diff.mjs`, `cli/commands/sync-tests.mjs`, `cli/commands/fix.mjs`, `cli/commands/diagnose.mjs`, `cli/commands/generate.mjs` for their own heading, brace or negation logic; route them through the new helpers or record why not.

## Phase 3 — Docs and generated files (FR-011)

- [ ] T012 `cli/commands/explain.mjs`; help text in `cli/findings.mjs`; `npm run docs:reference`.
- [ ] T013 `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md` (Unreleased); `npm run llms`.
- [ ] T014 `docguard specs --write`; `docguard anchors accept` for touched files only, with a reason.

## Phase 4 — Proof (SC-002, SC-003)

- [ ] T015 `npm test`, `node cli/docguard.mjs guard`, `npm run budget -- --base <base-worktree>`, TestGuard gate and claim `find` strings for the edited files.
- [ ] T016 Hermetic A/B (base CLI vs new CLI, one fresh `git archive` per CLI, no concurrent load) on this repository and the local projects; record every changed finding and score here.
- [ ] T017 Hand-review at least 20 changed findings across every changed project; record false positives and their exclusion.
- [ ] T018 Fill the Implementation Outcomes block; PR body names `specs/079-doc-validator-fidelity`; `docguard specs require --since origin/main` passes.

## Evidence

Filled during Phase 4.
