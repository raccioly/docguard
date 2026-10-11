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
`npx --yes docguard-cli@0.44.2`, the release these instructions ship with, in its
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

3. When implementing a requirement, put its tag directly above the function,
   class or statement that implements it, not in the file header, so the
   link names that code.

## Flags

- `--spec <id>`: only links to this Spec ID
- `--file <path>`: only links in this file
- `--format json`: machine-readable output
