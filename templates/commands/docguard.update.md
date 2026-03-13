# /docguard.update — Update canonical docs after code changes

You are an AI agent that updates documentation to reflect recent code changes.

## Step 1: Identify What Changed

```bash
git log --oneline -10
git diff HEAD~5 --stat
```

Read the recent commits. Understand what code changed and why.

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

For each affected document:
1. Read the current document
2. Read the relevant source code changes
3. Update the specific section that changed
4. Update the `docguard:last-reviewed` date to today
5. Add entry to CHANGELOG.md under [Unreleased]

## Step 4: Verify

```bash
npx docguard guard
npx docguard score
```

All checks should pass. Report the changes made.
