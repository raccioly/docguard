# Implementation Plan: MCP Doc Tools

**Branch**: `feat/mcp-doc-tools` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

- A new scanner, `cli/scanners/doc-references.mjs`, holds the one reference
  matcher. It replaces the private `findReferences` in `cli/commands/impact.mjs`
  and the inline loop in `runTraceReverse` (`cli/commands/trace.mjs`). Both
  commands call it with the same doc sets they use today.
- A new scanner, `cli/scanners/doc-structure.mjs`, builds a doc outline from
  `inspectSections` (`cli/writers/sections.mjs`), the `FACT_MARKER_RE` from
  `cli/scanners/as-built.mjs`, and headings. `slugifyHeading` and
  `extractHeadings` move from `cli/validators/cross-reference.mjs` to
  `cli/shared-headings.mjs`. The validator re-exports them, so scanners do not
  import a validator (Constitution IV).
- `cli/commands/mcp.mjs` adds four entries to `TOOLS` and `TOOL_HANDLERS`.
  `docguard_task_context` calls `buildTaskContextPacket`. Every file read goes
  through `createEvidenceReader` (`cli/scanners/semantic-claims.mjs`).
- Requirement IDs come from `scanImplementationFilesForReferences`
  (`cli/scanners/requirement-evidence.mjs`), called for the one file. `@doc`
  headers reuse the regex of `scanDocAnnotations`
  (`cli/validators/traceability.mjs`), moved to the new references scanner.
- `covers` and `owner` read the parsed marker attribute and the ownership
  config when present, and report `not-declared` or `not-configured`
  otherwise. This spec does not depend on 029 or 033 being merged.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Storage**: none; read-only
**Testing**: `node:test`; the JSON-RPC client already in `tests/mcp.test.mjs`
**Performance Goals**: each call on this repository under 500 ms; responses
within SC-002
**Constraints**: no network, no LLM, no writes, bounded output

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IV (validator isolation) | Heading helpers move to a shared module; new code lives in scanners and the MCP command. No validator imports a command. |
| V (no prose) | Tools return document bytes and parsed structure. DocGuard writes nothing. |
| VI (safe writes) | Not applicable: no writes. The disk plan cache is not touched. |
| VIII (local-first) | No network, no model. FR-009 forbids an `ask` tool. |
| IX (honest assurance) | Text matches are labelled heuristic; `covers` and owner report `not-declared` rather than an empty "no docs". Caps report totals. |

Pass.

## Project Structure

```text
cli/scanners/doc-references.mjs     # NEW: findDocReferences, agent-file lines, @doc headers
cli/scanners/doc-structure.mjs      # NEW: outline, section read by id/anchor/heading, byte caps
cli/shared-headings.mjs             # NEW: slugifyHeading, extractHeadings (moved)
cli/validators/cross-reference.mjs  # re-export the moved helpers
cli/validators/traceability.mjs     # scanDocAnnotations regex from doc-references
cli/commands/mcp.mjs                # four tools, handlers, input schemas
cli/commands/trace.mjs              # runTraceReverse uses findDocReferences
cli/commands/impact.mjs             # findReferences replaced
server.json, mcpb/manifest.template.json, smithery.yaml   # tool listings (FR-010)
docs/ai-integration.md, docs/commands.md, README.md       # tool tables
budgets.json                        # fixed MCP requests (after docguard.non-regression-budgets)
tests/mcp-doc-tools.test.mjs        # NEW
tests/mcp.test.mjs                  # tool count 7 → 11
testguard.claims.json               # MCP-DOC-TOOLS-READ-ONLY-AND-BOUNDED
```

## Design notes

- Section read by anchor ends at the next heading of the same or higher level,
  so a `###` read does not stop at its own `####` children.
- Truncation cuts at the last newline before the limit. `nextOffset` is a byte
  offset into the section body, so a client can page.
- `exists: false` is checked with `lstat` on the safe path, without reading
  the file, so a deleted file is still a valid query.
