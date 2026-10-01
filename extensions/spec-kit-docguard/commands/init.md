---
description: "Initialize Canonical-Driven Development in a project"
handoffs:
  - label: Generate Docs
    agent: docguard.fix
    prompt: Generate documentation content from codebase
  - label: Check Status
    agent: docguard.guard
    prompt: Run guard to see initial status
---

# DocGuard Init

Initialize CDD in your project. Creates the `docs-canonical/` directory, required files (CHANGELOG.md, DRIFT-LOG.md, AGENTS.md), and optionally sets a compliance profile.

## Running DocGuard

Run `docguard` from PATH when it is installed. Otherwise run
`npx --yes docguard-cli@0.42.1`, the release these instructions ship with, in its
place. Every `docguard …` command below means one of the two.

## User Input

$ARGUMENTS

## Steps

1. Run DocGuard init on the current project:

```bash
docguard init $ARGUMENTS
```

2. Choose a compliance profile:
   - **starter** — Minimal CDD (architecture + changelog only)
   - **standard** — Full CDD (all 5 canonical docs)
   - **enterprise** — Strict CDD (all docs, all validators, freshness enforced)

3. After init, run `speckit.docguard.generate` to populate the canonical docs with real data from your codebase.

## Flags

- `--profile <name>` — Set compliance profile (starter, standard, enterprise)
- `--dir <path>` — Run on a different directory
