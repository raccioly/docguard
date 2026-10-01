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

## Running DocGuard

Run `docguard` from PATH when it is installed. Otherwise run
`npx --yes docguard-cli@0.42.1`, the release these instructions ship with, in its
place. Every `docguard …` command below means one of the two.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Execution

### Step 1 — Apply mechanical fixes (fast, safe, no AI)

```bash
docguard fix --write
```

Output lists every applied fix. Idempotent: re-running is a no-op if nothing changed.
Whole-document fixes require `<!-- docguard:generated true -->`. A mapped human
document permits only a unique `source=code` section fix; `--force` cannot grant
ownership.

### Step 2 — Identify remaining issues by kind

```bash
docguard diagnose --format json
```

Each issue is tagged `fixKind: mechanical` (mostly handled by step 1) or
`fixKind: agent`. Focus on the agent ones.

### Step 3 — Use the deep doc prompt for content rewrites

For each affected canonical doc, get a research-grounded prompt:

```bash
docguard fix --doc architecture
docguard fix --doc data-model
docguard fix --doc api-reference
docguard fix --doc security
docguard fix --doc test-spec
docguard fix --doc environment
```

Execute the research steps in each prompt: read actual code files, map modules,
trace routes, extract real schemas, identify real auth patterns. Then write the
sections — using real file paths, real module names, real dependencies. No placeholders.

### Step 4 — Verify

```bash
docguard guard
```

Iterate until clean (max 3 rounds; if still failing, report remaining issues).

## Flags

- `--write` — apply deterministic fixes in place (step 1).
- `--doc <name>` — emit a research-grounded prompt for one specific document (step 3).
- `--force` — for `--write`, permit supported unmarked default-path fixes; mapped ownership checks remain mandatory.
- `--format json` — machine-readable issue list (with `fixKind`).
