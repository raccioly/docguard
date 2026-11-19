# Feature Specification: Project Glossary and Plain Writing

**Feature Branch**: `spec/105-glossary-and-plain-writing`

**Created**: 2026-11-19

**Status**: Active

**Spec ID**: `docguard.glossary-and-plain-writing`

**Lineage**: Resolves issue 706 (an STE100 writing profile for Doc-Quality) and adds a project glossary.
- It extends `docguard.doc-validator-fidelity` (spec 079) and `docguard.document-languages` (spec 104): Doc-Quality gains two codes, DQ009 and DQ010. DQ001 to DQ008 do not change.
- It follows `docguard.strict-by-default` (spec 097): the new Glossary validator joins strict in the release that ships it (`STRICT_ADDITIONS['0.50']`), and it never makes a run exit 4.
- It follows `docguard.enforcement-ladder` (spec 083): a code whose precision is not yet measured ships at a level that does not change the exit code, unless this spec states why it is safe at `warn`.
- It overrides one constraint of issue 706, "opt-in only (`quality.profile: "ste"`)". The maintainer's direction since 2026-11-12 is that new checks join the default and projects opt out (spec 097). The limits are settings under `docQuality`, and there is no profile key.

**Input**: The maintainer wants plain, consistent writing across his projects, based on ASD STE100 (Simplified Technical English): short sentences, active voice, and one term for one concept. A word such as "shipped" or "live" means different things in different projects, so each project decides its own terms. DocGuard does not review user interfaces; that stays out of scope.

## Problem

- **Nothing checks terms.** A document can say "spec" in one paragraph and "specification" in the next. People cope with this. An agent that reads the docs may treat the two words as two concepts. No validator knows which word a project chose.
- **One long sentence hides behind short ones.** DQ006 warns only when the average sentence of a document is over 30 words. STE100 limits each sentence: 25 words in descriptive text, 20 in a procedure step. On DocGuard's own canonical documents and README, 119 of 1,546 sentences are over the limit, and DQ006 passes for every document.
- **Steps that do not start with a verb.** STE100 writes each step as an instruction ("Run", "Open", "Set"). A numbered step such as "The config file is read first" tells the reader nothing to do.

Measured on 2026-11-19 with a throwaway counter over the canonical documents and README of 30 local projects that use DocGuard (names are not recorded here):

| Measure | Projects affected | Range per project |
|---|---|---|
| At least one sentence over the limit (25, or 20 in a numbered step) | 25 of 30 | 1 to 1,273 sentences; the worst document has 762 |
| At least one numbered step that starts with an article, pronoun, modal or "-ing" word | 19 of 30 | 1 to 25 steps |

A finding per sentence would print hundreds of lines on some projects. One finding per document, which names the first lines and gives a count, prints at most one line per document (Decision 4).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A project states its terms once (Priority: P1)

As a maintainer, I write `docs/GLOSSARY.md` with a table of Use, Avoid and Meaning. Guard then reports each document that uses an Avoid term, with the line and the term to use instead.

**Why this priority**: This is the feature. The project's own decisions become a check that runs on every change.

**Independent Test**: A fixture with a glossary row `| configuration | config | ... |` and a README that says "config" on line 7 in prose and `config` in inline code on line 9. Guard reports one GLS001 for `README.md:7` that names "configuration", and nothing for line 9.

**Acceptance Scenarios**:

1. **Given** a glossary row with Use `configuration` and Avoid `config, conf`, **When** a document uses "Config" in prose, **Then** guard reports GLS001 at that line, naming "configuration" as the term to use.
2. **Given** the same row, **When** "config" appears only in code blocks, inline code, link targets, file paths, quoted text or HTML comments, **Then** nothing is reported.
3. **Given** a Use term `Spec Kit` and an Avoid term `spec`, **When** a document says "Spec Kit", **Then** nothing is reported for "spec".
4. **Given** a document that uses an Avoid term on 12 lines, **When** guard runs, **Then** one GLS001 finding is reported for that document and term; its message gives the count and the first five lines.
5. **Given** a line that carries `<!-- docguard:ignore GLS001 — reason -->`, **When** guard runs, **Then** that line is not reported. A document that carries `<!-- docguard:glossary off — reason -->` is not checked, and `<!-- docguard:glossary allow config — reason -->` exempts one term in that document.

