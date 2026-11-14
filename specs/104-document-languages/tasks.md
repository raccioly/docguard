# Tasks: Documents in Any Language

**Spec**: `specs/104-document-languages/spec.md`
**Plan**: `specs/104-document-languages/plan.md`

Tests come first. Each reproduction must fail on the v0.48.0 tag before the change. Private repository names never appear in a tracked file, a commit or a pull request.

## Stage 0 - the parser fix and the compatibility test (its own pull request, first)

### Phase 1: Tests first

- [x] T001 `tests/document-languages-compat.test.mjs`: from a `git archive` copy of the v0.48.0 tag, load a configuration that carries `docs.language` and `docs.labelAliases`, with a document carrying `<!-- docguard:heading tech-stack -->`; guard runs with empty stderr and the findings of the same project without them (FR-001). If this fails, stop and report: the keys must ship first in a release that only accepts them.
- [x] T002 [US4] `tests/document-languages-sections.test.mjs`: a lone `<!-- docguard:section x n/a — reason -->` and a lone bare id marker produce no `nested-or-unclosed` issue and do not make `assertOwnedCodeSection` throw; `<!-- docguard:heading x -->` is never parsed as a section marker (FR-002).

### Phase 2: Implementation

- [x] T003 `cli/writers/sections.mjs`: an open marker without `id=` does not open a bounded block (FR-002).

## Stage 1 - structure

### Phase 1: Tests first

- [ ] T004 [US1] [US2] `tests/document-languages-structure.test.mjs`: with `docs.language: "pt-BR"`, each Portuguese heading of the D2 table satisfies its id for ARCHITECTURE, DATA-MODEL, SECURITY, TEST-SPEC and ENVIRONMENT (STR003, ENV001, ENV002); accents folded (`Visao geral`); a leading section number dropped; the same for `es` and `es-MX` (FR-005, FR-006).
- [ ] T005 [US3] Same file: the marker satisfies an id in any language, including with `docs.language: "de"`; the marker must be the next non-blank line under the heading and not inside a fence or a larger comment (FR-004).
- [ ] T006 [US1] Same file: `## Mapa de fontes para testes` makes Test-Spec examine its table (not `empty`); DCV005 reads `## Instalação`, `## Uso`, `## Licença`; the Score's section checks agree with STR003 (FR-008).
- [ ] T007 [US1] Same file: a heading the set does not list gives STR003 whose message names the accepted forms and the marker; adding the marker clears it (FR-010).
- [ ] T008 [US3] Same file: `docs.language: "de"`, no marker, German headings: no STR003, the document is reported with `language-not-supported` (the strict side is Stage 3); with markers or `docs.labelAliases` it is satisfied (FR-011).
- [ ] T009 [US4] `tests/document-languages-english-identity.test.mjs`: with no `docs.language`, STR003, ENV001, ENV002, DCV005, Test-Spec and the Score produce byte-identical results on the existing English fixtures; the legacy normalizer is used (FR-006).
- [ ] T010 Same file: STR009 for an unknown id, a duplicate id, a marker whose heading names another English label, and a misplaced marker; the marker wins on a conflict (FR-009).
- [ ] T011 [US5] `tests/document-languages-writers.test.mjs`: with `docs.language: "pt-BR"`, `generate --write` and `sync` on a Portuguese document place the generated block under `## Pilha tecnológica`, and when no host exists write the Portuguese alias heading plus its marker; no English heading is ever written; for `de` with no host the block is written without a heading and `language-not-supported` is reported (FR-008).
- [ ] T012 `tests/document-languages-registry.test.mjs`: the id list equals the authoring contract's N/A slugs; every alias belongs to exactly one id per language; the registry is closed, exact in both directions (FR-003).
- [ ] T013 `tests/config.test.mjs` additions: `docs.language` and `docs.labelAliases` load; `pt-PT` resolves to `pt`; an invalid tag is reported and treated as absent; the schema describes both (FR-007).

### Phase 3: Implementation

- [ ] T014 `cli/shared-labels.mjs` (registry, marker reader, resolver); `cli/authoring-contract.mjs` ids (FR-003, FR-004).
- [ ] T015 `cli/shared.mjs` normalizers and `docHasSection`/`findSectionHeading`; `cli/config.mjs`; `schemas/docguard-config.schema.json` (FR-005 to FR-007).
- [ ] T016 `structure.mjs`, `environment.mjs`, `score.mjs`, `test-spec.mjs`, `sync-tests.mjs`, `docs-coverage.mjs`, `writers/sections.mjs` `upsertSection`; STR009 in `findings.mjs` (FR-008 to FR-011).
- [ ] T017 Hermetic English A/B on DocGuard and eight other repositories (SC-004). Stage 2 does not start until it is clean.

## Stage 2 - changelog, decisions, lifecycle, Spec Kit

### Phase 1: Tests first

- [ ] T018 [US1] `tests/document-languages-changelog.test.mjs`: `## [Não lançado]`, `## [Sin publicar]`, a marker, and a `docs.labelAliases` entry satisfy CHG001; `fix --write` inserts `## [<first alias>]` plus the marker for `pt` and `es`, and `## [Unreleased]` with no `docs.language`; CHG002 and CHG003 unchanged (FR-012).
- [ ] T019 [US1] `tests/document-languages-decisions.test.mjs`: the status words of the D2 table and a front-matter `status:` normalize to the five ids for `pt` and `es`, extended by `docs.labelAliases` and never replaced by it; `Substituído por ADR-003` and `Substitui: ADR-002` build links (DEC002 to DEC005); terminal words skip records; DEC001's message lists the accepted words; English unchanged (FR-013).
- [ ] T020 [US1] `tests/document-languages-speckit.test.mjs`: a Portuguese and a Spanish `spec.md`, `plan.md`, `tasks.md` (`Fase 1`), and a bugfix spec produce no SPK003 to SPK005; `FR-` and `SC-` ids unchanged; the lifecycle label `Estado:` is read; no Spec Kit template is modified (FR-014, FR-015).
- [ ] T021 `tests/document-languages-requirements.test.mjs`: a translated template row (`O sistema DEVE [capacidade]`, `El sistema DEBE [capacidad]`) is a placeholder and not a requirement; a filled row is a requirement; English unchanged (FR-016).

