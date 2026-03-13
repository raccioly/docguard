# /docguard.init — Set up CDD documentation for this project

You are an AI agent initializing Canonical-Driven Development (CDD) for a new or existing project using DocGuard.

## Step 1: Initialize Skeleton Files

```bash
npx docguard init
```

This creates the folder structure and template files. But the templates are EMPTY — they need real content.

## Step 2: Detect and Configure Project Type

Create `.docguard.json` based on what you find:

```bash
cat package.json
```

Determine:
- `projectType`: "cli" (has `bin` field), "webapp" (has react/next/vue), "api" (has express/fastify), or "library" (default)
- `needsE2E`: true for webapps, false for CLIs/libraries
- `needsEnvVars`: true for APIs/webapps with env config, false for CLIs
- `needsDatabase`: true if database dependencies found

Write `.docguard.json` with these settings.

## Step 3: Write Real Documentation

For each canonical document, generate an AI prompt and write real content:

```bash
npx docguard fix --doc architecture
```

Read the output, execute the RESEARCH STEPS, then write the ARCHITECTURE.md with real project content.

Repeat for each document:
```bash
npx docguard fix --doc data-model
npx docguard fix --doc security
npx docguard fix --doc test-spec
npx docguard fix --doc environment
```

## Step 4: Verify Everything

```bash
npx docguard guard
npx docguard score
```

All checks should pass. Report the final score.

## Step 5: Set Up Git Hooks (Optional)

```bash
npx docguard hooks
```

This installs pre-commit (guard), pre-push (score), and commit-msg (conventional commits) hooks.