---

### User Story 2 - A broken glossary says so (Priority: P1)

As a maintainer, when my glossary has a row without a Use term, the same term twice, or a term that is Use in one row and Avoid in another, guard tells me the line of the glossary and what is wrong.

**Why this priority**: A wrong glossary row produces wrong findings in every document. It must be found first.

**Independent Test**: A glossary with `| spec | specification |` and `| specification | spec |`. Guard reports GLS003 at both glossary lines and checks no document for either term.

**Acceptance Scenarios**:

1. **Given** a row with an Avoid term and an empty Use cell, **When** guard runs, **Then** GLS002 reports the glossary line.
2. **Given** two rows with the same Use term, or one Avoid term listed twice, **When** guard runs, **Then** GLS002 reports the second line.
3. **Given** a term that is Use in one row and Avoid in another, or an Avoid term listed under two different Use terms, **When** guard runs, **Then** GLS003 reports both lines, and documents are not checked for that term.
4. **Given** a `GLOSSARY.md` written as headings and paragraphs, with no Use and Avoid table, **When** guard runs, **Then** no GLS002 is reported. The file is read as a free-form glossary, and GLS004 (informational) says that DocGuard cannot check terms from it.

---

### User Story 3 - A project without a glossary is told how to start one (Priority: P2)

As an adopter who upgrades, I get one informational line that says the project has no glossary and gives the command that writes a starter. My exit code does not change.

**Why this priority**: The check joins the default (spec 097), but a missing glossary is not a defect in the documents.

**Independent Test**: A fixture with prose documents, no glossary and no `enforcement` key. Guard on the previous release and on this one exit with the same code; this one prints GLS004 as informational.

**Acceptance Scenarios**:

1. **Given** no glossary, **When** guard runs, **Then** GLS004 is reported at the `info` level, with the fix `docguard init --with glossary`, and the exit code is the same as before this feature.
2. **Given** `docguard init --with glossary` in a project whose documents use both "spec" and "specification", **When** it runs, **Then** it writes `docs/GLOSSARY.md` with the table header and a proposals block in an HTML comment that lists `spec / specification` with both counts. Guard reports no GLS001 from the proposals.
3. **Given** a glossary already at the path, **When** `init --with glossary` runs, **Then** the file is not changed and the command says so.
4. **Given** `docguard fix --doc glossary`, **When** it runs, **Then** it prints an agent prompt to create or improve the glossary at the configured path.

---

### User Story 4 - Each long sentence is found, not just the average (Priority: P1)

As a writer, guard tells me which sentences are over 25 words, or over 20 words in a numbered step, by line.

**Why this priority**: The average hides the long sentences that STE100 rejects.

**Independent Test**: A fixture README with one 31-word sentence among short ones, and a numbered step of 22 words. Guard reports one DQ009 for the document that names both lines; DQ006 passes.

**Acceptance Scenarios**:

1. **Given** a sentence over the limit that spans two lines of a paragraph, **When** guard runs, **Then** DQ009 names its first line and its word count.
2. **Given** `<!-- docguard:quality sentence-limit off — reason -->` in a document, **When** guard runs, **Then** DQ009 does not check that document; `sentence-limit 30` sets the limit for that document.
3. **Given** `docQuality.sentenceLimit: 30` and `docQuality.stepSentenceLimit: 25` in `.docguard.json`, **When** guard runs, **Then** those limits apply.
4. **Given** a document in Portuguese or Spanish, **When** guard runs, **Then** DQ009 counts its words the same way; for a language without word spacing it is skipped with `language-not-supported`.

---

### User Story 5 - Steps start with a verb (Priority: P3)

As a writer of English procedures, guard tells me which numbered steps start with an article, a pronoun, a modal verb or an "-ing" word.

