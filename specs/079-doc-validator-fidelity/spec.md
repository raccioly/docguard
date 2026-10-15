# Feature Specification: Document Validators Agree With Each Other and Do Not Score a Blank Template

**Feature Branch**: `fix/validator-heading-brace-negation-scaffold`

**Created**: 2026-10-15

**Status**: Draft

**Spec ID**: `docguard.doc-validator-fidelity`

**Lineage**: Corrects five defects reported against 0.45.0 by one user (issues 584–588).
- It aligns ENV001 and ENV002 with the section matcher of `docguard.generated-docs-consistency` (spec 044, FR-003), which STR003 already uses.
- It extends the documented-test extractor of `docguard.dogfood-round-2` (FR-001) and the tech-stack negation reader of the same spec (FR-004, FR-007).
- It applies `docguard.generated-docs-consistency` (spec 044, FR-006: template placeholder text is not a claim) to the scores, and keeps that spec's SC-001 allow-lists intact.
- It reads comments with the shared reader of `docguard.quoted-comment-openers` (spec 074, FR-001), through the `visibleMarkdown` helper of `docguard.docs-sync-specific-evidence` (spec 078, FR-001).

**Input**: Five open bug reports, filed on 2026-10-14 and 2026-10-15, each with a repro on a clean repository.

1. ENV001 and ENV002 match `## Setup steps` and `## Environment variables` case-sensitively; STR003 accepts the same headings.
2. DDF002 reads `` `src/tests/{alpha,beta}.test.ts` `` as one literal path and reports three false findings.
3. DDF001 ignores a technology named in a negated sentence only when the negator sits directly next to it. `There are no CDK, Terraform or Pulumi stacks.` and `We removed Terraform in 1.0.` both report Terraform as documented but not found.
4. A document that is only the scaffold template, never edited, scores a passing docQuality, a passing ALCOA+ "Legible" line and a passing "Machine markers" line.
5. The readability validator reads the inherited `Object.prototype.constructor` as a syllable count, so prose that contains the word `constructor` yields `NaN` reading ease and grade, and DQ004 and DQ005 fire under `--fail-on-warning`.

## Problem

Each defect is a false statement DocGuard makes about a document. The first three are false alarms: they ask an author to change prose that is correct. The fourth is a false assurance: it reports a document with no content as readable.

- **Two matchers for one question.** "Does this document have a Setup Steps section?" is answered by STR003 through `docHasSection` (case-, whitespace-, section-number- and synonym-tolerant) and by ENV001 through a private case-sensitive regex. Sentence case is the house style of the large developer-documentation guides. The finding reads "missing section", so the natural reaction is to add a duplicate section.
- **A path pattern is not a path.** DDF002 extracts a documented test as a backticked token and compares it with the files on disk. A token that is a brace pattern matches nothing on disk, so the pattern is "documented but not found" and every file it names is "in code but not documented". The same extractor feeds `docguard diff`.
- **Negation reads one neighbor.** `mentionsCurrentTechnology` looks at the text between a technology and the previous technology. In `no CDK, Terraform or Pulumi stacks` the negator is two words and a comma away from Terraform, outside that slice. A removal verb (`removed`, `migrated off`) is not a negator at all, and a Revision History row such as `Removed the template's Terraform blocks` is harvested like a Tech Stack row, although a changelog describes past state by definition. The only way to clear the warning is to stop naming the technology.
- **A blank template reads as finished.** The structural score has no notion of an unedited document. `calcDocQualityScore` counts a required heading as present whether or not anything is under it. After `docguard init --skip-prompts` it reports docQuality 80% and "Legible — Doc quality score: 80% (readable)", and the marker check reports `6/6 canonical docs carry docguard markers` because `init` stamps `last-reviewed`. In a project whose configuration requires fewer documents, the missing ones leave the denominator and the same scaffold reaches 100%. The report names a likely cause, sentence ratios over zero sentences; that is not the path. The DQ validators produce findings only, and zero sentences produce none. The scores are the defect.

- **A dictionary read through the prototype.** `countSyllables` keeps its word exceptions in an object literal and tests `exceptions[word] !== undefined`. The word `constructor` is not an own key, but `exceptions.constructor` is the inherited `Object` function, which is returned as the syllable count. Summing it with numbers yields `NaN` for every document that contains the word, and `NaN` fails every threshold comparison silently in one direction. Only `constructor` collides after the validator's lowercase, letters-only normalization; the sibling plain-object lookups in `cli/` take keys from fixed vocabularies.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Environment headings are matched the way structure headings are (Priority: P1)

**Independent Test**: A project whose ENVIRONMENT.md has `## Setup steps` and `## Environment variables`, and whose TEST-SPEC.md has `## Test categories`.

