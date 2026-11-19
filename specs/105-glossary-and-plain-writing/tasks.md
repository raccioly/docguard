# Tasks: Project Glossary and Plain Writing

**Spec**: `specs/105-glossary-and-plain-writing/spec.md`
**Plan**: `specs/105-glossary-and-plain-writing/plan.md`

Tests come first in each phase. Private repository names never appear in a tracked file, a commit or a pull request.

## Phase 1: Shared registration

- [x] T001 `cli/findings.mjs`: register GLS001, GLS002, GLS003 (warn), GLS004 (`defaultLevel: 'info'`), DQ009 (warn), DQ010 (`defaultLevel: 'info'`) with titles, help and suppress forms (FR-026).
- [x] T002 `cli/strict-additions.mjs` (`'0.50'`: `glossary`), `cli/config.mjs` (`_KNOWN_VALIDATORS`, `docs.glossary` validation), `schemas/docguard-config.schema.json` (`docs.glossary`, `validators.glossary`, `docQuality.sentenceLimit`, `docQuality.stepSentenceLimit`) (FR-001, FR-014).

## Phase 2: Glossary (tests first)

- [x] T003 [US2] `tests/glossary-parse.test.mjs`: header aliases (en, pt, es, any order), Avoid splitting, `-`/`—`/empty, backticks and emphasis stripped, fenced and commented tables ignored, free-form glossary is `found: false`, GLS002 cases (empty Use, duplicate Use, duplicate Avoid, over 500 rows), GLS003 cases (Use in one row and Avoid in another, one Avoid under two Use terms) (FR-002 to FR-007).
- [x] T004 [US1] `tests/glossary-match.test.mjs`: whole words with accents, hyphen joins, case rule (`PR` vs `pr`), plural `s`/`es`, phrases across spaces, longest-Use masking (`Spec Kit`), overlapping Avoid terms, every exempt region of FR-009 including required headings in English and in `pt` (FR-004, FR-009, FR-010).
- [x] T005 [US1] [US3] `tests/glossary-validator.test.mjs`: fixture project; GLS001 one per document and term with count and five lines; the per-line pragma, `glossary off` and `allow` markers; excluded files (CHANGELOG, specs/, AGENTS.md, ADR, the glossary); a document in another language listed with `language-not-supported`; GLS004 with no glossary and with a free-form one; contract fields (`performed` ≥ 1, `applies`, unique `note`); `docs.glossary` path and the lookup order (FR-001, FR-007, FR-008, FR-011 to FR-016).
- [x] T006 `cli/shared-glossary.mjs`: `glossaryPath`, `parseGlossary`, `termMatcher`, `checkableLines`, `glossaryDocuments`.
- [x] T007 `cli/validators/glossary.mjs` and its registration in `cli/commands/guard.mjs` (validator map, `liteValidatorsConfig`); `tests/strict-by-default.test.mjs` `MIGRATED` and `FIXTURES` entries.
- [x] T008 [US3] `tests/glossary-compat.test.mjs`: a no-glossary fixture with no `enforcement` key exits with the same code on the v0.49.0 tag (`git archive` copy) and on this tree; its findings differ only by GLS004 (FR-027).

## Phase 3: Creating the glossary (tests first)

- [x] T009 [US3] `tests/glossary-init.test.mjs`: `init --with glossary` writes the starter with header and proposals in a comment (pair counts, capitalized terms), never overwrites, writes `pt`/`es` headers for `docs.language`; guard on the result reports no GLS001; plain `init` writes it when none exists; `fix --doc glossary` (text and `--format json`) for a missing and an existing glossary, at a configured `docs.glossary` path (FR-017 to FR-019).
- [x] T010 `starterGlossary` in `cli/shared-glossary.mjs`; `cli/commands/init.mjs`; `cli/commands/fix.mjs`.

## Phase 4: Plain writing (tests first)

- [x] T011 [US4] `tests/doc-quality-plain-writing.test.mjs`: `proseSentences` line numbers (a sentence across two lines, list items, protected dots), words (inline code one word, link text), exempt line kinds; DQ009 one finding per document with five pairs and the count, limits from config and the `sentence-limit` marker, `off`, per-line pragma; `pt` counted, `ja` skipped with `language-not-supported` (FR-020 to FR-022, FR-024).
- [x] T012 [US5] Same file: `numberedSteps` lists of two or more, `1)` form, `Step 1:` label, bold first word, code or link first not judged; DQ010 closed list and the `ing` rule with its exceptions; `step-verbs off`; non-English skipped (FR-023, FR-024).
- [x] T013 [US4] Same file: DQ001 to DQ008 messages and DQ006 unchanged on the existing doc-quality fixtures (FR-021, FR-025).
- [x] T014 `cli/shared-sentences.mjs`; `cli/validators/doc-quality.mjs`.

## Phase 5: Gates, documents, proof

- [x] T015 `tools/fuzz.mjs`: `parseGlossary`, `checkableLines`, `proseSentences`, `numberedSteps`; `npm run fuzz` passes (FR-028).
- [x] T016 Documents: `docs/configuration.md`, `docs/languages.md`, README section, `npm run docs:reference`, `npm run llms` if a canonical document changed, CHANGELOG naming every new code; DocGuard's own `docs/GLOSSARY.md` with rows that produce no finding on `main` (FR-029).
- [x] T017 Proof: `npm test` by exit code; A/B with `tools/release-ab.mjs` on DocGuard and the benchmark corpus; hermetic A/B on local projects (notes folder only); `npm run budget`; record results and the non-English review table in Verification Notes (SC-001 to SC-004, FR-030).
- [x] T018 Close: `specs --write`, anchors accepted for files this change touched, issue 706 updated to point at this spec.
