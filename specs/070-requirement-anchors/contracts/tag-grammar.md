# Contract: Tag Grammar and Scope Resolution

## Grammar (inside a comment, never inside a literal)

```text
tag        := "@" verb WS requirement [WS scopeBlock]
verb       := "implements" | "req" | "covers"
requirement:= specId "#" reqId | path "#" reqId | reqId
reqId      := PREFIX "-" DIGITS{2,4}            ; existing DEFAULT_REQ_PATTERNS, or config.traceability.requirementPattern
scopeBlock := "{" "scope" "=" ("file"|"symbol"|"statement"|"route") "}"
```

- One requirement per tag. Further IDs after a comma keep the first ID and
  produce ANC006.
- Anchors come only from `@implements` and `@req` in files that are not
  tests. `@covers`, and every tag in a test file, is test evidence (US6).
- Languages without a lexer (YAML, shell) use the `file` tier.
- Comment syntax per language: `//` and `/* */` (C family, JS/TS, Go, Rust,
  Java, Kotlin, C#, Swift, PHP), `#` (Python, Ruby, shell, YAML, PHP), and
  Python docstrings for tags placed inside them.

## Positional scope (no scope block)

| Position | Scope |
|---|---|
| Leading comment block followed by an import, another comment, or the end of the file | file |
| Comment ending on the line directly above a declaration (decorators and annotations may sit between, no blank line) | symbol |
| Leading block directly above a declaration, no import between | file + ANC006 (ambiguous) |
| Directly above a top-level variable declaration, any initializer | symbol (the variable name) |
| Inside a function body, above a statement | statement |
| Above any other top-level statement (a call, an expression) | statement under `<module>` |
| Above a statement a route extractor recognises | route (`route:<METHOD> <path>`) |
| Inside a Python docstring | symbol of the docstring's owner |
| Any position in a file whose delimiters do not balance (pattern tier) | file + ANC006 |

An explicit scope that does not resolve (`{scope=symbol}` with no declaration
below) produces ANC006. The tag still counts as file-scope evidence (FR-006).

## Importers (US9, opt-in through `anchors.import`)

| Source | Recognised form | Mapping |
|---|---|---|
| StrictDoc | `@relation(<ID>[, scope=<s>][, role=<r>])` or `@relation{…}` | `anchors.importMap["strictdoc:<ID>"] = "<specId>#<REQ>"`; `scope=function\|class` gives symbol, `file` gives file, `line\|range_*` gives statement |
| OpenFastTrace | `[impl->dsn~name~3]`, `[impl~x~1->req~y~2>>impl,test]` | `anchors.importMap["oft:<type>~<name>"] = { "requirement": "<specId>#<REQ>", "revision": 3 }`. A tag revision that differs from the mapping produces ANC001 with `side: "code", cause: "oft-outdated"` |

Foreign tags are never written. An unmapped ID produces ANC007. A symbol that
carries a native tag and a foreign tag for different requirements produces
ANC006; the same requirements through both systems are not a problem.

- **Placement.** Foreign tags anchor by position, like native ones.
  - StrictDoc `range_start` anchors the statement after it, and `range_end`
    is ignored, because a range is not a scope DocGuard anchors.
  - An unknown StrictDoc scope is read by position, with ANC006.
- **OpenFastTrace form.** The covering item may carry its own ID
  (`[impl~x~1->req~y~2]`). The `>>impl,test` suffix is accepted and not used.
- **Opt-in.** Only enabled importers are read. Their syntax joins the
  file prefilter, the Python candidate lines and the anchor cache's identity.
