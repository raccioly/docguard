# Implementation Plan: Project Glossary and Plain Writing

**Spec**: [spec.md](spec.md) (`docguard.glossary-and-plain-writing`)

## Summary

Two independent pieces in one pull request.

1. **Glossary.** A new leaf module reads the glossary table (`cli/shared-glossary.mjs`); a new validator (`cli/validators/glossary.mjs`) checks the documentation set against it and reports GLS001 to GLS004. `init --with glossary` writes a starter with inert proposals; `fix --doc glossary` prints an agent prompt.
2. **Plain writing.** A new line-aware sentence reader (`cli/shared-sentences.mjs`) feeds two new Doc-Quality codes: DQ009 (word limit per sentence) and DQ010 (numbered steps that do not start with a verb). The existing prose extraction stays untouched, so DQ001 to DQ008 are byte-identical.

| FR | Change |
|---|---|
| FR-001 | `cli/shared-glossary.mjs` `glossaryPath(projectDir, config)`; `cli/config.mjs` validates `docs.glossary` (stderr once, then dropped); `schemas/docguard-config.schema.json`. |
| FR-002 to FR-006 | `parseGlossary(text)` in `cli/shared-glossary.mjs`: header aliases, cell splitting, term rules, GLS002 and GLS003 issues with line numbers, the 500-row bound. |
| FR-004, FR-009, FR-010 | `termMatcher(rows)` and `checkableLines(text, ctx)` in `cli/shared-glossary.mjs`: Unicode word boundaries, case rule, plural, exempt regions, longest-Use masking. |
| FR-007, FR-008, FR-011 to FR-016 | `cli/validators/glossary.mjs` (`validateGlossary`, `applies`); registration in `cli/commands/guard.mjs` (validator map and `liteValidatorsConfig`), `cli/config.mjs` `_KNOWN_VALIDATORS`, `cli/strict-additions.mjs` (`'0.50'`), `cli/findings.mjs` (GLS001 to GLS004, GLS004 `defaultLevel: 'info'`). |
| FR-017, FR-018 | `cli/commands/init.mjs`: `glossary` in `SCAFFOLDER_DISPATCH`, and the starter written by plain `init` when none exists; `starterGlossary(projectDir, config)` in `cli/shared-glossary.mjs` builds the text and the proposals. |
| FR-019 | `cli/commands/fix.mjs`: `glossary` in the `--doc` mapping, resolved through `glossaryPath`; a `DOC_EXPECTATIONS` entry keyed by the resolved path. |
| FR-020 to FR-025 | `cli/shared-sentences.mjs` (`proseSentences(text, { unicode })` → `{ line, words, step }[]`, `numberedSteps(text)` → `{ line, firstWord }[]`); `cli/validators/doc-quality.mjs` (DQ009, DQ010, the two markers, the two config keys, `skippedMetrics` entries); `cli/findings.mjs` (DQ009 warn, DQ010 `defaultLevel: 'info'`). |
| FR-026 | Levels in `cli/findings.mjs` only. |
| FR-027 | `tests/glossary-compat.test.mjs`: the no-glossary fixture against the base tag. |
| FR-028 | `tools/fuzz.mjs`: `parseGlossary`, `checkableLines`, `proseSentences`, `numberedSteps`. |
| FR-029, FR-030 | `docs/configuration.md`, `docs/languages.md`, README section, `npm run docs:reference`, CHANGELOG, Verification Notes review table. |

## Technical Context

- **Language/runtime**: JavaScript (ES modules), Node.js 18+. No new dependency.
- **Code this builds on**: `listCanonicalDocs`, `walkFiles` (`cli/shared-ignore.mjs`); `resolveDocDirs` (`cli/shared.mjs`); `documentLanguage`, `nonEnglishDocument` (`cli/shared-doc-language.mjs`); `idForEnglishLabel`, `foldHeading`, `aliasesFor`, `headingIds`, `separatesWords`, `LANGUAGE_NOT_SUPPORTED` (`cli/shared-labels.mjs`); `agentInstructionKind` (`cli/shared-agent-instructions.mjs`); the file-kind classifier (`cli/shared-file-kind.mjs`, spec 100); `suppressesCode` (`cli/findings.mjs`); `contractFields` (`cli/shared-result-contract.mjs`); `safeWrite` (`cli/writers/generate-io.mjs`); the word-boundary rules of `cli/shared-prose-words.mjs`.
- **Constraints**: DQ001 to DQ008 byte-identical (`extractProse` and `splitSentences` unchanged); no `empty` Glossary result when it applies; one finding per document (and term); bounded time on adversarial input; Constitution IV (shared modules are leaves; validators never import commands).

## Design details

### Glossary table reader (`parseGlossary`)

