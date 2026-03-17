---
name: docguard-score
description: CDD maturity assessment with category-aware improvement roadmap. Runs scoring
  engine, analyzes category breakdown, identifies highest-impact improvements, and
  generates a before/after improvement plan with projected score gains.
compatibility: Requires DocGuard CLI installed (npm i -g docguard-cli or npx docguard-cli)
metadata:
  author: docguard
  version: 0.9.9
  source: extensions/spec-kit-docguard/skills/docguard-score
---
<!-- docguard:version: 0.9.9 -->

# DocGuard Score Skill

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Run DocGuard's CDD maturity scoring engine, analyze the category breakdown, identify highest-ROI improvements, and produce an actionable improvement roadmap showing projected score gains per fix.

## Execution Flow

### Step 1: Run Scoring Engine

Execute both tools for comprehensive data:

```bash
npx docguard-cli score 2>&1
npx docguard-cli guard 2>&1
```

If in DocGuard dev environment:
```bash
node cli/docguard.mjs score 2>&1
node cli/docguard.mjs guard 2>&1
```

### Step 2: Parse Score Breakdown

Extract the category-level scores:

| Category | Score | Weight | Points | Potential Gain |
|----------|:-----:|:------:|:------:|:--------------:|
| Structure | X% | ×25 | N | [25 - N] |
| Doc Quality | X% | ×20 | N | [20 - N] |
| Testing | X% | ×15 | N | [15 - N] |
| Security | X% | ×10 | N | [10 - N] |
| Environment | X% | ×10 | N | [10 - N] |
| Drift | X% | ×10 | N | [10 - N] |
| Changelog | X% | ×5 | N | [5 - N] |
| Architecture | X% | ×5 | N | [5 - N] |

Calculate `Potential Gain` for each category = (weight - current points).

### Step 3: Grade Classification

| Grade | Score | Description |
|-------|:-----:|------------|
| A+ | 95-100 | Exemplary — production-grade documentation, CDD fully adopted |
| A | 85-94 | Strong — minor improvements possible, CI-gate ready |
| B | 70-84 | Good — documentation covers essentials, some gaps exist |
| C | 50-69 | Fair — significant documentation debt, multiple gaps |
| D | 30-49 | Poor — major structural gaps, limited doc coverage |
| F | 0-29 | Critical — documentation infrastructure missing |

### Step 4: ROI-Based Improvement Roadmap

Sort categories by `Potential Gain / Effort` ratio:

For each category below 100%, calculate:
- **Gap**: What checks are failing?
- **Effort**: How hard is it to fix? (LOW = update metadata, MEDIUM = add content, HIGH = research + write)
- **Impact**: Points gained if fixed to 100%
- **ROI**: Impact / Effort ranking

Generate an improvement plan ordered by ROI:

```markdown
### Improvement Roadmap

| Priority | Category | Current | Target | Points Gain | Effort | Action |
|:--------:|----------|:-------:|:------:|:-----------:|--------|--------|
| 1 | Structure | 80% | 100% | +5 | LOW | Create REQUIREMENTS.md |
| 2 | Changelog | 60% | 100% | +2 | LOW | Add missing entry for v0.9.5 |
| 3 | Doc Quality | 85% | 100% | +3 | MEDIUM | Fix negation language in SECURITY.md |
| 4 | Testing | 70% | 100% | +4.5 | HIGH | Add E2E test documentation |
```

### Step 5: Guard Check Correlation

Cross-reference the score with guard results:

- For each failing guard check, show which score category it impacts
- Calculate: "If you fix these N guard warnings, score will increase from X to Y"
- Show the **minimum set of fixes** needed to reach the next grade level

```markdown
### Path to Next Grade

**Current**: B (78/100)
**Next Grade**: A (85/100) — need +7 points

**Minimum fixes for grade A**:
1. Fix Structure (3 checks failing) → +5 points
2. Fix Changelog (1 check failing) → +2 points
Total effort: ~30 minutes
```

### Step 6: ALCOA+ Compliance Summary

If the score engine reports ALCOA+ attributes, include:

| Attribute | Status | Description |
|-----------|--------|------------|
| Attributable | ✅/❌ | Author information in metadata |
| Legible | ✅/❌ | Readable formatting and structure |
| Contemporaneous | ✅/❌ | Docs updated within freshness window |
| Original | ✅/❌ | Primary source documentation |
| Accurate | ✅/❌ | Content matches codebase |
| Complete | ✅/❌ | All required sections present |
| Consistent | ✅/❌ | No cross-document conflicts |
| Enduring | ✅/❌ | Durable format (markdown, version controlled) |
| Available | ✅/❌ | Accessible to all team members |

### Step 7: Historical Comparison

If user has run score before (check git log for score badge changes):

```markdown
### Score History
| Date | Score | Grade | Change |
|------|:-----:|:-----:|:------:|
| 2026-03-14 | 100 | A+ | +22 |
| 2026-03-13 | 78 | B | baseline |
```

### Step 8: Completion Report

```markdown
## CDD Maturity Assessment

**Project**: [name]
**Score**: [X]/100 ([grade])
**Guard**: [N]/[M] checks passed
**ALCOA+**: [N]/9 attributes met

### Category Health
[Table from Step 2]

### Improvement Roadmap
[Plan from Step 4]

### Path to Next Grade
[Analysis from Step 5]

### Suggested Next Steps
- `/docguard.fix` — Fix the top [N] issues automatically
- `/docguard.review` — Deep semantic analysis for accuracy verification
- `/docguard.guard` — Verify fixes pass all validators
```

## Behavior Rules

- **ALWAYS run real CLI** — never simulate scores
- **Show math** — explain how score is calculated (category × weight)
- **Be actionable** — every recommendation must have a specific action
- **Compare before/after** — if user has previously run score in this session, show improvement
- **Focus on ROI** — surface the cheapest fixes with the biggest score impact first

## Context

$ARGUMENTS
