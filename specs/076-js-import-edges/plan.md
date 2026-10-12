# Implementation Plan: JS/TS Import Edges from the Syntax Tree

**Branch**: `fix/js-import-edges` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

## Summary

`cli/scanners/import-graph.mjs` reads each JS/TS file once through a new `readImports(content, filename)`: it parses the file with the existing `parseJsTs`, and walks the tree for import declarations, re-exports, `require()`, TypeScript `import = require()`, `import()` and TypeScript `import()` types, reading the specifiers and the bound names in the same pass. JSDoc block comments are scanned for `import('…')` type references. When the parse is unavailable or fails, the old text reader runs instead, with its clause widened to span lines inside one statement and a second pattern for re-exports. The result carries its tier, which the graph puts on every edge and, for the fallback, in `limitations`.

| FR | Change |
|---|---|
| FR-001, FR-002 | `cli/scanners/import-graph.mjs`: `importsFromSyntaxTree(ast)` walks `ast.program` (imports inside `declare module` blocks included) and `ast.comments` (JSDoc only). `import()`, `TSImportType` and JSDoc references are `dynamic: true`; everything else static. `buildUncached` keeps `import()` out of `fileMap` as today. |
| FR-003 | `extractImportsFromText(content)`: the ES clause becomes `[^;'"]*?` (the bound `importNamesBySpec` already uses), with `\b` before `import`; a re-export pattern `\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+…)?\|\{[^}]*\})\s+from\s+['"]…['"]` is added. |
| FR-004 | `importsFromSyntaxTree` fills the names map from specifiers, `VariableDeclarator`s whose init is `require()` or `require().name`, and `TSImportEqualsDeclaration`; a spec reached by a form with unknown bindings is deleted from the map, so the edge's `names` is `null`. `importNamesBySpec` (text) stays the fallback's names reader. |
| FR-005 | `extractImports(content, filename)` returns `readImports(...).imports`; `cli/validators/architecture.mjs` `validateConfigLayers` passes the file name. |
| FR-008 | Edges gain `tier`. `buildUncached` pushes `js-parser-unavailable` once (`files: n`) when `astTierAvailable()` is false, else `js-parse-failed` per file. `architecture.mjs`: labels for both codes; ARC001/ARC003 take the edge's or file's tier, ARC002 `summarizeTiers` over the cycle's files. `cli/scanners/module-diagram.mjs`: `js-parser-unavailable` is a partial code over the in-scope JS/TS files. |
| FR-006 | Guard before (c9934dd, captured) and after; module-graph section diff; CHANGELOG `### Fixed`; PR body. |
| FR-007 | `docs-canonical/ARCHITECTURE.md` (import-graph and analyzer-tier rows), `docs/reference/languages.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`; `npm run llms`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18.
**Primary Dependencies**: `@babel/parser` (existing, optional-load). None added.
**Testing**: `node:test`. New `tests/js-import-edges.test.mjs`; the existing graph, architecture, diagram, anchors and impact suites must stay green.
**Performance**: measured at c9934dd on this repository's 550 JS files (6.0 MB, tests and fixtures included): the pattern reader takes 9 ms; parsing 120–170 ms, the walk about 40 ms. The graph is built once per run (spec 035 FR-008) and guard takes about 16 s here, so the cost is about 1–2% of guard. The budget A/B decides.

## Research decisions

- **Syntax tree first, pattern second, as for every other JS/TS reader.** Routes, schemas, env reads, anchors and the doc lock already read JS/TS through `parseJsTs` with the pattern as fallback (Analyzer tier row of ARCHITECTURE.md). Imports were the exception. A widened regex alone (rejected as the primary) still reads imports out of strings and comments (14 specifiers in `cli/` today, two of them resolving to real files), and it cannot read a clause that contains a quote or an apostrophe in a comment. The tree has neither problem.
- **The bound names come from the same parse.** The text reader of spec 070 splits a clause on commas, so a comment inside a multi-line clause drops the following name, and an apostrophe in that comment drops the whole statement. Reading names from the tree costs nothing extra once the file is parsed and makes edges and names agree by construction. Rejected: keeping the text reader for names at the tree tier (two readers that can disagree about one statement).
- **Unknown stays unknown.** `import()`, an unbound `require()` and a destructuring with a rest element bind names the tree cannot list. Deleting the spec from the names map makes the edge's `names` `null`, which ripple already treats as "binds everything". Rejected: recording an empty set (would silently drop a real ripple). A side-effect import is the opposite case: it provably binds nothing, so its set is empty and ripple skips it, which the text reader could not tell.
- **Re-exports are edges.** `export … from` loads its module at load time, so a cycle or layer crossing through a barrel file is real. The names reader of spec 070 already records re-exports as `all`, which assumed the edge existed. Both tiers read them, so the tiers agree.
- **Keep today's static/dynamic split.** `import type` is static (as the single-line pattern made it); `import()` is dynamic; TypeScript `import('…')` types and JSDoc `import('…')` references, which the pattern read as dynamic edges, stay dynamic. Changing the treatment of type-only references in cycle detection is a separate decision (spec, Out of Scope). Rejected: dropping JSDoc references because they are comments (a JS project that types with JSDoc would lose real dependencies from its diagram and layer checks).
- **The fallback is reported, per the analyzer-tier contract.** ARCHITECTURE.md says a validator is `partial` when an AST-capable language was read by the fallback; once imports have a tree tier, the graph has to say when it did not use it. The two causes mirror the Python codes (`python-interpreter-unavailable`, `python-parse-failed`). Only the parser-unavailable case makes the module diagram partial: spec 035 FR-007 makes environment-dependent gaps partial and code-dependent ones complete, and a file that does not parse is read the same way on every machine. Rejected: no signal at all (the tree tier would be invisible when it is missing), and making the diagram partial for a parse failure (GST002 would stop comparing the diagram of every project with one Flow file).
- **One walk, no pruning.** Imports can sit inside `declare module` blocks and `require()` anywhere, so the walk covers `ast.program`. The 40 ms walk is not worth a text pre-check whose mistakes would drop edges. Revisit only if the budget fails.
- **Layer specifier checks keep their text semantics.** ARC001 compares specifier text with configured directories (spec 045, Out of Scope). Only where the specifiers come from changes.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added; `@babel/parser` stays optional-load. |
| IV (validator isolation) | The scanner reads imports; the validator only maps tiers and labels. |
| V (no LLM) | Syntax tree and patterns only. |
| IX (honest assurance) | The fallback is a named limitation; findings carry their tier. |
| X (spec-first) | Spec, plan and tasks precede code; tests fail first. |

Pass.

## Project Structure

```text
cli/scanners/import-graph.mjs     # FR-001–FR-005, FR-008: readImports, importsFromSyntaxTree, extractImportsFromText, edge tier, limitations
cli/validators/architecture.mjs   # FR-005, FR-008: file name to extractImports, parserTier, limitation labels
cli/scanners/module-diagram.mjs   # FR-008: js-parser-unavailable is partial
tests/js-import-edges.test.mjs    # NEW
docs-canonical/ARCHITECTURE.md, docs/reference/languages.md, docs-canonical/TEST-SPEC.md, CHANGELOG.md   # FR-006, FR-007
testguard.claims.json             # claim JS-IMPORT-EDGES
```
