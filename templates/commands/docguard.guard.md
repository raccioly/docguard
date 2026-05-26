---
description: Run DocGuard guard validation — check all validators and fix any issues
handoffs:
  - label: Fix Issues
    agent: docguard.fix
    prompt: Fix all documentation issues found by guard
  - label: Check Score
    agent: docguard.score
    prompt: Show CDD maturity score after fixes
---

# /docguard.guard — Validate CDD Compliance

You are an AI agent enforcing Canonical-Driven Development (CDD) compliance using DocGuard.

## Step 1: Run Guard

```bash
npx docguard-cli guard
```

Read the output. It shows pass (✅), warn (⚠️), or fail (❌) for each of the validators:

| Priority | Validators |
|----------|-----------|
| CRITICAL | Structure, Security, Test-Spec |
| HIGH | Doc Sections, Drift-Comments, Changelog, Traceability, API-Surface |
| MEDIUM | Freshness, Docs-Coverage, Doc-Quality, Metrics-Consistency |
| LOW | TODO-Tracking, Schema-Sync, Spec-Kit, Metadata-Sync |

## Step 2: Handle Results

### If all checks pass:
Report success and the score:
```bash
npx docguard-cli score
```

### If checks fail:
For each failing check, provide an **exact fix** — specific file, section, and content.
Then run the fix workflow:
```bash
npx docguard-cli fix --doc <name>
```

Execute the research steps in the output, write real content, then re-run guard to verify.

## Step 3: Report

Show the user:
1. Which checks passed/failed (with severity)
2. What was fixed
3. Final CDD score
