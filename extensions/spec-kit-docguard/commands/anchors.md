---
description: "List what each requirement tag anchors to (read-only)"
allowed-tools: Bash, Read
handoffs:
  - label: Run Guard
    agent: docguard.guard
    prompt: Validate the project after retargeting requirement tags
---

# DocGuard Anchors

List every `@implements` / `@req` tag in source code, the requirement it
resolves to, and the file, symbol, statement or route it anchors to, with the
tier that placed it. Read-only: this command never writes the anchor lock.

## Running DocGuard

Run `docguard` from PATH when it is installed. Otherwise run
`npx --yes docguard-cli@0.45.1`, the release these instructions ship with, in its
place. Every `docguard …` command below means one of the two.

## User Input

$ARGUMENTS

## Steps

1. List the links, scoped to the spec being worked on when there is one:

```bash
docguard anchors --format json $ARGUMENTS
```

2. For each `problems[]` entry:
   - **ANC007**: the tag cites a requirement nobody declares. Qualify it with
     the Spec ID that declares it, or fix the ID.
   - **ANC006** (`severity: info`): the tag's scope is ambiguous or did not
     resolve. Add `{scope=symbol}` or `{scope=file}` after the requirement, or
     move the tag directly above the code it describes.
   - **ANC010**: links were placed below their exact tier. Report it; do not
     edit code to silence it.

3. For each link whose code changed (`state: suspect`, `side: code`), read
   its `tests[]`. A test marked `needs-reverification` should be run, or its
   TestGuard claim probed. A claim names the requirement as
   `"source": { "kind": "spec", "ref": "req:<spec-id>#<REQ>" }`. Treat
   `inconclusive` as unproven, never as passing.

4. When implementing a requirement, put its tag directly above the function,
   class or statement that implements it, not in the file header, so the
   link names that code.

5. For code with no requirement, run `docguard anchors --orphans --format json`.
   For each orphan, tag it with the requirement it implements. If none
   applies, tell the user which disposition fits (`derived`, `dead` or
   `infrastructure`) and why. Recording one writes the anchor lock, which is
   the user's sign-off, not yours.

## Flags

- `--spec <id>`: only links to this Spec ID
- `--file <path>`: only links in this file
- `--orphans`: list untagged exported or top-level symbols instead of links
- `--format json`: machine-readable output
