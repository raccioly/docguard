# Feature Specification: Documents in Any Language

**Feature Branch**: `spec/104-document-languages`

**Created**: 2026-11-13

**Status**: Active

**Spec ID**: `docguard.document-languages`

**Lineage**: Resolves issue 644 (item 6 of it, the README note, shipped in #647).
- It amends `docguard.authoring-contract` (spec 082): the registry of required sections gains a stable id per section, and STR003, STR007, the score and `fix` read labels through one resolver.
- It amends `docguard.doc-validator-fidelity` (spec 079): the heading matcher (`docHasSection`, `findSectionHeading`) and the Environment, Doc-Quality and scaffold rules it fixed.
- It amends `docguard.decision-records` (spec 086): the status vocabulary and the supersession link words (DEC001 to DEC006).
- It amends `docguard.generated-docs-consistency` (spec 044): `upsertSection` finds its host heading, and the generators write headings.
- It amends `docguard.upstream-coverage` (spec 085) and `docguard.spec-kit-artifact-coverage` (spec 016): the Spec Kit mandatory sections (SPK003 to SPK005) and the lifecycle `Status:` label.
- It extends `docguard.strict-by-default` (spec 097): a check that cannot judge a document because of its language reports `couldNotRead`, never a block and never a silent pass.
- It extends `docguard.configured-canonical-paths` (spec 093): `docs.roles` says where a document is; `docs.language` and `docs.labelAliases` say in which language its labels are written.
- It follows `docguard.file-kinds` (spec 100), which left translations out of scope: R3 below says what this spec does about them.

**Input**: Issue 644. A team that writes its documentation in Portuguese gets warnings it cannot clear, because every structural label DocGuard looks for is English. Reported on DocGuard 0.47.0 and re-measured here on the v0.48.0 tag (see Problem).

## Problem

A warning that cannot be cleared fails builds that run guard with warnings as failures, and an `empty` validator exits 4 under strict enforcement (the default since spec 097). The team cannot clear either without writing headings in a language it did not choose. The reporter's table, reproduced on a committed fixture project (Portuguese headings in two canonical documents, an ADR, a changelog, a README, and a spec with `spec.md`, `plan.md` and `tasks.md`):

| Input | Result on v0.48.0 |
|---|---|
| `## Visão geral do sistema` for `## System Overview` (also Tech Stack, Component Map, Test Categories, Coverage Rules) | STR003 per section |
| `## Mapa de fontes para testes` for the Source-to-Test Map | No STR003 (the section is not required), but Test-Spec goes from `pass` (control: the same project with the English `## Source-to-Test Map` and one real row) to `empty` with cause `needs-declaration`, and joins `strict.unexamined`, which makes a strict run exit **4** |
| `## Requisitos funcionais`, `## Feito quando` | SPK003 for `User Scenarios`, `Requirements`, `Success Criteria` |
| `## Resumo`, `## Contexto técnico`, `## Estrutura do projeto` in `plan.md` | SPK004 for `Summary`, `Technical Context`, `Project Structure` |
| `## Fase 1: Preparação` in `tasks.md` | SPK005 |
| `## [Não lançado]` | CHG001 (CHG002 passes: it only needs `## [`) |
| `**Status:** Aceito` and `Substituído por ADR-003` | DEC001 once per record; the link words `Substitui` and `Substituído por` are ignored without a finding |
| `## Instalação`, `## Uso`, `## Licença` in `README.md` | DCV005 three times (the check searches for the substrings `install`, `usage`, `license` anywhere in the file) |
| Portuguese prose scored by Doc-Quality | A number built on English word lists and a tokenizer that turns `não` into the tokens `n` and `o` |

`Feito quando` is the heading the reporter's team wrote for its success criteria; it is reproduced here as input, and it is not a built-in translation (the built-in forms are `Critérios de sucesso`, `Critérios de aceite` and `Critérios de aceitação`). The fixture clears it through the project's own `docs.labelAliases`.

What already works: `FR-001` and `SC-001` ids inside Portuguese sentences, and accented text in headings that nothing looks for. A link to an accented heading anchor (`#visão-geral-do-sistema`) did not produce a false Cross-Reference finding, while a control link to a missing anchor in the same README did (XRF002), so the check ran. Both sides of the comparison use the same ASCII-only slug; that slug can map different accented words to the same anchor, which this spec does not address.

### R1. Inventory: every place the CLI matches an English label or English words

Consequence key: **FALSE** a finding on a correct non-English document; **BLOCK** a result that makes a strict run exit 4; **MISS** a check that silently finds nothing on non-English text; **NUM** a number that means nothing; **WRITE** DocGuard writes English into a non-English document. "Measured" means reproduced on the fixture; the other rows are read from the code and are reproduced by the Stage tests (SC-006).

| File:line | What is matched | Validator and finding | Consequence |
|---|---|---|---|
| `cli/authoring-contract.mjs:19-48` | The registry of required and recommended headings (System Overview, Component Map, Tech Stack, Entities, Authentication, Secrets Management, Test Categories, Coverage Rules, Environment Variables, Setup Steps, and the recommended ones) | Doc-Sections STR003 | FALSE, measured |
| `cli/validators/structure.mjs:214-251` | `docHasSection(content, '## <English>')` per required section; the N/A slug is the English heading's slug | Doc-Sections STR003 | FALSE, measured |
| `cli/validators/structure.mjs:296-309` | The same matcher for a profile's `requiredSections` | Doc-Sections STR007 | FALSE |
| `cli/shared-scaffold.mjs:100-115` | `isUneditedScaffold` compares heading text with the English template | Doc-Sections STR006 | MISS: a translated, still-empty scaffold is not recognized |
| `cli/shared.mjs:121-134` | `SECTION_SYNONYMS`: English synonyms of 13 canonical headings | STR003, STR007, ENV001, ENV002, Score | FALSE |
| `cli/shared.mjs:138-147,157-169` | `normalizeHeadingText` keeps only `[a-z0-9]`; `WHOLE_HEADING_SYNONYMS`, `GENERIC_SUFFIXES` (`reference`, `variables`, `settings`, ...) | every `docHasSection` caller | FALSE: `Visão geral` becomes `vio geral`, so no alias could match; accents are dropped, not folded |
| `cli/validators/environment.mjs:141,155` | `## Setup Steps` or `## Prerequisites`; `## Environment Variables` | Environment ENV001, ENV002 | FALSE |
| `cli/commands/score.mjs:779,1090-1096` | Required sections, `## Layer Boundaries`, `## Component Map`, `## External Dependencies`, `## Revision History` | Score (Doc Quality dimension) | NUM |
| `cli/commands/score.mjs:1069-1070`, `cli/commands/fix.mjs:515` | `[Unreleased]` as a substring; `fix` then reports an empty changelog | Score, Fix | NUM, FALSE |
| `cli/commands/score-dora.mjs:200` | `must not never do not always` and a heading with `rules boundary guardrail` | Score (DORA AI stance) | NUM |
| `cli/validators/test-spec.mjs:98` | `(?:Service|Source)[- ]to[- ]Test Map` heading; the same in `cli/commands/sync-tests.mjs:96` | Test-Spec TSP001 to TSP007 | BLOCK, measured against an English control (`pass` with the English heading; `empty`, `needs-declaration` with the Portuguese one) |
| `cli/validators/docs-coverage.mjs:519-531` | `install`, `usage`, `license`, `licence` as substrings of the whole README | Docs-Coverage DCV005 | FALSE, measured |
| `cli/validators/changelog.mjs:71,78` | `[Unreleased]` and `[unreleased]` as a substring anywhere in the file | Changelog CHG001 | FALSE, measured |
| `cli/validators/decision-records.mjs:33-34,56-59` | `STATUS` (five words) and `SYNONYM` (`approved`, `draft`, `proposal`, `obsolete`, `replaced`) | Decision-Records DEC001 | FALSE, measured |
| `cli/validators/decision-records.mjs:36,156` | `TERMINAL_STATUS_RE` (`superseded`, `retired`, `archived`, ...) | Decision-Records (which records are skipped) | MISS |
| `cli/validators/decision-records.mjs:62-69` | `supersedes` and `superseded by` link words | DEC002 to DEC005 | MISS: no chain is built from `Substitui` or `Substituído por` |
| `cli/scanners/lifecycle-status.mjs:10-16` | The `Status` field label and `RETIRED_STATUSES` (English words) | Document-Lifecycle, Spec Kit | MISS: `Estado:` is not read |
| `cli/scanners/speckit.mjs:41-45,226,265` | `User Scenarios`, `Requirements`, `Success Criteria` as a substring of a `#`-`####` heading (`FR`/`SC` id prefixes are language-neutral) | Spec Kit SPK003 | FALSE, measured |
| `cli/scanners/speckit.mjs:47-51,292` | `Summary`, `Technical Context`, `Project Structure` | Spec Kit SPK004 | FALSE, measured |
| `cli/scanners/speckit.mjs:53-55,303-312` | `Phase\s+\d` | Spec Kit SPK005 | FALSE, measured |
| `cli/scanners/speckit.mjs:256-260` | `Root Cause` and `Fix` of a bugfix spec | Spec Kit SPK003 | FALSE |
| `cli/scanners/spec-registry.mjs:249` | The `Spec ID` field label (the neutral `docguard:spec-id` comment already exists as the language-neutral form) | Spec-Registry SPR002 | FALSE if the label is translated and no comment is present |
| `cli/shared-requirement-ids.mjs:53,57` | `must|shall|should|may|will|can` and the scaffold sentence shape that marks a template row | Traceability, Requirement-Anchors (placeholder rows) | FALSE: a translated template row (`O sistema DEVE [capacidade]`) counts as a real requirement |
| `cli/validators/doc-quality.mjs:261-267` | `tokenizeWords`: `[^a-z0-9\s'-]` | all Doc-Quality metrics | NUM, measured (`não` becomes `n`, `o`) |
| `cli/validators/doc-quality.mjs:279-296` | Passive voice: be-verb plus an English participle suffix | DQ001 | NUM |
| `cli/validators/doc-quality.mjs:301-317` | Ambiguous pronouns: `it this that they them ...` | DQ002 | NUM |
| `cli/validators/doc-quality.mjs:326-345` | Compound sentences: `and also`, `as well as`, `additionally`, and the word `and` | DQ003 | NUM |
| `cli/validators/doc-quality.mjs:59-95,225-260,352-382` | `TECH_VOCAB`, English syllable counting, Flesch Reading Ease and Flesch-Kincaid (English constants) | DQ004, DQ005 | NUM |
| `cli/validators/doc-quality.mjs:384-392` | Average sentence length (counts words; neutral once tokenization is Unicode-aware, except for scripts without word spacing) | DQ006 | NUM for Chinese, Japanese, Thai |
| `cli/validators/doc-quality.mjs:395-415` | Negation words (`not no never cannot don't ...`) | DQ007 | NUM |
| `cli/validators/doc-quality.mjs:417-437` | Conditional words (`if unless when ...`) | DQ008 | NUM |
| `cli/validators/docs-diff.mjs:49-59,186-243` | `Tech Stack` drift titles; `LIST_*` and `REMOVAL_*` patterns for "no X", "X was removed", lists joined by `or` | Docs-Diff DDF001, DDF002 | MISS |
| `cli/validators/docs-diff.mjs:252-255` | `CHANGE_RECORD_HEADINGS` (`changelog`, `revision history`, `release notes`) | Docs-Diff (which sections are skipped) | FALSE: a translated change-record section is read as a claim |
| `cli/validators/metrics-consistency.mjs:335-339,408,429` | `NUMBER_WORDS`, `DEP_QUALIFIED_RE` (`zero runtime dependencies`), `DEP_LABEL_RE`, `SOFTWARE_CONTEXT`, `COUNT_HEADER` | Metrics-Consistency MET003, MET004 | MISS |
| `cli/scanners/semantic-claims.mjs:36-51` | Units and nouns after a number (`seconds`, `tables`, `roles`), `ENUM_CONTEXT_RE` (`status state enum values`) | Evidence, semantic claims in `guard` | MISS |
| `cli/scanners/instruction-audit.mjs:52,73-74,333` | `must never always do not should`; polarity and conditional words | `verify`, instruction audit | MISS; out of scope by decision (Decision 6: agent-instruction files) |
| `cli/writers/mechanical.mjs:125-141` | Inserts an English `## [Unreleased]` | `fix --write` for CHG001 | WRITE |
| `cli/writers/sections.mjs:175-179` | `findSectionHeading(content, heading)` finds the host heading by English text; if it does not, `## <English heading>` is written above the generated block | `generate --write`, `sync` | WRITE: an English heading is added to a Portuguese document |
| `cli/writers/doc-generators.mjs:178,204,610,618,630,859` | English headings in generated documents and the changelog | `init`, `generate` | WRITE |
| `cli/scanners/memory-plan.mjs:521-604`, `cli/scanners/as-built.mjs:244-260`, `cli/scanners/speckit.mjs:647` | English heading names in plan tasks and as-built specs | `generate --plan`, `specs` | WRITE |
| `cli/writers/sections.mjs:25,60-90` | `OPEN_RE` treats any `docguard:section` comment alone on a line as an open marker | `inspectSections`, `assertOwnedCodeSection` | Latent defect, measured: an `n/a` marker or a bare id marker alone on a line yields `nested-or-unclosed`, and the bounded-write guard throws |

41 rows by owner: Doc-Quality 8, Doc-Sections 4, Spec Kit 4, Score 3 (the section checks, the changelog check, the DORA stance), Decision-Records 3, the shared matcher 2, Docs-Diff 2, and one each for Environment, Test-Spec, Docs-Coverage, Changelog, Document-Lifecycle, Spec-Registry, Traceability and Requirement-Anchors, Metrics-Consistency, semantic claims, instruction audit and the section parser; four rows are writers and generators (the changelog insert, the host heading, the generators, the plan and as-built headings).

Not matched by language and therefore unchanged: TODO tracking (`TODO`, `FIXME` are tokens), Security (secret patterns), Freshness (git history and `docguard:` markers), Agent-Readability (structure, not words), requirement ids (`FR-`, `SC-`, `NFR-`), Cross-Reference anchors (same slug on both sides).

### R2. Mechanisms that could carry the fix

- **`docguard:section`.** It is not a usable anchor. Its parser (`cli/writers/sections.mjs:25`, `inspectSections`) reads any `docguard:section` comment alone on a line as the open marker of a bounded `id=... source=code` block, and `\b` after `section` also admits `docguard:section-id`. Measured on the v0.48.0 tag: a bare `docguard:section tech-stack` comment and the existing `docguard:section authentication n/a` comment (the N/A marker) each yield `nested-or-unclosed` when a bounded block follows, and `assertOwnedCodeSection` then throws, so a bounded write to that document is refused. A new marker name that does not start with `section` is therefore required, and the existing defect is fixed in Stage 0.
- **The N/A slug is already an id.** The `n/a` form of the section marker (`docguard:section authentication n/a`, with a reason) names a section by the slug of its English heading (`structure.mjs:229-232`). The N/A marker is already language-neutral; this spec makes the slug the id of the section and makes it declared, not derived.
- **A neutral form beside a labeled field exists.** `Spec ID:` may be given as a `docguard:spec-id` comment (`spec-registry.mjs:249`), and `docguard:quality`, `docguard:status`, `docguard:spec-type` and `docguard:last-reviewed` are language-neutral comments. The id marker follows that precedent.
- **`docs.roles` (spec 093)** says which file fills a role; it carries nothing about language and stays as it is. **`requiredFiles`** names files, not labels. `requiredSections` (profile or config) names English headings; it gains the same resolver.
- **Spec Kit.** `.specify/templates/` carries English templates and no locale mechanism (read from this repository's `.specify/templates/*.md`; no network access was used). So a team that writes `## Requisitos` is outside Spec Kit's template. DocGuard's SPK checks are DocGuard's own reading of Spec Kit's structure, so aliasing them does not conflict with Spec Kit.
- **Translated READMEs.** `README.pt-BR.md` and `README.es.md` are read by no validator today (the README checks open `README.md` by name; guard on this repository reports nothing for them).
- **Backwards compatibility of the new keys.** Measured on a `git archive` of the v0.48.0 tag: a `.docguard.json` with `docs.language` and `docs.labelAliases` (the final key names, Decisions 1 and 2), and a document carrying `<!-- docguard:heading tech-stack -->`, loads and runs `guard` with an empty stderr and exactly the findings of the same project without them; `generate --plan --write` also runs. The schema's top level has `additionalProperties: true`. The new keys can ship with the feature; no release that only accepts them is needed (unlike `enforcement` in spec 097). Task T001 pins this against the tag.

### R3. Translations (spec 100's out-of-scope line)

Spec 100 says "Translations (`README.pt-BR.md`) are not copies" and nothing more. A translation is the project's own document: `fileKind` answers `own`, it is not a mirror (mirrors compare identical content), and it needs no new kind. What it can need is a language and a relation to its source.

- **Language.** A canonical-folder translation (`docs-canonical/ARCHITECTURE.pt-BR.md`) is read by Doc-Quality, which walks that folder recursively (by code; not measured with a single file). Without a language it would be scored with the project's language lists. FR-021 gives a document its own language from explicit naming only: a `<name>.<lang>.md` file name or an `i18n/<lang>/` or `locales/<lang>/` folder segment.
- **Relation to the source** (a translation that has drifted from `README.md`) is a different feature (translation drift) and is out of scope here (Decision 7).

## Design

### D1. Language-neutral anchors (primary mechanism)

Every section DocGuard requires has a stable id, declared in the registry. A heading in any language satisfies the requirement when the line directly under it (the next non-blank line) is `<!-- docguard:heading <id> -->`.

```markdown
## Visão geral do sistema
<!-- docguard:heading system-overview -->

Texto.
```

**Why this spelling.**
- A bare `docguard:section <id>` comment collides with the bounded-block grammar (measured, R2).
- `{#id}` renders as literal text on GitHub (and is not CommonMark), which would put `{#system-overview}` into every heading a team reads; an HTML comment is invisible in GitHub, GitLab and every CommonMark renderer.
- A comment on the line under the heading, not at its end, keeps the heading text (and its anchor) as the author wrote it.
- `docguard:heading` is unused today and does not begin with `section`, so no existing parser reads it.

The ids are the N/A slugs that already exist (`system-overview`, `secrets-management`, ...), so there is one id namespace, and an N/A marker and a heading marker for the same section use the same word. The closed list is in the registry (Stage 1) and in the generated reference page; an unknown id is a finding (STR009), not a silent pass.

### D2. Built-in aliases for a few languages

`docs.language` in `.docguard.json`, next to `docs.roles`, is a BCP 47 tag. There is no top-level `docs.language` key (Decision 1). Absent means English only, which is today's behavior byte for byte. A tag is matched by its primary subtag (`pt-BR` and `pt-PT` use the `pt` set; `es-MX` uses `es`). Built-in sets in this release: `pt` and `es`. Any other valid tag is accepted and has no built-in set (D4).

Aliases map heading text to ids, the changelog marker to `unreleased`, and decision status words to the ids `proposed`, `accepted`, `rejected`, `deprecated` and `superseded`. English is always accepted, in every language, so mixed documents work. `docs.labelAliases` is flat and keyed by id (ids are global and unique); each value is a list of strings (`{ "requirements": ["Requisitos do sistema"], "accepted": ["Vigente"] }`, a team's own wording, not a built-in translation). The built-in sets are selected by `docs.language`; project aliases extend them and never replace them. A front-matter `status:` is read as it is today and its value goes through the same alias mechanism; there is no separate status marker (Decision 3). Structure is never detected from text: only configuration, a document's explicit name (FR-021) and the heading marker decide.

Alias matching folds case and accents (`Visao geral` matches `Visão geral`) and compares whole headings after dropping a leading section number, as today. The English path keeps its current normalization until the gated task of FR-006 (Decision 9).

The sets (reviewed by the maintainer, a native Portuguese speaker, on 2026-11-17; see Decision 11):

| Id | pt | es |
|---|---|---|
| `system-overview` | Visão geral do sistema, Visão geral, Panorama do sistema | Visión general del sistema, Descripción general del sistema, Visión general, Resumen del sistema |
| `component-map` | Mapa de componentes, Componentes | Mapa de componentes, Componentes |
| `tech-stack` | Stack tecnológica, Pilha tecnológica, Stack tecnológico, Stack de tecnologia, Tecnologias, Tecnologias utilizadas | Stack tecnológico, Pila tecnológica, Tecnologías, Tecnologías utilizadas |
| `layer-boundaries` | Limites entre camadas, Camadas, Fronteiras entre camadas | Límites entre capas, Capas |
| `data-flow` | Fluxo de dados | Flujo de datos |
| `external-dependencies` | Dependências externas | Dependencias externas |
| `revision-history` | Histórico de revisões, Histórico de alterações | Historial de revisiones, Historial de cambios |
| `entities` | Entidades, Modelo de dados | Entidades, Modelo de datos |
| `relationships`, `indexes` | Relacionamentos, Relações; Índices | Relaciones; Índices |
| `authentication` | Autenticação | Autenticación |
| `secrets-management` | Gerenciamento de segredos, Gestão de segredos, Gestão de credenciais | Gestión de secretos, Manejo de secretos |
| `authorization`, `security-boundaries` | Autorização; Limites de segurança, Fronteiras de segurança | Autorización; Límites de seguridad |
| `test-categories` | Categorias de teste, Categorias de testes, Tipos de teste, Tipos de testes | Categorías de pruebas, Tipos de pruebas |
| `coverage-rules` | Regras de cobertura | Reglas de cobertura |
| `test-commands` | Comandos de teste, Comandos de testes | Comandos de prueba, Comandos de pruebas |
| `source-to-test-map` | Mapa de código para testes, Mapa de fontes para testes, Mapa do código-fonte para testes | Mapa de código a pruebas, Mapa de código fuente a pruebas |
| `environment-variables` | Variáveis de ambiente | Variables de entorno |
| `setup-steps` | Passos de configuração, Instalação e configuração, Como configurar, Configuração | Pasos de configuración, Instalación y configuración, Configuración |
| `prerequisites` | Pré-requisitos | Requisitos previos, Prerrequisitos |
| `configuration-files` | Arquivos de configuração, Ficheiros de configuração | Archivos de configuración |
| README `installation`, `usage`, `license`, `contributing` | Instalação; Uso, Como usar, Utilização; Licença; Contribuindo, Como contribuir, Contribuição, Contribuições | Instalación; Uso, Cómo usar; Licencia; Contribuir, Cómo contribuir, Contribuciones |
| Spec: `user-scenarios` | Cenários de usuário, Histórias de usuário, Cenários e testes, Cenários de usuário e testes, Cenários de uso | Escenarios de usuario, Historias de usuario, Escenarios de uso, Escenarios de usuario y pruebas |
| Spec: `requirements` | Requisitos, Requisitos funcionais | Requisitos, Requisitos funcionales |
| Spec: `success-criteria` | Critérios de sucesso, Critérios de aceite, Critérios de aceitação | Criterios de éxito, Criterios de aceptación |
| Plan: `summary`, `technical-context`, `project-structure` | Resumo; Contexto técnico; Estrutura do projeto | Resumen; Contexto técnico; Estructura del proyecto |
| Tasks: `phase` (the word before a number) | Fase | Fase |
| Bugfix spec: `root-cause`, `fix` | Causa raiz; Correção, Solução | Causa raíz; Corrección, Solución |
| `unreleased` (changelog) | [Não lançado], [Não publicado] | [Sin publicar], [No publicado], [Por publicar] |
| `proposed` | proposto, proposta, rascunho, em análise | propuesto, propuesta, borrador |
| `accepted` | aceito, aceita, aprovado, aprovada | aceptado, aceptada, aprobado, aprobada |
| `rejected` | rejeitado, rejeitada, recusado, recusada | rechazado, rechazada |
| `deprecated` | obsoleto, descontinuado, depreciado, obsoleta, descontinuada | obsoleto, en desuso, deprecado, obsoleta |
| `superseded` | substituído, substituída, superado, superada | sustituido, sustituida, reemplazado, superado, reemplazada, superada |
| Supersession link words | Substitui; Substituído por, Substituída por | Sustituye, Reemplaza; Sustituido por, Reemplazado por, Sustituida por |
| Lifecycle `Status:` field label | Status, Situação, Estado | Estado |

The tables are a starting point. A label a team writes that is not listed is cleared by one marker or one `docs.labelAliases` entry, and the STR003 message names both.

### D3. Text metrics run only where their word lists exist

Doc-Quality's eight metrics fall into three groups.

| Metric | Depends on | Non-English behavior |
|---|---|---|
| Average sentence length (DQ006) | Word count only | Runs for any language that separates words with spaces, once tokenization is Unicode-aware (FR-018). Skipped for scripts without word spacing (Chinese, Japanese, Thai). |
| Negation (DQ007), conditional (DQ008), compound (DQ003), ambiguous pronouns (DQ002) | Closed-class word lists | Run for `pt` (`pt-BR`, `pt-PT`) and `es` (every `es-*`) with the lists a native speaker reviewed on 2026-11-17 (task T033, Decision 12), with the English thresholds; skipped for every other language. |
| Passive voice (DQ001), Flesch Reading Ease and Flesch-Kincaid (DQ004, DQ005) | English morphology, an English syllable counter, English constants | Skipped and reported as skipped, with the reason, for every language other than English. Adapted readability formulas and a passive-voice detector are out of scope (Decision 4). |

A skipped metric is reported as skipped with its reason, never as a number, and is left out of both the numerator and the denominator of the Doc-Quality and Score results, so a skip never lowers a score and never raises one.

**No content detection.** A document's language comes from configuration and from explicit naming only (FR-021), never from its text. Without `docs.language` nothing is skipped and Doc-Quality scores exactly as today (D6).

### D4. Strict mode: could not read, never a block, never a silent pass

A new empty cause, `language-not-supported`, joins `EMPTY_CAUSES` (`cli/validator-coverage.mjs:100`). `buildStrictReport` routes it to `strict.couldNotRead` at both levels: a validator that performed zero checks for this cause, and a document in `unexaminedDocuments`. Today `addUnexaminedDocuments` keeps only three causes and its non-blocking path says "ownership is not established"; both change, so the new cause is neither dropped nor mislabeled. It never changes the exit code. A validator or document in `couldNotRead` for this cause names the language and the fix: a marker, a `docs.labelAliases` entry, or a language with built-in support.

What each case does:

| Situation | Result |
|---|---|
| No `docs.language` | Today's behavior, no new field (D6). |
| `docs.language: pt-BR` (or `es`) and a required heading written with a built-in alias, a `docs.labelAliases` entry or a marker | Satisfied. |
| `docs.language: pt-BR`, a required section missing under every form | STR003 as today, and its message lists the accepted forms and the marker. The finding can be cleared by writing a marker. |
| `docs.language: de` (valid tag, no built-in set), a canonical document with no English label, no `docs.labelAliases` entry and no marker for a required section | No STR003. The document goes to `couldNotRead` with `language-not-supported` and the fix. It is not passed silently and does not block. |
| `docs.language: de`, the same document with markers for every required section | Satisfied. |
| `docs.language: de`, a metric whose lists exist only for English | Skipped and reported, as D3. |
| A validator whose rules read English prose (Docs-Diff, Metrics-Consistency, semantic claims) and a document in a language without rules | The validator lists the document in `unexaminedDocuments` with `language-not-supported`; the report prints one line per validator, not one per document. Agent-instruction files are out of scope (Decision 6). |

### D5. Spec Kit

The Spec Kit checks use the same registry. Mandatory spec sections (`user-scenarios`, `requirements`, `success-criteria`), plan sections (`summary`, `technical-context`, `project-structure`), the `Phase N` pattern in tasks, and the bugfix sections (`root-cause`, `fix`) resolve through aliases or the marker. `FR-`, `NFR-`, `REQ-` and `SC-` id prefixes are unchanged; they are language-neutral and are the contract between specs, tasks and tests. Spec Kit's own templates stay English and `specify` is untouched: DocGuard never rewrites a Spec Kit template. A project that wants localized headings writes them in its specs; DocGuard writes headings in the project's language only for documents it creates itself (D7).

### D6. Backward compatibility

No finding changes for a project without `docs.language` and without id markers. The legacy English normalization and matcher stay byte-identical on that path; the Unicode-aware, accent-folding normalizer is used when `docs.language` is set. A marker in a project without `docs.language` still satisfies its id (a marker is explicit and inert otherwise), and that is the only new behavior without `docs.language`. v0.48.0 loads the new keys and the marker without error (measured, R2).

### D7. Writers respect `docs.language`

`init` and `generate` write `<!-- docguard:heading <id> -->` under every generated required heading, so new projects are language-ready. When `docs.language` has a built-in set, the heading text is the first alias of the set; otherwise it is English. Existing documents are never rewritten by these commands, with three rules for the commands that write into an existing document:

- `generate --write` and `sync` (`upsertSection`) find the host heading through the resolver. If a host exists under any accepted form, the block goes under it. If none exists and the language has a built-in set, they write the first alias as the heading plus the id marker. They never write an English heading into a translated document. If the language has no built-in set and no host exists, they write the block without a heading and report `language-not-supported` for it.
- `fix --write` inserts the changelog section as `## [<first alias>]` plus the id marker, or `## [Unreleased]` when `docs.language` is absent or English.
- Unedited-scaffold detection compares headings by id.

Stage 1 delivers the `upsertSection` rule (so `generate --write` and `sync` respect `docs.language`), Stage 2 delivers the `fix --write` rule, and Stage 4 delivers the scaffold written by `init` and `generate`.

### D8. Measurement

A fixture project per language (`pt-BR`, `es`, and one unsupported language, `de`) reproducing the reporter's table; each runs on v0.48.0 (red) and on the branch (green). An A/B on DocGuard and eight other real repositories, English, shows no difference in findings, verdicts, exit code and Guard JSON (apart from fields documented as new and absent when `docs.language` is unset). Fresh `git archive` copy per CLI, no concurrent load.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Portuguese team clears every label warning (Priority: P1)

A team writes its documents in Brazilian Portuguese.

1. **Given** `docs.language: "pt-BR"` and `docs-canonical/ARCHITECTURE.md` with `## Visão geral do sistema`, `## Mapa de componentes` and `## Pilha tecnológica` (still accepted; the first alias is now `Stack tecnológica`), **When** guard runs, **Then** STR003 reports nothing for the file.
2. **Given** `## Mapa de fontes para testes` with a table in TEST-SPEC, **Then** Test-Spec examines the table and is not `empty`.
3. **Given** `## [Não lançado]` in the changelog and `**Status:** Aceito` in an ADR, **Then** neither CHG001 nor DEC001 is reported, and `Substituído por ADR-003` builds the supersession link.
4. **Given** a spec with `## Requisitos funcionais`, `## Critérios de sucesso` and `FR-001`, a plan with `## Resumo`, and tasks with `## Fase 1`, **Then** no SPK003, SPK004 or SPK005.
5. **Given** a heading written in words the set does not list (`## Panorama geral`), **Then** STR003 names the accepted forms and the marker, and adding `<!-- docguard:heading system-overview -->` under the heading clears it.
6. **Given** Portuguese prose of 50 or more words, **Then** Doc-Quality reports sentence length, negation, conditional, ambiguous pronouns and compound sentences (the reviewed word lists of T033 run for `pt`), and reports passive voice and both Flesch scores as skipped with the reason.

### User Story 2 - A Spanish team gets the same (Priority: P1)

1. **Given** `docs.language: "es"` and the Spanish forms in the table above, **Then** the scenarios of User Story 1 pass with Spanish labels.
2. **Given** `docs.language: "es-MX"`, **Then** the `es` set applies.

### User Story 3 - A team in an unsupported language is never blocked by labels and never passed silently (Priority: P1)

1. **Given** `docs.language: "de"`, no marker and German headings, **When** strict guard runs, **Then** no STR003 is reported, the document is listed in `strict.couldNotRead` with cause `language-not-supported` and the fix, and the exit code is not changed by it.
2. **Given** the same project with `<!-- docguard:heading <id> -->` under each required heading, **Then** STR003 is satisfied and `couldNotRead` no longer lists the document.
3. **Given** `docs.labelAliases` extending `requirements` with the team's German heading, **Then** SPK003 is satisfied.
4. **Given** German prose, **Then** Doc-Quality reports no passive voice, readability or negation number; it reports each metric as skipped for `language-not-supported`.
5. **Given** a German document whose spec uses `FR-001`, **Then** requirement tracing works as it does for English.

### User Story 4 - An English team sees no change (Priority: P1)

1. **Given** a project with no `docs.language` key, **When** it upgrades, **Then** every finding, verdict, count, exit code and score is the same as before, on DocGuard and on the A/B set.
2. **Given** an English project with a `<!-- docguard:heading system-overview -->` marker under `## System Overview`, **Then** nothing changes (the marker restates what the heading already says).
3. **Given** `docs.language: "en"`, **Then** the behavior is today's.

### User Story 5 - A new project starts language-ready (Priority: P2)

1. **Given** `docguard init` and `generate` in a project with `docs.language: "pt-BR"`, **Then** the generated headings are Portuguese, each followed by its id marker, and the first guard run reports no label finding.
2. **Given** the same commands without `docs.language`, **Then** the headings are English and carry the markers.
3. **Given** `generate --write` in a Portuguese document that holds `## Stack tecnológica` with its marker, **Then** the generated block goes under that heading; in a Portuguese document that lacks it, **Then** the Portuguese alias heading and its marker are written, never an English heading; and `fix --write` inserts `## [Não lançado]` with its marker.

### User Story 6 - Translations are not scored as the wrong language (Priority: P2)

1. **Given** `README.pt-BR.md` and `README.es.md` beside `README.md`, **Then** no validator reads them as `README.md` (unchanged).
2. **Given** `docs.language: "en"` and `docs-canonical/ARCHITECTURE.pt-BR.md` (or `docs/i18n/pt-BR/ARCHITECTURE.md`), **Then** its labels resolve with the `pt` set and its text metrics are skipped as for any language other than English; the project's other documents are unchanged.
3. **Given** the same files and no `docs.language`, **Then** nothing changes (no inference without the key).

## Edge Cases

- **Mixed-language document.** English labels are always accepted, so a Portuguese document with `## Tech Stack` passes. A document's language is never read from its text, so an English paragraph inside a Portuguese document is simply part of it.
- **A heading that matches an English label and carries a different id.** The marker wins: the heading satisfies the marker's id, and the label's own id stays unsatisfied unless another heading supplies it; STR009 reports the conflict as a warning so the author sees the intent was ambiguous.
- **Duplicate ids.** Two headings in one document carrying the same id: the first counts, STR009 names the second.
- **Unknown id** (`<!-- docguard:heading system-overveiw -->`): satisfies nothing, STR009 lists the valid ids.
- **Marker not directly under a heading** (inside a fence, after prose, inside a larger comment block): ignored, and reported by STR009 only when it names a valid id.
- **N/A marker and heading marker for the same id.** The heading marker satisfies the section; the N/A marker is redundant and changes nothing.
- **The marker in a project without `docs.language`.** It satisfies its id (a marker is explicit); everything else is unchanged.
- **`docs.language` that is not a BCP 47 tag** (`"portuguese"`): reported through the channel used for other invalid configuration values, with an example tag; the run continues as English only.
- **`pt`, `pt-BR`, `pt-PT`.** One `pt` set; regional spelling differences are added through `docs.labelAliases`.
- **Accents typed without diacritics** (`Visao geral`). Matches (accent folding), with no finding.
- **Right-to-left and non-Latin scripts.** Headings match by Unicode letter classes; metrics that need word spacing are skipped; a `docs.language: "ar"` team takes the unsupported-language path.
- **Translated README.** Not read as `README.md`; no new kind (R3).
- **`AGENTS.md` and other agent-instruction files.** Out of scope (Decision 6): no alias, no language skip and no `language-not-supported` entry applies to a file whose role is `agent-instruction` (spec 094); their rules stay as they are.
- **A document that is mostly tables and code.** Skipped by Doc-Quality for insufficient prose already; no language note is added for it.
- **Generated code-truth blocks** (`docguard:section id=... source=code`) are written by DocGuard and are not label-matched; they are unchanged.

## Requirements *(mandatory)*

### Functional Requirements

Stage 0 (compatibility and parser):

- **FR-001**: A `.docguard.json` carrying `docs.language` and `docs.labelAliases`, and a document carrying `<!-- docguard:heading <id> -->`, MUST load, run `guard` and `generate --plan --write` with the v0.48.0 CLI with no configuration error and the same findings as the same project without them. A test MUST pin this against the v0.48.0 tag from a `git archive` copy.
- **FR-002**: `inspectSections` MUST treat a `docguard:section` comment that has no `id=` attribute (an `n/a` marker, a bare id) as not opening a bounded block, so it produces no `nested-or-unclosed` issue and does not block `assertOwnedCodeSection`. `docguard:heading` MUST NOT match the section grammar.

Stage 1 (structure):

- **FR-003**: A label registry (`cli/shared-labels.mjs`, new) MUST own every id, its English label, and the aliases per primary subtag. The ids of the sections the authoring contract lists MUST equal the existing N/A slugs. The registry MUST be closed and rendered into the reference page. `authoring-contract.mjs` MUST carry an `id` per section.
- **FR-004**: A heading satisfies id `X` when the next non-blank line under it, outside a fence and outside any other comment block, is `<!-- docguard:heading X -->`. One function MUST read the marker and every consumer MUST call it.
- **FR-005**: A required section MUST be satisfied, in this order, by: a matching `docguard:heading` marker; the English label or an English synonym as today; an alias of the configured language; an alias from `docs.labelAliases`. English MUST always be accepted. A section marked `n/a` with a reason (spec 084) keeps its meaning.
- **FR-006**: With `docs.language` absent or `en`, label normalization MUST be the legacy normalization, so no finding changes. With another `docs.language`, normalization MUST fold case and diacritics (NFD, strip combining marks) and keep Unicode letters and digits (`\p{L}`, `\p{N}`), and drop a leading section number as today.
- **FR-007**: `docs.language` (a BCP 47 tag) and `docs.labelAliases` (flat, keyed by id, each value a list of strings; project aliases extend the built-in sets and never replace them) MUST be read by `cli/config.mjs` next to `docs.roles` and described in `schemas/docguard-config.schema.json`. There MUST be no top-level `language` key. A tag is resolved by its primary subtag. An invalid tag MUST be reported and treated as absent.
- **FR-008**: `docHasSection` and `findSectionHeading` MUST resolve through the registry. STR003, STR007, ENV001, ENV002, the Score's section checks, the Test-Spec map heading (`source-to-test-map` and the older `service-to-test-map`), and DCV005's README sections MUST call them. `upsertSection` (so `generate --write` and `sync`) MUST find its host heading through them; when none exists it MUST write the first alias of the `docs.language` set plus the id marker, never an English heading into a translated document, and for a language with no built-in set MUST write the block without a heading and report `language-not-supported` (D7).
- **FR-009**: A new finding, STR009 (the next free STR code at build time), MUST report an unknown id, a duplicate id in one document, a marker whose heading carries a different English label, and a misplaced marker that names a valid id. It is a warning and is registered in `findings.mjs` with help text.
- **FR-010**: STR003, STR007, SPK003 to SPK005 and DCV005 messages under a configured language MUST name the accepted heading forms and the marker.
- **FR-011**: With a `docs.language` that has no built-in set, a required heading with no English form, alias or marker MUST NOT yield STR003 for that document; the document MUST be reported through `language-not-supported` (FR-019).

Stage 2 (changelog, decisions, lifecycle, Spec Kit):

- **FR-012**: CHG001, the Score's changelog check and `fix` MUST accept the `unreleased` label by the resolution of FR-005 (a heading `## [<label>]`, an alias, or `<!-- docguard:heading unreleased -->` under the heading). `fix --write` MUST insert `## [<first alias of the docs.language set>]` plus the marker, or `## [Unreleased]` when `docs.language` is absent or English. CHG002 and CHG003 are unchanged.
- **FR-013**: Decision records MUST resolve a status word through the registry (ids `proposed`, `accepted`, `rejected`, `deprecated`, `superseded`): `normalizeStatus`, `TERMINAL_STATUS_RE`, the `Status` table-cell reading, a front-matter `status:` value, and the link words `supersedes` and `superseded by`. There is no separate status marker. The closed set of five meanings, the codes and their messages are unchanged; DEC001's message MUST list the accepted words of the language.
- **FR-014**: `parseLifecycleStatus` and `RETIRED_STATUSES` MUST accept the lifecycle label (`Status`, `Estado`, `Situação`) and the retired words of the language.
- **FR-015**: `speckit.mjs` MUST resolve `SPEC_MANDATORY_SECTIONS`, `PLAN_MANDATORY_SECTIONS`, the `Phase\s+\d` pattern and the bugfix sections through the registry. `FR-`, `NFR-`, `REQ-` and `SC-` ids, `Spec ID` (with the existing `docguard:spec-id` comment form) and the `docguard:spec-type` marker are unchanged. DocGuard MUST NOT modify a Spec Kit template.
- **FR-016**: `hasPlaceholderSlot` MUST recognize the scaffold sentence shape of the language (modal verbs `deve`, `devem`, `pode`, `deverá`; `debe`, `deben`, `puede`), so a translated template row is a placeholder and not a requirement.

Stage 3 (metrics and strict):

- **FR-017**: For every `docs.language` other than English, Doc-Quality MUST skip passive voice, Flesch Reading Ease and Flesch-Kincaid, and MUST skip negation, conditional, compound and ambiguous-pronoun metrics for every language except `pt` (`pt-BR`, `pt-PT`) and `es` (every `es-*`), for which those four run with the word lists a native speaker reviewed on 2026-11-17 (task T033, Decision 12) and the English thresholds. A skipped metric MUST be reported as skipped with a reason (`language-not-supported`), MUST NOT yield a number, and MUST be excluded from the passed and total counts, from the Score, and from DQ findings. Sentence length (DQ006) runs for any language whose script separates words with spaces.
- **FR-018**: With a non-English `docs.language`, `tokenizeWords` and the sentence splitter MUST be Unicode-aware (`\p{L}`, `\p{N}`). With no `docs.language` or `en` they MUST be unchanged. DQ006 MUST be skipped for a document whose script has no word spacing.
- **FR-019**: `language-not-supported` MUST be added to `EMPTY_CAUSES`. A validator that performed zero checks for it, and a document listed in `unexaminedDocuments` with it, MUST go to `strict.couldNotRead` with the language, the reason and the fix, MUST NOT change the exit code, and MUST NOT be reported as "ownership is not established". The guard text MUST print one line per validator.
- **FR-020**: Heading comparison MUST normalize to NFC for all languages, English included, as its own task gated on the English A/B showing no change in findings, verdicts, exit codes and Guard JSON (Decision 9). Until that task lands, English keeps the legacy path.
- **FR-021**: With `docs.language` set, a document's language MUST be inferred only from explicit naming: a `<name>.<lang>.md` file name, or an `i18n/<lang>/` or `locales/<lang>/` path segment, where `<lang>` is a BCP 47 tag. It overrides `docs.language` for that document, for labels and metrics. It MUST NOT be inferred from content, and there is no per-document marker. Without `docs.language`, nothing is inferred.
- **FR-022**: For the validators whose rules read English prose (Docs-Diff, Metrics-Consistency, semantic claims), a configured language that has no rules for them MUST be reported as `language-not-supported` for the documents they would have read, instead of passing silently. Agent-instruction files and the instruction audit are out of scope (Decision 6).

Stage 4 (generators and explain):

- **FR-023**: `init`, `generate` and `generate --plan` MUST write the id marker under each generated required heading, in the language's first alias when the language has a built-in set. They MUST NOT rewrite an existing document. `isUneditedScaffold` MUST compare headings by id.
- **FR-024**: `explain`, the findings help text, the authoring-contract reference page and the README note MUST state which labels are matched by id and which by alias, and list the closed id list. The README note added by #647 MUST be replaced by the final statement.

Stage 5 (measurement):

- **FR-025**: Fixtures for `pt-BR`, `es` and `de` MUST exist (committed projects), reproducing each row of the Problem table, each red on v0.48.0 and green on the branch.
- **FR-026**: The A/B of D8 MUST be run and its result recorded in the pull request.

## Success Criteria *(mandatory)*

- **SC-001**: On the `pt-BR` fixture the reporter's table yields no label finding, no `empty` Test-Spec, and a skip report for the metrics without lists.
- **SC-002**: On the `es` fixture the same holds with Spanish labels.
- **SC-003**: On the `de` fixture no label finding blocks, the documents appear in `strict.couldNotRead` with `language-not-supported`, no metric number is printed, and adding markers or `docs.labelAliases` removes the entries.
- **SC-004**: With the CLI at `origin/main` and at the branch on DocGuard and eight other English repositories, findings, verdicts, exit codes and Guard JSON are identical (new fields absent without `docs.language`).
- **SC-005**: The v0.48.0 compatibility test passes (FR-001).
- **SC-006**: Every row of the R1 table has a test that fails before the change, or a recorded "unchanged by decision" with the reason.
- **SC-007**: `npm test`, `node cli/docguard.mjs guard` on this repository and the benchmark comparison pass.

## Out of Scope

- Detecting a language from content, for structure or for skipping (Decision 5). Structure comes from configuration, explicit naming, markers and aliases only.
- Translating DocGuard's own messages, finding codes or CLI output.
- Translation drift, a translation lagging its source: a relation between two documents is a feature of its own, so it is a later spec (Decision 7).
- Agent-instruction files (`AGENTS.md` and the like): no aliases or language skips apply to them (Decision 6).
- A hint that suggests `docs.language` when it is unset and the text looks non-English: off, not in this spec (Decision 8).
- Adapted readability formulas and a passive-voice detector for any language other than English.
- A third built-in language set. German, French and others use `docs.labelAliases` and markers.
- Changing Spec Kit's templates or `specify`.
- Changing id prefixes (`FR-`, `SC-`, `NFR-`, `REQ-`) or `DEC` and `STR` codes.

## Decisions

Recorded 2026-11-13, from the maintainer's answers to the open questions of the first draft. They replace those questions.

1. **Key.** `docs.language` (BCP 47), next to `docs.roles`. There is no top-level `language` key.
2. **Aliases.** `docs.labelAliases`, flat, keyed by id (ids are global and unique); each value is a list of strings. Built-in alias sets for pt-BR and es are selected by `docs.language`; project aliases extend the built-ins and never replace them.
3. **Decision status.** A front-matter `status:` is accepted, and translated status words go through the same alias mechanism (ids `proposed`, `accepted`, `rejected`, `deprecated`, `superseded`). No separate marker.
4. **Metrics.** For any language other than English, passive voice and Flesch-style readability are skipped and reported as skipped with the reason. The closed-class lists (negation, conditional, compound requirement, pronouns) ship for `pt` and `es` only, after the native review of task T033 (Decision 12); every other language skips them too.
5. **Per-document language.** Inferred only from explicit naming, `<name>.<lang>.md` and an `i18n/<lang>/` or `locales/<lang>/` folder segment, and it overrides `docs.language` for that document. Never from content. This removes the first draft's stop-word detector and its `document-language-mismatch` reason, and the per-document marker.
6. **Agent-instruction files.** `AGENTS.md` and the like are out of scope; no aliases are applied.
7. **Translation drift.** A later spec (Out of scope).
8. **Hint without `docs.language`.** Off, not in this spec.
9. **Unicode normalization.** NFC for heading comparison, applied to all languages, but only after the English A/B shows no change; it is its own task with that gate (FR-020, T043).
10. **FR-002 parser fix.** Ships first as its own pull request (Stage 0), because it is a latent bug on its own.
11. **Label review, 2026-11-17.** The Portuguese and Spanish label sets were reviewed by the maintainer, a native Portuguese speaker, and approved as proposed. Changes: the first alias (the one `init` and `generate` write) of three Portuguese headings is now the form Brazilian teams write (`Tech Stack` is `Stack tecnológica`, not `Pilha tecnológica`; `Source-to-Test Map` is `Mapa de código para testes`, not `Mapa de fontes para testes`; `Security Boundaries` is `Limites de segurança`, not `Fronteiras de segurança`), and each old form stays accepted. Added accepted variants (29 Portuguese and 21 Spanish, plus the new Portuguese first alias `Limites de segurança`), and translations for `external-dependencies` and `revision-history`, which had none. A heading that ends in a Spec Kit requirement marker, `*(obrigatório)*`, `*(opcional)*`, `*(obligatorio)*`, `*(mandatory)*` or `*(optional)*`, with or without the emphasis, is matched without it (one trailing parenthetical of that closed list, accent and case folded); any other parenthetical stays part of the heading. The README examples `Feito quando` and `Em desenvolvimento` were the reporter's own wording, not built-in translations; the READMEs now show `Requisitos do sistema` as a team's own alias. T033 (the closed-class word lists for the text metrics) was not part of this review; Decision 12 records it.
12. **Word-list review, 2026-11-17 (T033).** The maintainer, a native Portuguese speaker, approved the negation, conditional, ambiguous-pronoun and compound-sentence word lists for `pt` (`pt-BR`, `pt-PT`) and `es` (every `es-*`) as proposed, with two decisions. (a) Portuguese "se" counts as a conditional only as the first word of a sentence or right after a comma, never after a hyphen (`configura-se`), because it is mostly the reflexive pronoun in technical text; this misses some mid-sentence conditionals, the safer side. (b) "desde que" is included as "provided that", though it also means "since". Left out: "sem" and "sin", "enquanto" and "mientras", the articles and clitics (o, a, os, as, lhe, lo, la, los, las, le, les), "el" without the accent and "sí" with it; "si" counts only without the accent and "él" only with it. Words are matched whole (Unicode letters, digits and combining marks bound a word, and a hyphen between letters belongs to the word, so "e-mail" and "não-funcional" never match "e" or "não"), ignoring case, with accents optional in the text and never invented ("é" is not "e"); two or more "e" (pt) or "y"/"e" (es) in a sentence make it non-atomic. The lists live in `cli/shared-prose-words.mjs`; English keeps its regexes unchanged. The thresholds are the English ones.

## Verification Notes

Recorded 2026-11-17, at the completion of T033 (the last open task).

- **FR-026** (the English A/B). Run hermetically with fresh clones, one run at a time, each project's own enforcement, `docs.language` unset, on origin/main's CLI (v0.49.0) against this branch's CLI. Seven projects were compared, one this repository at origin/main and six unrelated ones (a monorepo with a canonical documentation set, a content platform, an admin tool, a service, a portal and a small website), and in every one the findings, verdicts, exit codes and Guard JSON were identical once `timestamp`, `durationMs` and `detectorCalibration` were masked. The result is also in the pull request of T033. The earlier stages recorded theirs in their pull requests, and `tests/document-languages-english-identity*.test.mjs` pin the English path to goldens.
- **SC-005** (the v0.48.0 compatibility test). `tests/document-languages-compat.test.mjs` passes.
- **SC-007** (`npm test`, guard and the benchmark comparison). At the T033 commit: `npm test` passes (a file that timed out under load was re-run alone before it was called a failure), `node cli/docguard.mjs guard` exits 2 (warnings only, none of them new), `node benchmarks/run.mjs --baseline benchmarks/baseline.json` exits 0, and `npm run fuzz` exits 0 with the fuzz test at 3.2 s at reference speed (main: 3.1 s).

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `053ecd8c466840a3c00a1a733f5f17ee2c388a12` — T033 closes spec 104: the maintainer reviewed the pt and es word lists on 2026-11-17 and Doc-Quality now runs negation, conditional, pronoun and compound-sentence metrics for Portuguese and Spanish; every task is checked, the English A/B is identical, and the compatibility, identity and fixture tests pass. Evidence: `cli/authoring-contract.mjs`, `cli/config.mjs`, `cli/scanners/as-built.mjs`, `cli/scanners/lifecycle-status.mjs`, `cli/scanners/speckit.mjs`, `cli/shared-doc-language.mjs`, `cli/shared-labels.mjs`, `cli/shared-prose-words.mjs`, `cli/shared-requirement-ids.mjs`, `cli/shared-scaffold.mjs`, `cli/shared.mjs`, `cli/validators/changelog.mjs`, `cli/validators/decision-records.mjs`, `cli/validators/doc-quality.mjs`, `cli/validators/docs-coverage.mjs`, `cli/validators/environment.mjs`, `cli/validators/structure.mjs`, `cli/validators/test-spec.mjs`, `cli/writers/generate-io.mjs`, `cli/writers/mechanical.mjs`, `cli/writers/sections.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `tests/config.test.mjs`, `tests/document-languages-changelog.test.mjs`, `tests/document-languages-compat.test.mjs`, `tests/document-languages-decisions.test.mjs`, `tests/document-languages-english-identity-stage2.test.mjs`, `tests/document-languages-english-identity.test.mjs`, `tests/document-languages-explain.test.mjs`, `tests/document-languages-fixtures.test.mjs`, `tests/document-languages-generate.test.mjs`, `tests/document-languages-labels-review.test.mjs`, `tests/document-languages-metrics-wordlists.test.mjs`, `tests/document-languages-metrics.test.mjs`, `tests/document-languages-naming.test.mjs`, `tests/document-languages-nfc.test.mjs`, `tests/document-languages-r1-coverage.test.mjs`, `tests/document-languages-registry.test.mjs`, `tests/document-languages-requirements.test.mjs`, `tests/document-languages-sections.test.mjs`, `tests/document-languages-speckit.test.mjs`, `tests/document-languages-strict.test.mjs`, `tests/document-languages-structure.test.mjs`, `tests/document-languages-verification.test.mjs`, `tests/document-languages-writers.test.mjs`. Accepted deviations: none. Successor: none. Blobs: `cli/authoring-contract.mjs`=`331a1ce640838aa6187bd9dd63f03c51be652f26`, `cli/config.mjs`=`e4fc72a0c62dde6c35d28aaa97a4d339b680bda0`, `cli/scanners/as-built.mjs`=`767717ecad5a5d1e465374272a64ea2adb1d55a8`, `cli/scanners/lifecycle-status.mjs`=`3e8e50440f60b81c2276565b4841c22e4163309b`, `cli/scanners/speckit.mjs`=`504d3fac676a2f094b1d3534a4295a0f313746d1`, `cli/shared-doc-language.mjs`=`788201f455d4598ca465489487093ada54438917`, `cli/shared-labels.mjs`=`00c7919372ace780d9dac4096749f259d4a93476`, `cli/shared-prose-words.mjs`=`fa68aee8750ebce603c2237467c6d3c4840e19c7`, `cli/shared-requirement-ids.mjs`=`0dbefe20d673b43a72355dd23492ab35232fd29c`, `cli/shared-scaffold.mjs`=`2278e9365d39168166e3c17b0c8ffcfeef16585d`, `cli/shared.mjs`=`ea6f7878fac6a70c2bf5302a5313787be1a441b2`, `cli/validators/changelog.mjs`=`ec0ef74ca32cd74d342feb7c83e3c2cd0ddf3933`, `cli/validators/decision-records.mjs`=`f1b4f19a4821435cf4cea75b3ee12dd5f4bbefcb`, `cli/validators/doc-quality.mjs`=`e4af58b41ad57e64291ae1d1d944d7e1c3120836`, `cli/validators/docs-coverage.mjs`=`0d1415fe8586c7a3ef52c62abf487135b0f8b8c2`, `cli/validators/environment.mjs`=`c25622d2e5690e825fdf3b406e1653320589812e`, `cli/validators/structure.mjs`=`df64603664b5287fa1c8d047edc869a4e747b659`, `cli/validators/test-spec.mjs`=`78470f97a6b15b44194faf203d71ff37a9d971cd`, `cli/writers/generate-io.mjs`=`51675ec8fce7c05414e60bf48b05e6a9eabb3698`, `cli/writers/mechanical.mjs`=`f7bdba60560e5fb845845e1aa500ef5dd4e17574`, `cli/writers/sections.mjs`=`aac1cbd35bf7c2051f7272f6140eeed8974c124d`, `docs-canonical/ARCHITECTURE.md`=`0c419528c57e3b977b1161d5908b9541f224f150`, `docs-canonical/TEST-SPEC.md`=`aa6d58c51e3356b0ddc0c15f35844d1e5b3cc462`, `tests/config.test.mjs`=`b5e5895139a286b68b7f1b3cb422a8009bda0276`, `tests/document-languages-changelog.test.mjs`=`244fd6e3ec2b943b11ab0de70f5ebb8ace2579d3`, `tests/document-languages-compat.test.mjs`=`80529c8b0433bdcda2b6b502e3342b21eb611ae2`, `tests/document-languages-decisions.test.mjs`=`4058d39718af55ce2a989af00eaf8504d6a57c30`, `tests/document-languages-english-identity-stage2.test.mjs`=`70fd6a0ce891f1fd34d11ebd0d5db4f49c7898f3`, `tests/document-languages-english-identity.test.mjs`=`e8940b55bda77b30efc52eb869d4754ac3a2a957`, `tests/document-languages-explain.test.mjs`=`172ce00c8eebd66928e1dba49fdf4a395df50f91`, `tests/document-languages-fixtures.test.mjs`=`63d690ad536cfa3e35f16bfbc4410a9826798d97`, `tests/document-languages-generate.test.mjs`=`03090b991388b01f8eb38597cd877643e9aefdf1`, `tests/document-languages-labels-review.test.mjs`=`b1add06f4886e44e9ebdbbd67d4ebf995f3bc60e`, `tests/document-languages-metrics-wordlists.test.mjs`=`adaf6bc2ab17b9ec71c98b8ac2f2913f21c9b0ff`, `tests/document-languages-metrics.test.mjs`=`ea622577f361536fbbaee11f7a80dfc48c34ce82`, `tests/document-languages-naming.test.mjs`=`485210f980235256fbf462e9ea32cf623d1c4c57`, `tests/document-languages-nfc.test.mjs`=`04b1935400ffeb8e8e47794334e68304917756f2`, `tests/document-languages-r1-coverage.test.mjs`=`8ae8fdda3e84cb08745ce8e7fde556fd13d21d8d`, `tests/document-languages-registry.test.mjs`=`3e4084efb2609c0967180d3ccca6134b2ddc6d24`, `tests/document-languages-requirements.test.mjs`=`9de10e1e6cb9d0a91061f0e13e1d130601b52af9`, `tests/document-languages-sections.test.mjs`=`4b566ca45c95df5dd23dbc5844d915eb63e04608`, `tests/document-languages-speckit.test.mjs`=`2fca956271bf4a025d5aaad61c5faf44ad11f9f7`, `tests/document-languages-strict.test.mjs`=`cc82eb3918c46dd6118677e8737c3678c5effa2a`, `tests/document-languages-structure.test.mjs`=`14183d3f6f4a08d16f4d8443b072c0475930fbcf`, `tests/document-languages-verification.test.mjs`=`2800b4bb4b921cdc7ff196ca6169d94a04343309`, `tests/document-languages-writers.test.mjs`=`763aec0d3f61d3e824742a8760d0327cca1179b3`.
<!-- docguard:implementation-outcomes:end -->
