---
title: Quick Start
nav_order: 2
---

# DocGuard — Quick Start

Set up DocGuard in under 5 minutes. Your agent then keeps your docs correct.

## For New Projects

### Option A: Minimal (side projects)

```bash
cd your-project
npx docguard-cli init --profile starter
```

Creates only ARCHITECTURE.md and CHANGELOG. This is the minimum.

### Option B: Full CDD (team projects)

```bash
cd your-project
npx docguard-cli init
```

Creates the 5 required canonical docs plus REQUIREMENTS.md, the tracking files and the agent slash commands.

### Option C: Spec-Driven Development (spec-kit projects)

If you use [GitHub Spec Kit](https://github.com/github/spec-kit):

```bash
# 1. Initialize Spec Kit for your agent
specify init --here --integration claude

# 2. Add DocGuard: init registers its Spec Kit extension
npx docguard-cli init

# 3. Write specs with AI, validate with DocGuard
/speckit.specify Build an app that...
npx docguard-cli guard
```

### Option D: From existing code (established projects)

```bash
cd your-project
npx docguard-cli generate
```

Scans your code and writes pre-filled docs. These include REQUIREMENTS.md, with FR/SC IDs that match Spec Kit.

## Fill the Docs (AI Does It)

After `init` creates the skeleton templates, run **one command**:

```bash
npx docguard-cli diagnose
```

This prints a complete fix plan for your agent. If you use Claude Code, Cursor, Copilot, or Antigravity, the agent reads the plan and writes every doc.

**That's all.** The loop works like this:

```
diagnose  →  AI reads prompts  →  AI fixes docs  →  guard verifies
   ↑                                                       ↓
   └───────────────── issues found? ←──────────────────────┘
```

## Verify

```bash
npx docguard-cli guard        # Pass/fail check (36 validators)
npx docguard-cli score        # 0-100 maturity score
```

## Automate

```bash
# Git hooks (auto-check on commit/push)
npx docguard-cli hooks

# CI/CD pipelines
npx docguard-cli ci --threshold 70

# Live watch mode
npx docguard-cli watch --auto-fix
```

## What's Next?

- [Commands Reference](./commands.md) — All 28 commands
- [Configuration](./configuration.md) — `.docguard.json` options
- [Profiles](./profiles.md) — Starter, Standard and Enterprise
- [AI Integration](./ai-integration.md) — How agents use DocGuard
- [FAQ](./faq.md) — Common questions
