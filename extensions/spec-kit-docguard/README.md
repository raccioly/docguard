# DocGuard — CDD Enforcement Extension for Spec Kit

Enterprise-grade Canonical-Driven Development (CDD) enforcement and **AI-readable project memory** for [Spec Kit](https://github.com/github/spec-kit). DocGuard builds source-derived documentation context for supported code (`generate --plan`), refreshes generated sections as code changes (`sync`), and checks configured rules (`guard`) — with deterministic mechanical fixes (`fix --write`) where it can and grounded agent prompts where prose is needed.

## Features

- **Configurable validators** — Structure, Security, Doc Quality, Test-Spec, Drift-Comments, API-Surface, Freshness, Cross-Reference, and more; use `docguard --help` for the current surface
- **Language-specific extraction** — Supported checks cover several languages and monorepos. Coverage varies by detector; unsupported inputs remain unverified.
- **AI-powered Generate** — `generate --plan` builds the code-truth skeleton in `<!-- docguard:section -->` markers and emits a structured agent task manifest; the AI writes the prose.
- **Refresh and review** — `sync` surgically refreshes code-truth doc sections in place, **preserves human prose**, flags prose for agent review.
- **Mechanical `fix --write`** — deterministic, no-LLM: remove stale documented endpoints, refresh stale "N validators" counts, replace stale version refs, insert missing `## [Unreleased]`.
- **5 AI Skills** — docguard-fix, docguard-guard, docguard-sync, docguard-review, docguard-score (enterprise-grade behavior protocols, not just step-lists)
- **Workflow Chaining** — YAML handoffs enable guard → sync → fix → review → score flows
- **Spec Kit Hooks** — Quality gate integrations at implement, tasks, and review phases
- **Minimal Dependencies** — one pinned, optional-load parser (`@babel/parser`); Node.js built-ins otherwise

## Installation

```bash
npm install -g docguard-cli
```

Spec Kit orchestration scripts require a local `node_modules/docguard-cli` installation or `docguard` on PATH; they do not implicitly download a CLI. Direct CLI use via npx remains available:
```bash
npx docguard-cli guard
```

## Quick Start

```bash
# Initialize CDD in your project
docguard init

# Check documentation health
docguard guard

# Get AI-ready fix prompts
docguard fix --doc architecture

# Calculate maturity score
docguard score
```

## Commands

| Command | Alias | Purpose |
|---------|-------|---------|
| `speckit.docguard.guard` | `docguard.guard` | Run configurable quality gate with severity triage |
| `speckit.docguard.fix` | `docguard.fix` | AI-driven documentation repair with codebase research |
| `speckit.docguard.review` | `docguard.review` | Cross-document semantic consistency analysis (read-only) |
| `speckit.docguard.score` | `docguard.score` | CDD maturity score with ROI improvement roadmap |
| `speckit.docguard.diagnose` | — | Diagnose issues + generate multi-perspective AI prompts |
| `speckit.docguard.generate` | — | Reverse-engineer canonical docs from codebase |

## AI Skills

DocGuard provides 4 enterprise-grade AI behavior protocols modeled after Spec Kit's skill architecture:

| Skill | Lines | What It Does |
|-------|:-----:|-------------|
| `docguard-guard` | 155 | 6-step execution with severity triage, structured reporting, remediation recommendations |
| `docguard-fix` | 195 | 7-step research workflow with per-document codebase research, 3-iteration validation loops |
| `docguard-review` | 170 | Semantic cross-document analysis with 6 analysis passes and quality scoring matrix |
| `docguard-score` | 165 | CDD maturity assessment with ROI-based improvement roadmap and grade progression |

Skills differ from commands in a critical way: **commands tell agents what to run** (step-lists), while **skills tell agents how to think, validate, and iterate** (behavior protocols).

## Spec Kit Integration

### Workflow Hooks

DocGuard integrates into the spec-kit workflow through hooks:

```yaml
hooks:
  after_implement:   # Optional — quality gate after /speckit.implement
    command: speckit.docguard.guard
  before_tasks:      # Optional — review docs before task generation
    command: speckit.docguard.review
  after_tasks:       # Optional — show score after tasks
    command: speckit.docguard.score
```

### Workflow Chaining

All commands support YAML handoffs for seamless workflow chaining:

```
guard → fix → review → score
  ↑                      ↓
  └──────────────────────┘
```

## Scripts

| Script | Purpose |
|--------|---------|
| `docguard-check-docs.sh` | Discover docs, return JSON inventory with metadata |
| `docguard-suggest-fix.sh` | Run guard, prioritize fixes as JSON |
| `docguard-init-doc.sh` | Initialize canonical doc with metadata header |

All scripts support `--json` mode for AI-parseable output.

## License

MIT © Ricardo Accioly
