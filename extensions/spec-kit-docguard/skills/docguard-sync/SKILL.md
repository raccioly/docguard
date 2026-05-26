---
name: docguard-sync
description: Keep canonical documentation ALWAYS UP TO DATE. Refreshes code-truth doc sections in place (mechanical, idempotent, preserves human prose) and flags the prose sections you must review when code changes.
compatibility: Requires DocGuard CLI installed (npm i -g docguard-cli or npx docguard-cli)
metadata:
  author: docguard
  version: 0.21.1
  source: extensions/spec-kit-docguard/skills/docguard-sync
---

# DocGuard Sync Skill

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input. If `--since <ref>` is provided, include the
git diff context in your reasoning when reviewing prose sections.

## Goal

When code changes, re-derive the code-truth surface (endpoints, entities,
screens, tech stack, env vars), refresh the matching `<!-- docguard:section
source=code -->` blocks in canonical docs in place, and **review/refresh the
human-written prose** in the same docs so it still describes reality.

## Operating Constraints

- **Mechanical refreshes do not need you.** DocGuard does them itself. Your job
  is the prose sections flagged as "review" — where the human writing may no
  longer match the new code reality.
- **Never edit anything outside the marked `source=human` sections** in
  generated docs. The markers protect human writing; respect them.
- **Use the dry run first** to see what will change before applying.

## Execution Flow

### Step 1 — Preview what's stale

```bash
npx --yes docguard-cli@latest sync 2>&1
```

Reads:
- `↻` / `•` lines: code-truth sections that drifted (you don't need to write these).
- `🤖 Prose to review` lines: human-written sections whose surrounding code changed — **these are yours**.

### Step 2 — Apply the mechanical refresh

```bash
npx --yes docguard-cli@latest sync --write 2>&1
```

Re-derives every code-truth section from the current code and rewrites only those
markers. Idempotent — running again is a no-op when up to date.

### Step 3 — Review the flagged prose

For each `🤖 Prose to review` entry:

1. Open the doc (e.g. `docs-canonical/API-REFERENCE.md`).
2. Locate the `<!-- docguard:section id=<id> source=human -->` block.
3. **Read the surrounding `source=code` section first** — that's the new truth
   (e.g. the refreshed endpoint list, the refreshed screens table).
4. Update the human prose so it still accurately describes that truth.
   Examples of what to update:
   - The API overview's endpoint count, or its description of the surface area.
   - The Architecture overview when new components/services appeared.
   - The Screens flows when new screens were added/removed/renamed.
5. Stay inside the `source=human` markers — don't touch the code sections.

### Step 4 — Verify

```bash
npx --yes docguard-cli@latest guard
```

Confirm there are no errors. If the API surface drifted (`API-Surface` failures),
combine with `docguard fix --write` (the mechanical removal of stale endpoints).

### Step 5 — Loop

The intended flow is `sync → guard → (fix if needed) → guard → commit`. Run sync
again before opening a PR to make sure the memory is current.

## What to do if `--since <ref>` is provided

When `--since main` is given, DocGuard also lists the changed code files since
that ref. Use that diff to:

- Prioritize which prose sections to update first (the ones whose related code
  files changed most).
- Cite concrete change reasons in your prose updates ("Added `/api/orders`
  endpoint in commit X" → update the API overview accordingly).

## Common patterns

| Symptom | Action |
|---|---|
| `↻ docs-canonical/API-REFERENCE.md → endpoints` | Code-truth refreshed by `--write`. No action needed. |
| `🤖 docs-canonical/API-REFERENCE.md → overview` | Open the doc; update the `overview` prose to reflect the new endpoint set. |
| `Skipped … not marked docguard:generated` | The doc isn't owned by DocGuard. Either add the marker (and commit ownership) or skip with `--force`. |
| `Documentation memory is up to date` | Done — no drift. |

## Anti-patterns (do NOT do these)

- ❌ Editing inside `<!-- docguard:section source=code -->` — DocGuard will rewrite it on the next sync.
- ❌ Removing the markers to "make the doc look cleaner" — that breaks future sync/regeneration.
- ❌ Skipping `sync --write` and editing the code section by hand — let DocGuard do it.
