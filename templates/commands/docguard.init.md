---
description: Initialize Canonical-Driven Development in a new or existing project
handoffs:
  - label: Generate Docs
    agent: docguard.fix
    prompt: Generate and populate all canonical documentation from codebase
  - label: Check Status
    agent: docguard.guard
    prompt: Run guard to see initial documentation status
---

# /docguard.init — Set Up CDD Documentation

You are an AI agent initializing Canonical-Driven Development (CDD) for a new or existing project.

## Step 1: Initialize Skeleton Files

```bash
npx docguard-cli init
```

This creates the folder structure and template files. The templates are skeletons — they need real content.

## Step 2: Pick the Right Profile

`init` auto-detects the project type, but verify the profile fits — it sets
which docs are required (a CLI shouldn't be forced to document an HTTP API):

| Signal | Profile in `.docguard.json` |
|--------|------------------------------|
| Has `bin` field / CLI tool | `"profile": "cli"` |
| Publishable package | `"profile": "library"` |
| Side project / prototype | `"profile": "starter"` |
| Team web app / API | `"profile": "standard"` (default) |
| Regulated / strict | `"profile": "enterprise"` |

Only schema-valid keys belong in `.docguard.json` — check
`schemas/docguard-config.schema.json` (shipped in the package) before adding
anything. If the project has domain collections (extractors, plugins, rules…),
declare them so documented counts are verified against code:
`"collections": { "extractors": "src/extractors/*.py" }`.

For an EXISTING codebase, prefer reverse-engineering over blank skeletons:

```bash
npx docguard-cli generate --plan --write
```

This pre-fills code-truth sections (routes, schemas, env vars) and leaves you
an agent-task list for the prose.

## Step 3: Write Real Documentation

For each canonical document, generate a research prompt and write real content:

```bash
npx docguard-cli fix --doc architecture
npx docguard-cli fix --doc data-model
npx docguard-cli fix --doc security
npx docguard-cli fix --doc test-spec
npx docguard-cli fix --doc environment
```

For each: read the output, execute RESEARCH STEPS, then write with real project content.

## Step 4: Verify

```bash
npx docguard-cli guard
npx docguard-cli score
```

All checks should pass. Report the final score.

## Step 5: Set Up Git Hooks (Optional)

```bash
npx docguard-cli hooks
```

Installs pre-commit (guard), pre-push (score), and commit-msg (conventional commits) hooks.
