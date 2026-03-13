# /docguard.review — Review documentation vs code for drift

You are an AI agent reviewing documentation quality and detecting drift between docs and code.

## Step 1: Run Diff

```bash
npx docguard diff
```

Read the output carefully. It shows where documentation no longer matches the codebase.

## Step 2: Run Guard

```bash
npx docguard guard
```

Note any failed validators — these indicate docs that need updating.

## Step 3: Check Freshness

For each file listed in the guard output with a freshness warning:
1. Read the document
2. Read the related source code
3. Compare: does the doc accurately describe the current code?
4. If not, update the doc to match reality

## Step 4: Update Stale Docs

For each stale or drifted document:
1. Read the relevant source code files
2. Update the document to match current implementation
3. Update the `docguard:last-reviewed` date to today
4. If the change is intentional drift, add an entry to DRIFT-LOG.md

## Step 5: Verify

```bash
npx docguard guard
npx docguard score
```

Report the final results to the user.
