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

## Why this matters

This is the foundation for two things:

1. **Complete generation** — `docguard generate` writes code-derived sections inside
   markers, then an AI agent fills the prose around them.
2. **Always up to date** — `docguard sync` refreshes just the affected section when
   code changes, instead of regenerating (and clobbering) the whole document.
