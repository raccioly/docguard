# Implementation Plan: A Quoted Comment Opener Hides Nothing

**Branch**: `fix/requirement-ids-after-code-comment` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-003, FR-004 | NEW `cli/shared-html-comments.mjs`: `stripHtmlComments(line, inComment)` returns the line's text outside HTML comments and whether a comment is still open at its end. It finds `<!--` and `-->` only outside inline code spans, and ends a comment at its first `-->`. `cli/shared-requirements.mjs` `collectRequirementIdsFromContent` uses it in place of its own tracker. |
| FR-002 | `cli/scanners/instruction-audit.mjs` `extractInstructionPointers` uses it in place of its own tracker. |
| SC-002 | The requirement inventory of every spec and canonical doc, and the pointers of every agent instruction file, are compared before and after; the differences are listed in tasks.md. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; `tests/quoted-comment-openers.test.mjs`

## Research decisions

- **Code spans by CommonMark's rule, within a line.** A backtick run opens a span only when a run of the same length closes it, so `` `<!--` `` and ``` `` `<!--` `` ``` are spans and a lone backtick is not. Rejected: stripping every backticked substring with a regex (an unclosed backtick would then hide a real comment opener after it).
- **One helper, and the comment ends at its first `-->`.** The two trackers differed in order: one removed complete comments before closing an open one, the other closed first. HTML ends a comment at the first `-->`, so the helper closes first. The two orders differ only on a line that both closes a multi-line comment and holds another complete one, and this repository has none.
- **The requirement parser keeps reading IDs from the original text.** Only comment detection looks through the code-span mask; `` `FR-001` `` at the start of a list item is still a declaration, as before.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | Requirements and pointers are no longer dropped without a trace. |
| X (spec-first) | Spec, plan and tasks precede code; tests fail first. |

Pass.

## Project Structure

```text
cli/shared-html-comments.mjs            # NEW: FR-001, FR-003, FR-004
cli/shared-requirements.mjs             # FR-001
cli/scanners/instruction-audit.mjs      # FR-002
tests/quoted-comment-openers.test.mjs   # NEW
docs-canonical/ARCHITECTURE.md, docs-canonical/TEST-SPEC.md, CHANGELOG.md
```
