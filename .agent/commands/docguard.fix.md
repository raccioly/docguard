---
description: Find and fix all CDD documentation issues using AI-driven research
handoffs:
  - label: Verify Fixes
    agent: docguard.guard
    prompt: Run guard to verify all fixes pass
  - label: Check Score
    agent: docguard.score
    prompt: Show score improvement after fixes
---

# /docguard.fix — Find and Fix CDD Documentation Issues

You are an AI agent responsible for maintaining documentation quality using DocGuard.

## Step 1: Mechanical fixes first (no AI judgment needed)

```bash
npx docguard-cli fix --write
```

This deterministically applies the safe fix class: broken doc anchors, stale
counts bound to code collections, stale version references. Each fix is
provenance-checked and fail-closed — it never rewrites content whose source of
truth it cannot verify. Doing this first shrinks the issue list you research.

## Step 2: Assess what remains

```bash
npx docguard-cli diagnose
```

Parse the output — issues are categorized with AI-ready fix prompts. Every
finding carries a stable code; run `npx docguard-cli explain <CODE>` whenever
the right remediation isn't obvious from the message.

If no issues remain, report "All CDD documentation is up to date" and stop.

## Step 3: Fix each issue

| Issue Type | Action |
|-----------|--------|
| `missing-file` | Run `npx docguard-cli fix --doc <name>` to generate |
| `empty-doc` / `partial-doc` | Proceed to Step 4 for codebase research |
| `missing-config` | Create `.docguard.json` based on project type |
| `stale-doc` | Update `docguard:last-reviewed` date and content |
| `quality-issue` | Fix negation language, add missing sections |
| false positive | Suppress at the site: `// docguard:ignore <CODE>` (with a reason comment), and report it: `npx docguard-cli feedback` |

**Doc wrong vs code wrong:** a doc/code mismatch does not automatically mean
the doc is stale. Canonical docs are the spec — if the code drifted from a
documented decision, flag the code (or record the deviation with a
`// DRIFT: reason` comment + DRIFT-LOG.md entry) instead of silently rewriting
the doc to match the regression.

## Step 4: Write real content

For each document that needs content:

```bash
npx docguard-cli fix --doc <name>
```

Where `<name>` is: `architecture`, `data-model`, `security`, `test-spec`, `environment`

Read the output carefully — it contains:
- **RESEARCH STEPS**: Exactly what files to read and commands to run
- **WRITE THE DOCUMENT**: Expected structure and content for each section

Execute the research steps, then write with REAL project content. No placeholders.
Never edit inside `<!-- docguard:section ... source=code -->` markers by hand —
those bodies are regenerated from code by `docguard sync --write`; pin them
(`pinned="reason"`) if a hand-maintained exception is genuinely needed.

## Step 5: Verify (iterate up to 3 times)

```bash
npx docguard-cli guard
npx docguard-cli score
```

All checks should pass. If any fail, read the output and fix remaining issues.
Report the final CDD score, plus anything you suppressed (with reasons) or
reported as a false positive.
