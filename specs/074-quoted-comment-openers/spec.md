# Feature Specification: A Quoted Comment Opener Hides Nothing

**Feature Branch**: `fix/requirement-ids-after-code-comment`

**Created**: 2026-10-12

**Status**: Draft

**Spec ID**: `docguard.quoted-comment-openers`

**Lineage**: Found by the session fixing TODO parsing (spec 073) while writing its spec: a requirement list that quotes an HTML comment opener in backticks lost every requirement after it. The requirement parser (`cli/shared-requirements.mjs`, from the spec lifecycle registry, #349) and the instruction-pointer reader (`cli/scanners/instruction-audit.mjs`, `docguard.path-scoped-rules` FR-003) both track HTML comments line by line and both read `<!--` inside an inline code span as a real comment opener.

**Input**: "The requirement-ID parser reads a backticked HTML comment opener in a spec as a real comment and silently drops every FR after it."

## Problem

In Markdown, text inside an inline code span is literal: `` `<!--` `` shows the four characters, it opens nothing. DocGuard's two line-by-line comment trackers did not know that. A spec line such as "- **FR-001**: Keep the `<!--` marker" opened a comment that never closed, so every requirement after it vanished: traceability under-counted, a tag citing one of them read as citing nothing (ANC007), and nothing said so. In an agent instruction file, every doc pointer after such a line went unchecked.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Requirements after a quoted opener are declared (Priority: P1)

A spec author writes "- **FR-001**: Strip the `<!--` and `-->` markers." followed by FR-002 and FR-003.

**Acceptance Scenarios**:

1. **Given** that spec, **When** DocGuard reads its requirements, **Then** FR-001, FR-002 and FR-003 are all declared.
2. **Given** a real HTML comment around FR-009, on one line or across several, **Then** FR-009 is not declared and the requirements outside the comment are.

### User Story 2 - Instruction pointers after a quoted opener are checked (Priority: P2)

An AGENTS.md line explains "wrap generated text in `<!-- docguard:section -->`", and a later line says "Read `docs/missing.md`".

**Acceptance Scenarios**:

1. **Given** that file, **When** the instruction audit reads its pointers, **Then** `docs/missing.md` is read and checked.

### Edge Cases

- A backtick run opens a code span only when a run of the same length closes it on the same line; an unclosed run is literal backticks, so a `<!--` after it still opens a comment.
- Inside a real comment, backticks are comment text: the comment ends at its first `-->`.
- A double-backtick span (`` `` `<!--` `` ``) is a code span too.

## Requirements *(mandatory)*

- **FR-001**: When the requirement parser decides what is inside an HTML comment, `<!--` and `-->` inside an inline code span (a run of backticks closed by a run of the same length on the same line) MUST be text. Requirements on later lines MUST be declared as if the code span were not there.
- **FR-002**: The instruction-pointer reader MUST apply the same rule, so pointers after a quoted opener are read.
- **FR-003**: A real HTML comment, on one line or across several, MUST still hide what it contains from both readers; a comment MUST end at its first `-->`.
- **FR-004**: Both readers MUST use one shared implementation of the rule, so they cannot drift apart.

## Success Criteria *(mandatory)*

- **SC-001**: Each of FR-001 to FR-003 has a test that fails before the change and passes after it.
- **SC-002**: On this repository, no requirement or pointer read before the change is lost, any it adds is listed in the tasks, and this spec's own requirements, whose lines quote `<!--`, are all declared.

## Assumptions

- A code span is recognised within one line. A span that CommonMark would let continue onto the next line of a paragraph is rare in requirement lists and is not handled.

## Out of Scope

- The doc-section markers (`docguard:section`) and generated-section readers, which find their own literal markers and do not track comment state across lines.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `4f46e9f6571abbd257c8c781b87cf6aaec9e3b52` — Reviewed at 4f46e9f (main after #574; shipped in #572): a !-- quoted in a code span opens nothing for requirement IDs or instruction pointers; real comments still hide. 13 tests; inventory of 441 Markdown files unchanged (1,853 IDs, 34 pointers); TestGuard 7/7. Reused by specs 073 and 078. Deviations: none. Evidence: `cli/shared-html-comments.mjs`, `cli/shared-requirements.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `tests/quoted-comment-openers.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
