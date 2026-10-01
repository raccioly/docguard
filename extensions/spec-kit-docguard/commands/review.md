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

## Running DocGuard

Run `docguard` from PATH when it is installed. Otherwise run
`npx --yes docguard-cli@0.42.1`, the release these instructions ship with, in its
place. Every `docguard …` command below means one of the two.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding when it is not empty.

## Execution

0. If any doc section declares `covers=`, list which covered sections changed
   since their last review (read-only):

   ```bash
   docguard review --format json
   ```

   Report every section that is not `current`. Do not run `review --accept`
   on the user's behalf: accepting records that a person checked the prose.


1. Run the deterministic inventory and quality checks:

```bash
docguard diagnose $ARGUMENTS
docguard diff $ARGUMENTS
docguard score $ARGUMENTS
docguard verify --evidence --format json $ARGUMENTS
docguard verify --semantic $ARGUMENTS
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