**Acceptance Scenarios**:

1. **Given** sentence-case headings, **Then** guard reports neither ENV001 nor ENV002 nor STR003.
2. **Given** `## setup`, `## Getting Started`, `## 2. Setup Steps` or `## Prerequisites`, **Then** ENV001 is not reported. **Given** `## Environment Variables`, `## Env Vars`, `## 3. environment variables` or `## Configuration`, **Then** ENV002 is not reported.
3. **Given** ENVIRONMENT.md with none of those headings, **Then** ENV001 and ENV002 are reported with their current text.
4. **Given** the same heading list, **Then** ENV001/ENV002 and STR003 give the same answer for the same section.

### User Story 2 - A brace pattern documents the files it expands to (Priority: P1)

**Independent Test**: `src/tests/alpha.test.ts` and `src/tests/beta.test.ts` exist; TEST-SPEC.md documents `` `src/tests/{alpha,beta}.test.ts` ``.

**Acceptance Scenarios**:

1. **Given** that line, **Then** DDF002 is not reported and `docguard diff` lists no test-file mismatch.
2. **Given** `` `src/tests/{alpha,beta,gamma}.test.ts` `` and no `gamma.test.ts`, **Then** DDF002 reports exactly one documented file not found, `src/tests/gamma.test.ts`, and nothing in code undocumented.
3. **Given** `` `tests/foo.{test,spec}.ts` `` with both files on disk, **Then** both are documented; the token is extracted although it contains no literal `.test.`.
4. **Given** `` `{src,lib}/{a,b}.test.ts` ``, **Then** four paths are documented. **Given** `` `src/{a,}.test.ts` ``, **Then** `src/a.test.ts` and `src/.test.ts` are the two expansions.
5. **Given** `` `src/tests/{alpha.test.ts` `` (unbalanced), `` `src/{alpha}.test.ts` `` (no comma) or a pattern with more than 64 expansions, **Then** the token stays literal, as today.
6. **Given** a brace pattern inside a fenced code block, **Then** it documents nothing, as today.

### User Story 3 - Negation covers a list and removal verbs (Priority: P1)

**Independent Test**: One repository per sentence: `package.json` with React only, no `.tf` files, ARCHITECTURE.md with a Tech Stack table naming React, and one sentence under `## Infrastructure`.

**Acceptance Scenarios**:

1. **Given** any of `There are no CDK, Terraform or Pulumi stacks.`, `There are no Pulumi, CDK or Terraform stacks.`, `We use neither Terraform, Pulumi nor CDK.`, `Without Terraform or Pulumi.`, **Then** DDF001 is not reported.
2. **Given** any of `We removed Terraform in 1.0.`, `Terraform was removed.`, `We migrated off Terraform.`, `We migrated away from Terraform.`, `We dropped Terraform.`, `We no longer use Terraform.`, `Terraform was replaced by Pulumi.`, **Then** Terraform is not documented.
3. **Given** `We replaced MySQL with PostgreSQL.` and neither in code, **Then** DDF001 names PostgreSQL and not MySQL. (CDK and Pulumi are not in the vocabulary DDF001 compares, so they are negated in lists but never reported themselves.)
4. **Given** `We use Terraform, but there are no Pulumi stacks.` and no Terraform in code, **Then** DDF001 names Terraform: a negator does not reach back across a clause break.
5. **Given** `Terraform manages DNS. Pulumi is not used.`, **Then** Terraform is documented.
6. **Given** a Revision History table row `| 0.2.0 | 2026-10-01 | Removed the template's Terraform blocks |` and no other mention, **Then** Terraform is not documented. **Given** a row `| 0.3.0 | | Added Terraform for DNS |` under `## Changelog`, **Then** Terraform is not documented either: a changelog describes past state. **Given** the same words under `## Tech Stack`, **Then** it is documented.
7. **Given** the seven sentences in the report, **Then** each clears DDF001 alone; **Given** the existing negation cases of `tests/docs-diff.test.mjs`, **Then** they pass unchanged.

### User Story 4 - An unedited template is not scored as finished (Priority: P1)

**Independent Test**: `docguard init --skip-prompts` in a repository with a `package.json`; a second fixture holding only an unedited ARCHITECTURE.md.

**Acceptance Scenarios**:

1. **Given** the scaffold, **Then** guard reports STR006 once per unedited canonical document, as a warning, and `score` reports docQuality below the Legible line (60%) with ALCOA+ "Legible" as a gap, not as evidence.
2. **Given** the scaffold, **Then** "Machine markers" counts 0 of its documents as marked.
3. **Given** a configuration that requires only ARCHITECTURE.md and that document unedited, **Then** docQuality is 0%, not 100%.
4. **Given** one sentence of prose written under `## System Overview`, **Then** that document is no longer a scaffold, STR006 is not reported, and its scores are those of today.
5. **Given** `init --skip-prompts` followed by `generate --plan --write` on each fixture stack, **Then** guard reports STR006 only for a document the plan derives nothing for (SECURITY.md has no code-derived section, so the plan leaves it as the template), and never for ARCHITECTURE.md, DATA-MODEL.md, TEST-SPEC.md or ENVIRONMENT.md, whose generated sections are content. Plain `generate` and the `plan` flow without `init` report no STR006.
6. **Given** a document whose headings and comments were deleted but whose table rows and prose came from the template, **Then** it is still a scaffold; **Given** a document with the owner and status filled in but no other change, **Then** it is still a scaffold.
7. **Given** a scaffold that carries `@your-github-username` and `draft | review | approved`, **Then** the STR006 message names them as evidence. **Given** an edited document that keeps `@your-github-username`, **Then** nothing is reported: `generate --plan --write` leaves them in place.

### User Story 5 - A word that names an inherited property is still a word (Priority: P1)

**Independent Test**: A document of reference length whose prose contains `constructor`.

**Acceptance Scenarios**:

1. **Given** `constructor`, `Constructor` and `CONSTRUCTOR`, **Then** each counts as 3 syllables, and every word of the explicit exception list keeps its count.
2. **Given** prose containing `constructor`, **Then** reading ease and grade are finite numbers and DQ004 and DQ005 fire exactly as they do for the same prose with another three-syllable word in its place.
3. **Given** the thresholds, **Then** they are unchanged: this is a lookup fix, not a suppression or a weaker gate.

### Edge Cases