### Phase 2: Implementation

- [ ] T022 `changelog.mjs`, `fix.mjs`, `writers/mechanical.mjs`, `score.mjs` (FR-012).
- [ ] T023 `decision-records.mjs`, `scanners/lifecycle-status.mjs`, `scanners/speckit.mjs`, `shared-requirement-ids.mjs` (FR-013 to FR-016).
- [ ] T024 Hermetic English A/B (SC-004).

## Stage 3 - metrics and strict

### Phase 1: Tests first

- [ ] T025 [US1] `tests/document-languages-metrics.test.mjs`: with `docs.language: "pt-BR"`, Portuguese prose gets sentence length and a skip entry (reason `language-not-supported`) for passive voice, Flesch, and, until T033 is recorded, negation, conditional, compound and pronouns; no skipped metric yields a number, a finding, or a count in passed or total; the Score excludes it from numerator and denominator (FR-017).
- [ ] T026 Same file: the Unicode tokenizer keeps `não` as one token for a non-English language; with no `docs.language` the tokenizer is unchanged and the English fixtures' numbers are identical; DQ006 is skipped for a script without word spacing (FR-018).
- [ ] T027 [US3] Same file: `docs.language: "de"` yields no passive, readability or negation number, each reported as skipped for `language-not-supported`.
- [ ] T028 [US6] `tests/document-languages-naming.test.mjs`: with `docs.language: "en"`, `X.pt-BR.md`, `i18n/pt-BR/X.md` and `locales/pt-BR/X.md` resolve labels with the `pt` set and skip text metrics; content in another language never changes the language; without `docs.language` nothing is inferred (FR-021).
- [ ] T029 [US3] `tests/document-languages-strict.test.mjs`: the `de` fixture in strict mode: the documents appear in `strict.couldNotRead` with `language-not-supported`, the fix and the language; the exit code equals the same project's exit code without them; the cause is not dropped by `addUnexaminedDocuments` and not labeled "ownership is not established"; validator-level and document-level routes both work; the text prints one line per validator (FR-019).
- [ ] T030 Same file: Docs-Diff, Metrics-Consistency and semantic claims report `language-not-supported` for a document in a language without rules, and are silent when `docs.language` is absent; an agent-instruction file gets no entry and no alias (FR-022, Decision 6).

### Phase 2: Implementation

- [ ] T031 `doc-quality.mjs` skip table, tokenizer, skip report; per-document language from naming in `cli/shared-labels.mjs` (FR-017, FR-018, FR-021).
- [ ] T032 `validator-coverage.mjs` (`EMPTY_CAUSES`), `enforcement.mjs` routing, `shared-guard-json.mjs`, `guard.mjs` text line, and the four validators of FR-022 (FR-019, FR-022).
- [ ] T033 Native review of the pt-BR and es word lists (owner: maintainer). It blocks enabling the closed-class metrics (negation, conditional, compound requirement, pronouns); until it is recorded those metrics are skipped for every language other than English (FR-017, Decision 4).
- [ ] T034 Hermetic English A/B (SC-004).

## Stage 4 - generators and explain

### Phase 1: Tests first

- [ ] T035 [US5] `tests/document-languages-generate.test.mjs`: `init` and `generate` write the marker under each generated required heading, in the first alias for `pt` and `es`, in English otherwise; the first guard run reports no label finding; no existing document is rewritten; `isUneditedScaffold` recognizes a localized unedited scaffold by id (FR-023).
- [ ] T036 `tests/explain.test.mjs` additions: `explain` for STR003, CHG001, DEC001, SPK003 and DCV005 states the id, the marker and the aliases; the reference page lists the closed id list and a test fails when they drift (FR-024).

### Phase 2: Implementation

- [ ] T037 `writers/doc-generators.mjs`, `scanners/memory-plan.mjs`, `scanners/as-built.mjs`, `shared-scaffold.mjs` (FR-023).
- [ ] T038 `explain.mjs`, `findings.mjs` help, the generated reference page, `docs/languages.md`, README and the two translated READMEs (FR-024).

## Stage 5 - measurement and closing

- [ ] T039 `tests/fixtures/languages/{pt-BR,es,de}/`: committed projects reproducing each row of the Problem table; a test runs each on the v0.48.0 `git archive` copy (red) and on the branch (green) (FR-025, SC-001 to SC-003).
- [ ] T040 Final hermetic A/B: DocGuard and eight other English repositories, findings, verdicts, exit codes and Guard JSON identical (FR-026, SC-004).
- [ ] T041 SC-006: each R1 row has a test that was red before the change, or an "unchanged by decision" entry with the reason.
- [ ] T042 `docs-canonical/` and `docs-implementation/` updates, `docguard specs --write`, the spec's move to `Implemented`; `npm test`, `node cli/docguard.mjs guard`, the benchmark comparison (SC-007).
- [ ] T043 `tests/document-languages-nfc.test.mjs` and `cli/shared-labels.mjs`: NFC heading comparison for all languages, a composed and a decomposed accent compare equal; enabled for English only after the English A/B (T040) shows no change in findings, verdicts, exit codes and Guard JSON (FR-020, Decision 9).
