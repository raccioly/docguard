# Section-Addressable Docs

DocGuard maintains canonical docs *surgically*: it regenerates the parts that are
derived from code while never touching the prose a human wrote. It does this with
HTML-comment markers that keep the document plain, readable markdown.

## The marker format

```markdown
<!-- docguard:section id=api-endpoints source=code -->
| `GET` | `/api/users` | … |
<!-- /docguard:section -->
```

- **`id`** — a stable identifier for the section (e.g. `api-endpoints`, `entities`,
  `env-vars`, `screens`). DocGuard addresses sections by id.
- **`source`** — `code` means DocGuard owns and may regenerate this block from the
  codebase; `human` means it is author-owned and DocGuard will not rewrite it.

Markers must each sit on their own line. An open marker with no matching close is
ignored (DocGuard never corrupts a malformed doc).

## What DocGuard does and does not touch

- It rewrites **only** the bytes between a `source=code` section's open and close
  markers when the underlying code changes.
- **Everything outside any marker — and any `source=human` section — is preserved
  exactly.** Your rationale, "why" notes, and design intent are safe.

## Diagrams drawn from code

Two section ids hold mermaid diagrams that DocGuard draws from the code. Add the
empty marker where the diagram should go, then run `docguard sync --write` (add
`--force` if the doc is not marked `docguard:generated`):

```markdown
<!-- docguard:section id=module-graph source=code -->
<!-- /docguard:section -->
```

- **`module-graph`** (ARCHITECTURE) — a `graph LR` with one node per directory
  module and one edge per pair of modules with a static import between them. A
  dashed edge is a dynamic `import()` only. Tests, fixtures, examples and ignored
  paths are not drawn. Over `diagrams.moduleGraph.maxNodes` (default 30, at most
  60), modules are grouped one directory level higher, then the least-connected
  are merged into one counted node; at most 150 edges are drawn. A caption under
  the diagram states every reduction.
- **`entity-diagram`** (DATA-MODEL) — an `erDiagram` from the same schema scan as
  the `entities` table, with entities and relationships sorted by name.

When imports or schemas change, Generated-Staleness reports the section (GST002)
and `sync --write` redraws it. An existing doc without the marker is never given
one; `generate --plan --write` adds both when it creates the doc.

When the graph cannot be complete on this machine (no Python interpreter for
Python files, an unreadable source file), guard reports the check as `partial`
instead of GST002, and `sync --write` leaves the committed diagram alone unless
you pass `--allow-partial`. Options: [`diagrams.moduleGraph`](configuration.md#code-derived-diagrams--diagramsmodulegraph).

## Why this matters

This is the foundation for two things:

1. **Complete generation** — `docguard generate` writes code-derived sections inside
   markers, then an AI agent fills the prose around them.
2. **Always up to date** — `docguard sync` refreshes just the affected section when
   code changes, instead of regenerating (and clobbering) the whole document.
