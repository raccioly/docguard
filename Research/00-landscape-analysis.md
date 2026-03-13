# AI-Agent Documentation Standards — Landscape Analysis

> **Date**: March 12, 2026  
> **Purpose**: Deep research into what exists, what's missing, and where your Canonical-Driven Development approach fits in the market.

---

## Executive Summary

After researching every major player in this space, here's the bottom line:

**Everyone is building tools to help AI agents GENERATE code. Nobody is building tools to help AI agents GOVERN code.**

Your methodology — Canonical-Driven Development with Agent Governance — occupies a unique position. The closest competitor (GitHub Spec Kit) focuses on *greenfield generation*. You've been doing *ongoing governance* (drift detection, architecture enforcement, changelog discipline) across *brownfield* projects. **That gap is the opportunity.**

---

## The Competitive Landscape (March 2026)

### 1. GitHub Spec Kit  
**Stars**: 46K+ | **Status**: Experimental (v0.2.1) | **Language**: Python CLI

| Aspect | Details |
|--------|---------|
| **What it does** | 4-phase workflow: Specify → Plan → Tasks → Implement |
| **Core files** | `constitution.md`, feature specs in `specs/`, implementation plans |
| **CLI** | `specify init`, `/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.implement` |
| **Agent support** | 20+ agents (Claude Code, Gemini CLI, Copilot, Cursor, Antigravity, Kiro, etc.) |
| **Strength** | Greenfield project scaffolding, feature-by-feature spec generation |
| **Weakness** | **No governance layer** — no drift detection, no architecture enforcement, no ongoing health checks |
| **Philosophy** | "Specifications become executable" — specs drive code generation |

**Key insight**: Spec Kit is a *project bootstrapper*. Once code is written, it has no mechanism to ensure the code stays aligned with the spec over time. There's no equivalent of your `DRIFT-LOG.md`, `// DRIFT:` comments, or architecture layer checks.

---

### 2. AGENTS.md Standard  
**Repos**: 20K+ | **Governance**: Linux Foundation (Agentic AI Foundation)

| Aspect | Details |
|--------|---------|
| **What it does** | Single markdown file giving AI agents project context |
| **Scope** | Build commands, test commands, code style, security notes |
| **Agent support** | 25+ agents (Codex, Jules, Cursor, Copilot, Gemini CLI, Devin, etc.) |
| **Strength** | Universal, simple, already an industry standard |
| **Weakness** | **Flat and shallow** — one file, no structure, no enforcement, no validation |
| **Philosophy** | "README for agents" — static context, not a governance system |

**Key insight**: AGENTS.md is a *context dump*. It tells agents how to build and test, but has no opinion on architecture, documentation structure, drift tracking, or change management. It's complementary to what you're building, not competitive.

---

### 3. Kiro (AWS)  
**Status**: Public preview (mid-2025) | **Type**: Full IDE

| Aspect | Details |
|--------|---------|
| **What it does** | Agentic IDE with built-in SDD: `requirements.md` → `design.md` → `tasks.md` |
| **Key features** | Agent Hooks (automation), Steering Files (conventions), design doc generation |
| **Strength** | Tightest integration — spec and code live in the same IDE |
| **Weakness** | **Vendor lock-in** (AWS/Bedrock only), no portability, no governance post-implementation |
| **Philosophy** | "SDD inside the IDE" — specs are IDE-native, not repo-native |

**Key insight**: Kiro is powerful but proprietary. Your approach is *repo-native* and *agent-agnostic* — any agent can read markdown files. Kiro's specs are tied to the Kiro IDE.

---

### 4. Cursor Rules  
**Type**: IDE-specific config | **Format**: `.cursor/rules/*.mdc`

| Aspect | Details |
|--------|---------|
| **What it does** | Per-project rules that shape Cursor AI behavior |
| **Scope** | Code style, architectural preferences, framework conventions |
| **Agent support** | Cursor only |
| **Strength** | Deep IDE integration, glob-based auto-attach |
| **Weakness** | **Cursor-only**, no portability, no validation, no enforcement |

**Key insight**: Cursor rules are *agent-specific preferences*, not a documentation standard. They influence how Cursor generates code but don't validate anything.

---

### 5. CLAUDE.md  
**Type**: Agent-specific memory file | **By**: Anthropic

| Aspect | Details |
|--------|---------|
| **What it does** | Project context file read by Claude Code at session start |
| **Scope** | Architecture, conventions, workflows, agent behavior rules |
| **Best practice** | Keep under 200-300 lines, use progressive disclosure |
| **Strength** | Claude Code reads it automatically, deep integration |
| **Weakness** | **Claude-only** (though AGENTS.md is the universal equivalent) |

---

### 6. Emerging Protocols

| Protocol | Purpose | Status |
|----------|---------|--------|
| **MCP (Model Context Protocol)** | Standard for AI agents to discover tools/data sources | Linux Foundation, widely adopted |
| **A2A (Agent-to-Agent)** | Multi-agent communication | Emerging standard |
| **OpenAPI 3.0+** | API contract definition | Gold standard for API specs |
| **Markdown for Agents** (Cloudflare) | Web content → structured markdown for AI | Feb 2026 launch |

---

## The Gap Map

