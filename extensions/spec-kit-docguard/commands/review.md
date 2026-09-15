---
description: "Review documentation against code without modifying the repository"
allowed-tools: Bash, Read
handoffs:
  - label: Fix Reviewed Issues
    agent: docguard.fix
    prompt: Fix the documentation issues confirmed by the review
  - label: Run Guard
    agent: docguard.guard
    prompt: Validate all checks after approved fixes
---

# DocGuard Review

Perform a read-only semantic review of canonical documentation against the
repository. Report evidence and recommendations; do not edit files.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding when it is not empty.

## Execution

1. Run the deterministic inventory and quality checks:

```bash
npx --yes docguard-cli@latest diagnose $ARGUMENTS
npx --yes docguard-cli@latest diff $ARGUMENTS
npx --yes docguard-cli@latest score $ARGUMENTS
npx --yes docguard-cli@latest verify --evidence --format json $ARGUMENTS
npx --yes docguard-cli@latest verify --semantic $ARGUMENTS
```

2. Read the canonical documents and their cited code. Check architecture,
   schemas, security claims, test coverage, terminology, and cross-references.
3. For every contradiction, identify whether approved documentation or current
   code owns the intended behavior. A mismatch can be a code regression.
4. Return a severity-ranked report with exact file paths, evidence, confidence,
   and a proposed next action. Keep unsupported claims explicitly unverified.

## Constraints

- Do not modify files or treat a clean structural guard as proof that prose is
  factually correct.
- Do not rewrite canonical intent to match code until ownership is resolved.
- Cap the report at 50 findings and aggregate lower-priority overflow.
