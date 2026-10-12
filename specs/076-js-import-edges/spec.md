# Feature Specification: JS/TS Import Edges from the Syntax Tree

**Feature Branch**: `fix/js-import-edges`

**Created**: 2026-10-12

**Status**: Draft

**Spec ID**: `docguard.js-import-edges`

**Lineage**: Corrects the JS/TS half of the import graph that `docguard.code-derived-diagrams` (spec 035, FR-001) moved into a scanner and that `docguard.language-repository-coverage` (spec 009, FR-005) shares between JS/TS and Python. Python imports have been read from Python's own syntax tree since spec 009 (FR-001); JS/TS imports were still read by one regular expression. Every consumer of the graph inherits the fix: the Architecture validator (ARC001–ARC003), the module diagram (spec 035), `diff --since` / `impact` indirect docs, the symbol map ranking (`docguard.symbol-map`, spec 036) and requirement-anchor ripple (`docguard.requirement-anchors`, spec 070 FR-031), including the names each import binds.

**Input**: "`extractImports` uses `/import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g`. `.` does not match newlines, so a multi-line named import produces no edge at all. DocGuard's own `cli/` has 16 such imports. Make the import regex span newlines without swallowing across statements, or better, use Babel's ImportDeclaration nodes where the AST tier is available, with the regex as the fallback. Keep dynamic `import()` excluded from cycle adjacency."

## Problem

A JS/TS file's imports are read by one regular expression whose clause, `.*?`, stops at the end of a line. Formatters such as Prettier break any import longer than the line width into one specifier per line:

```js
import {
  a,
  b,
} from './x.mjs';
```

That statement produces no edge. Measured on this repository at c9934dd, across the 192 JS files in `cli/`:

- 16 multi-line imports produce no edge;
- 2 re-exports (`export { … } from`) produce no edge: the pattern never read them, although a re-export loads its module exactly as an import does, and the binding-name reader of spec 070 already records them;
- 14 import-shaped strings and comments produce an edge or a specifier that does not exist in the code: source text a scanner builds for its own test fixtures, examples in doc comments.

The graph is then wrong in both directions. A cycle or a forbidden layer crossing through a multi-line import is never reported; a doc that depends on a file through one is not listed by `diff --since`; requirement-anchor ripple misses the importer; and a string that merely spells an import draws an edge that is not in the code.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Architecture checks see every import (Priority: P1)

A maintainer formats code with Prettier. A file in `src/routes/` imports three helpers from `src/db/` in an import broken over five lines, and ARCHITECTURE.md declares that routes may not import db.

**Acceptance Scenarios**:

1. **Given** that import, **When** `docguard guard` runs, **Then** the Architecture validator reports the layer violation (ARC003), as it does for the same import on one line.
2. **Given** `a.mjs` imports `b.mjs` on one line and `b.mjs` imports `a.mjs` in a multi-line named import, **Then** ARC002 reports the cycle.
3. **Given** the same cycle where `b.mjs` reaches `a.mjs` only through `await import('./a.mjs')`, **Then** no cycle is reported, as today.
4. **Given** `layers` in `.docguard.json` forbid `routes` from importing `db`, **When** the import crossing them spans lines, **Then** ARC001 is reported.

### User Story 2 - Diagrams, impact and ripple follow the same edges (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a multi-line import from `src/api/` to `src/core/` and no other import between them, **Then** the module diagram draws `src/api → src/core`.
2. **Given** a doc that covers `src/core/service.mjs`, **When** `docguard diff --since <ref>` runs after a change to a file that imports it in a multi-line import, **Then** the doc is listed as indirectly affected.
3. **Given** `import {\n  formatTotal, // keeps the caller's rounding\n  parse,\n} from './money.mjs'`, **Then** the edge records `formatTotal` and `parse` as the bound names, so requirement-anchor ripple names the importer when `parse` changes.

### User Story 3 - Text that only looks like an import is not an edge (Priority: P2)

A scanner builds test-fixture source in a template literal (`` `import x from './y.js'` ``); a doc comment shows `// import { a } from './old.js'`.

