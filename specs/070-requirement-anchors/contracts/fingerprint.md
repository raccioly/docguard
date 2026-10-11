# Contract: Fingerprints

## Algorithms

| ID | Used by | Form | Stability promise |
|---|---|---|---|
| `doclock-v0` | `.docguard-doc-lock.json` (spec 030) | `sha256:<hex>` | byte-identical to the 0.44.x doc-deps output |
| `v1` | the anchor lock | `dg1:sha256:<hex>` | fixed by the golden fixtures. Any change bumps to `dg2` |

## v1 exact tier: what is removed

- positions, ranges and `extra` (Babel); `lineno`, `col_offset` and
  `end_*` (Python)
- whitespace and layout
- comments, except allowlisted directives
- docstrings (Python, and a JS function's leading `"use strict"` is kept
  because it is a directive)
- the declaration's own name: the `id` of a function, class or variable, a
  method's `key`, and Python's `name`

## v1 exact tier: what is kept

- decorators and annotations, verbatim in AST form
- parameters, defaults and type annotations
- the body
- literals: strings verbatim (no quote-style difference survives the AST),
  numbers by value
- directive comments that fall inside the span, in source order:
  `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`,
  `eslint-disable-next-line`, `eslint-disable-line`, `//go:build`,
  `// +build`, `//go:generate`, `/*#__PURE__*/`, `/*@__PURE__*/`,
  `# type: ignore`, `# noqa`, `# pragma: no cover`

## Floor (`pattern@1`)

- The token stream from DocGuard's own lexer over the span.
- Comments are dropped except directives. Literals are kept verbatim.
- Every whitespace run collapses to nothing between tokens.
- In Go, a `;` token is emitted wherever a newline ends a statement under the
  language specification's semicolon-insertion rule. Kotlin, Swift and Ruby
  follow the same rule on a best-effort basis.
- Python gets indent/dedent markers, so re-indenting a whole block keeps the
  floor while moving a statement into or out of a block changes it.
- Inside literals, `\r\n` becomes `\n`, so CRLF checkouts give the same floor.
- The floor is computed for every link in every language, so any two machines
  can compare at this level.

## Requirement fingerprint

- The block runs from the requirement declaration through the line before the
  next requirement declaration, a heading, or a list item at the same or
  shallower indent.
- The implementation-outcomes block and review stamps are removed.
- The text is normalized with Unicode NFC, `\r\n` → `\n`, and every whitespace
  run → one space, then trimmed.

## Comparison

1. Same exact tier on both sides: compare the exact fingerprints.
2. Otherwise, compare the floors. An equal floor means current, with a note
   that the tier changed.
3. A stored algorithm version DocGuard still supports: recompute with that
   version. Equal means current, with a "restamp" note. An unsupported version
   is unverifiable (ANC010).
4. Neither comparison is possible: unverifiable (ANC010).

## Tree-sitter tier (`treesitter@<hash8>`, opt-in, FR-009)

- **Scope.** Only symbols the pattern tier found, matched by name and name
  line. It never adds an anchor, so a key does not depend on the tier.
- **Exact.** `dg1:sha256:` of the declaration's leaves in source order:
  - a named leaf is `type:text`, and an anonymous leaf is its text;
  - comments, the declaration's own name, `,` and `;` are skipped;
  - a parenthesized expression contributes only what it encloses.
- **Floor.** The pattern tier's, over the pattern tier's span, so a machine
  without the tier still compares at the floor.
- **Tier id.** `treesitter@` followed by the first 8 hex digits of a sha256
  over the runtime, its wasm, and each language's grammar hash.
- **Declarations.** The node types per language are in
  `cli/scanners/ts-decls.mjs`, shared with the CI oracle.
