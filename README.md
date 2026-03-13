# SpecGuard

> **The enforcement tool for Canonical-Driven Development (CDD).**  
> Document first. Any agent understands. Machine-enforceable.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-brightgreen)](package.json)

---

## What is CDD?

**Canonical-Driven Development** is a methodology where canonical documentation drives every phase of a project — from initial design through ongoing maintenance. Unlike traditional development where docs are written after code (and quickly rot), CDD treats documentation as the authoritative source that code must conform to.

| Traditional | CDD |
|-------------|-----|
| Code first, docs maybe | Docs first, code conforms |
| Docs rot silently | Drift is tracked explicitly |
| Docs are optional | Docs are required and validated |
| One agent, one context | Any agent, shared context |

**SpecGuard** is the CLI tool that enforces CDD — auditing, generating, and guarding your project documentation.

📖 **[Read the full philosophy](PHILOSOPHY.md)** | 📋 **[Read the standard](STANDARD.md)** | ⚖️ **[See comparisons](COMPARISONS.md)**

---

## Quick Start

```bash
# Audit your project (what docs exist/missing?)
npx specguard audit

# Initialize CDD docs from templates
npx specguard init

# Validate project alignment (use in CI/pre-commit)
npx specguard guard
```

No installation needed. Zero dependencies. Works with Node.js 18+.

---

## What Does It Do?

### 🔍 Audit Mode
Scan your project and see what CDD documentation exists or is missing:

```
$ npx specguard audit

📋 SpecGuard Audit — my-project

  Canonical Documentation:
    ✅ docs-canonical/ARCHITECTURE.md
    ✅ docs-canonical/DATA-MODEL.md
    ❌ docs-canonical/SECURITY.md
    ❌ docs-canonical/TEST-SPEC.md
    ❌ docs-canonical/ENVIRONMENT.md

  Agent Instructions:
    ✅ AGENTS.md

  Change Tracking:
    ✅ CHANGELOG.md
    ❌ DRIFT-LOG.md

  Score: 4/8 required files (50%)
```

### 🏗️ Init Mode
Create all CDD documentation from professional templates:

```
$ npx specguard init

  ✅ Created: docs-canonical/ARCHITECTURE.md
  ✅ Created: docs-canonical/DATA-MODEL.md
  ✅ Created: docs-canonical/SECURITY.md
  ✅ Created: docs-canonical/TEST-SPEC.md
  ✅ Created: docs-canonical/ENVIRONMENT.md
  ✅ Created: AGENTS.md
  ✅ Created: CHANGELOG.md
  ✅ Created: DRIFT-LOG.md
  ✅ Created: .specguard.json
```

### 🛡️ Guard Mode
Validate your project against its canonical docs (perfect for CI/CD):

```
$ npx specguard guard

🛡️  SpecGuard Guard — my-project

  ✅ Structure      8/8 checks passed
  ✅ Doc Sections   10/10 checks passed
  ✅ Docs-Sync      14/14 checks passed
  ✅ Drift          1/1 checks passed
  ✅ Changelog      2/2 checks passed
  ⚠️  Test-Spec     6/8 checks passed
  ✅ Environment    4/4 checks passed

  ⚠️  WARN — 45/47 passed, 2 warning(s)
```

---

## 8 Validators

| # | Validator | What It Checks | Default |
|---|-----------|---------------|---------|
| 1 | **Structure** | Required CDD files exist | ✅ On |
| 2 | **Doc Sections** | Canonical docs have required sections | ✅ On |
| 3 | **Docs-Sync** | Routes/services referenced in docs | ✅ On |
| 4 | **Drift** | `// DRIFT:` comments logged in DRIFT-LOG.md | ✅ On |
| 5 | **Changelog** | CHANGELOG.md has [Unreleased] section | ✅ On |
| 6 | **Test-Spec** | Tests exist per TEST-SPEC.md rules | ✅ On |
| 7 | **Environment** | Env vars documented, .env.example exists | ✅ On |
| 8 | **Security** | No hardcoded secrets in source code | ❌ Off |
| 9 | **Architecture** | Imports follow layer boundaries | ❌ Off |

---

## CDD File Structure

```
your-project/
├── docs-canonical/              # Design intent (the "blueprint")
│   ├── ARCHITECTURE.md          # System design, components, boundaries
│   ├── DATA-MODEL.md            # Database schemas, entity relationships
│   ├── SECURITY.md              # Auth, permissions, secrets
│   ├── TEST-SPEC.md             # Required tests, coverage rules
│   └── ENVIRONMENT.md           # Environment variables, setup
│
├── AGENTS.md                    # AI agent behavior rules
├── CHANGELOG.md                 # Change tracking
├── DRIFT-LOG.md                 # Documented deviations
└── .specguard.json              # SpecGuard configuration
```

---

## Configuration

Create `.specguard.json` in your project root:

```json
{
  "projectName": "my-project",
  "version": "0.1",
  "validators": {
    "structure": true,
    "docsSync": true,
    "drift": true,
    "changelog": true,
    "architecture": false,
    "testSpec": true,
    "security": false,
    "environment": true
  }
}
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: SpecGuard
on: [pull_request]
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx specguard guard
```

### Pre-commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/sh
npx specguard guard
```

---

## Agent Compatibility

SpecGuard works with **every major AI coding agent**:

| Agent | Compatibility |
|-------|:---:|
| Google Antigravity | ✅ |
| Claude Code | ✅ |
| GitHub Copilot | ✅ |
| Cursor | ✅ |
| Windsurf | ✅ |
| Cline | ✅ |
| Gemini CLI | ✅ |
| Kiro (AWS) | ✅ |

All canonical docs are **plain markdown** — any agent can read them. No vendor lock-in.

---

## How CDD Relates to Other Methodologies

| Methodology | Relationship |
|-------------|-------------|
| **SDD** (Spec-Driven Dev) | CDD Phase 1-2. Use Spec Kit for generation, SpecGuard for governance. |
| **TDD** (Test-Driven Dev) | TEST-SPEC.md defines policy; TDD implements the tests. |
| **AGENTS.md** | One of CDD's 8 required files — fully compatible. |

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[MIT](LICENSE) — Free to use, modify, and distribute.

---

**Made with ❤️ by [Ricardo Accioly](https://github.com/raccioly)**
