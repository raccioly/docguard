---
description: Review documentation quality — identify drift, coverage gaps, and improvements
handoffs:
  - label: Fix Issues
    agent: docguard.fix
    prompt: Fix the documentation issues identified in the review
  - label: Run Guard
    agent: docguard.guard
    prompt: Validate all checks pass after review
---

# /docguard.review — Review Documentation vs Code

You are an AI agent reviewing documentation quality and detecting drift between docs and code.

## Step 1: Run Diagnostics

```bash
npx docguard-cli diagnose
npx docguard-cli diff
npx docguard-cli score
```

Read all output. Identify where documentation no longer matches the codebase.
Findings carry stable codes — `npx docguard-cli explain <CODE>` when unclear.

## Step 2: Verify Documented Claims Against Code

```bash
npx docguard-cli verify --semantic
```

This extracts every checkable claim in the canonical docs — counts, limits,
rate numbers, retention windows, status enums — as a task list with the nearest
cited code path. **You perform each verification**: read the cited code, compare
the value, and report every mismatch with both values. This is the highest-value
review step; deterministic validators cannot judge these.

## Step 3: Semantic Analysis (Beyond CLI)

For each canonical doc, verify alignment with actual code:

| Analysis | What to Check |
|----------|--------------|
| Architecture ↔ Code | Components in ARCHITECTURE.md exist as real modules |
| Data Model ↔ Code | Schemas in DATA-MODEL.md match actual implementations |
| Security Claims | Auth mechanisms in SECURITY.md match actual code |
| Test Coverage | Critical flows in TEST-SPEC.md have actual test files |
| Terminology | Same concepts named consistently across all docs |

## Step 4: Update Stale Docs

For each stale or drifted document:
1. **Decide which side is wrong first.** Canonical docs are the spec — if the
   code regressed from a documented decision, flag the code (or record a
   `// DRIFT: reason` + DRIFT-LOG.md entry); don't rewrite the doc to match a
   regression.
2. Sections inside `<!-- docguard:section ... source=code -->` markers are
   regenerated — run `npx docguard-cli sync --write` instead of editing by hand.
3. For hand-maintained sections: read the relevant source, update the specific
   section, refresh `docguard:last-reviewed` to today.
4. Add entry to CHANGELOG.md under [Unreleased].

## Step 5: Verify

```bash
npx docguard-cli guard
npx docguard-cli score
```

Report findings, changes made, and the final score.
