# Implementation Plan: Doc Ownership Map

**Branch**: `feat/doc-ownership-map` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

- A new scanner, `cli/scanners/doc-ownership.mjs`, loads the `ownership` block,
  compiles each entry's patterns with `compileGlob` (`cli/shared-ignore.mjs`),
  and exposes `resolveOwner(path)`, `ownershipReport(projectDir, config)`
  (owners per file, ties, unowned directories, dead entries) and
  `lintDevinWiki(projectDir)`. It caches the compiled map per config key for
  the life of the process, which the long-lived MCP server needs (SC-004).
- Default roots come from `scanComponents` (`cli/scanners/inventory.mjs`), the
  same top-level module list that fills the ARCHITECTURE component map.
- Section checks use `parseSections` (`cli/writers/sections.mjs`) for ids and
  `slugifyHeading`/`extractHeadings` for anchors. Those move to
  `cli/shared-headings.mjs` in `docguard.mcp-doc-tools`; if this spec lands
  first, it does the move.
- The tracked-file list comes from `listTrackedFiles` in `cli/shared-git.mjs`
  (added by `docguard.path-scoped-rules`, or here if this spec lands first).
- A new validator, `cli/validators/doc-ownership.mjs`, emits OWN001–OWN007.
- `trace --owners` and `trace --owners --suggest` are new modes in
  `cli/commands/trace.mjs`, beside `--reverse` and `--features`. The draft
  uses `scanComponents`, the `@doc` scan and `TRACE_MAP`. `runTraceReverse`
  prints the declared owner first.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Storage**: `.docguard.json` (`ownership` block, human-owned)
**Testing**: `node:test` fixtures in temporary git repositories
**Performance Goals**: ≤3% guard wall time (SC-003); owner lookup under 50 ms
warm (SC-004)
**Constraints**: no network; no writes to config

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IV (validator isolation) | The validator imports the scanner; `trace`, MCP and `review` compose it. |
| V (no prose) | `--suggest` prints a draft with placeholder purposes; DocGuard never writes `purpose` or the config. |
| VI (safe writes) | Not applicable: nothing is written. |
| VIII (local-first) | `.devin/wiki.json` is linted as a local file. Nothing is fetched. |
| IX (honest assurance) | A broken map is an error, never a pass. `trace --reverse` labels owners `declared` and text matches heuristic. |

Pass.

## Project Structure

```text
cli/scanners/doc-ownership.mjs          # NEW: load, resolve, report, Devin wiki lint, limits constant
cli/validators/doc-ownership.mjs        # NEW: OWN001–OWN007
cli/findings.mjs                        # OWN001–OWN007
cli/commands/guard.mjs                  # register the validator
cli/commands/trace.mjs                  # --owners, --owners --suggest; owner line in --reverse
cli/docguard.mjs                        # --owners, --suggest flags and help
cli/config.mjs                          # ownership defaults; validators.docOwnership
schemas/docguard-config.schema.json     # ownership block
cli/shared-git.mjs                      # listTrackedFiles, if not already added
cli/commands/mcp.mjs                    # owner in docguard_docs_for_path (after 031)
cli/commands/review.mjs                 # covers candidates in --suggest (after 029)
.docguard.json                          # adopt for cli/, extensions/, tools/, benchmarks/, tests/ (FR-008)
README.md, docs/configuration.md, docs/commands.md
docs-canonical/ARCHITECTURE.md, docs-canonical/DATA-MODEL.md
tests/doc-ownership.test.mjs            # NEW
tests/fixtures/doc-ownership/           # NEW
testguard.claims.json                   # DOC-OWNERSHIP-ONE-OWNER-PER-PATH
```

## Design notes

- A file's owner is found by testing entries in descending specificity
  (exact path, then literal prefix length, then entry order for reporting
  only). The first two equally specific matches make a tie.
- "Highest unowned directory" walks up from each unowned file while the parent
  is also wholly unowned and still under a root. Output is sorted.
- Wiki path mentions are found with the instruction audit's path lexer
  (`pathCandidates`), so the rule for "looks like a path" is shared.
