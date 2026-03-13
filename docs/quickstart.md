# DocGuard — Quick Start

Get AI-enforced documentation in under 5 minutes.

## For New Projects

### Option A: Minimal (side projects)

```bash
cd your-project
npx docguard init --profile starter
```

Creates only ARCHITECTURE.md + CHANGELOG — the bare minimum.

### Option B: Full CDD (team projects)

```bash
cd your-project
npx docguard init
```

Creates all 5 canonical docs + tracking files + AI slash commands.

### Option C: From existing code (best for established projects)

```bash
cd your-project
npx docguard generate
```

Scans your codebase and generates pre-filled documentation.

## Fill the Docs (AI Does It)

After init creates skeleton templates, run **one command**:

```bash
npx docguard diagnose
```

This outputs a complete AI remediation plan. If you're using Claude Code, Cursor, Copilot, or Antigravity, the AI reads the output and writes every doc automatically.

**That's it.** The AI loop:

```
diagnose  →  AI reads prompts  →  AI fixes docs  →  guard verifies
   ↑                                                       ↓
   └───────────────── issues found? ←──────────────────────┘
```

## Verify

```bash
npx docguard guard        # Pass/fail check
npx docguard score        # 0-100 maturity score
npx docguard score --tax  # How much time docs cost you
```

## Automate

```bash
# Git hooks (auto-check on commit/push)
npx docguard hooks

# CI/CD pipelines
npx docguard ci --threshold 70

# Live watch mode with auto-fix
npx docguard watch --auto-fix
```

## What's Next?

- [Commands Reference](./commands.md) — All 13 commands
- [Configuration](./configuration.md) — `.docguard.json` options
- [Profiles](./profiles.md) — Starter vs Standard vs Enterprise
- [AI Integration](./ai-integration.md) — How AI agents use DocGuard
- [FAQ](./faq.md) — Common questions
