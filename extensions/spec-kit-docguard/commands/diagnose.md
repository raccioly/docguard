---
description: "Diagnose documentation issues and generate AI-ready fix prompts"
handoffs:
  - label: Fix All Issues
    agent: docguard.fix
    prompt: Fix all documentation issues found
  - label: Run Guard
    agent: docguard.guard
    prompt: Validate all checks pass
---

# DocGuard Diagnose

Runs guard validation, analyzes failures, and generates AI-ready prompts to fix documentation issues.

## Running DocGuard

Run `docguard` from PATH when it is installed. Otherwise run
`npx --yes docguard-cli@0.43.0`, the release these instructions ship with, in its
place. Every `docguard …` command below means one of the two.

## User Input

$ARGUMENTS

## Steps

1. Run DocGuard diagnose on the current project:

```bash
docguard diagnose $ARGUMENTS
```

2. Review the output:
   - **Issues found** — categorized as errors or warnings
   - **Remediation plan** — ordered list of fix commands
   - **AI-ready prompt** — copy/paste to your AI agent for automated fixes

3. For multi-perspective analysis, add `--debate` to get three-agent prompts (Advocate/Challenger/Synthesizer).

## Flags

- `--format json` — Output as JSON
- `--debate` — Generate multi-perspective AI prompts
- `--dir <path>` — Run on a different directory

## Research

Inspired by AITPG (IEEE TSE 2026) multi-agent prompting and the quality-label stratification of TRACE (IEEE TMLCN 2026); DocGuard's labels are deterministic strata, not calibrated probabilities.
