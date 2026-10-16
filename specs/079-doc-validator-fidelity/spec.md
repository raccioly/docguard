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
7. **Given** a brace glob, `` `src/**/*.test.{js,jsx}` ``, **Then** it is one pattern that documents what any alternative matches: with only `.js` tests on disk, DDF002 is not reported; with none, it is reported once, by the pattern as written. A glob whose alternatives are not all test files (`` `src/*.{ts,md}` ``) is not a documented test. (Found by the A/B on a real project, 2026-10-15: expanding such a glob reported its absent `.jsx` alternative.)
8. **Given** the same lines, **Then** `docguard diff` reports no Test Files mismatch.

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
- A scaffold that carries a reasoned `docguard:section <id> n/a — reason` marker (`scaffold n/a` included) is owned: no STR006, and it is scored as any written document, as STR003 already counts an owned section as passed. A marker without a reason owns nothing.
- The `Metadata` table, the `Canonical document` banner, dates and the version badge of the template are template text, not authored content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: ENV001 and ENV002 MUST decide whether the required section exists with the matcher STR003 uses (`docHasSection`), so the two validators cannot disagree. ENV001 MUST be satisfied by a Setup Steps section or by a Prerequisites section. Messages, codes and severities MUST NOT change. The shared matcher MUST keep main's matching (a heading names a section when its normalized text contains the key or a synonym, so `## Data Models` and `## Tech Stacks` count), except that the two generic Environment Variables synonyms (`environment`, `configuration`) count only as the whole heading or followed by a word that names the variables (`reference`, `variables`, `vars`, `env`, `settings`, `options`, `keys`); `environment configuration` and `runtime configuration` are synonyms: `## Configuration` names Environment Variables, `## Configuration Files`, `## Production environment` and `## Test environment` do not (found by the review of this change, 2026-10-15). That tightening applies to STR003 too, so the two still agree; it can add an ENV002 or STR003 where one of those two words matched inside a longer heading, and the A/B records each. `environment variable` is a synonym, so `## Environment Variable Reference` still counts. The section writer (`findSectionHeading`, used by `generate`) MUST use the same rule, so generation adds the heading instead of filling an unrelated section. History: a first version applied a whole-heading rule to every one-word synonym (it dropped `## 2. Architecture Layers` on a real project), and a second matched every phrase as whole words (it dropped `## Data Models`); both were reverted to this rule.
- **FR-002**: `extractDocumentedTests` MUST expand single-level brace alternation in a documented token before applying its test-file rules. A token with one or more balanced groups, each holding at least one comma, expands to the product of its alternatives (an empty alternative is allowed). A token with unbalanced braces, a group without a comma, a nested group, or more than 64 expansions MUST stay literal. The extraction rule (ends in `.test.<ext>` or `.spec.<ext>`, or matches a configured pattern) applies to each expansion. A brace group written with spaces after its commas (`{alpha, beta}`) expands as if they were absent. Tokens are read by passes that each anchor on their own shape (a test-file name; a token with brace groups; any token only when test patterns are configured, as on main), so the closing backtick of a code span with spaces never pairs with the next span, and every pass is linear in the document length. In a documented glob `*` is any run of characters, `**/` any number of directories including none (`src/**/*.test.js` documents `src/a.test.js`, as `compileGlob` reads it), and `?` one character. A token that also contains a glob character (`*` or `?`) is one pattern, not a list: it is a documented test when every expansion would be one, it is kept as written, and `documentedTestRegex` matches any alternative (so an absent alternative is not reported, and a pattern that matches nothing is reported once as written). A documented expansion of a brace list that is not found MUST be reported by its expanded path. The same function feeds DDF002 and `docguard diff`.
- **FR-003**: A negator MUST govern every item of the coordinated list it opens. The negators are `no`, `without`, `neither`, `nor` and `not using`; the list is a run of items of at most three words, separated by `,`, `or` or `nor`, holding no verb or preposition of a closed set (`is|are|was|were|be|been|uses?|used|using|requires?|required|has|have|had|but|to|of|for|in|on|with|from|by|at|about|into|than`). The technology MUST be a list item on both sides: a middle item is followed by more items, a coordinator and a last item; after the last item only nouns for a technology's own artifacts may follow (`stacks`, `modules`, `containers`, …), then optionally an existence predicate (`are expected`, `are used`, `is present`, …, which states the absence), then the clause ends or a prepositional phrase starts (`… or Terraform stacks in this repo`; `No CDK, Terraform, Pulumi, SAM, or Serverless Framework artifacts are expected`, a real project's sentence the A/B checked). The last item is one word, or two when the second is a name (`AWS CDK`), so a predicate is not read as part of it: `No Docker or Redis caches sessions`, `no sessions, Redis or PostgreSQL store nothing`, `No ORM, PostgreSQL or SQLite directly` and `No mocks, Redis or PostgreSQL containers back the tests` leave Redis and PostgreSQL documented. `none of` is also a negator; `no-` compounds (`no-build`) and `no matter` are not. So `No Docker, Express serves the API` negates Docker only, and `No changes to PostgreSQL, Redis or Express are needed` negates nothing. `and` is not a list coordinator (`without Docker and PostgreSQL runs locally` starts a new clause as often as it extends a list), so `no Docker, Terraform and Redis stacks` leaves Redis documented. The patterns MUST parse one way only, so matching time stays linear in the line length. Scope MUST end at a clause break (`but`, `whereas`, `while`, `however`, a sentence end or a semicolon).
- **FR-004**: A removal or migration verb before a technology MUST negate it: `removed`, `dropped`, `deleted`, `retired`, `decommissioned`, `replaced`, `migrated|moved|switched|rolled off|away from|back from`, `no longer use|using|run|need` (with filler, `We no longer use the Terraform modules`), `stopped using`, `phased out`, with at most three filler words between the verb and the technology (determiners and possessives), and only when the technology is the object removed: what follows it is nothing, a preposition (`in 1.0`, `with PostgreSQL`) or a noun for its own infrastructure artifacts (`blocks`, `modules`, `stacks`, `resources`, `providers`, `manifests`; not `support`, `setup`, `code`, `usage`, `config`, `files` or `dependency`, which a project removes while it still uses the technology: `We dropped Redis support for Windows`, `We removed the Tailwind config file in the v4 upgrade`). `Removed all Redis keys on logout` and `replaced the Redis client library with ioredis` keep Redis documented. After a technology, `was|were|has been|have been` followed by one of those verbs (or `replaced by`) MUST negate it. `replaced X with Y` negates X and not Y.
- **FR-005**: Sections whose heading is a change record MUST NOT be read for documented technology: a heading whose normalized text equals `revision history`, `change history`, `document history`, `version history`, `history`, `revisions`, `changelog`, `change log` or `release notes`, through the next heading of the same or a higher level. HTML comments are removed first, and a `#` line inside a fenced code block is not a heading (a shell `# history` comment does not hide the rest of the document). Only an H1 or H2 opens a change record (`### History` may be a component); one opened by an H1 ends at the next H1 or H2; a heading indented up to three spaces counts.
- **FR-006**: DocGuard MUST have one definition of an unedited scaffold (`cli/shared-scaffold.mjs`). A canonical document is an unedited scaffold when its authored lines are all lines of the shipped template for the same document. Authored lines are the lines left after removing HTML comments (spec 074 reader), headings, blank lines, thematic breaks, the `Metadata` table, table separator rows, cells that are empty, ISO dates and the placeholder `@your-github-username`. A document with no matching template is not a scaffold; neither is an empty file, a bare skeleton of headings with no template line at all (STR003 judges its sections), a document that shares no heading with its template, one with a heading the template does not have (an entity or component someone named), one that carries a `docguard:generated` marker, or one that carries a reasoned section N/A marker (`<!-- docguard:section <id> n/a — reason -->`, `scaffold n/a` included): that marker is an authored decision about the document, as it already is for STR003. A document that `docs.roles` remaps is compared with the template of the role it fills (`docs/architecture.md` → `ARCHITECTURE`), in STR006, the score and Machine markers alike.
- **FR-007**: Guard MUST report STR006 (validator `docSections`, warning) for each unedited scaffold among the documents STR003 checks. The message MUST name the evidence (the placeholder owner, the unchosen status) when the document carries it. The owner and status alone MUST NOT cause a report. STR006 MUST be listed in the help of `explain`, in the finding-code reference and in the allow-lists of the flows of `tests/generated-docs-e2e.test.mjs` that start from a blank `init`. After `generate --plan --write` the test MUST allow STR006 only for the documents the plan derives nothing for (SECURITY.md), and MUST NOT allow it in the plain `generate` and un-initialized `plan` flows.
- **FR-008**: `score` MUST count an unedited scaffold as failing every docQuality check of that document (its required sections and its content check), with a failure that says `unedited scaffold`. A document that is not a scaffold MUST score exactly as today.
- **FR-009**: The "Machine markers" check MUST NOT count an unedited scaffold as marked among the documents STR006 checks; the document stays in the denominator. Other canonical documents count as before, so every change in the score has a finding that explains it (a blank `DEPLOYMENT.md` does not lower it without one; after `init`, REQUIREMENTS.md still counts: 1 of 6).
- **FR-010**: The DQ validators MUST NOT change. A scaffold produces no DQ finding, and the specification says why: the readability claim belongs to the score (FR-008), not to a sentence ratio.
- **FR-012**: The syllable counter MUST read its exception dictionary by own property only (`Object.hasOwn`), so no word that names an inherited property (`constructor`) can return a non-number. Every syllable count MUST be a positive integer. The same defect class MUST be closed wherever a dictionary is indexed by outside input (CLI arguments, MCP tool names, configuration, document or source text): such dictionaries are null-prototype objects. Before this, `docguard explain constructor` and `docguard hooks --type constructor` crashed with a TypeError, `agents --agent constructor` failed inside (`paths[1] must be of type string`), `init --with toString` passed as a scaffolder, and an MCP `tools/call` named `constructor` reached `Object` (found by the review of this change). Route scanners are included: a Django REST Framework viewset whose base class is named `constructor` crashed `generate --plan` (`VIEWSET_ACTIONS`, `GENERIC_VIEW_METHODS`). A dictionary whose keys cannot come from outside (the router scanner's `METHOD_OF` is read only for names in its verb set; `llms` document names end in `.md`; `iac` tools come from its own table; the Nest scanner already filters decorator names) is left unchanged.
- **FR-011**: `docguard explain docSections` and `docguard explain environment`, the help of ENV001, ENV002, DDF001, DDF002 and STR006, the finding-code reference (`npm run docs:reference`), `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md` and the llms bundles (`npm run llms`) MUST state FR-001 to FR-009 (and FR-012 in the CHANGELOG).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every User Story case that expects a different result from today fails on the base CLI and passes on the new one. Every case that expects an unchanged result passes on both. The seven DDF001 sentences of the report each fail on the base and pass after.
- **SC-002**: Run `guard --format json` and `score --format json` with the base CLI and the new CLI on `git archive` copies of this repository and of the local projects with canonical documents, one copy per CLI, with no other load. Findings differ only as follows: ENV001 or ENV002 removed (or added, and STR003 with it, only where `environment` or `configuration` had matched inside a longer heading), DDF001 or DDF002 removed or reworded because part of a list cleared, STR006 added. No other finding is added or removed. docQuality, Legible and Machine markers differ only for a project with a document STR006 reports. Every changed finding is recorded in tasks.md, a sample of at least 20 across every changed project is reviewed by hand, and any false positive is recorded with how it was excluded. Guard on this repository is unchanged, and its wall time stays within the CI budget.
- **SC-004**: Calling `countSyllables` for every word of a large English word list and of the repository's own documents returns a positive integer each time; the readability findings of this repository's guard run are unchanged.
- **SC-003**: After `init --skip-prompts` on each of the five fixture stacks of spec 044, `score` reports ALCOA+ Legible as a gap and `Machine markers` as 0 of N. After `init` then `generate --plan --write`, guard reports STR006 for SECURITY.md at most.

## Assumptions

- Sentence case is correct English for a heading; the canonical section names are matcher keys, not mandatory spellings.
- A project that wrote its test files as brace patterns means the files the shell would expand them to.
- An author who names a removed technology in a changelog or a "no X" sentence means the technology is not in use.
- Template text is stable within a release; a document generated by an older template may stop matching it, which only hides STR006 and never invents a finding.
- STR006 is a warning, so a pipeline that passes today keeps passing; it sees one more warning for a document nobody wrote.

## Out of Scope

- Skipping a heading that sits inside a fenced code block, for ENV001, ENV002 and STR003 alike (change-record sections, FR-005, do skip fences).
- Per-section emptiness: a required heading with no body in an otherwise edited document keeps counting as present in the score.
- Reporting a placeholder owner or an unchosen status in an edited document: `generate --plan --write` writes neither.
- Brace expansion for documented source paths outside test files (DDF002 and `diff` read tests only), and nested brace groups.
- Changing the DQ sentence-ratio validators, the structure score (file presence), or which documents are canonical.
- The spec-kit catalog submission for 0.45.0 (issue 578), which is a form the maintainer submits.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `9be5a44da477cf41a04c0494f0bd12b787253b10` — Reviewed at 9cfd6c0 (#589): ENV/STR003 one heading matcher; brace lists+globs in DDF002/diff; DDF001 list negation, removal verbs, change records; STR006 and scaffold-aware scores; own-property and null-prototype lookups. 3 review rounds, 18 findings fixed. A/B 44 projects: -4 false findings, +8 STR006, all hand-reviewed, no false positive. Budget PASS, TestGuard 40/40. Deviation: owner/status are STR006 evidence only. Evidence: `cli/commands/agents.mjs`, `cli/commands/score.mjs`, `cli/scanners/agent-readability.mjs`, `cli/shared-scaffold.mjs`, `cli/shared.mjs`, `cli/validators/doc-quality.mjs`, `cli/validators/docs-diff.mjs`, `cli/validators/environment.mjs`, `cli/validators/structure.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/TEST-SPEC.md`, `tests/doc-validator-fidelity.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
