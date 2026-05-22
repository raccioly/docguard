---
description: Keep canonical docs always up to date — refresh code-truth sections in place, preserve human prose
allowed-tools: Bash, Read, Edit
---

# DocGuard Sync

Keep the documentation memory ALWAYS UP TO DATE. Sync re-derives every code-truth
section (endpoints, entities, screens, tech stack, env vars) and refreshes the
matching `source=code` sections of existing canonical docs in place. **Human prose
is never touched** — it lives outside markers or in `source=human` sections.

When a code section changes, the prose sections in that doc are flagged for agent review.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Execution

1. Preview what will change (dry run, never writes):

```bash
npx --yes docguard-cli@latest sync $ARGUMENTS
```

2. If only `source=code` sections are stale, apply the mechanical refresh:

```bash
npx --yes docguard-cli@latest sync --write $ARGUMENTS
```

3. For each "prose to review" line, **read the affected doc and update the
   surrounding human-written section to match the new code reality** (e.g. if the
   endpoints table grew, update the API overview prose). Then re-run guard:

```bash
npx --yes docguard-cli@latest guard
```

## Flags

- `--since <ref>` — also report which code files changed since this git ref (context for prose updates).
- `--write` — apply the mechanical refreshes. Default is a dry-run preview.
- `--force` — sync docs even without the `<!-- docguard:generated true -->` marker.
- `--format json` — machine-readable output (`updates`, `reviews`, `skipped`).

## When to use

- **Before opening a PR:** `docguard sync --since main` to refresh any stale sections.
- **On a pre-commit hook:** auto-keep the memory current.
- **After a big refactor:** confirm the doc map still matches the territory.

## Triage glyphs

- `↻` mechanically refreshed (code section updated)
- `•` stale (will refresh with `--write`)
- `🤖` prose to review — open the doc, update the relevant human-written section
