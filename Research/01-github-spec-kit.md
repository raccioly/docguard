# GitHub Spec Kit — Deep Dive

> **Date**: March 12, 2026  
> **Source**: https://github.com/github/spec-kit  
> **Version**: v0.2.1 (March 2026)  
> **Stars**: 46,000+ | **Contributors**: 108 | **Releases**: 114

---

## What It Is

A Python CLI (`specify`) that implements Spec-Driven Development (SDD). It scaffolds documentation and uses slash commands to guide AI agents through a structured workflow.

## Installation

```bash
# Persistent (recommended)
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git

# One-time
uvx --from git+https://github.com/github/spec-kit.git specify init <PROJECT_NAME>
```

## Workflow (6 Steps)

1. **Install** — `specify init` (creates `.specify/` directory)
2. **Constitution** — `/speckit.constitution` → creates `.specify/memory/constitution.md`
3. **Specify** — `/speckit.specify` → creates feature spec in `specs/<feature>/`
4. **Plan** — `/speckit.plan` → creates technical implementation plan
5. **Tasks** — `/speckit.tasks` → breaks plan into actionable checklist
6. **Implement** — `/speckit.implement` → AI builds from tasks

## File Structure Created

```
project/
├── .specify/
│   └── memory/
│       └── constitution.md         # Project principles & guardrails
├── specs/
│   └── 001-feature-name/
│       ├── spec.md                 # Feature specification
│       ├── plan.md                 # Technical implementation plan
│       └── tasks.md                # Actionable task breakdown
```

## Supported AI Agents (20+)

Claude Code, Gemini CLI, GitHub Copilot, Cursor, Windsurf, Kiro, Amp, Jules, 
Roo Code, Cline/Kilo Code, OpenAI Codex, IBM Bob, Augment Code, Qwen Code, 
Mistral Vibe, Kimi Code, Antigravity (agy), SHAI (OVHcloud), Tabnine CLI, 
CodeBuddy CLI, opencode

## Core Philosophy

- Intent-driven: specs define the "what" before the "how"
- Multi-step refinement rather than one-shot prompting
- Technology-independent
- Supports enterprise constraints

## What's Missing (vs Your Approach)

| Your Feature | Spec Kit Equivalent |
|-------------|-------------------|
| `docs-canonical/` (READ-ONLY design intent) | `constitution.md` (close but much thinner) |
| `docs-implementation/` (current state) | ❌ Nothing |
| `DRIFT-LOG.md` | ❌ Nothing |
| `// DRIFT:` inline comments | ❌ Nothing |
| Architecture enforcement | ❌ Nothing |
| Changelog discipline | ❌ Nothing |
| Docs-sync validation | ❌ Nothing |
| 24+ quality gate workflows | ❌ Nothing |
| `AGENT-REFERENCE.md` (lookup tables) | ❌ Nothing |
| `ADR.md` (decision records) | ❌ Nothing |
| Brownfield support | Partial (community walkthroughs show it) |

## Verdict

Spec Kit is a **generation tool**. It helps you go from idea → spec → code. 
It does NOT help you maintain alignment between specs and code over time.
It does NOT enforce architectural boundaries, track drift, or validate documentation completeness.

**Complementary, not competitive.** Your tool could run *after* Spec Kit generates code.
