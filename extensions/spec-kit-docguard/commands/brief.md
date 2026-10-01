---
description: "Load current spec intent and lifecycle before creating a new specification"
allowed-tools: Bash, Read
---

# DocGuard Spec Briefing

Read the committed spec lifecycle registry before creating a new specification.
This command is a deterministic history gate. It does not decide whether two
features are semantically equivalent.

## Running DocGuard

Run `docguard` from PATH when it is installed. Otherwise run
`npx --yes docguard-cli@0.42.1`, the release these instructions ship with, in its
place. Every `docguard …` command below means one of the two.

## Execution

1. Run the read-only briefing:

```bash
docguard specs preflight --format json
```

2. If the result is `BLOCKED`, stop specification work. Report every blocker and
   refresh or repair the registry before continuing. A missing registry is valid
   only when the project has no prior specs.

3. If the result is `BRIEFING`, read each current spec named in `briefing` before
   drafting the new behavior. Treat approval, delivery, task counts, and test
   evidence as separate signals. None of them alone proves that behavior exists.

4. Carry relevant immutable spec IDs and explicit lineage into the draft. Do not
   copy prior requirement prose into the registry or infer completion from a
   checkbox.

## User Input

$ARGUMENTS
