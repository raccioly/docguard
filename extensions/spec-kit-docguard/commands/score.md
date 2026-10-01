---
description: "Calculate CDD maturity score with multi-signal quality breakdown"
handoffs:
  - label: Improve Score
    agent: docguard.fix
    prompt: Fix highest-ROI documentation issues to improve score
  - label: Deep Review
    agent: docguard.review
    prompt: Perform semantic analysis for accuracy verification
---

# DocGuard Score

Calculate your project's Canonical-Driven Development maturity score (0-100) across 8 weighted categories.

## Running DocGuard

Run `docguard` from PATH when it is installed. Otherwise run
`npx --yes docguard-cli@0.43.0`, the release these instructions ship with, in its
place. Every `docguard …` command below means one of the two.

## User Input

$ARGUMENTS

## Steps

1. Run DocGuard score on the current project:

```bash
docguard score $ARGUMENTS
```

2. Review the breakdown:
   - **Structure** (25%) — required files present
   - **Doc Quality** (20%) — docs have required sections
   - **Testing** (15%) — test spec alignment
   - **Security** (10%) — no hardcoded secrets
   - **Environment** (10%) — env docs configured
   - **Drift** (10%) — drift tracking discipline
   - **Changelog** (5%) — changelog maintenance
   - **Architecture** (5%) — layer boundary compliance

3. For per-signal quality labels, add `--signals`.

## Grading

| Score | Grade | Status |
|-------|-------|--------|
| 90-100 | A | Strong CDD compliance |
| 75-89 | B | Good, some gaps |
| 50-74 | C | Needs work |
| < 50 | D | Significant gaps |

## Flags

- `--signals` — Show multi-signal CJE composite breakdown with quality labels
- `--tax` — Show estimated maintenance effort
- `--format json` — Output as JSON