**Acceptance Scenarios**:

1. **Given** either text in a file the syntax tree can read, **Then** no edge is recorded for it.
2. **Given** `/** @param {import('./types.js').Order} order */`, **Then** the dynamic edge to `./types.js` that the pattern reader recorded is still recorded: a JSDoc type reference names a real dependency.

### User Story 4 - The fallback still reads multi-line imports (Priority: P2)

The parser is unavailable (a files-only vendoring of DocGuard), or a file does not parse (Flow annotations in a `.js` file).

**Acceptance Scenarios**:

1. **Given** a multi-line named import in such a file, **Then** its edge is recorded.
2. **Given** `import './polyfill';` followed by `const s = "x";` and `import a from './a';`, **Then** the edges are `./polyfill` and `./a` and nothing else: the clause never extends across a statement.

### Edge Cases

- `import type { T } from './t'` and `import type {\n T,\n} from './t'` are static edges, as single-line type imports are today.
- `import a, { b, c } from './m'` and `import a, * as ns from './m'` are one edge each, binding the default and the named or namespace names.
- A side-effect import (`import './x'`) is an edge that binds no name.
- The same module imported both statically and with `import()` gives a static edge and a dynamic edge; the static one is in cycle adjacency.
- `export * from './x'`, `export * as ns from './x'`, `export { a } from './x'` and `export type { T } from './x'` are static edges. `export { a }` with no source is not an edge.
- `const { a, b: c } = require('./x')` binds `a` and `b`; `const x = require('./x').foo` binds `foo`; `const m = require('./x')` and TypeScript's `import m = require('./x')` bind the namespace `m`.
- A `require()` whose result is not bound to a name, a destructuring with a rest element or a computed key, and any `import()` leave the bound names unknown, so ripple stays conservative for that importer.
- `require(name)` and a template literal with substitutions are not edges. A template literal without substitutions is a static specifier and is an edge at the syntax-tree tier.
- `require.resolve('./x')` is not an edge, as today.
- `let t: import('./x').T` and `/** @type {import('./x').T} */` are dynamic edges, as today; `// import('./x')` in a line comment is not an edge.
- Imports inside an ambient `declare module '…' { … }` block in a `.d.ts` file are edges.
- A file whose syntax error the parser recovers from is read from its recovered tree; a file it cannot recover from is read by the fallback.
- At the fallback tier, a clause that contains a quote or a semicolon (a string-named specifier, an apostrophe in a comment inside the braces) is not read, and comments or strings that spell an import are still edges. Both are limits of a pattern, documented here and in the docs; the syntax-tree tier has neither.

## Requirements *(mandatory)*

- **FR-001**: When the JS/TS syntax-tree tier is available and a file parses, the import graph MUST read that file's imports from its syntax tree:
  - every import declaration, whatever the shape of its clause and however many lines it spans, including `import type` and side-effect imports;
  - every re-export that names a source (`export * from`, `export * as ns from`, `export { … } from`, `export type { … } from`);
  - `require()` calls and TypeScript `import x = require()` declarations with a static specifier;
  - `import()` expressions with a static specifier;
  - type references that load nothing at run time but name a module: TypeScript's `import('…')` type and `import('…')` inside a JSDoc `/** … */` comment.

  Any other text in comments, strings and template literals MUST NOT become an edge.