- Walk lines; skip fenced code (```` ``` ````, `~~~`) and HTML comments (single-line and multi-line).
- A table header is a line starting with `|` followed by a separator line (`|---|`). Fold each header cell (`foldHeading`); find the Use, Avoid and Meaning columns by the alias lists of FR-002. The first table with Use and Avoid columns is the glossary; later tables are ignored.
- Each body row until the first non-`|` line: split cells on unescaped `|`; clean a term (strip backticks, `*`, `_`, trim); Avoid splits on `,` and `;`; `-`, `—`, `–` and empty mean none.
- Returns `{ found: boolean, rows: [{ line, use, avoid: string[], meaning }], issues: [{ code: 'GLS002'|'GLS003', line, message }], conflicted: Set<string folded> }`.
- Comparison key for duplicates and conflicts: NFC, lowercase (case-sensitive terms keep case).

### Matching (`termMatcher`, `checkableLines`)

- `checkableLines(text, { ctx })` yields `{ line, text }` with exempt spans replaced by spaces of equal length (so columns stay true): fences, indented code (4 spaces or a tab after a blank line, outside a list), front matter at line 1, HTML comments, inline code, link destinations `](...)`, autolinks `<http...>`, bare URLs, path-like tokens, double-quoted spans (`"..."`, `“...”`), blockquote lines, and exempt headings.
- An exempt heading: `idForEnglishLabel(text)` is non-null, or its `foldHeading` key equals the fold of an alias of any `headingIds()` id in the document's context (`aliasesFor`), or the next non-blank line is a `docguard:heading` marker.
- `termMatcher(rows)` builds one regex per term with the boundary `(?<![\p{L}\p{N}\p{M}])` / `(?![\p{L}\p{N}\p{M}])` and no hyphen-letter join (`(?<![\p{L}]-)`, `(?!-[\p{L}])`), flag `u`, plus `i` for case-insensitive terms; plural suffix `(?:e?s)?` for single words. Use terms are matched first and their spans masked; then Avoid terms, longest first, masking as they match.

### Validator (`validateGlossary`)

- Documents: FR-008 set, deduplicated, sorted; skip the glossary path, `CHANGELOG.md`, `DRIFT-LOG.md`, `specs/**`, agent-instruction files, decision-record paths (the decision-records validator's path rule), backup and generated kinds, ignored paths.
- `performed` = 1 (lookup) + documents checked. GLS004 when no table. Document-level markers (`docguard:glossary off`, `allow`). Per-line pragma via `suppressesCode(lineText, 'GLS001')`.
- Language: glossary language from `documentLanguage(config, glossaryRel)?.language ?? 'en'`; a document whose `documentLanguage` differs goes to `unexaminedDocuments` with `LANGUAGE_NOT_SUPPORTED`, `blocking: false`.
- `applies`: documents exist in the FR-008 set.

### Sentence reader (`proseSentences`, `numberedSteps`)

- Line-aware: keeps each paragraph's lines with their numbers; skips code, tables, headings, comments, front matter, images and HTML lines (the line kinds `extractProse` skips) and blank lines.
- A paragraph ends at a blank line, a heading, a list item start or a table. Inside a paragraph, sentence ends follow `splitSentences`'s protections (copied, not imported, so the old function stays private and unchanged); the start line of each sentence is tracked by character offset.
- Inline code spans count as one word; link text counts, the destination does not.
- `numberedSteps`: ordered-list items (`^\s*\d+[.)]\s+`) grouped into lists (a list ends at a heading or a non-indented paragraph line); lists of two or more items yield their items with the first word after stripping emphasis and a `Step N:` label; `null` first word when the item starts with code or a link.

### Doc-Quality additions

- After the existing eight checks for a document (English or not), run DQ009 when the document's language separates words, and DQ010 when it is English. Each adds one to `total` and to `passed` when clean. Markers through `parseQualityOverride` with rules `sentence-limit` and `step-verbs`. Non-English: DQ010 (and DQ009 for unspaced scripts) go to `skippedMetrics`.
- The early return for "insufficient prose" stays; DQ009 and DQ010 run only on documents that passed it, so tiny documents keep today's result exactly.

## Proof

- Tests first for each FR (tasks.md). Fixtures as committed projects under `tests/fixtures/glossary/` with `"enforcement": "standard"` unless the test is about strict.
- Byte-identity: DQ001 to DQ008 messages on the existing doc-quality fixtures before and after.
- Compatibility: `tests/glossary-compat.test.mjs` runs the v0.49.0 tag from a `git archive` copy and this tree on a no-glossary fixture with no `enforcement` key; same exit code.
- A/B: `tools/release-ab.mjs` with `release-gate.json` (DocGuard and the benchmark corpus), and the hermetic recipe on local projects (results in the session notes folder only).
- `npm test` by exit code, `npm run fuzz`, `npm run budget -- --base <main worktree>`, `node cli/docguard.mjs guard`.
