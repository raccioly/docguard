# Implementation Plan: Quoted TODO Forms Are Not Annotations

**Branch**: `fix/todo-quoted-forms` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

## Summary

TODO tracking gets its comments from `realComments()` (`cli/scanners/anchor-tags.mjs`), the string-aware reader requirement tags use, split into one entry per comment line. Each line has its inline code spans blanked before the existing spec 019 patterns run, and the annotation text is cut from the original line at the keyword the blanked line found. The validator stops skipping its own source file.

| FR | Change |
|---|---|
| FR-001 | `cli/validators/todo-tracking.mjs` `maskCodeSpans(line)`: every code span (a backtick run and the next run of exactly as many backticks on the line, CommonMark's rule on one line) is replaced by a placeholder of the same length. The placeholder is a non-space, non-word character, so a keyword inside a span disappears while text after a keyword stays non-empty. |
| FR-002 | `annotationOn(line)`: the spec 019 patterns (`isTodoAnnotation`, `TODO_EXTRACT`) run on the masked line; `TODO_EXTRACT` gives the index of the first keyword outside spans, and keyword and text are extracted from the original line at that index. |
| FR-003, FR-004 | `commentLines(content, relPath)`: for a path `languageOf()` knows, `realComments(content, relPath)` with each comment's text split on newlines, line `c.line + k`; otherwise the existing `commentPortion()` line scanner. |
| FR-005 | Remove `SELF_PATH` and `isSelfPath()`. |
| FR-006 | The spec 019 patterns, the keyword set, `SOURCE_EXTENSIONS` and the test-file exclusion are unchanged; the spec 019 tests run unchanged. |
| FR-007 | `cli/findings.mjs` TDO002 `help`; `npm run docs:reference` (`docs/reference/findings.md`); `npm run llms`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (`@babel/parser`, already optional-loaded, through `realComments`)
**Testing**: `node:test` in `tests/todo-tracking.test.mjs`; `npm run benchmark` for SC-004
**Project Type**: CLI
**Performance Goals**: within the CI `budget` job's guard wall-time limit (×1.15). Measured before planning: 11 of this repository's 301 source files pass the keyword prefilter, and reading their comments takes about 38 ms cold.
**Constraints**: guard output on this repository may change only by the two quoted-form TDO002 findings (SC-002).

## Research decisions

- **Reuse the requirement-tag reader, not a second string scanner.** Spec 070 FR-005 already answers "is this text a comment?" for JS/TS (Babel, then the pattern lexer when Babel fails or is unavailable), Python, Go, Rust, Java, C#, Ruby and the other lexer languages. A second masker inside the validator would be a third definition of a comment in the codebase and would drift. Rejected: extending the existing `maskJsNonCode()` (JavaScript only; Python, Go and Ruby strings would stay unread).
- **Keep the line scanner where the reader has no language.** `.vue`, `.svelte` and `.astro` hold `<!-- -->`, `//` and `/* */` comments in one file; `realComments` would fall back to `#` comments only and lose them. They keep today's scanner, with code spans masked.
- **Mask code spans per comment line.** Annotations are reported per line, and a span is defined on the line it sits on. A backtick that closes on a later line is therefore literal and the keyword stays reportable: the miss, if any, is on the side of reporting. Rejected: spans across lines (needs paragraph rules; a `//` line sequence is several Babel comments, so it would work for block comments only).
- **Same-length, non-space placeholder.** Blanking spans to spaces would make ``// HACK: `setTimeout(0)` `` look like a keyword with no text, and the spec 019 patterns, which require text after the separator, would drop a real annotation. A non-space, non-word placeholder keeps offsets, keeps `\b` boundaries and keeps "text follows" true.
- **Extract from the original line.** The keyword's index comes from the masked line, the text from the original, so a reported TODO reads as written (``rename `foo` later``) and its tracking match against ROADMAP and similar docs is unchanged.
- **Drop the self-path skip instead of extending it.** Any path test (the running file, the package name, a `cli/validators/` suffix) still makes output depend on the install, or hides a user's file of the same name. With FR-001 the validator's own docstring is a quotation like any other, so the skip has nothing left to hide.
- **No new languages.** `realComments` also reads Kotlin, PHP, Swift, C and C++, which TODO tracking has never scanned. Adding them would add findings to projects that have none today; it is out of scope.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IV (validator isolation) | The validator imports scanners (`anchor-tags.mjs`, `pattern-lexer.mjs`), as it already imports `js-ast.mjs`; no validator imports another. |
| V (no LLM, no prose) | Deterministic text rules. |
| IX (honest assurance) | Only text DocGuard can show is a quotation or a string is dropped; an unmatched backtick and a cross-line span stay reportable. |
| X (spec-first) | Spec, plan and tasks precede code; tests fail first. |

Pass.

## Project Structure

```text
cli/validators/todo-tracking.mjs   # FR-001–FR-005
cli/findings.mjs                   # FR-007: TDO002 help
docs/reference/findings.md         # FR-007: generated (npm run docs:reference)
llms.txt, llms-full.txt            # generated (npm run llms)
tests/todo-tracking.test.mjs       # spec 073 cases, appended
testguard.claims.json              # TODO-QUOTED-FORMS claim
CHANGELOG.md                       # [Unreleased] Fixed
specs/073-todo-quoted-forms/       # spec, plan, tasks, checklists
```

No `data-model.md`, `contracts/` or `quickstart.md`: the finding shape and codes are unchanged, and verification is the task list's Phase 3.
