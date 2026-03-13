# SpecGuard — Quick Start

Get CDD documentation compliance in under 5 minutes.

## 1. Initialize

```bash
cd your-project
npx specguard init
```

This creates:
- `docs-canonical/` — 5 canonical documents (Architecture, Data Model, Security, Test Spec, Environment)
- `AGENTS.md` — AI agent instructions with SpecGuard workflow
- `CHANGELOG.md` — Change tracking
- `DRIFT-LOG.md` — Documentation deviation log
- `.specguard.json` — Project configuration
- `.github/commands/` — Slash commands for AI agents

## 2. Write Real Content

The init creates **skeleton templates**. The AI writes the real content:

```bash
# Generate AI research prompts for each document
npx specguard fix --doc architecture
npx specguard fix --doc data-model
npx specguard fix --doc security
npx specguard fix --doc test-spec
npx specguard fix --doc environment
```

Each command outputs research instructions. If you're using an AI coding agent (Claude Code, Cursor, Copilot), the agent reads the output and writes the doc automatically.

## 3. Validate

```bash
npx specguard guard
```

Shows pass/fail for each validator. Fix any issues and re-run.

## 4. Score

```bash
npx specguard score
```

Get your CDD maturity score (0-100) with a letter grade.

## 5. Integrate

```bash
# Add git hooks (pre-commit guard, pre-push score)
npx specguard hooks

# CI/CD integration
npx specguard ci --threshold 70
```

## What's Next?

- Run `npx specguard fix` anytime to find issues
- Run `npx specguard --help` to see all commands
- Read [configuration.md](./configuration.md) to customize validators
- Read [commands.md](./commands.md) for the full command reference