**Why this priority**: Useful, but the rule is a heuristic, so it reports without changing the exit code.

**Independent Test**: A fixture with the steps "1. Run the tests." and "2. The build starts." Guard reports DQ010 for line 2 only.

**Acceptance Scenarios**:

1. **Given** an ordered list of two or more items, **When** an item's first word is in the closed list (Decision 7), **Then** DQ010 names the line.
2. **Given** a step that starts with inline code, a link or a bold verb (`**Run**`), **When** guard runs, **Then** the bold word is read as the first word, and a step that starts with code or a link is not judged.
3. **Given** a document that is not in English, **When** guard runs, **Then** DQ010 is skipped with `language-not-supported`.

### Edge Cases

- A glossary file larger than 1 MB, or with more than 500 rows: read the first 500 rows and report GLS002 once for the rest (bounded time, spec 088).
- An Avoid term that is also a common word in another sense ("live"): the project chose it. The per-term allow marker and the per-line ignore exist for the exceptions.
- An Avoid term inside a hyphenated word (`config-file`): not a match. A hyphen between letters joins a word, as in spec 104.
- A term in a heading that DocGuard requires ("## Configuration" in ENVIRONMENT.md is not affected, but a required heading that contains an Avoid term): the heading is exempt, because renaming it would break STR003.
- Two documents with the same name in different folders: each finding carries its own path.
- CRLF line endings, a byte order mark, tabs: read like the other document parsers.
- A sentence that ends without a period at the end of a list item or paragraph: it ends there.
- Abbreviations ("e.g.", "i.e."), versions (`0.49.0`), file names (`package.json`) and decimals do not end a sentence (the protections of `splitSentences`).

## Requirements *(mandatory)*

### Glossary file

- **FR-001**: The glossary path MUST be `docs.glossary` in `.docguard.json` when set (a project-relative path to a `.md` file). Without it, DocGuard MUST look for `docs/GLOSSARY.md`, then `docs-canonical/GLOSSARY.md`, then `GLOSSARY.md`, and use the first that exists. A `docs.glossary` value that is not a string ending in `.md`, or that leaves the project, MUST be reported once on stderr and ignored, like the other `docs` keys.
- **FR-002**: The glossary MUST be read from the first Markdown table, outside code blocks and HTML comments, whose header row has a Use column and an Avoid column. Header cells are compared after case and accent folding: Use is `Use`, `Usar` or `Term`; Avoid is `Avoid`, `Evitar` or `Avoid terms`; Meaning is `Meaning`, `Significado`, `Definition` or `Definição`. Meaning and other columns are optional and do not change the check. Column order is free.
- **FR-003**: A Use cell MUST hold one term. An Avoid cell MUST hold zero or more terms separated by commas or semicolons; an empty cell, `-` or `—` means none. Backticks around a term are removed. Markdown emphasis is removed.
- **FR-004**: A term MUST match whole words only: no Unicode letter, digit or combining mark directly before or after it, and a hyphen between letters is part of the word. A term with an uppercase letter after its first character (`PR`, `GitHub`) MUST match case-sensitively; every other term MUST match case-insensitively. A single-word term MUST also match its regular plural (the term plus `s` or `es`). A phrase MUST match with any run of spaces or tabs between its words, on one line. There is no other stemming.
- **FR-005 (GLS002)**: The glossary MUST be reported as malformed, at the glossary line, when a row has Avoid terms and an empty Use cell, when two rows have the same Use term, when one Avoid term is listed twice, or when the table has more than 500 rows (the rest are not read). The finding is a warning.
- **FR-006 (GLS003)**: A term that is the Use term of one row and an Avoid term of another, or an Avoid term listed under two different Use terms, MUST be reported as a conflict at each line involved. A conflicting term MUST NOT be checked in documents. The finding is a warning.
- **FR-007 (GLS004)**: When no glossary file exists, or the file has no Use and Avoid table, guard MUST report GLS004 at the `info` level (`defaultLevel: 'info'`), with the command that writes a starter (`docguard init --with glossary`) and the `docs.glossary` key. A free-form glossary file MUST NOT be reported as malformed.

