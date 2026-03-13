# AI Integration Guide

DocGuard is **AI-native**. It generates prompts that AI agents execute — the human reviews, not writes.

## How It Works

```
docguard diagnose  →  AI reads output  →  AI writes docs  →  docguard guard  →  ✅
```

DocGuard is designed to be used **by** AI agents, not just **for** humans.

## Supported AI Agents

DocGuard works with any AI coding agent that can read CLI output:

| Agent | Integration |
|-------|------------|
| **Claude Code** | Reads `diagnose` output, writes docs, runs `guard` |
| **GitHub Copilot** | Slash commands in `.github/commands/` |
| **Cursor** | Slash commands in `.cursor/rules/` |
| **Google Antigravity** | Workflows in `.agents/workflows/` |
| **Google Gemini** | Commands in `.gemini/commands/` |
| **Any CLI-capable LLM** | Reads JSON output from `--format json` |

## Slash Commands

`docguard init` auto-installs slash commands for detected AI agents:

```
.github/commands/diagnose.md     # GitHub Copilot
.cursor/rules/diagnose.md        # Cursor
.gemini/commands/diagnose.md     # Google Gemini
.agents/workflows/diagnose.md    # Antigravity
```

## The AI Workflow

### Step 1: Diagnose

```bash
npx docguard diagnose
```

Output:
```
🔍 DocGuard Diagnose — my-project
   Profile: standard | Score: 75/100 (B)
   Guard:   35/41 passed | Status: WARN

  Warnings (3):
  ⚠ [Freshness] docs-canonical/ARCHITECTURE.md — 15 commits since last update
    Fix: docguard fix --doc architecture

  📋 Remediation Plan:
  1. docguard fix --doc architecture
  2. docguard guard ← verify fixes

  🤖 AI-Ready Prompt:
  TASK: Fix 3 documentation issue(s) in project "my-project"
  ...
```

### Step 2: AI Fixes

The AI reads the remediation plan and executes `docguard fix --doc <name>` for each issue. Each fix command outputs research instructions:

```bash
npx docguard fix --doc architecture
```

Output:
```
TASK: Write ARCHITECTURE.md for "my-project"

RESEARCH STEPS:
1. Read package.json for dependencies and project structure
2. List top-level directories (src/, lib/, cli/)
3. Read 2-3 representative files per directory
4. Map the import graph
5. Identify external dependencies

WRITE THE DOCUMENT:
- System Overview (2-3 sentences)
- Component Map (table of modules)
- Layer Boundaries (import rules)
- Data Flow (request lifecycle)
```

### Step 3: Verify

```bash
npx docguard guard
```

If all checks pass → done. If issues remain → repeat from Step 1.

## JSON Output for Automation

For programmatic integration:

```bash
npx docguard diagnose --format json
```

```json
{
  "project": "my-project",
  "profile": "standard",
  "status": "WARN",
  "score": 75,
  "grade": "B",
  "issues": [
    {
      "severity": "warning",
      "validator": "Freshness",
      "message": "ARCHITECTURE.md — 15 commits since last update",
      "command": "docguard fix --doc architecture",
      "docTarget": "architecture"
    }
  ],
  "fixCommands": ["docguard fix --doc architecture"]
}
```

```bash
npx docguard guard --format json
```

```json
{
  "project": "my-project",
  "profile": "standard",
  "status": "PASS",
  "passed": 41,
  "total": 41,
  "validators": [
    { "name": "Structure", "status": "pass", "passed": 8, "total": 8 }
  ]
}
```

## CI/CD Integration

### GitHub Actions

DocGuard ships a ready-to-use workflow:

```yaml
# .github/workflows/docguard.yml
name: DocGuard CDD Check
on: [pull_request]
jobs:
  docguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx docguard ci --format json --threshold 70
```

Or copy `templates/ci/github-actions.yml` from this repo.

### Pre-commit Hook

```bash
npx docguard hooks
```

Automatically runs `guard` before every commit.

## Best Practices for AI Agents

1. **Always run `diagnose` first** — it's the one command that identifies everything
2. **Use `--format json`** for structured, parseable output
3. **Run `guard` after fixes** to verify — loop until all checks pass
4. **Use `fix --doc <name>`** for targeted prompts when you know which doc needs work
5. **Check `score --tax`** periodically to ensure documentation isn't becoming a burden
