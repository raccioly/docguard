# Feature Specification: Quoted TODO Forms Are Not Annotations

**Feature Branch**: `fix/todo-quoted-forms`

**Created**: 2026-10-12

**Status**: Draft

**Spec ID**: `docguard.todo-quoted-forms`

**Lineage**: Found by the 0.45.0 release gate of `docguard.requirement-anchors` (spec 070, `checklists/remediation.md` gate item 3). Published 0.44.3, run in place on this repository, reports two TDO002 findings in `cli/validators/todo-tracking.mjs` (lines 51 and 58 at c9934dd): a doc comment quoting the accepted annotation forms inside backticks. The repository's own CLI does not report them only because the validator skips its own source file, so guard output depends on where DocGuard is installed. Successor of `docguard.ignore-and-todo-parsing` (spec 019), whose recognised forms it keeps.

**Input**: "TODO tracking reads keywords only where a developer wrote an annotation: a keyword inside an inline code span in a comment is a quotation, not an annotation; a keyword inside a string literal, template or regex is not a comment, so TODO tracking reads comments with the same string-aware reader as requirement tags; and the validator no longer skips its own source file, so guard output is independent of install location."

## Problem

TODO tracking reports untracked work: a comment where a developer wrote `TODO`, `FIXME`, `HACK`, `XXX`, `TEMP` or `WORKAROUND` as an annotation. It reports two kinds of text that are not annotations.

- **Quoted forms in comments.** A comment that documents the annotation forms, such as a style guide or this validator's own docstring, quotes them in backticks: ``Accepted forms: `TODO: …`, `HACK - …` ``. Each quote is read as an annotation. DocGuard hid this on its own code by skipping the validator's source file, which only works when the CLI running is that same file. Run from npm, the skip points at the installed copy, and the checkout's file is reported.
- **Keywords inside strings.** The scanner takes everything after the first `//`, `#`, `/*` or HTML comment opener on a line as a comment, including a marker that sits inside a string. `const url = "https://host/HACK: x"` and `const fixture = '// TODO: …'` are reported. Spec 070 built a string-aware comment reader for requirement tags (its FR-005); TODO tracking does not use it.

Each false finding costs a reader the time to open the file and decide it is not real, and teaches them to skim TDO002.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Documenting the forms is not a TODO (Priority: P1)

A maintainer writes a comment that lists the annotation forms the team accepts, quoting each in backticks.

**Independent Test**: A project whose only keyword occurrences are quoted forms in comments gets no TDO002.

**Acceptance Scenarios**:

1. **Given** ``// Accepted: `TODO: …`, `HACK - …`, `TEMP(ana) …`, `FIXME(bo): …` ``, **When** guard runs, **Then** nothing is reported.
2. **Given** ``// `TODO(ana): …` used to be reported as "ana): …" ``, **Then** nothing is reported.
3. **Given** `// TODO: fix retries`, **Then** it is reported, as before.
4. **Given** `// TODO fix retries` (bare, first word), **Then** it is reported, as before.
5. **Given** ``// TODO: rename `foo` later``, **Then** it is reported, and its text is ``rename `foo` later``.
6. **Given** ``// see `HACK - x`; FIXME: real``, **Then** one annotation is reported, as FIXME with the text `real`.

---

### User Story 2 - Strings are not comments (Priority: P1)

A source file holds a keyword inside a string, template or regular expression, behind a comment marker that belongs to the string.

**Independent Test**: A JavaScript, Python and Go file each holding only string-embedded keywords get no TDO002; a real comment in the same file still does.

**Acceptance Scenarios**:

1. **Given** `const a = '// TODO: not a comment';`, `const u = "https://example.com/HACK: x";` and a template literal holding `# FIXME: fixture`, **Then** nothing is reported.
2. **Given** the same file with `// TODO: real one` on another line, **Then** exactly that line is reported.
3. **Given** a Python string `"# TODO: s"` and a Go string `"// TODO: s"`, **Then** nothing is reported; a `# TODO:` comment in the Python file and a `// TODO:` comment in the Go file are.
4. **Given** a block comment whose third line is ` * TODO: investigate`, **Then** it is reported at that line's own number.
5. **Given** a `.vue`, `.svelte` or `.astro` file, **Then** it is scanned as before, by line.