- **FR-002**: `import()` and the two type references MUST stay dynamic edges, as they are today: recorded in the graph's edges, so layer checks see them and the module diagram draws them dashed, and excluded from cycle adjacency. Every other form in FR-001, `import type` and re-exports included, MUST be a static edge.
- **FR-003**: When the syntax-tree tier is unavailable or a file cannot be parsed, the graph MUST read that file with a text pattern whose import clause may span lines but never extends across a `;` or a quote, and which also reads re-exports that name a source. For the forms of FR-001 written without quotes or semicolons inside the clause, the pattern MUST return the same specifiers as the syntax tree.
- **FR-004**: At the syntax-tree tier, the names each edge binds (spec 070 FR-031) MUST come from the same syntax tree:
  - named imports by their exported name, type-only names included;
  - the default import, including `{ default as x }`;
  - a namespace: `* as ns`, `const m = require()`, `import m = require()`;
  - destructured `require()` properties, and the property of `require('…').name`;
  - `all` for a re-export, as today.

  A side-effect import MUST bind no name. A form whose bindings cannot be read statically (`import()`, a `require()` not bound to a name, a destructuring with a rest element or a computed key) MUST leave the specifier's names unknown, which ripple treats conservatively. A comment inside a multi-line clause MUST NOT drop a name. At the fallback tier the existing text reading applies, and MUST read multi-line clauses.
- **FR-005**: The configured-layer check (ARC001, `layers` in `.docguard.json`) MUST read imports through the same function as the graph, so the same file gives the same specifiers to both.
- **FR-006**: The effect on this repository MUST be measured by running `docguard guard` before and after, and every new or removed Architecture finding and every change to the module-graph section MUST be listed in the PR body and in the CHANGELOG under `### Fixed`, with a note that adopters may see new ARC001, ARC002 or ARC003 findings and a GST002 for a module graph that gains an edge.
- **FR-007**: `docs-canonical/ARCHITECTURE.md` (the import-graph and code-derived diagram rows), `docs/reference/languages.md` (how JS/TS imports are read) and `docs-canonical/TEST-SPEC.md` MUST describe the two tiers, which forms are edges, and the fallback's limits.
- **FR-008**: Every JS/TS edge MUST record which tier read it (`js-ast` or `regex-fallback`), as Python edges record `py-ast`, and the analyzer-tier contract of `docs-canonical/ARCHITECTURE.md` MUST hold for the graph:
  - ARC001, ARC002 and ARC003 MUST carry the `parserTier` of the files they cite (`mixed` when a cycle crosses tiers);
  - a JS/TS file read by the fallback MUST be a graph limitation, so the Architecture validator reports `partial` with the reason: the parser is unavailable (one limitation for all files), or the named file did not parse;
  - the module diagram MUST be `partial` when the parser is unavailable, because the same code would draw differently on a machine that has it (spec 035 FR-007). A file that does not parse draws the same on every machine and leaves the diagram complete.

## Success Criteria *(mandatory)*

- **SC-001**: Each of FR-001 to FR-005 and FR-008 has a test that fails before the change and passes after it. The tests cover, at both tiers where the fallback supports the form: a multi-line named import, `import type` on one line and over several, a default plus named import, a namespace import, a side-effect import, the re-export forms, `require()`, TypeScript `import = require()`, and `import()` staying out of cycle adjacency.
- **SC-002**: On this repository, every multi-line import declaration and every re-export in `cli/` that resolves to a project file is an edge, and the import-shaped text that `cli/feedback-fixture.mjs` writes into generated test files is not. At c9934dd that is 16 multi-line imports and 2 re-exports gained, and 14 import-shaped specifiers lost.
- **SC-003**: The CHANGELOG entry records the guard before/after comparison on this repository: every Architecture finding and module-graph change, or that there are none, and the note for adopters.

## Assumptions

- The syntax-tree tier is `@babel/parser`, the project's one runtime dependency, loaded optionally with the per-extension plugins every other JS/TS AST reader in DocGuard uses (`cli/scanners/js-ast.mjs`). No dependency is added.
- The graph is built once per guard run (spec 035 FR-008), so the parse cost is paid once per run, not per consumer.
- Type-only imports stay static edges in cycle adjacency, as they are today for a single-line `import type`. Whether a type-only cycle should be reported is a separate decision.

## Out of Scope

- Excluding type-only imports from cycle detection.
- Specifier resolution (relative paths, extensions, index files, `compilerOptions.paths` aliases): unchanged.
- Bundler-specific forms: `require.context`, `import.meta.glob`, webpack magic comments.
- Python imports, which already come from Python's syntax tree.
- Sharing parsed syntax trees between scanners.
