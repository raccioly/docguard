---
name: docguard-review
description: Cross-document consistency analysis and quality assessment. Performs read-only
  analysis across all canonical docs, identifies drift, coverage gaps, and quality issues.
  Produces a structured report with severity-ranked findings. Modeled after speckit-analyze.
compatibility: Requires DocGuard CLI installed (npm i -g docguard-cli or npx docguard-cli)
metadata:
  author: docguard
  version: 0.9.9
  source: extensions/spec-kit-docguard/skills/docguard-review
---
<!-- docguard:version: 0.9.9 -->

# DocGuard Review Skill

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Perform a comprehensive, **read-only** analysis of the project's documentation health. Unlike `/docguard.guard` (which runs CLI validators), this skill performs **semantic analysis** — checking whether documentation actually matches the codebase, whether cross-references are consistent, and whether the documentation tells a coherent story.

## Operating Constraints

**STRICTLY READ-ONLY**: Do **not** modify any files. Output a structured analysis report only. Offer remediation suggestions that the user must explicitly approve before any changes are made.

## Execution Flow

### Step 1: Gather Documentation Inventory

1. **List all canonical docs**: Read every file in `docs-canonical/`
2. **List support files**: Check for `CHANGELOG.md`, `DRIFT-LOG.md`, `AGENTS.md`, `README.md`, `ROADMAP.md`
3. **Check for spec-kit artifacts**: If `.specify/` exists, include `specs/*/spec.md`, `specs/*/plan.md`, `specs/*/tasks.md`
4. **Build a document map**:

| Document | Exists | Last Modified | Size | Metadata Version |
|----------|--------|---------------|------|-----------------|
| ARCHITECTURE.md | ✅ | 2026-03-14 | 5.2KB | 0.5.0 |
| SECURITY.md | ✅ | 2026-03-14 | 3.1KB | 0.5.0 |
| ... | ... | ... | ... | ... |

### Step 2: Run Quantitative Analysis

Execute DocGuard's diagnostic and scoring tools:

```bash
npx docguard-cli diagnose 2>&1
npx docguard-cli score 2>&1
npx docguard-cli guard 2>&1
```

Record:
- Guard pass/fail counts per validator
- CDD maturity score (0-100)
- ALCOA+ compliance attributes
- Category breakdown

### Step 3: Semantic Cross-Document Analysis

This is the **unique value** of the review skill — analysis that CLI validators cannot do.

#### A. Terminology Consistency
- Extract key technical terms from each document
- Flag terms used differently across documents (e.g., "validator" vs "checker" vs "rule")
- Flag abbreviations used without definition
- Build a de facto glossary

#### B. Architecture ↔ Code Alignment
- Read ARCHITECTURE.md component list
- Verify each listed component actually exists as a directory/module
- Flag components that exist in code but are missing from ARCHITECTURE.md
- Flag components listed in ARCHITECTURE.md that don't exist in code

#### C. Data Model ↔ Code Alignment
- Read DATA-MODEL.md schemas/structures
- Search codebase for actual data structures
- Flag schemas documented but not implemented
- Flag schemas implemented but not documented

#### D. Test Coverage ↔ Test-Spec Alignment
- Read TEST-SPEC.md critical flows
- Check actual test files exist for each critical flow
- Flag test scenarios documented but not implemented
- Flag test files with no corresponding TEST-SPEC.md entry

#### E. Security Claims ↔ Implementation
- Read SECURITY.md auth/secrets claims
- Verify auth implementation exists in code
- Check that listed secrets are actually used
- Flag security-relevant code not mentioned in SECURITY.md

#### F. Cross-Reference Integrity
- Find all internal doc links (`[text](file)` and `See ARCHITECTURE.md`)
- Verify every referenced file/section actually exists
- Flag broken cross-references
- Flag orphaned sections not referenced anywhere

### Step 4: Quality Assessment

For each document, evaluate:

| Criterion | Weight | Score | Notes |
|-----------|--------|-------|-------|
| Completeness | 30% | 0-10 | Are all mandatory sections present? |
| Accuracy | 30% | 0-10 | Does content match actual codebase? |
| Clarity | 20% | 0-10 | Readability, specificity, no jargon |
| Currency | 10% | 0-10 | Is content up-to-date with latest code? |
| Cross-refs | 10% | 0-10 | Are references valid and bidirectional? |

### Step 5: Severity Classification

Classify every finding using this matrix:

- **CRITICAL**: Security claim doesn't match implementation, missing mandatory doc, broken architecture reference
- **HIGH**: Undocumented component, stale content (>5 commits behind), terminology conflict
- **MEDIUM**: Missing cross-reference, minor coverage gap, readability issue
- **LOW**: Formatting inconsistency, optional section missing, minor terminology drift

### Step 6: Produce Analysis Report

Output a structured markdown report (do NOT write to disk):

```markdown
## DocGuard Documentation Review

### Executive Summary
- **Overall Health**: [A+/A/B/C/D/F] ([score]/100)
- **Documents Analyzed**: [N]
- **Findings**: [CRITICAL: N, HIGH: N, MEDIUM: N, LOW: N]
- **Top Risk**: [Most impactful finding]

### Findings Table

| ID | Category | Severity | Location | Summary | Recommendation |
|----|----------|----------|----------|---------|----------------|
| R01 | Terminology | HIGH | ARCH:L15, SEC:L22 | "validator" vs "checker" | Standardize on "validator" |
| R02 | Coverage | MEDIUM | DATA-MODEL.md | Schema X undocumented | Add Schema X to Data Model |

### Per-Document Health

| Document | Completeness | Accuracy | Clarity | Currency | Cross-refs | Overall |
|----------|:----------:|:-------:|:------:|:-------:|:----------:|:-------:|
| ARCHITECTURE.md | 9/10 | 8/10 | 9/10 | 7/10 | 10/10 | 8.8/10 |
| SECURITY.md | 8/10 | 9/10 | 8/10 | 9/10 | 7/10 | 8.4/10 |

### Semantic Consistency
- **Terminology conflicts**: [N found]
- **Architecture gaps**: [N components undocumented]
- **Broken cross-refs**: [N found]
- **Test coverage gaps**: [N critical flows untested]

### Recommendations (Priority Order)
1. [Most impactful fix] — estimated effort: [LOW/MEDIUM/HIGH]
2. [Second most impactful] — estimated effort: [LOW/MEDIUM/HIGH]
3. ...
```

### Step 7: Offer Next Actions

Based on findings:
- **If CRITICAL issues**: "Run `/docguard.fix --doc [name]` to resolve blocking issues"
- **If spec-related gaps**: "Run `/speckit.specify` to update specifications" or "/speckit.clarify to resolve ambiguities"
- **If architecture drift**: "Run `/speckit.plan` to realign implementation plan with codebase"
- **If only LOW/MEDIUM**: "Documentation is healthy. Consider `/docguard.fix` for polish"
- **If constitution missing**: "Run `/speckit.constitution` to establish project principles"
- **If all clean**: "Documentation is excellent. No action needed."

Ask: "Would you like me to fix the top N issues? (I'll show you what I plan to change before applying)"

## Behavior Rules

- **NEVER modify files** — this is strictly read-only analysis
- **ALWAYS run real CLI commands** — don't simulate or guess results
- **Be specific** — cite exact file paths, line numbers, and content
- **Compare actual code vs docs** — don't just validate formatting
- **Limit findings to 50** — aggregate overflow in a summary count
- **Prioritize high-signal findings** — one CRITICAL finding is worth ten LOW findings

## Context

$ARGUMENTS