| Capability | Spec Kit | AGENTS.md | Kiro | Cursor | CLAUDE.md | **Your Approach** |
|-----------|----------|-----------|------|--------|-----------|-------------------|
| Project bootstrapping | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Agent context (build/test) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Feature spec generation | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Architecture documentation | ❌ | ❌ | ✅ | ❌ | Partial | ✅ |
| Data model documentation | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| Security documentation | ❌ | Partial | ❌ | ❌ | ❌ | ✅ |
| **Drift detection** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Architecture enforcement** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Changelog discipline** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Docs-sync validation** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Machine-enforceable checks** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (planned) |
| Agent-agnostic | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Brownfield support | Partial | ✅ | Partial | ✅ | ✅ | ✅ |
| Quality gate automation | ❌ | ❌ | Partial | ❌ | ❌ | ✅ (24+ workflows) |

> [!IMPORTANT]
> **The bottom-right quadrant (governance + enforcement) is completely empty in every competitor.** This is your unique space.

---

## Your Unique Differentiators

### Things nobody else has:

1. **Two-Tier Documentation Model** — `docs-canonical/` (READ-ONLY design intent) vs `docs-implementation/` (current state). Nobody else separates *what we want to build* from *what we've built*.

2. **Drift-Aware Development** — `// DRIFT: reason` inline comments + `DRIFT-LOG.md`. Every other system either passes or fails. Yours *acknowledges and documents* conscious deviations.

3. **Agent Governance Layer** — Your `CLAUDE.md`/`AGENTS.md` files create behavioral contracts. Step 1 Research + Step 2 Confirm is enforced *before* any code generation.

4. **Architecture Layer Enforcement** — Checking that controllers don't call databases directly, that imports follow declared boundaries. Nobody else does this.

5. **Quality Automation Suite** — 24+ slash commands (`/preflight`, `/sentinel`, `/keeper`, `/mirror`, etc.) that run as pre-commit gates. Spec Kit has no equivalent.

6. **Brownfield-First** — Your system works on existing projects with existing code. Spec Kit and Kiro are heavily greenfield-oriented.

---

## What Would Make This Revolutionary

Based on this research, here's what would make your approach a **standard that others adopt**:

### Must-Have for Adoption

1. **Agent-Agnostic** — Must work with Claude, Gemini, Copilot, Cursor, Kiro, and any future agent. ✅ (Your markdown-based approach already is.)

2. **Zero Dependencies** — `npm install` is a barrier. A standalone script or simple CLI that works anywhere. ✅ (Your canonical-guard design is zero-dep.)

3. **Machine-Enforceable** — The key gap in everything that exists. Your validators (structure, docs-sync, drift, architecture, changelog) fill this perfectly.

4. **Configurable Per-Project** — Not everyone has the same structure. `.canonical-guard.json` or similar per-project config is essential.

5. **Progressive Adoption** — Projects should be able to adopt one validator at a time, not all-or-nothing.

### Nice-to-Have for Growth

6. **GitHub Action / CI Integration** — Run as a CI check on every PR.
7. **VSCode/IDE Extension** — Show violations inline while coding.
8. **Spec Kit Compatibility** — Can work alongside Spec Kit (Spec Kit generates, your tool governs).
9. **Community Templates** — Pre-built configs for common stacks (Next.js, Fastify, Django, etc.).

---

## Strategic Positioning

```
┌─────────────────────────────────────────────────────────────┐
│                    AI-Agent Documentation Stack              │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────────┐ │
│  │ AGENTS.md│   │ CLAUDE.md│   │  Cursor Rules / Steering │ │
│  │ (Context)│   │ (Context)│   │      (Context)           │ │
│  └────┬─────┘   └────┬─────┘   └───────────┬──────────────┘ │
│       │              │                      │                │
│       └──────┬───────┘──────────────────────┘                │
│              ▼                                               │
│  ┌───────────────────────────────────────────┐               │
│  │ Spec Kit / Kiro (GENERATION)              │               │
│  │ "Build the project from specs"            │               │
│  └───────────────────┬───────────────────────┘               │
│                      ▼                                       │
│  ┌───────────────────────────────────────────┐               │
│  │ ??? NOBODY IS HERE ??? (GOVERNANCE)       │  ◄── YOU      │
│  │ "Keep the project aligned with specs"     │               │
│  │ Drift detection, architecture enforcement │               │
│  │ Changelog discipline, docs-sync, quality  │               │
│  └───────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

---

## Open Questions for Discussion

1. **Name**: "Canonical Spec Kit" positions you as a peer/complement to GitHub's Spec Kit. But is that the right framing? Or should you position as something entirely new — a *governance* tool, not a *generation* tool?

2. **Relationship with Spec Kit**: Should your tool *integrate* with Spec Kit (run after Spec Kit generates)? Or *compete* (replace Spec Kit's workflow entirely with your more comprehensive one)?

3. **Scope**: Is this a CLI tool only? Or a full standard (like AGENTS.md) that defines what files a project should have and how they should be structured?

4. **Audience**: Solo developers who use AI agents? Teams? Enterprises? The governance angle is very enterprise-friendly.

5. **Open Source Strategy**: GitHub Spec Kit is MIT licensed, AGENTS.md is under Linux Foundation. What's your licensing/governance model?

---

## Next Steps

Before building anything, we should discuss:
- [ ] Naming and positioning
- [ ] Relationship with existing standards (complement vs compete)
- [ ] Core spec: what files/structure does a "canonical" project require?
- [ ] Machine enforcement: what exactly gets validated and how?
- [ ] Target audience and adoption strategy

> [!NOTE]
> This research document will be updated as our discussions progress. See subsequent files in this `Research/` folder for deeper dives into specific topics.
