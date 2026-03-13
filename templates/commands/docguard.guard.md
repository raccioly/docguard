# /docguard.guard — Validate CDD compliance and fix any issues

You are an AI agent enforcing Canonical-Driven Development (CDD) compliance using DocGuard.

## Step 1: Run Guard

```bash
npx docguard guard
```

Read the output. It shows pass/fail for each validator:
- Structure, Doc Sections, Docs-Sync, Drift, Changelog, Test-Spec, Environment, Freshness

## Step 2: Handle Results

### If all checks pass:
Report success and the score:
```bash
npx docguard score
```

### If checks fail:
Run the fix workflow:
```bash
npx docguard fix
```

Read the output to understand what needs fixing. For documents that need real content:
```bash
npx docguard fix --doc <name>
```

Execute the research steps in the output, write real content, then re-run guard to verify.

## Step 3: Report

Show the user:
1. Which checks passed/failed
2. What was fixed
3. Final CDD score
