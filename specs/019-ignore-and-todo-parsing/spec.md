# Feature Specification: Ignore and TODO Parsing Correctness

**Feature Branch**: `fix/ignore-and-todo-parsing`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.ignore-and-todo-parsing`

**Lineage**: supersedes open PR #453 (Jules: TODO annotation parsing) with a narrower fix that
keeps its tests. Records dogfood finding (e) from #455.

**Input**: User description: "Two parsers disagree with what adopters write: `.docguardignore`
directory patterns and TODO annotations with an author."

## Problem

- **`.docguardignore` has two parsers.** `cli/shared-ignore.mjs` (`buildIgnoreFilter`) treats
  a gitignore-style `dir/` as "this directory and everything under it". `cli/shared.mjs`
  (`loadIgnorePatterns`), a private copy that never received that fix, compiles `dir/` into a
  pattern that matches nothing. Guard's coverage map, Metrics-Consistency, Metadata-Sync,
  agent readability and semantic-claim extraction use the second parser. An adopter who writes
  `fixtures/` sees it honoured by some checks and silently ignored by others. This repository's
  own `.docguardignore` works around the bug by listing both `Research/` and `Research/**`.
- **TODO annotations with an author are mis-parsed.** `// TODO(ana): fix retries` is reported
  as `ana): fix retries`. Bare `// TODO fix retries` and `// FIXME fix retries`, the most common
  forms, are not recognised at all, because the pattern requires `:` or `(` right after the
  keyword.

PR #453 fixed both TODO problems but made every keyword match a bare following word. HACK,
XXX, TEMP and WORKAROUND are ordinary English in comments ("TEMP directory", "no HACK
needed"), so that change trades one miss for a stream of false findings.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One meaning for `.docguardignore` (Priority: P1)

**Independent Test**: With `.docguardignore` containing `notes/`, a Markdown file in `notes/`
is reported as ignored by guard's coverage map, and Metrics-Consistency does not read it.

**Acceptance Scenarios**:

1. **Given** a `dir/` pattern, **When** any DocGuard check consults `.docguardignore`,
   **Then** every file under `dir/` is ignored.
2. **Given** existing patterns (`*.bak`, `docs/**`, `SURFACE-AUDIT.md`), **When** evaluated,
   **Then** results are unchanged.

---

### User Story 2 - TODOs read as developers write them (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `// TODO(ana): fix retries`, **Then** the reported text is `fix retries`.
2. **Given** `// TODO fix retries` or `// FIXME fix retries`, **Then** it is reported.
3. **Given** `// TEMP directory path`, `// no HACK needed` or `// XXX marks the spot`,
   **Then** nothing is reported. HACK, XXX, TEMP and WORKAROUND still need `:`, `(`, or `-`.
4. **Given** `// TEMPLATE is here`, **Then** nothing is reported.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every consumer of `.docguardignore` MUST use one parser. `loadIgnorePatterns`
  MUST delegate to `buildIgnoreFilter`.
- **FR-002**: A TODO-family annotation MAY carry a parenthesised author (`KEYWORD(author)`).
  The extracted text MUST exclude the keyword, the author and the separator.
- **FR-003**: `TODO` and `FIXME` MUST be recognised when followed by whitespace and text.
- **FR-004**: `HACK`, `XXX`, `TEMP` and `WORKAROUND` MUST require a separator (`:`, `-`) or an
  author parenthesis, as before.
- **FR-005**: The regression tests from PR #453 MUST be kept, adjusted only where they assert
  the bare-word behaviour this spec rejects.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No `.docguardignore` pattern gives different answers in the two former parsers.
  A test enumerates this repository's own patterns.
- **SC-002**: The TODO benchmark cases in the precision corpus keep their expected verdicts.
- **SC-003**: Every example in User Story 2 behaves as stated.

## Assumptions

- Precision takes priority over recall for ambiguous English keywords, consistent with the
  measured-precision discipline in `docguard.precision-evidence-loop`.
