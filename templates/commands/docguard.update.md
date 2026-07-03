---
description: Update canonical docs after code changes — detect drift and sync documentation
handoffs:
  - label: Run Guard
    agent: docguard.guard
    prompt: Validate all checks pass after updates
  - label: Check Score
    agent: docguard.score
    prompt: Show CDD maturity score after updates
---

# /docguard.update — Update Docs After Code Changes

You are an AI agent that updates documentation to reflect recent code changes.

## Step 1: Identify What Changed

```bash
npx docguard-cli diff --since HEAD~5
git log --oneline -10
```

`diff --since` maps the changed files directly to the canonical docs they
affect — read its output first; the git log supplies the "why".

## Step 2: Check Which Docs Are Affected

For each changed file, determine which canonical doc it affects:

| Code Change | Update This Doc |
|-------------|----------------|
| New API endpoint or route | ARCHITECTURE.md (component map) |
| Database schema change | DATA-MODEL.md (entities, fields) |
| New env variable | ENVIRONMENT.md (env var table) |
| Auth or permission change | SECURITY.md (auth/RBAC section) |
| New test or test config | TEST-SPEC.md (test categories) |
| New dependency added | ARCHITECTURE.md (tech stack) |
| Major refactoring | ARCHITECTURE.md (layer boundaries, data flow) |

## Step 3: Update Each Affected Doc

Mechanical layers first — they update marked sections and counts without AI
judgment:

```bash
npx docguard-cli sync --write
npx docguard-cli fix --write
```

Then, for each remaining affected document:
1. Read the current document
2. Read the relevant source code changes
3. Update the specific section that changed (never hand-edit inside
   `<!-- docguard:section ... source=code -->` markers — sync owns those)
4. Update the `docguard:last-reviewed` date to today
5. Add entry to CHANGELOG.md under [Unreleased]

## Step 4: Verify

```bash
npx docguard-cli guard
npx docguard-cli score
```

All checks should pass. Report the changes made and the final score.
