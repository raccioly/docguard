# Agent Compatibility Guide

> How CDD / SpecGuard works with every major AI coding agent.

---

## The Compatibility Advantage

CDD's canonical docs are **plain markdown files in your repo**. Every AI coding agent can read markdown. This means your `docs-canonical/` files are automatically available to any agent — no plugins, no configuration, no vendor lock-in.

But different agents also have their **own instruction files**. Here's how CDD works with each one.

---

## Universal Layer: AGENTS.md

The [AGENTS.md standard](https://agents.md) (Linux Foundation) is read by **25+ agents**. CDD's required `AGENTS.md` file serves as the universal instruction layer.

**Supported by**: Claude Code, GitHub Copilot, Cursor, Windsurf, Cline, Gemini CLI, Kiro, Devin, Jules, Codex, Amp, Roo Code, and more.

---

## Agent-Specific Instruction Files

| Agent | Instruction File | Relationship to CDD |
|-------|-----------------|---------------------|
| **Google Antigravity** | `AGENTS.md` + Knowledge Items | ✅ Reads AGENTS.md natively. Knowledge Items auto-index your `docs-canonical/` files across conversations. |
| **Claude Code** | `CLAUDE.md` | ✅ Fully compatible. Can use `CLAUDE.md` in place of or alongside `AGENTS.md`. |
| **GitHub Copilot** | `.github/copilot-instructions.md` | ✅ Compatible. Reference your canonical docs from copilot-instructions. |
| **Cursor** | `.cursor/rules/*.mdc` | ✅ Compatible. Cursor rules can reference canonical docs path. |
| **Windsurf** | `.windsurfrules` | ✅ Compatible. Windsurf rules can reference canonical docs path. |
| **Cline** | `.clinerules` | ✅ Compatible. Cline rules can reference canonical docs path. |
| **Continue.dev** | `.continue/config.json` | ✅ Compatible. Continue can be configured to include doc context. |
| **Kiro** | Steering files + `specs/` | ✅ Compatible. SpecGuard can bridge from Kiro's format. |
| **VS Code Agents** | `.github/agents/*.agent.md` | ✅ Compatible. Custom agents can reference canonical docs. |
| **Gemini CLI** | `AGENTS.md` + `GEMINI.md` | ✅ Reads AGENTS.md natively. |

---

## How To Set Up Maximum Compatibility

### Option 1: AGENTS.md Only (Recommended Start)

The simplest approach. One file, maximum reach.

```
project-root/
├── AGENTS.md                     # Universal — read by 25+ agents
└── docs-canonical/               # All agents can read these
    ├── ARCHITECTURE.md
    ├── DATA-MODEL.md
    └── ...
```

**Your AGENTS.md should include a section pointing agents to canonical docs:**

```markdown
## Project Documentation

This project follows Canonical-Driven Development (CDD).

- **Canonical docs** (design intent): `docs-canonical/`
- **Implementation docs** (current state): `docs-implementation/`
- **Drift tracking**: `DRIFT-LOG.md`
- **Change tracking**: `CHANGELOG.md`

Before making any changes, read the relevant canonical doc first.
When deviating from canonical docs, add `// DRIFT: reason` comment.
```

### Option 2: Multi-Agent Setup (Maximum Compatibility)

For teams using multiple AI tools simultaneously:

```
project-root/
├── AGENTS.md                                  # Universal standard
├── CLAUDE.md                                  # Claude Code specific
├── .github/
│   ├── copilot-instructions.md                # GitHub Copilot
│   └── agents/
│       └── project-expert.agent.md            # VS Code custom agent
├── .cursor/
│   └── rules/
│       └── project-conventions.mdc            # Cursor rules
├── .windsurfrules                             # Windsurf
├── .clinerules                                # Cline
└── docs-canonical/                            # CDD canonical docs
```

> [!TIP]
> **Don't duplicate content.** Each agent-specific file should REFERENCE the canonical docs, not copy them. Example: your `.cursor/rules/project-conventions.mdc` should say "Read `docs-canonical/ARCHITECTURE.md` before modifying architecture" — not repeat the architecture doc.

### Option 3: SpecGuard Auto-Generate (Future)

SpecGuard will support generating agent-specific instruction files from your `AGENTS.md`:

```bash
specguard generate --agent-files

# Generates:
# ✅ .github/copilot-instructions.md (from AGENTS.md)
# ✅ .cursor/rules/cdd-conventions.mdc (from AGENTS.md)
# ✅ .clinerules (from AGENTS.md)
# ✅ .windsurfrules (from AGENTS.md)
```

This is a planned feature for Phase 3.

---

## Google Antigravity Specific

Antigravity has special advantages with CDD:

1. **AGENTS.md** — Antigravity reads this natively at the start of every conversation.

2. **Knowledge Items (KIs)** — Antigravity automatically distills information from conversations into persistent knowledge. Your canonical docs become part of this knowledge base, accessible across all future conversations.

3. **Workflows** — Antigravity supports slash-command workflows (e.g., `/preflight`, `/courier`). CDD's SpecGuard validators can be integrated as workflow steps.

4. **Conversation continuity** — Antigravity maintains context across conversations via logs and artifacts. Combined with canonical docs, this means the AI has deep project understanding from day one.

**Recommendation for Antigravity users:**
- Use `AGENTS.md` (universal, Antigravity reads it)
- Put your CDD governance rules in `AGENTS.md` (research-before-code, confirm-before-implementing)
- Store workflows in `.agents/workflows/` — SpecGuard guards can be a workflow step

---

## VS Code Integration Points

Since most agents run inside VS Code, here are the integration paths:

| Integration | How |
|------------|-----|
| **Pre-commit hook** | `specguard guard` runs before every commit |
| **VS Code Task** | Add `specguard guard` as a VS Code task in `.vscode/tasks.json` |
| **Terminal** | Run manually: `npx specguard audit` |
| **CI/CD** | GitHub Actions / GitLab CI runs `specguard guard` on every PR |
| **Agent workflow** | Any agent can run `specguard guard` as a tool call |

### VS Code tasks.json Example

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "SpecGuard: Audit",
      "type": "shell",
      "command": "npx specguard audit",
      "group": "test",
      "problemMatcher": []
    },
    {
      "label": "SpecGuard: Guard",
      "type": "shell",
      "command": "npx specguard guard",
      "group": "test",
      "problemMatcher": []
    }
  ]
}
```

---

## Key Principle: Write Once, All Agents Understand

The power of CDD is that your canonical docs are **agent-agnostic markup**:

```
AGENTS.md        → Tells any agent HOW to work with your project
docs-canonical/  → Tells any agent WHAT the project is
DRIFT-LOG.md     → Tells any agent WHERE code deviates from design
TEST-SPEC.md     → Tells any agent WHAT should be tested
```

No proprietary format. No vendor lock-in. Any agent, any IDE, any time.
