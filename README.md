# DocGuard

> **AI-native documentation enforcement for Canonical-Driven Development (CDD).**  
> AI diagnoses. AI fixes. AI verifies. Humans review.

[![npm](https://img.shields.io/npm/v/docguard-cli)](https://www.npmjs.com/package/docguard-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-brightgreen)](package.json)
[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-DocGuard-blue?logo=github)](https://github.com/marketplace/actions/docguard-cdd-compliance)

---

## What is CDD?

**Canonical-Driven Development** is a methodology where canonical documentation drives every phase of a project — from initial design through ongoing maintenance. Unlike traditional development where docs are written after code (and quickly rot), CDD treats documentation as the authoritative source that code must conform to.

| Traditional | CDD |
|-------------|-----|
| Code first, docs maybe | Docs first, code conforms |
| Docs rot silently | Drift is tracked explicitly |
| Docs are optional | Docs are required and validated |
| One agent, one context | Any agent, shared context |

**DocGuard** is the CLI tool that enforces CDD — auditing, generating, and guarding your project documentation.

📖 **[Read the full philosophy](PHILOSOPHY.md)** | 📋 **[Read the standard](STANDARD.md)** | ⚖️ **[See comparisons](COMPARISONS.md)** | 🗺️ **[Roadmap](ROADMAP.md)**

---

## Quick Start

```bash
# The primary command — AI diagnoses AND fixes everything
npx docguard-cli diagnose

# Generate CDD docs from an existing codebase
npx docguard-cli generate

# Start from scratch (minimal setup for side projects)
npx docguard-cli init --profile starter

# Start from scratch (full enterprise setup)
npx docguard-cli init

# CI gate — pass/fail for pipelines
npx docguard-cli guard
```

No installation needed. Zero dependencies. Works with Node.js 18+.

### Install

```bash
# Run directly (no install)
npx docguard-cli diagnose

# Or install globally
npm i -g docguard-cli
docguard diagnose
```

### GitHub Action

```yaml
- uses: raccioly/docguard@v0.5.0
  with:
    command: guard
    fail-on-warning: true
```

### The AI Loop

```
diagnose  →  AI reads prompts  →  AI fixes docs  →  guard verifies
   ↑                                                       ↓
   └───────────────── issues found? ←──────────────────────┘
```

`diagnose` is the primary command. It runs all validators, maps every failure to an AI-actionable fix prompt, and outputs a remediation plan. Your AI agent runs it, fixes the docs, and runs `guard` to verify. Zero human intervention.

---

## Usage

```bash
# Initialize CDD docs for your project
npx docguard-cli init

# Reverse-engineer docs from existing code
npx docguard-cli generate

# Validate project — use as CI gate
npx docguard-cli guard

# Get AI-actionable fix prompts
npx docguard-cli diagnose

# Check CDD maturity score
npx docguard-cli score
```

---

## 13 Commands

### 🔮 Generate — Reverse-engineer docs from code
```
$ npx docguard-cli generate

🔮 DocGuard Generate — my-project
   Scanning codebase to generate canonical documentation...

  Detected Stack:
    language: TypeScript ^5.0
    framework: Next.js ^14.0
    database: PostgreSQL
    orm: Drizzle 0.33
    testing: Vitest
    hosting: AWS Amplify

  ✅ ARCHITECTURE.md (4 components, 6 tech)
  ✅ DATA-MODEL.md (12 entities detected)
  ✅ ENVIRONMENT.md (18 env vars detected)
  ✅ TEST-SPEC.md (45 tests, 8/10 services mapped)
  ✅ SECURITY.md (auth: NextAuth.js)
  ✅ AGENTS.md
  ✅ CHANGELOG.md
  ✅ DRIFT-LOG.md

  Generated: 8  Skipped: 0
```

**Detects:** Next.js, React, Vue, Angular, Fastify, Express, Hono, Django, FastAPI, SvelteKit, and more.  
**Scans for:** Routes, models, services, tests, env vars, components, middleware.

### 📊 Score — CDD maturity assessment
```
$ npx docguard-cli score

  Category Breakdown

  structure      ████████████████████ 100%  (×25) = 25 pts
  docQuality     ██████████████████░░ 90%   (×20) = 18 pts
  testing        █████████░░░░░░░░░░░ 45%   (×15) = 7 pts
  security       █████████████████░░░ 85%   (×10) = 9 pts
  environment    ██████████████░░░░░░ 70%   (×10) = 7 pts
  drift          ████████████████████ 100%  (×10) = 10 pts
  changelog      ██████████████░░░░░░ 70%   (×5)  = 4 pts
  architecture   █████████████████░░░ 85%   (×5)  = 4 pts

  CDD Maturity Score: 83/100 (A)
  Great — Strong CDD compliance

  Top improvements:
  → testing: Add tests/ directory and configure TEST-SPEC.md
```

### 🔍 Diff — Canonical docs vs code comparison
```
$ npx docguard-cli diff

  🛣️ API Routes
    In code but not documented:
      + src/routes/webhooks.ts
      + src/routes/admin/settings.ts
    ✓ In sync: 12 routes

  🔧 Environment Variables
    Documented but not found in .env.example:
      − REDIS_URL
```

### 🤖 Agents — Generate agent-specific configs
```
$ npx docguard-cli agents

  ✅ Cursor: .cursor/rules/cdd.mdc
  ✅ GitHub Copilot: .github/copilot-instructions.md
  ✅ Cline: .clinerules
  ✅ Windsurf: .windsurfrules
  ✅ Claude Code: CLAUDE.md
  ✅ Gemini CLI: .gemini/settings.json

  Created: 6  Skipped: 0
```

### 🔍 Audit — What docs exist/missing
```
$ npx docguard-cli audit

  Score: 8/8 required files (100%)
```

### 🏗️ Init — Create CDD docs from templates
```
$ npx docguard-cli init

  Created 9 files (8 docs + .docguard.json)
```

### 🛡️ Guard — Validate project against docs
```
$ npx docguard-cli guard

  ✅ Structure      8/8 checks passed
  ✅ Doc Sections   10/10 checks passed
  ✅ Drift          1/1 checks passed
```

---

## CLI Flags

| Flag | Description | Commands |
|------|-------------|----------|
| `--dir <path>` | Project directory (default: `.`) | All |
| `--verbose` | Show detailed output | All |
| `--format json` | Output as JSON for CI/CD | score, diff |
| `--fix` | Auto-create missing files | guard |
| `--force` | Overwrite existing files | generate, agents, init |
| `--agent <name>` | Target specific agent | agents |

---

## 19 Validators

| # | Validator | What It Checks | Default |
|---|-----------|---------------|---------| 
| 1 | **Structure** | Required CDD files exist | ✅ On |
| 2 | **Doc Sections** | Canonical docs have required sections | ✅ On |
| 3 | **Docs-Sync** | Routes/services referenced in docs + OpenAPI cross-check | ✅ On |
| 4 | **Drift** | `// DRIFT:` comments logged in DRIFT-LOG.md | ✅ On |
| 5 | **Changelog** | CHANGELOG.md has [Unreleased] section | ✅ On |
| 6 | **Test-Spec** | Tests exist per TEST-SPEC.md rules | ✅ On |
| 7 | **Environment** | Env vars documented, .env.example exists | ✅ On |
| 8 | **Security** | No hardcoded secrets in source code | ✅ On |
| 9 | **Architecture** | Imports follow layer boundaries | ✅ On |
| 10 | **Freshness** | Docs not stale relative to code changes | ✅ On |
| 11 | **Traceability** | Canonical docs linked to source + V-Model requirement IDs | ✅ On |
| 12 | **Docs-Diff** | Code artifacts match documented entities | ✅ On |
| 13 | **Metadata-Sync** | Version refs consistent across docs | ✅ On |
| 14 | **Docs-Coverage** | Code features referenced in documentation | ✅ On |
| 15 | **Metrics-Consistency** | Hardcoded numbers match actual counts | ✅ On |
| 16 | **Doc-Quality** | Writing quality (readability, passive voice, atomicity) | ✅ On |
| 17 | **TODO-Tracking** | Untracked TODOs/FIXMEs and skipped tests | ✅ On |
| 18 | **Schema-Sync** | Database models documented in DATA-MODEL.md | ✅ On |
| 19 | **Spec-Kit** | GitHub Spec Kit artifact detection and CDD mapping | ✅ On |

---

## 18 Templates

Every template includes professional metadata: `docguard:version`, `docguard:status`, badges, and revision history.

| Template | Type | Purpose |
|----------|------|---------|
| ARCHITECTURE.md | Canonical | System design, components, boundaries |
| DATA-MODEL.md | Canonical | Schemas, entities, relationships |
| SECURITY.md | Canonical | Auth, permissions, secrets |
| TEST-SPEC.md | Canonical | Required tests, coverage |
| ENVIRONMENT.md | Canonical | Env vars, setup steps |
| DEPLOYMENT.md | Canonical | Infrastructure, CI/CD, DNS |
| ADR.md | Canonical | Architecture Decision Records |
| ROADMAP.md | Canonical | Project phases, feature tracking |
| REQUIREMENTS.md | Canonical | Requirement IDs, V-Model traceability |
| KNOWN-GOTCHAS.md | Implementation | Symptom/gotcha/fix entries |
| TROUBLESHOOTING.md | Implementation | Error diagnosis guides |
| RUNBOOKS.md | Implementation | Operational procedures |
| VENDOR-BUGS.md | Implementation | Third-party issue tracker |
| CURRENT-STATE.md | Implementation | Deployment status, tech debt |
| AGENTS.md | Agent | AI agent behavior rules |
| CHANGELOG.md | Tracking | Change log |
| DRIFT-LOG.md | Tracking | Deviation tracking |
| llms.txt | Generated | AI-friendly project summary (llmstxt.org) |

---

## CDD File Structure

```
your-project/
├── docs-canonical/              # Design intent (the "blueprint")
│   ├── ARCHITECTURE.md          # System design, components, boundaries
│   ├── DATA-MODEL.md            # Database schemas, entity relationships
│   ├── SECURITY.md              # Auth, permissions, secrets
│   ├── TEST-SPEC.md             # Required tests, coverage rules
│   ├── ENVIRONMENT.md           # Environment variables, setup
│   └── REQUIREMENTS.md          # Requirement IDs, V-Model traceability
│
├── docs-implementation/         # Current state (optional)
│   ├── KNOWN-GOTCHAS.md         # Lessons learned
│   ├── TROUBLESHOOTING.md       # Error solutions
│   ├── RUNBOOKS.md              # Operational procedures
│   └── CURRENT-STATE.md         # What's deployed now
│
├── AGENTS.md                    # AI agent behavior rules
├── CHANGELOG.md                 # Change tracking
├── DRIFT-LOG.md                 # Documented deviations
├── llms.txt                     # AI-friendly project summary
└── .docguard.json              # DocGuard configuration
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: DocGuard
on: [pull_request]
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx docguard-cli guard
      - run: npx docguard-cli score --format json
```

### Pre-commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/sh
npx docguard-cli guard
```

---

## Agent Compatibility

DocGuard works with **every major AI coding agent**:

| Agent | Compatibility | Auto-Generate Config |
|-------|:---:|:---:|
| Google Antigravity | ✅ | — |
| Claude Code | ✅ | `docguard agents --agent claude` |
| GitHub Copilot | ✅ | `docguard agents --agent copilot` |
| Cursor | ✅ | `docguard agents --agent cursor` |
| Windsurf | ✅ | `docguard agents --agent windsurf` |
| Cline | ✅ | `docguard agents --agent cline` |
| Gemini CLI | ✅ | `docguard agents --agent gemini` |
| Kiro (AWS) | ✅ | — |

All canonical docs are **plain markdown** — any agent can read them. No vendor lock-in.

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Research Credits

DocGuard's quality evaluation and documentation generation patterns are informed by peer-reviewed research from the University of Arizona and the Joint Interoperability Test Command (JITC), U.S. Department of Defense:

- **AITPG** — AI-driven Test Plan Generator using Multi-Agent Debate and RAG ([Lopez et al., IEEE TSE 2026](Research/AITPG.pdf))
- **TRACE** — Telecom Root Cause Analysis through Calibrated Explainability ([Lopez et al., IEEE TMLCN 2026](Research/TRACE.pdf))

Lead researcher: **[Martin Manuel Lopez](https://github.com/martinmanuel9)** · [ORCID 0009-0002-7652-2385](https://orcid.org/0009-0002-7652-2385)

See [CONTRIBUTING.md](CONTRIBUTING.md#research--academic-credits) for full citations and concept attributions.

---

## License

[MIT](LICENSE) — Free to use, modify, and distribute.

---

**Made with ❤️ by [Ricardo Accioly](https://github.com/raccioly)**
