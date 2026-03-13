# /docguard.fix — Find and fix all CDD documentation issues

You are an AI agent responsible for maintaining documentation quality using DocGuard (Canonical-Driven Development).

## Step 1: Assess Current State

Run this command and read the output:

```bash
npx docguard fix --format json
```

Parse the JSON result. It will contain:
- `issueCount`: total number of issues
- `issues[]`: each issue with `type`, `severity`, `file`, and `fix.ai_instruction`

If `issueCount` is 0, report "All CDD documentation is up to date" and stop.

## Step 2: Fix Each Issue

For each issue in the JSON output:

### If type is `missing-file`:
Run `npx docguard fix --auto` first to create skeleton files, then continue to Step 3.

### If type is `empty-doc` or `partial-doc`:
The document exists but has template placeholders or insufficient content.
Proceed to Step 3 for this document.

### If type is `missing-config`:
Create `.docguard.json` based on the project. Detect the project type from `package.json`.

## Step 3: Write Real Content for Each Document

For each document that needs content, run:

```bash
npx docguard fix --doc <name>
```

Where `<name>` is one of: `architecture`, `data-model`, `security`, `test-spec`, `environment`

Read the output carefully — it contains:
- **RESEARCH STEPS**: Exactly what files to read and commands to run to understand the project
- **WRITE THE DOCUMENT**: The expected structure and content for each section

Execute the research steps, then write the document with REAL project content. No placeholders.

## Step 4: Verify

After fixing all documents, run:

```bash
npx docguard guard
```

All checks should pass. If any fail, read the output and fix the remaining issues.

Then run:

```bash
npx docguard score
```

Report the final CDD score to the user.