---

### User Story 3 - Same result wherever DocGuard is installed (Priority: P1)

A maintainer runs guard on this repository from the checkout, and the release gate runs the published package from npm against the same tree.

**Acceptance Scenarios**:

1. **Given** this repository, **When** guard runs from the checkout and from an installed copy, **Then** both report the same TDO findings.
2. **Given** a copy of the validator's own source in a project, **When** guard runs, **Then** it reports nothing for that file, as for the original.

### Edge Cases

- A backtick run opens a code span only when the same comment line has a closing run of exactly the same length. ``` ``TODO: x`` ``` is a span; an unmatched backtick is literal text, so a keyword after it still counts.
- A code span that would continue onto the next comment line is not a span: each line is read alone, as each line is reported alone. The keyword stays reportable (the conservative side).
- A file the string-aware reader cannot read (a lexer failure) yields no comments, as it does for requirement tags.
- Two comments on one line are read separately; each can report one annotation.
- A comment whose only keyword is quoted, ``// `TODO`: fix the parser``, is a quotation and is not reported. Writing the keyword outside the backticks reports it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A TODO-family keyword inside an inline code span of a comment line MUST NOT be an annotation. A code span is a run of backticks and the next run of exactly as many backticks on the same comment line; a run with no such partner is literal text.
- **FR-002**: When a comment line has a keyword outside code spans, the annotation MUST be the first such keyword, and its reported text MUST be the original text after it, code spans included.
- **FR-003**: TODO tracking MUST read comments with the same string-aware comment reader as requirement tags (`docguard.requirement-anchors#FR-005`) for every source file whose language that reader knows, so a keyword in a string literal, template or regular expression is never an annotation. Files in languages the reader does not know (`.vue`, `.svelte`, `.astro`) MUST be scanned by line as before.
- **FR-004**: Each line of a multi-line comment MUST be read as its own annotation line and reported at its own source line number.
- **FR-005**: TODO tracking MUST NOT skip a file because it is DocGuard's own source; the result for a tree MUST NOT depend on where DocGuard is installed.
- **FR-006**: Every annotation form that `docguard.ignore-and-todo-parsing` recognises (its FR-002 to FR-004) MUST still be recognised when written in a real comment and outside code spans, with the same keyword and text.
- **FR-007**: TDO002's help, shown by `docguard explain TDO002` and the findings reference, MUST state that only comments count and that a keyword inside backticks or a string is a quotation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario above has a test; the tests for FR-001, FR-003 and FR-005 fail before the change and pass after it, and the spec 019 tests pass unchanged.
- **SC-002**: On a `git archive` export of this repository, `guard --format json` from the candidate differs from 0.44.3 only by the two TDO002 findings on the quoted forms in `cli/validators/todo-tracking.mjs`, plus differences already recorded for specs 070 and 072; against the main CLI at the base commit, the two TDO002 findings are the only difference.
- **SC-003**: On other real repositories exported the same way, every TDO difference between the base and the candidate is a removed finding whose keyword sits in a code span or a string. No other finding changes.
- **SC-004**: The TODO benchmark cases in the precision corpus keep their expected verdicts.

## Assumptions

- Backticks mean inline code in comments across the languages DocGuard scans (Markdown in JSDoc, rustdoc, godoc, docstrings), so reading them as a quotation is safe everywhere.
- Precision takes priority over recall for text that is plainly a quotation, as in spec 019.
- Reading comments through the string-aware reader costs tens of milliseconds on this repository (11 of 301 source files contain a keyword), within the guard wall-time budget.

## Out of Scope

- Scanning the further languages the comment reader knows (Kotlin, PHP, Swift, C, C++): that adds findings to projects that have none today and needs its own spec.
- Code spans across comment lines, and Markdown parsing beyond inline code.
- A suppression syntax for TODO findings: `todoIgnore` and quoting already cover it.
