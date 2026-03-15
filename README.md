# 🛡️ DocGuard

> **The enforcement layer for Spec-Driven Development.**
> Validate. Score. Enforce. Ship documentation that AI agents can actually use.

[![npm](https://img.shields.io/npm/v/docguard-cli)](https://www.npmjs.com/package/docguard-cli)
[![PyPI](https://img.shields.io/pypi/v/docguard-cli)](https://pypi.org/project/docguard-cli/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-brightgreen)](package.json)
[![Spec Kit Extension](https://img.shields.io/badge/Spec_Kit-Extension-blueviolet)](https://github.com/github/spec-kit)

---

## Table of Contents

- [What is DocGuard?](#what-is-docguard)
- [Quick Start](#-quick-start)
- [Spec Kit Integration](#-spec-kit-integration)
- [Commands](#-commands)
- [Validators](#-validators)
- [Templates](#-templates)
- [AI Agent Support](#-ai-agent-support)
- [Slash Commands](#-slash-commands)
- [Examples](#-examples)
- [Testing](#-testing)
- [CI/CD Integration](#%EF%B8%8F-cicd-integration)
- [File Structure](#-file-structure)
- [Configuration](#%EF%B8%8F-configuration)
- [Research Credits](#-research-credits)

---

## What is DocGuard?

DocGuard enforces **Canonical-Driven Development (CDD)** — a methodology where documentation is the source of truth, not an afterthought. AI writes the docs, DocGuard validates them.

| Traditional Development | Canonical-Driven Development |
|:----|:----|
| Code first, docs maybe | Docs first, code conforms |
| Docs rot silently | Drift is tracked and enforced |
| Docs are optional | Docs are required and validated |
| One AI agent, one context | Any agent, shared context via canonical docs |

DocGuard is an official [GitHub Spec Kit](https://github.com/github/spec-kit) community extension. It validates the artifacts that Spec Kit creates, ensuring your specs stay high-quality throughout the development lifecycle.

📖 **[Philosophy](PHILOSOPHY.md)** · 📋 **[CDD Standard](STANDARD.md)** · ⚖️ **[Comparisons](COMPARISONS.md)** · 🗺️ **[Roadmap](ROADMAP.md)**

### Architecture

```mermaid
graph TD
    CLI["CLI Entry<br/>docguard.mjs"] --> Commands["Commands (15)"]
    Commands --> guard["guard"]
    Commands --> generate["generate"]
    Commands --> score["score"]
    Commands --> diagnose["diagnose"]
    Commands --> setup["setup wizard"]
    Commands --> other["diff · init · fix · trace<br/>agents · hooks · badge · ci · watch"]

    guard --> Validators["Validators (19)"]
    generate --> Scanners["Scanners (4)<br/>routes · schemas · doc-tools · speckit"]
    score --> Scoring["Weighted Scoring<br/>8 categories"]
    diagnose --> Validators
    diagnose --> AIPrompts["AI-Ready<br/>Fix Prompts"]

    Validators --> Output["Output"]
    Scanners --> Output
    Scoring --> Output
    Output --> Terminal["Terminal"]
    Output --> JSON["JSON"]
    Output --> Badge["Badge"]

    style CLI fill:#2d5016,color:#fff
    style Validators fill:#1a3a5c,color:#fff
    style Scanners fill:#1a3a5c,color:#fff
    style Output fill:#5c3a1a,color:#fff
```

> **Distribution**: Node.js core (npm) · Python wrapper (PyPI) · GitHub Action (`action.yml`) · Spec Kit Extension (ZIP)

---

## ⚡ Quick Start

### Node.js (npm)

```bash
# No install needed — run directly
npx docguard-cli diagnose

# Or install globally
npm i -g docguard-cli
docguard diagnose
```

### Python (PyPI)

```bash
pip install docguard-cli
docguard diagnose
```

> **Note:** The Python package is a thin wrapper that delegates to `npx`. Node.js 18+ is required on the system.

### Core Workflow

```bash
# 1. Initialize docs for your project
npx docguard-cli init

# 2. Or reverse-engineer docs from existing code
npx docguard-cli generate

# 3. AI diagnoses issues and generates fix prompts
npx docguard-cli diagnose

# 4. Validate — use as CI gate
npx docguard-cli guard

# 5. Check maturity score
npx docguard-cli score
```

### The AI Loop

```
diagnose  →  AI reads prompts  →  AI fixes docs  →  guard verifies
   ↑                                                       ↓
   └───────────────── issues found? ←──────────────────────┘
```

`diagnose` is the primary command. It runs all validators, maps every failure to an AI-actionable fix prompt, and outputs a remediation plan. Your AI agent runs it, fixes the docs, and runs `guard` to verify. Zero human intervention required.

---

## 🌱 Spec Kit Integration

DocGuard is a [community extension](https://github.com/github/spec-kit/blob/main/extensions/README.md) for GitHub's **Spec Kit** framework. While Spec Kit focuses on **creating** specifications (via AI slash commands like `/speckit.specify` and `/speckit.plan`), DocGuard focuses on **validating** their quality.

### How They Work Together

```
┌─────────────────┐          ┌──────────────────┐
│    Spec Kit      │          │    DocGuard       │
│                  │          │                   │
│  /speckit.specify│ ──────→  │  docguard guard   │
│  Creates specs   │          │  Validates specs  │
│  (AI-driven)     │          │  (automated)      │
└─────────────────┘          └──────────────────┘
```

| Phase | Tool | What happens |
|:------|:-----|:-------------|
| 1. Initialize | `specify init` | Creates `.specify/` directory and templates |
| 2. Write specs | `/speckit.specify` | AI creates `spec.md` with FR-IDs, user stories |
| 3. **Validate** | **`docguard guard`** | Checks spec quality (mandatory sections, FR/SC IDs) |
| 4. Plan | `/speckit.plan` | AI creates `plan.md` with technical context |
| 5. **Validate** | **`docguard guard`** | Checks plan quality (sections, structure) |
| 6. Tasks | `/speckit.tasks` | AI creates `tasks.md` with phased breakdown |
| 7. **Validate** | **`docguard guard`** | Checks task quality (phases, T-IDs) |
| 8. Implement | `/speckit.implement` | AI writes code |
| 9. **Enforce** | **`docguard guard`** | Final quality gate — CI/CD |

### What DocGuard Validates in Spec Kit Projects

- **spec.md** — Mandatory sections (User Scenarios, Requirements, Success Criteria), FR-xxx IDs, SC-xxx IDs
- **plan.md** — Summary, Technical Context, Project Structure sections
- **tasks.md** — Phased task breakdown (Phase 1, 2, 3+), T-xxx task IDs
- **constitution.md** — Detected at `.specify/memory/constitution.md` or project root
- **Requirement traceability** — FR, SC, NFR, US, AC, UC, SYS, ARCH, MOD, T IDs

### Installing as a Spec Kit Extension

```bash
specify extension add docguard
```

This installs DocGuard's slash commands (`/docguard.guard`, `/docguard.review`, `/docguard.fix`, `/docguard.score`) into your AI agent's command palette.

---

## Usage

DocGuard ships **13 commands**:

| Command | Purpose |
|:--------|:--------|
| `diagnose` | **Primary** — identify every issue + generate AI fix prompts |
| `guard` | Validate project against canonical docs (CI gate) |
| `generate` | Reverse-engineer docs from existing codebase |
| `init` | Initialize CDD docs from templates (interactive) |
| `score` | CDD maturity score (0–100) with weighted breakdown |
| `fix --doc <name>` | Generate AI prompt for a specific document |
| `diff` | Compare canonical docs vs actual code artifacts |
| `agents` | Generate agent-specific config files |
| `trace` | Requirements traceability matrix |
| `ci` | CI/CD pipeline check with threshold |
| `watch` | Live watch mode with auto-fix |
| `hooks` | Install git hooks (pre-commit, pre-push) |
| `llms` | Generate `llms.txt` (AI-friendly project summary) |

### CLI Flags

| Flag | Description | Commands |
|:-----|:------------|:---------|
| `--dir <path>` | Project directory (default: `.`) | All |
| `--verbose` | Show detailed output | All |
| `--format json` | Machine-readable output for CI/CD | score, guard, diff |
| `--force` | Overwrite existing files (creates `.bak` backups) | generate, agents, init |
| `--profile <name>` | Starter, standard, or enterprise | init |
| `--agent <name>` | Target specific AI agent | agents |

### Example Output

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
  ✅ REQUIREMENTS.md (spec-kit aligned)
  ✅ AGENTS.md
  ✅ CHANGELOG.md
  ✅ DRIFT-LOG.md

  Generated: 9  Skipped: 0
```

---

## 🔍 Validators

DocGuard runs **19 automated validators** on every `guard` check:

| # | Validator | What It Checks | Default |
|:--|:----------|:--------------|:--------|
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
| 11 | **Traceability** | Requirement IDs (FR, SC, NFR, US, AC, T) trace to tests | ✅ On |
| 12 | **Docs-Diff** | Code artifacts match documented entities | ✅ On |
| 13 | **Metadata-Sync** | Version refs consistent across docs | ✅ On |
| 14 | **Docs-Coverage** | Code features referenced in documentation | ✅ On |
| 15 | **Metrics-Consistency** | Hardcoded numbers match actual counts | ✅ On |
| 16 | **Doc-Quality** | Writing quality (readability, passive voice, atomicity) | ✅ On |
| 17 | **TODO-Tracking** | Untracked TODOs/FIXMEs and skipped tests | ✅ On |
| 18 | **Schema-Sync** | Database models documented in DATA-MODEL.md | ✅ On |
| 19 | **Spec-Kit** | Spec quality validation (FR-IDs, mandatory sections, phased tasks) | ✅ On |

---

## 📄 Templates

DocGuard ships **18 professional templates** with metadata, badges, and revision history:

| Template | Type | Purpose |
|:---------|:-----|:--------|
| ARCHITECTURE.md | Canonical | System design, components, layer boundaries |
| DATA-MODEL.md | Canonical | Schemas, entities, relationships |
| SECURITY.md | Canonical | Auth, permissions, secrets management |
| TEST-SPEC.md | Canonical | Test strategy, coverage requirements |
| ENVIRONMENT.md | Canonical | Environment variables, deployment config |
| REQUIREMENTS.md | Canonical | Spec-kit aligned FR/SC IDs, user stories |
| DEPLOYMENT.md | Canonical | Infrastructure, CI/CD, DNS |
| ADR.md | Canonical | Architecture Decision Records |
| ROADMAP.md | Canonical | Project phases, feature tracking |
| KNOWN-GOTCHAS.md | Implementation | Symptom → gotcha → fix entries |
| TROUBLESHOOTING.md | Implementation | Error diagnosis guides |
| RUNBOOKS.md | Implementation | Operational procedures |
| VENDOR-BUGS.md | Implementation | Third-party issue tracker |
| CURRENT-STATE.md | Implementation | Deployment status, tech debt |
| AGENTS.md | Agent | AI agent behavior rules |
| CHANGELOG.md | Tracking | Change log |
| DRIFT-LOG.md | Tracking | Deviation tracking |
| llms.txt | Generated | AI-friendly project summary (llmstxt.org) |

---

## 🤖 AI Agent Support

DocGuard works with **every major AI coding agent**. All canonical docs are plain markdown — no vendor lock-in.

| Agent | Compatibility | Auto-Generate Config |
|:------|:---:|:---:|
| Google Antigravity | ✅ | `docguard agents --agent antigravity` |
| Claude Code | ✅ | `docguard agents --agent claude` |
| GitHub Copilot | ✅ | `docguard agents --agent copilot` |
| Cursor | ✅ | `docguard agents --agent cursor` |
| Windsurf | ✅ | `docguard agents --agent windsurf` |
| Cline | ✅ | `docguard agents --agent cline` |
| Google Gemini CLI | ✅ | `docguard agents --agent gemini` |
| Kiro (AWS) | ✅ | — |

---

## ⚡ Slash Commands

DocGuard provides AI agent slash commands for integrated workflows. Installed automatically via `docguard init` or `specify extension add docguard`:

| Command | What It Does |
|:--------|:-------------|
| `/docguard.guard` | Run quality validation — check all 19 validators |
| `/docguard.review` | Analyze doc quality and suggest improvements |
| `/docguard.fix` | Generate targeted fix prompts for specific issues |
| `/docguard.score` | Show CDD maturity score with category breakdown |

These commands are installed into your AI agent's command directory:

```
.github/commands/     → GitHub Copilot
.cursor/rules/        → Cursor
.gemini/commands/     → Google Gemini
.claude/commands/     → Claude Code
.agents/workflows/    → Antigravity
```

---

## 🧠 AI Skills (Enterprise)

Beyond slash commands, DocGuard provides **4 enterprise-grade AI skills** — deep behavior protocols that tell AI agents not just *what* to run, but *how to think, validate, and iterate*. Skills are modeled after [Spec Kit's](https://github.com/github/spec-kit) skill architecture.

| Skill | Lines | What It Does |
|:------|:-----:|:-------------|
| `docguard-guard` | 155 | 6-step quality gate with severity triage (CRITICAL→LOW), structured reporting, remediation |
| `docguard-fix` | 195 | 7-step research workflow with per-document codebase research and 3-iteration validation loops |
| `docguard-review` | 170 | Read-only semantic cross-document analysis with 6 analysis passes and quality scoring |
| `docguard-score` | 165 | CDD maturity assessment with ROI-based improvement roadmap and grade progression |

### Workflow Hooks

DocGuard integrates into the spec-kit workflow as an automated quality gate:

| Hook | When | Behavior |
|:-----|:-----|:---------|
| `after_implement` | After `/speckit.implement` | **Mandatory** — always runs DocGuard guard |
| `before_tasks` | Before `/speckit.tasks` | Optional — reviews doc consistency |
| `after_tasks` | After `/speckit.tasks` | Optional — shows CDD maturity score |

### Orchestration Scripts

For advanced users and CI/CD pipelines, DocGuard includes bash scripts with `--json` output:

| Script | Purpose |
|:-------|:--------|
| `docguard-check-docs.sh` | Discover project docs, return JSON inventory with metadata |
| `docguard-suggest-fix.sh` | Run guard, parse results, output prioritized fixes |
| `docguard-init-doc.sh` | Initialize canonical doc with metadata header |

---

## 📁 Examples

Three real-world projects to see DocGuard in action:

| Example | Scenario | What You'll See |
|---------|----------|----------------|
| [01-express-api](examples/01-express-api/) | Node.js API with **zero docs** | Cold-start: `generate` → instant coverage |
| [02-python-flask](examples/02-python-flask/) | Python app with **drifted docs** | Drift detection: catch when docs lie |
| [03-spec-kit-project](examples/03-spec-kit-project/) | Full CDD + Spec Kit | Gold standard: what maturity looks like |

See [examples/README.md](examples/README.md) for step-by-step instructions.

---

## 🧪 Testing

### Test Suite

```bash
npm test    # 33 tests across 18 describe blocks
```

Covers all 15 CLI commands, project type detection, compliance profiles, JSON output format, and help completeness.

### CI Matrix

| Node.js | OS | Status |
|---------|-----|--------|
| 18 | ubuntu-latest | ✅ |
| 20 | ubuntu-latest | ✅ |
| 22 | ubuntu-latest | ✅ |

### Self-Validation (Dogfooding)

DocGuard runs its own `guard`, `score`, `diff`, `diagnose`, and `badge` commands against itself in CI — ensuring the tool passes its own checks.

---

## ⚙️ CI/CD Integration

### GitHub Actions

```yaml
name: DocGuard CDD Check
on: [pull_request]
jobs:
  docguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx docguard-cli guard
      - run: npx docguard-cli score --format json
```

### Pre-commit Hook

```bash
npx docguard-cli hooks --type pre-commit
```

### GitHub Marketplace

```yaml
- uses: raccioly/docguard@v0.9.7
  with:
    command: guard
    fail-on-warning: true
```

---

## 📁 File Structure

```
your-project/
├── .specify/                        # Spec Kit (if using specify init)
│   ├── specs/
│   │   └── 001-feature/
│   │       ├── spec.md              # Requirements (FR-IDs, user stories)
│   │       ├── plan.md              # Implementation plan
│   │       └── tasks.md             # Task breakdown
│   ├── memory/
│   │   └── constitution.md          # Project principles
│   └── templates/
│
├── docs-canonical/                  # CDD canonical docs (the "blueprint")
│   ├── ARCHITECTURE.md              # System design, components
│   ├── DATA-MODEL.md                # Database schemas
│   ├── SECURITY.md                  # Auth, permissions, secrets
│   ├── TEST-SPEC.md                 # Required tests, coverage
│   ├── ENVIRONMENT.md               # Environment variables
│   └── REQUIREMENTS.md              # Spec-kit aligned FR/SC IDs
│
├── docs-implementation/             # Current state (optional)
│   ├── KNOWN-GOTCHAS.md
│   ├── TROUBLESHOOTING.md
│   ├── RUNBOOKS.md
│   └── CURRENT-STATE.md
│
├── AGENTS.md                        # AI agent behavior rules
├── CHANGELOG.md                     # Change tracking
├── DRIFT-LOG.md                     # Documented deviations
├── llms.txt                         # AI-friendly summary
└── .docguard.json                   # DocGuard configuration
```

---

## ⚙️ Configuration

Create `.docguard.json` in your project root (auto-generated by `docguard init`):

```json
{
  "projectName": "my-project",
  "version": "0.4",
  "profile": "standard",
  "projectType": "webapp",
  "validators": {
    "structure": true,
    "docsSync": true,
    "drift": true,
    "changelog": true,
    "testSpec": true,
    "security": true,
    "environment": true,
    "docQuality": true,
    "specKit": true
  }
}
```

See [Configuration Guide](docs/configuration.md) for all options.

---

## 🔬 Research Credits

DocGuard's quality evaluation and documentation generation patterns are informed by peer-reviewed research from the University of Arizona and the Joint Interoperability Test Command (JITC), U.S. Department of Defense:

- **AITPG** — AI-driven Test Plan Generator using Multi-Agent Debate and RAG ([Lopez et al., IEEE TSE 2026](Research/AITPG.pdf))
- **TRACE** — Telecom Root Cause Analysis through Calibrated Explainability ([Lopez et al., IEEE TMLCN 2026](Research/TRACE.pdf))

Lead researcher: **[Martin Manuel Lopez](https://github.com/martinmanuel9)** · [ORCID 0009-0002-7652-2385](https://orcid.org/0009-0002-7652-2385)

See [CONTRIBUTING.md](CONTRIBUTING.md#research--academic-credits) for full citations.

---

## 📄 License

[MIT](LICENSE) — Free to use, modify, and distribute.

---

**Made with ❤️ by [Ricardo Accioly](https://github.com/raccioly)**
