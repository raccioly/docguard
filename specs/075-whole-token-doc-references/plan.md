# Implementation Plan: Doc References Match Whole File Names

**Branch**: `fix/whole-token-doc-references` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002 | `cli/scanners/doc-references.mjs`: a new exported `namesToken(line, name)` tests a name as a whole token; `referenceKind` uses it for the path and basename kinds and keeps the backticked module test. |
| FR-003 | No consumer changes: `findReferences` (impact direct, indirect and `--prs`, `docsForPath`) and `trace --reverse` already call `referenceKind`. |
| FR-004 | `cli/commands/impact.mjs`: `docsReferencing` uses `namesToken` for the changed document's basename. |
| FR-005 | `cli/scanners/import-graph.mjs` and the indirect walk in `impact.mjs` are not edited. |
| FR-006 | `docs/commands.md` (`trace --reverse`), `docs-canonical/ARCHITECTURE.md` (MCP doc navigation row), `CHANGELOG.md`, `npm run llms`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/doc-reference-tokens.test.mjs` unit-tests `referenceKind` and `namesToken` and runs the input fixture through `impact`, `trace --reverse` and `docsForPath`.

## Research decisions

- **What exists.** The matcher (`cli/scanners/doc-references.mjs`):
  `if (line.includes(normalized)) return 'path'; if (line.includes(base)) return 'basename';`.
  Reconciliation already has a whole-path test for spec 069
  (`cli/scanners/reconciliation.mjs`):
  ``const PATH_EDGE = String.raw`[\s\x60'"()\[\],;:]`;``.
  It is not reused. It lists the characters allowed around a name, and it
  rejects `/` before a path on purpose (spec 069 FR-003: `x/scripts/old.sh`
  must not attribute a removal of `scripts/old.sh`). Attribution is an evidence
  gate, so a missed match there is the safe failure. Here a missed match is
  a doc nobody re-reads, so the rule must keep every way a doc names a file and
  drop only the names inside longer names.
- **Exclude file-name characters rather than list allowed edges.** *Rejected:*
  an allowlist of edges, ``(^|[/\s`'"(])b\.mjs`` style. Markdown puts many
  characters around a file name (`**b.mjs**`, `| b.mjs |`, `<b.mjs>`,
  `[b.mjs]`, `b.mjs#L3`), and each one an allowlist misses is a lost
  reference. The characters that make a name part of a longer one are few:
  letters, digits, `_` (`test_foo.py`), `-` (`user-service.ts`), `.`
  (`impact.test.mjs`), and the framework route sigils `$` (Remix), `+`
  (SvelteKit) and `@`.
- **Both sides.** The report is about the leading side (`hub.mjs`), but the
  trailing side has the same defect, and in TypeScript it is the common one
  (`index.ts` inside `index.tsx`, `config.js` inside `config.json`). A period
  ends the token only when no file-name character follows, so a sentence
  period still matches and `b.mjs.bak` does not.
- **ASCII file-name characters.** *Rejected:* `\p{L}` and `\p{N}`. Chinese,
  Japanese and Thai prose do not separate words with spaces, so
  `参见b.mjs文件` would stop matching. Removing those scripts from `\p{L}`
  needs the `v` flag (Node 20) or a lookahead inside a lookbehind, which is
  hard to read. The cost of ASCII is a collision between a non-ASCII letter
  and a name in one file name (`é.mjs` inside `résumé.mjs`).
- **`/` is an edge for both kinds.** `lib/src/a.mjs` keeps matching
  `src/a.mjs` by path, as today, and a GitHub URL stays a `path` match.
  `othersrc/a.mjs` stops being a path match and is a basename match, which is
  what it is.
- **Cost.** `namesToken` first checks `line.includes(name)`, so the regular
  expression is compiled only for lines that contain the name. Lines without
  it cost what they cost today.
- **No consumer edits.** `trace --reverse` calls `referenceKind` per line and
  `findReferences` serves the rest, so fixing the one function fixes every
  surface. Keeping `trace.mjs` untouched also keeps its requirement anchors
  reviewed.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | Text matches stay labelled heuristics; fewer false ones. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/doc-references.mjs        # FR-001, FR-002
cli/commands/impact.mjs                # FR-004
tests/doc-reference-tokens.test.mjs    # NEW: FR-001–FR-005
testguard.claims.json                  # new claim; MCP-DOC-TOOLS F1 follows the new line
docs/commands.md, docs-canonical/ARCHITECTURE.md, CHANGELOG.md, llms*.txt   # FR-006
```
