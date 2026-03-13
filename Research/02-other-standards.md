# Other Standards & Competitors — Research Notes

> **Date**: March 12, 2026

---

## AGENTS.md

- **Website**: https://agents.md
- **Governance**: Linux Foundation (Agentic AI Foundation)
- **Adoption**: 20,000+ GitHub repos
- **Agent support**: 25+ agents
- **Format**: Single markdown file at project root
- **Scope**: Build commands, test commands, code style, security notes
- **Philosophy**: "README for agents" — static context, no enforcement
- **Verdict**: Context layer only. Complementary. Your project docs are deeper and structured.

---

## Kiro (AWS)

- **Launched**: Mid-2025 (public preview)
- **Type**: Full IDE (Code OSS-based)
- **Powered by**: Amazon Bedrock (Claude Sonnet 4.0, 3.7)
- **SDD Files**: `requirements.md`, `design.md`, `tasks.md`
- **Unique Features**: 
  - Agent Hooks (auto-run on git commit, file save, etc.)
  - Steering Files (encode project conventions)
  - Auto-generates design docs and data flow diagrams
- **Weakness**: Proprietary IDE, AWS-locked, no portability
- **Verdict**: Great IDE but vendor-locked. Your approach is repo-native and agent-agnostic.

---

## Cursor Rules

- **Format**: `.cursor/rules/*.mdc` (MDC = markdown + frontmatter)
- **Types**: Always, Auto-Attached (glob-based), Agent-Requested, Manual
- **Scope**: Code style, architecture preferences, framework conventions
- **Precedence**: Local > Auto-Attached > Agent-Requested > Always
- **Limit**: Best under 500 lines
- **Weakness**: Cursor-only, no validation, no enforcement
- **Verdict**: IDE-specific preferences. Not a standard. Not portable.

---

## CLAUDE.md

- **By**: Anthropic
- **Purpose**: Memory/onboarding file for Claude Code
- **Best practice**: Under 200-300 lines, progressive disclosure
- **Scope**: Architecture, conventions, workflows, agent behavior
- **Weakness**: Claude-only (AGENTS.md is the universal equivalent)
- **Verdict**: Your CLAUDE.md files are already more comprehensive than most.

---

## Emerging Protocols

### MCP (Model Context Protocol)
- By Anthropic, donated to Linux Foundation Dec 2025
- Standard for AI agents to discover/connect to tools and data
- Not a documentation standard — it's a connectivity standard

### A2A (Agent-to-Agent)
- Multi-agent communication protocol
- Not relevant to project documentation

### OpenAPI 3.0+
- Gold standard for API contracts
- Machine-enforceable at build time
- Relevant: your /keeper workflow already validates against this

### Markdown for Agents (Cloudflare)
- Feb 2026: converts web content → structured markdown for AI
- Not a project documentation standard

---

## Intent-Driven Development (IDD)

An emerging methodology where:
- Humans define "what" and "why" 
- AI agents manage "how" and "when"
- Microsoft VS Code Copilot "Planning" feature embodies this
- Kiro uses this as core philosophy (Specs + Steering + Hooks)

**Relevance**: Your Step 1 Research + Step 2 Confirm workflow IS intent-driven development. You were doing this before it had a name.

---

## Key Takeaway

Every tool in this space is either:
1. **A context file** (AGENTS.md, CLAUDE.md, Cursor rules) — tells agents what to do
2. **A generation tool** (Spec Kit, Kiro) — helps agents create code from specs

**Nobody is doing governance**: drift detection, architecture enforcement, docs-sync validation, changelog discipline. That's your lane.
