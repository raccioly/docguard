# DocGuard — CDD Enforcement Extension for Spec Kit

Enterprise-grade Canonical-Driven Development (CDD) enforcement for [Spec Kit](https://github.com/github/spec-kit). Validates, scores, and fixes project documentation with 19 automated validators, AI-driven research workflows, and spec-kit integration hooks.

## Features

- **20 Validators** — Structure, Security, Doc Quality, Test-Spec, Drift-Comments, API-Surface, Freshness, and 13 more
- **4 AI Skills** — Enterprise-grade AI behavior protocols (not just step-lists)
- **3 Bash Scripts** — JSON-output orchestration for AI consumption
- **Workflow Chaining** — YAML handoffs enable guard → fix → review → score flows
- **Spec Kit Hooks** — Quality gate integrations at implement, tasks, and review phases
- **Zero Dependencies** — Pure Node.js built-ins only

## Installation

```bash
npm install -g docguard-cli
```

Or use via npx:
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
| `speckit.docguard.guard` | `docguard.guard` | Run 19-validator quality gate with severity triage |
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