- A heading inside a fenced code block is matched by `docHasSection` today, for ENV001 and for STR003 alike; this specification does not change that.
- A brace group may contain a path separator (`{src,lib}/x`); a nested group (`{a,{b,c}}`) is not expanded and the token stays literal.
- A brace expansion that equals a path already documented is one path.
- `We removed Terraform` before a full stop, a semicolon or a line break ends the clause; the negation does not carry into the next sentence.
- A list negator does not cross a verb: in `We do not use CDK, but Terraform manages DNS` Terraform stays documented (`but` ends the clause).
- A document that cannot be matched to a shipped template (a custom name with no template) is never reported as a scaffold: the check compares against a template, it does not guess.
- A scaffold marked `<!-- docguard:section scaffold n/a — reason -->` is not reported by STR006, and scores are unchanged: the marker owns the absence, it does not make the document readable.
- The `Metadata` table, the `Canonical document` banner, dates and the version badge of the template are template text, not authored content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: ENV001 and ENV002 MUST decide whether the required section exists with the matcher STR003 uses (`docHasSection`), so the two validators cannot disagree. ENV001 MUST be satisfied by a Setup Steps section or by a Prerequisites section. Messages, codes and severities MUST NOT change, and the change MUST only remove findings.
- **FR-002**: `extractDocumentedTests` MUST expand single-level brace alternation in a documented token before applying its test-file rules. A token with one or more balanced groups, each holding at least one comma, expands to the product of its alternatives (an empty alternative is allowed). A token with unbalanced braces, a group without a comma, a nested group, or more than 64 expansions MUST stay literal. The extraction rule (ends in `.test.<ext>` or `.spec.<ext>`, or matches a configured pattern) applies to each expansion. A documented expansion that is not found MUST be reported by its expanded path. The same function feeds DDF002 and `docguard diff`.
- **FR-003**: A negator MUST govern every item of the coordinated list it opens. The negators are `no`, `without`, `neither`, `nor` and `not using`; the list is a run of items of at most three words, separated by `,`, `or`, `and` or `nor`, that holds no verb of the closed set `is|are|was|were|uses?|used|requires?|required|has|have`, and that ends at the technology. Scope MUST end at a clause break (`but`, `whereas`, `while`, `however`, a sentence end or a semicolon).
- **FR-004**: A removal or migration verb before a technology MUST negate it: `removed`, `dropped`, `deleted`, `retired`, `decommissioned`, `replaced`, `migrated|moved|switched off|away from`, `no longer use|using`, `stopped using`, `phased out`, with at most three filler words between the verb and the technology (determiners and possessives). After a technology, `was|were|has been|have been` followed by one of those verbs (or `replaced by`) MUST negate it. `replaced X with Y` negates X and not Y.
- **FR-005**: Sections whose heading is a change record MUST NOT be read for documented technology: a heading whose normalized text equals `revision history`, `change history`, `document history`, `version history`, `history`, `revisions`, `changelog`, `change log` or `release notes`, through the next heading of the same or a higher level.
- **FR-006**: DocGuard MUST have one definition of an unedited scaffold (`cli/shared-scaffold.mjs`). A canonical document is an unedited scaffold when its authored lines are all lines of the shipped template for the same document. Authored lines are the lines left after removing HTML comments (spec 074 reader), headings, blank lines, thematic breaks, the `Metadata` table, table separator rows, cells that are empty, ISO dates and the placeholder `@your-github-username`. A document with no matching template is not a scaffold; neither is an empty file, a bare skeleton of headings with no template line at all (STR003 judges its sections), a document that shares no heading with its template, or one that carries a `docguard:generated` marker. The per-document marker `<!-- docguard:section scaffold n/a — reason -->` silences the STR006 report only; scores still treat the document as a scaffold.
- **FR-007**: Guard MUST report STR006 (validator `docSections`, warning) for each unedited scaffold among the documents STR003 checks. The message MUST name the evidence (the placeholder owner, the unchosen status) when the document carries it. The owner and status alone MUST NOT cause a report. STR006 MUST be listed in the help of `explain`, in the finding-code reference and in the allow-lists of the flows of `tests/generated-docs-e2e.test.mjs` that start from a blank `init`. After `generate --plan --write` the test MUST allow STR006 only for the documents the plan derives nothing for (SECURITY.md), and MUST NOT allow it in the plain `generate` and un-initialized `plan` flows.
- **FR-008**: `score` MUST count an unedited scaffold as failing every docQuality check of that document (its required sections and its content check), with a failure that says `unedited scaffold`. A document that is not a scaffold MUST score exactly as today.
- **FR-009**: The "Machine markers" check MUST NOT count an unedited scaffold as marked; the document stays in the denominator.
- **FR-010**: The DQ validators MUST NOT change. A scaffold produces no DQ finding, and the specification says why: the readability claim belongs to the score (FR-008), not to a sentence ratio.
- **FR-012**: The syllable counter MUST read its exception dictionary by own property only (`Object.hasOwn`), so no word that names an inherited property (`constructor`) can return a non-number. Every syllable count MUST be a positive integer.
- **FR-011**: `docguard explain docSections` and `docguard explain environment`, the help of ENV001, ENV002, DDF001, DDF002 and STR006, the finding-code reference (`npm run docs:reference`), `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md` and the llms bundles (`npm run llms`) MUST state FR-001 to FR-009 (and FR-012 in the CHANGELOG).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every User Story case that expects a different result from today fails on the base CLI and passes on the new one. Every case that expects an unchanged result passes on both. The seven DDF001 sentences of the report each fail on the base and pass after.
- **SC-002**: Run `guard --format json` and `score --format json` with the base CLI and the new CLI on `git archive` copies of this repository and of the local projects with canonical documents, one copy per CLI, with no other load. Findings differ only as follows: ENV001 or ENV002 removed, DDF001 or DDF002 removed or reworded because part of a list cleared, STR006 added. No other finding is added or removed. docQuality, Legible and Machine markers differ only for a project with a document STR006 reports. Every changed finding is recorded in tasks.md, a sample of at least 20 across every changed project is reviewed by hand, and any false positive is recorded with how it was excluded. Guard on this repository is unchanged, and its wall time stays within the CI budget.
- **SC-004**: Calling `countSyllables` for every word of a large English word list and of the repository's own documents returns a positive integer each time; the readability findings of this repository's guard run are unchanged.
- **SC-003**: After `init --skip-prompts` on each of the five fixture stacks of spec 044, `score` reports ALCOA+ Legible as a gap and `Machine markers` as 0 of N. After `init` then `generate --plan --write`, guard reports STR006 for SECURITY.md at most.

## Assumptions

- Sentence case is correct English for a heading; the canonical section names are matcher keys, not mandatory spellings.
- A project that wrote its test files as brace patterns means the files the shell would expand them to.
- An author who names a removed technology in a changelog or a "no X" sentence means the technology is not in use.
- Template text is stable within a release; a document generated by an older template may stop matching it, which only hides STR006 and never invents a finding.
- STR006 is a warning, so a pipeline that passes today keeps passing; it sees one more warning for a document nobody wrote.

## Out of Scope

- Skipping a heading that sits inside a fenced code block, for ENV001, ENV002 and STR003 alike.
- Per-section emptiness: a required heading with no body in an otherwise edited document keeps counting as present in the score.
- Reporting a placeholder owner or an unchosen status in an edited document: `generate --plan --write` writes neither.
- Brace expansion for documented source paths outside test files (DDF002 and `diff` read tests only), and nested brace groups.
- Changing the DQ sentence-ratio validators, the structure score (file presence), or which documents are canonical.
- The spec-kit catalog submission for 0.45.0 (issue 578), which is a form the maintainer submits.