### Checking documents

- **FR-008**: The documents checked MUST be the canonical documents (`docs-canonical/**/*.md` and `docs.roles` mappings), the root `README.md` and `README.<lang>.md`, and the Markdown files under the documentation homes (`docs/`, `doc/`, `documentation/`, `guides/` and the others of `resolveDocDirs`, plus `docs.dirs`). Excluded: the glossary itself; `CHANGELOG.md`, `DRIFT-LOG.md` and `specs/`, which record history and intent; decision records; agent-instruction files (spec 094: their rules are DocGuard's own); backup and generated files (spec 100); and paths in `.docguardignore`.
- **FR-009**: These parts of a document MUST NOT be checked: fenced code (```` ``` ```` and `~~~`) and indented code blocks; inline code; HTML comments; YAML front matter; link destinations, autolinks and bare URLs; path-like tokens (a token with `/`, or with `.` between word characters, such as `config.json`); text inside double quotes (straight or curly); blockquote lines; and headings that DocGuard matches: a heading whose text is a label of the registry (`cli/shared-labels.mjs`) in the document's language, or that carries a `docguard:heading` marker.
- **FR-010**: An Avoid term inside an occurrence of a longer Use term (`spec` in `Spec Kit`) MUST NOT be reported. Where two Avoid terms overlap, only the longer MUST be reported.
- **FR-011 (GLS001)**: Guard MUST report one warning per document and Avoid term. The location is the document and its first line with the term. The message MUST give the term found, the Use term, the number of lines, and up to five line numbers. The suggestion is a fix: replace the term with the Use term, or add an allow marker when the word means something else here.
- **FR-012**: A line that carries `docguard:ignore GLS001` (the existing inline pragma, with its reason, owner and expiry rules) MUST NOT be reported. A document that carries `<!-- docguard:glossary off — reason -->` MUST NOT be checked. `<!-- docguard:glossary allow <term>[, <term>] — reason -->` MUST exempt those Avoid terms in that document.
- **FR-013**: The glossary's language is the language of its own path (spec 104: `docs.language` and the document's name). A document whose language differs from the glossary's MUST NOT be checked; it MUST be listed in `unexaminedDocuments` with the cause `language-not-supported`, which never changes the exit code. Without `docs.language`, every document has the same language and is checked.

### Validator contract

- **FR-014**: Glossary MUST be a validator of its own (key `glossary`, name `Glossary`), listed under `STRICT_ADDITIONS['0.50']`. It MUST carry the contract fields of spec 097: `performed`, `applies`, and, for zero checks, a cause, `howToConfigure` and a `note` sentence no other validator uses.
- **FR-015**: Glossary MUST apply when the project has at least one document in the set of FR-008. Looking for the glossary MUST count as one performed check, so a project without a glossary is never `empty` and never exits 4 because of this validator. Each document checked against a readable glossary MUST count as one more check.
- **FR-016**: `validators.glossary: false` MUST behave as it does for the other validators (spec 097 FR-003: strict ignores it and says so). The documented opt-outs are `findingSeverity`, the N/A marker `<!-- docguard:validator glossary n/a — reason -->` and the markers of FR-012.

### Creating the glossary

- **FR-017**: `docguard init --with glossary`, and `docguard init` in a project with no glossary, MUST write a starter at the path of FR-001 (default `docs/GLOSSARY.md`) with `safeWrite`. It MUST NOT overwrite an existing file, and MUST say that it left the file alone.
- **FR-018**: The starter MUST contain a title, a short explanation in an HTML comment, the table header (in the project's language for `pt` and `es`, else English) and no active row. Proposals MUST be written inside an HTML comment, so the checker ignores them. A proposal is (a) a built-in synonym pair whose two forms both occur in prose in the documents of FR-008, with each count, and the more frequent form as Use; or (b) up to ten words or phrases with a capital letter that occur three or more times not at the start of a sentence, with an empty Avoid. The built-in pairs are English only (Decision 9).
- **FR-019**: `docguard fix --doc glossary` MUST print an agent prompt for the glossary at the configured path: CREATE when it is missing, IMPROVE when it exists. The prompt MUST ask the agent to read the documents of FR-008, list concepts named two or more ways, choose one term per concept with the maintainer, move accepted proposals into the table and run `docguard guard`. `--format json` wraps it as for the other documents.

### Plain-writing checks in Doc-Quality

- **FR-020 (DQ009)**: Doc-Quality MUST check every sentence of every document it already scores (canonical documents and README.md) against a word limit: `docQuality.sentenceLimit` (default 25) for descriptive text, `docQuality.stepSentenceLimit` (default 20) for a sentence in a numbered step (FR-023). It MUST report one finding per document, located at the first sentence over the limit, with the number of sentences over and up to five `line (words)` pairs. It counts as one check per document.
- **FR-021**: Sentences MUST be read by a new line-aware reader that keeps line numbers. A sentence that spans lines is reported at its first line. Code (fenced with ```` ``` ```` or `~~~`, indented, inline), tables, headings, blockquotes, HTML comments, front matter and image lines are not prose. *(Amended 2026-11-19: blockquotes, which the generated documents use for metadata lines such as `> **Sections covered**: ...`, were first read as prose and gave DQ009 on every generated ARCHITECTURE.md.)* A word is a whitespace-separated token with a letter or digit; an inline code span is one word; a link counts the words of its text. The reader MUST keep the sentence-end protections of `splitSentences` (file names, versions, URLs, abbreviations, decimals). `extractProse` and `splitSentences` MUST NOT change, so DQ001 to DQ008 stay byte-identical.
- **FR-022**: A sentence whose first line carries `docguard:ignore DQ009` MUST NOT be reported. `<!-- docguard:quality sentence-limit off — reason -->` turns DQ009 off for one document; `sentence-limit <n>` sets that document's descriptive limit.
- **FR-023 (DQ010)**: A numbered step is an item of an ordered list (`1.` or `1)`) with two or more items. Doc-Quality MUST report, for an English document, each step whose first word (after removing emphasis and a leading `Step N:` label) is in the closed list of Decision 7. A step that starts with inline code, a link or a non-letter is not judged. One finding per document, at the first such step, with up to five lines. `docguard:ignore DQ010` on the line and `<!-- docguard:quality step-verbs off — reason -->` are the waivers. It counts as one check per English document that has a numbered step.
- **FR-024**: For a document in another language (spec 104), DQ009 MUST run when the language separates words with spaces, and MUST be listed in `skippedMetrics` with `language-not-supported` otherwise. DQ010 MUST be listed in `skippedMetrics` with `language-not-supported` for every language but English.
- **FR-025**: DQ006 MUST stay as it is (the average, above 30 words). DQ009 is its per-sentence form; a document that turns DQ009 off keeps DQ006.

### Levels, compatibility and proof

- **FR-026** *(amended 2026-11-19)*: The default levels MUST be: GLS001, GLS002 and GLS003 `warn`; GLS004, DQ009 and DQ010 `info` (Decision 2). `findingSeverity.<CODE>` changes any of them.
- **FR-027**: On a project with no glossary and no plain-writing problem, guard MUST give the same exit code, the same findings and the same JSON keys as the previous release, except the GLS004 line, the Glossary validator's own result and Doc-Quality's check counts. A test MUST show it on a fixture with no `enforcement` key.
- **FR-028**: The glossary table reader and the sentence reader MUST be registered in `npm run fuzz` (no throw, the same answer twice, bounded time).
- **FR-029**: `docs/configuration.md`, the generated finding reference (`npm run docs:reference`), `docs/languages.md` and the README MUST document the glossary, the six codes, the keys and the markers. The CHANGELOG MUST name each new code.
- **FR-030**: Every non-English string this spec adds to user-facing output MUST be listed with where it is used in a review table, and the maintainer MUST approve it before the release that ships it (memory rule of 2026-11-17).

## Success Criteria *(mandatory)*

- **SC-001**: On a fixture with seeded Avoid terms in prose and in every exempt place of FR-009, GLS001 reports every seeded prose use and nothing in an exempt place (precision and recall 1.0 on the fixture).
- **SC-002**: The full suite passes by exit code, and `npm run fuzz` passes.
- **SC-003**: An A/B of `guard --format json` between `main` and this branch, hermetic (a fresh `git archive` copy per CLI), on DocGuard and on the benchmark corpus, shows only GLS00x and DQ009/DQ010 changes and no change of exit code; every other finding is identical.
- **SC-004**: No validator result is `empty` because of this feature on any corpus directory, and no strict run exits 4 that did not before.

## Decisions

1. **A validator of its own for the glossary; Doc-Quality for sentences.** Glossary reads the documentation homes, which Doc-Quality does not read, and its findings follow the project's own table. The sentence checks are refinements of DQ006 and share Doc-Quality's documents and markers. Rejected: putting everything in Doc-Quality, which would either widen its document set (changing DQ001 to DQ008 on every project) or leave `docs/` unchecked.
2. **Levels.** GLS001 to GLS003 are warnings: they fire only after a project wrote a glossary, and they repeat the project's own decision, so a finding is true by construction. DQ009 is informational: it runs for every project (spec 097: new checks join), but a long sentence is a style choice, not a defect, so it does not change the exit code; `findingSeverity.DQ009` makes it a warning. GLS004 is informational: a missing glossary is not a defect in the documents. DQ010 is informational: its word list is a heuristic whose precision is not measured (spec 083). **Trade-off, in plain words (measured before the decision):** with DQ009 at `warn`, 25 of 30 measured projects get at least one new warning. Guard's exit code goes from 0 to 2 where a project had no warning before; a pipeline that fails on warnings turns red until the long sentences are split or the document opts out. With DQ009 at `info`, no exit code changes, and the long sentences are listed but easy to ignore. *(Decided by the maintainer on 2026-11-19: `info`. DQ009 ships informational, so no exit code changes; a project that wants the STE100 limit enforced sets `findingSeverity.DQ009`.)*
3. **A missing glossary is a performed check, not an empty result.** Under strict, an `empty` validator with a project-side cause exits 4 (spec 097 FR-007). The lookup is a real check with a real answer, so the validator reports GLS004 instead. Rejected: `applies: false` without a glossary, which spec 097 FR-006 forbids (a validator's own missing input cannot decide that it does not apply).
4. **One finding per document and term.** Per-line findings would print up to 762 lines for one measured document and break the MCP response budget. A document-level finding names the first five lines and the count, as FRS002 does.
5. **Exempt headings are the ones DocGuard matches.** A required heading cannot be renamed without breaking STR003, so it is exempt. Any other heading is prose and is checked.
6. **Historical documents are exempt.** CHANGELOG, DRIFT-LOG, decision records and `specs/` quote the words used at the time. Rewriting them would falsify the record.
7. **The DQ010 word list (English, closed):** articles `the`, `a`, `an`; pronouns `i`, `you`, `we`, `they`, `he`, `she`, `it`, `this`, `that`, `these`, `those`, `there`, `here`; modal and auxiliary verbs `should`, `must`, `can`, `could`, `will`, `would`, `may`, `might`, `shall`, `is`, `are`, `was`, `were`, `do`, `does`; and any word of six or more letters that ends in `ing`, except `bring`, `string`, `spring`, `swing`, `thing`. A list of verbs was rejected: it misses every project verb ("Bootstrap", "Seed").
8. **No `quality.profile`.** Issue 706 asked for an opt-in profile. That conflicts with the maintainer's direction of 2026-11-12. The limits are ordinary settings, and each check has its own markers.
9. **Non-English text is kept small.** The synonym pairs and the verb list are English only. The only new non-English strings are the glossary header words and the starter's title (Verification Notes).
10. **No `generate` change.** `generate` writes documents from code. A glossary comes from the documents, and `init --with glossary` covers existing projects.

## Open Questions

None. DQ009 at `warn` or `info` was the one open question; the maintainer chose `info` on 2026-11-19, after first choosing `warn` the same day.

## Out of Scope

- User interface text and UX review.
- Checking terms in code comments, identifiers or commit messages.
- One glossary per language.
- Rewriting documents. DocGuard reports; `fix --doc glossary` prepares an agent prompt.
- Widening Doc-Quality's document set to `docs/`.

## Verification Notes

- **SC-001**: `tests/glossary-match.test.mjs` and `tests/glossary-validator.test.mjs` seed Avoid terms in prose and in every exempt place of FR-009; every prose use is reported and nothing in an exempt place.
- **SC-002**: the full suite passes by exit code except three files that fail identically on `main` with the local Node 24 (`spec-kit-delegation`, `spec-kit-integration-honesty`, `upgrade-pr-e2e`: their `specify` stubs are read as ES modules); CI is the reference. `npm run fuzz`: 32 parsers, 0 failures.
- **SC-003**: `tools/release-ab.mjs` (main at `31652de` against this branch) over DocGuard and the 25 benchmark directories: gate PASS, no exit code changed, every change is an added finding: GLS004 in each benchmark directory without a glossary; on DocGuard 8 DQ009 and 2 DQ010. A hermetic A/B on 12 other local projects (one `git archive` copy per CLI, sequential): no exit code or status changed, no finding removed; added DQ009 2 to 12 per project, DQ010 0 to 4, GLS004 once each.
- **SC-004**: no Glossary result is `empty` on any corpus directory (the lookup is a performed check), and no strict exit 4 is new.
- **Amendment (2026-11-19)**: blockquotes are not prose for DQ009 (FR-021).
- **FR-030, non-English strings for review before release:**

| String | Language | Where it is used |
|---|---|---|
| `# Glossário` | pt | Title of the starter `docs/GLOSSARY.md` that `init` writes when `docs.language` is `pt` |
| `# Glosario` | es | The same, for `es` |
| `\| Usar \| Evitar \| Significado \|` | pt, es | Header of that starter table |
| `Usar`, `Evitar`, `Significado`, `Definição` | pt, es | Header cells the glossary reader accepts (compared without case and accents, so `Definicao` also works) |

The maintainer, a native Portuguese speaker, approved all four strings above on 2026-11-19.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `7db0ae5fa8809ddbd40c6b23d69a1d4ca5ae06b4` — Glossary validator (GLS001-GLS004), DQ009/DQ010 and the init/fix starter; full suite green except three stub files that fail identically on main with local Node 24; release A/B PASS, no exit-code change on DocGuard, the benchmark corpus or 12 other projects Evidence: `cli/commands/fix.mjs`, `cli/commands/init.mjs`, `cli/config.mjs`, `cli/shared-glossary.mjs`, `cli/shared-sentences.mjs`, `cli/validators/doc-quality.mjs`, `cli/validators/glossary.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `tests/doc-quality-plain-writing.test.mjs`, `tests/glossary-compat.test.mjs`, `tests/glossary-init.test.mjs`, `tests/glossary-match.test.mjs`, `tests/glossary-parse.test.mjs`, `tests/glossary-validator.test.mjs`, `tests/glossary-verification.test.mjs`. Accepted deviations: none. Successor: none. Blobs: `cli/commands/fix.mjs`=`802c66190e8221fb16191b15a361a342d80f08e8`, `cli/commands/init.mjs`=`2b47f202d1730a4e990a2aeba319c0b204910294`, `cli/config.mjs`=`c57255b25d193c3d47f3f9e2e4ba315b768bc7a6`, `cli/shared-glossary.mjs`=`177b1a7ae3e5810b528d1008bec216908d2bdd7b`, `cli/shared-sentences.mjs`=`51b6c0dff93b88a8205a07086fb0c0f899be451f`, `cli/validators/doc-quality.mjs`=`9b62dd060d622955fc00bbd0c2aeda2f2b734ee5`, `cli/validators/glossary.mjs`=`cdfd24c4a6c86a7e54dceb80475ee79a138812bb`, `docs-canonical/ARCHITECTURE.md`=`48828afe4aae3b1dc7617b35467763783f7b35fb`, `docs-canonical/DATA-MODEL.md`=`c9ef1c35b559a2bb55d153b10cc3b9bf18000402`, `tests/doc-quality-plain-writing.test.mjs`=`102cf1f2bbfc6d5157d2caee363a400f21e3d83c`, `tests/glossary-compat.test.mjs`=`81eb07a4a92a25e4491182977d8250a96eda1a05`, `tests/glossary-init.test.mjs`=`0fb0cb391a53efa574a9bb89318d6eb4d8deae10`, `tests/glossary-match.test.mjs`=`b3d98c1e783182ccd032d940b157dd0d045949ce`, `tests/glossary-parse.test.mjs`=`c13b3451f8fd0cf442ec683ffc555e9b6ab244b0`, `tests/glossary-validator.test.mjs`=`03550d32a329ce1bb17aa9959674b765210dfb04`, `tests/glossary-verification.test.mjs`=`e98c6c1b7777d665fa8b6c0ef1d24a95198abe45`.
- `58aed35af17d9744395a7b76b470d70dd70bc7de` — CI fuzz time: two speedups in the spec 105 parsers (dot-free tokens skip the dot protections; blanking passes run only when their trigger character is present); output unchanged, fuzz and the spec's tests pass Evidence: `cli/commands/fix.mjs`, `cli/commands/init.mjs`, `cli/config.mjs`, `cli/shared-glossary.mjs`, `cli/shared-sentences.mjs`, `cli/validators/doc-quality.mjs`, `cli/validators/glossary.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `tests/doc-quality-plain-writing.test.mjs`, `tests/glossary-compat.test.mjs`, `tests/glossary-init.test.mjs`, `tests/glossary-match.test.mjs`, `tests/glossary-parse.test.mjs`, `tests/glossary-validator.test.mjs`, `tests/glossary-verification.test.mjs`. Accepted deviations: none. Successor: none. Blobs: `cli/commands/fix.mjs`=`802c66190e8221fb16191b15a361a342d80f08e8`, `cli/commands/init.mjs`=`2b47f202d1730a4e990a2aeba319c0b204910294`, `cli/config.mjs`=`c57255b25d193c3d47f3f9e2e4ba315b768bc7a6`, `cli/shared-glossary.mjs`=`614b10f0f38666f3114e161d27e1f3c9df2f2a97`, `cli/shared-sentences.mjs`=`bd01e46c05f24de797c0fe40cfc143a8e19c937f`, `cli/validators/doc-quality.mjs`=`9b62dd060d622955fc00bbd0c2aeda2f2b734ee5`, `cli/validators/glossary.mjs`=`cdfd24c4a6c86a7e54dceb80475ee79a138812bb`, `docs-canonical/ARCHITECTURE.md`=`48828afe4aae3b1dc7617b35467763783f7b35fb`, `docs-canonical/DATA-MODEL.md`=`c9ef1c35b559a2bb55d153b10cc3b9bf18000402`, `tests/doc-quality-plain-writing.test.mjs`=`102cf1f2bbfc6d5157d2caee363a400f21e3d83c`, `tests/glossary-compat.test.mjs`=`81eb07a4a92a25e4491182977d8250a96eda1a05`, `tests/glossary-init.test.mjs`=`0fb0cb391a53efa574a9bb89318d6eb4d8deae10`, `tests/glossary-match.test.mjs`=`b3d98c1e783182ccd032d940b157dd0d045949ce`, `tests/glossary-parse.test.mjs`=`c13b3451f8fd0cf442ec683ffc555e9b6ab244b0`, `tests/glossary-validator.test.mjs`=`03550d32a329ce1bb17aa9959674b765210dfb04`, `tests/glossary-verification.test.mjs`=`e98c6c1b7777d665fa8b6c0ef1d24a95198abe45`.
<!-- docguard:implementation-outcomes:end -->
