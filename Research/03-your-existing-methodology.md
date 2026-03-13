# Your Existing Methodology — Audit Summary

> **Date**: March 12, 2026  
> **Source**: Analysis from conversation `b5965db0-987f-4936-bd38-6d7dd55dc6ad`

---

## What You've Already Built (Across 10+ Projects)

### Documentation Layer

| Element | Found In | Purpose |
|---------|----------|---------|
| `docs-canonical/` | 6+ projects | READ-ONLY design intent (architecture, data model, security, features) |
| `docs-implementation/` | 5+ projects | Current state tracking (what's actually built) |
| `CLAUDE.md` / `AGENTS.md` | 4-6 projects | Agent behavior rules and guardrails |
| `AGENT-REFERENCE.md` | 9 projects | Lookup tables for docs-to-update per change type |
| `CHANGELOG.md` | 10 projects | Structured change tracking (Added/Changed/Fixed/Removed) |
| `DRIFT-LOG.md` | CCTAtlanta | Tracks deviations from canonical design |
| `ADR.md` | Multiple | Architecture Decision Records (why decisions were made) |

### Automation Layer

24+ agent workflows (slash commands):
- `/preflight` — Pre-commit validation
- `/courier` — Commit, push, deploy
- `/sentinel` — Security scanning
- `/keeper` — API contract validation
- `/mirror` — Schema consistency
- `/medic` — Dependency health
- `/critic` — Code quality review
- `/hunter` — Technical debt tracking
- `/janitor` — Dead code elimination
- ... and 15+ more

### Governance Rules

Your `CLAUDE.md` enforces:
1. **Step 1: RESEARCH** — Check docs before suggesting anything
2. **Step 2: CONFIRM** — Show pre-implementation checklist, no code yet
3. **Step 3: IMPLEMENT** — Only after approval
4. **Step 4: SUMMARIZE** — Document what was done

Hard rules include:
- Never suggest code without showing docs checked
- Never recreate existing functionality
- Never change >3 files without approval
- Never store data locally (use S3, Redis, DynamoDB)
- Never commit without explicit approval

---

## Your Methodology Name

> **📋 Canonical-Driven Development with Agent Governance**

A hybrid that applies design-first principles at *full-stack scope* (not just APIs) and enforces through *AI agent rules* rather than code generation.

---

## The Two-Tier Model

| Tier | Location | Rules |
|------|----------|-------|
| **Canonical** | `docs-canonical/` | READ-ONLY during implementation. The "blueprint." |
| **Implementation** | `docs-implementation/` | Living docs. Updated as code changes. |

When code must deviate from canonical docs:
1. Add `// DRIFT: reason` inline comment
2. Log in `DRIFT-LOG.md`
3. Never silently deviate

---

## What Makes This Enterprise-Grade

1. **Full-stack coverage** — Most standards only cover API shape. Yours covers architecture, security, data models, message flows, feature specs, user personas, and business rules.

2. **Drift awareness** — Acknowledges reality that code will sometimes deviate from spec. Documents it rather than pretending it doesn't happen.

3. **Mandatory research-before-code** — Prevents blind coding. No other standard enforces this.

4. **24+ automated quality gates** — Goes far beyond what any competitor offers.

5. **Agent-agnostic** — Works with any AI agent that can read markdown.
