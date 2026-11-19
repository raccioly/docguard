---
title: Section-Addressable Docs
parent: Reference
nav_order: 7
---

# Section-Addressable Docs

DocGuard updates canonical docs *surgically*. It regenerates the parts that come
from code and never touches the prose a person wrote. It uses HTML-comment
markers for this, so the document stays plain, readable markdown.

## The marker format

```markdown
<!-- docguard:section id=api-endpoints source=code -->
| `GET` | `/api/users` | … |
<!-- /docguard:section -->
```

- **`id`** — a stable name for the section (for example `api-endpoints`, `entities`,
  `env-vars`, `screens`). DocGuard finds sections by id.
- **`source`** — `code` means DocGuard owns this block and may regenerate it from
  the code. `human` means the author owns it and DocGuard does not rewrite it.

Each marker must be on its own line. DocGuard ignores an open marker that has no
matching close marker. It never corrupts a malformed doc.

## What DocGuard does and does not touch

- When the code changes, it rewrites **only** the bytes between the open and
  close markers of a `source=code` section.
- **Everything outside the markers, and every `source=human` section, stays
  exactly as it is.** Your rationale, "why" notes and design intent are safe.

## Diagrams drawn from code

Two section ids hold mermaid diagrams that DocGuard draws from the code. Add the
empty marker where the diagram should go. Then run `docguard sync --write`. Add
`--force` if the doc is not marked `docguard:generated`:

```markdown
<!-- docguard:section id=module-graph source=code -->
<!-- /docguard:section -->
```

- **`module-graph`** (ARCHITECTURE) — a `graph LR` with one node per directory
  module. It has one edge for each pair of modules that have a static import
  between them. A dashed edge means a dynamic `import()` only. DocGuard does not
  draw tests, fixtures, examples or ignored paths. If there are more modules than
  `diagrams.moduleGraph.maxNodes` (default 30, at most 60), DocGuard groups
  modules one directory level higher. Then it merges the least-connected modules
  into one counted node. It draws at most 150 edges. A caption under the diagram
  states every reduction.
- **`entity-diagram`** (DATA-MODEL) — an `erDiagram` from the same schema scan as
  the `entities` table. Entities and relationships are sorted by name.

When imports or schemas change, Generated-Staleness reports the section (GST002).
Then `sync --write` redraws it. DocGuard never adds the marker to an existing doc.
`generate --plan --write` adds both markers when it creates the doc.

Sometimes the graph cannot be complete on this machine. For example, there may be
no Python interpreter for Python files, or a source file may be unreadable. Then
guard reports the check as `partial` and not as GST002. `sync --write` leaves the
committed diagram as it is unless you pass `--allow-partial`. Options: [`diagrams.moduleGraph`](configuration.md#code-derived-diagrams--diagramsmodulegraph).

## Why this matters

Markers make two things possible:

1. **Complete generation** — `docguard generate` writes code-derived sections
   inside markers. Then an agent fills in the prose around them.
2. **Docs that stay current** — when the code changes, `docguard sync` refreshes
   only the affected section. It does not regenerate the whole document and
   overwrite your prose.
