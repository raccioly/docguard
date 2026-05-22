---
description: Fix documentation drift — mechanical (no AI) or AI-driven research, depending on the issue
allowed-tools: Bash, Read, Edit
---

# DocGuard Fix

DocGuard splits drift into two kinds and is explicit about which is which.

- **Mechanical** (deterministic, no AI): apply with `docguard fix --write`. Covers
  removing endpoints documented but absent in code, refreshing stale "N validators"
  counts, replacing stale version references, inserting a missing `## [Unreleased]`.
- **Agent** (needs judgment): content rewrites — e.g. updating an X-Ray section to
  CloudWatch, writing a new endpoint's request/response block.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Execution

### Step 1 — Apply mechanical fixes (fast, safe, no AI)

```bash
npx --yes docguard-cli@latest fix --write
```

Output lists every applied fix. Idempotent: re-running is a no-op if nothing changed.
Only edits `<!-- docguard:generated true -->` docs unless `--force`.

### Step 2 — Identify remaining issues by kind

```bash
npx --yes docguard-cli@latest diagnose --format json
```

Each issue is tagged `fixKind: mechanical` (mostly handled by step 1) or
`fixKind: agent`. Focus on the agent ones.

### Step 3 — Use the deep doc prompt for content rewrites

For each affected canonical doc, get a research-grounded prompt:

```bash
npx --yes docguard-cli@latest fix --doc architecture
npx --yes docguard-cli@latest fix --doc data-model
npx --yes docguard-cli@latest fix --doc api-reference
npx --yes docguard-cli@latest fix --doc security
npx --yes docguard-cli@latest fix --doc test-spec
npx --yes docguard-cli@latest fix --doc environment
```

Execute the research steps in each prompt: read actual code files, map modules,
trace routes, extract real schemas, identify real auth patterns. Then write the
sections — using real file paths, real module names, real dependencies. No placeholders.

### Step 4 — Verify

```bash
npx --yes docguard-cli@latest guard
```

Iterate until clean (max 3 rounds; if still failing, report remaining issues).

## Flags

- `--write` — apply deterministic fixes in place (step 1).
- `--doc <name>` — emit a research-grounded prompt for one specific document (step 3).
- `--force` — for `--write`, edit docs that lack the generated marker.
- `--format json` — machine-readable issue list (with `fixKind`).
