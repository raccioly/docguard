# spec-kit-docguard

> DocGuard extension for [Spec Kit](https://github.com/github/spec-kit) — Canonical-Driven Development enforcement.

[![npm](https://img.shields.io/npm/v/docguard-cli)](https://www.npmjs.com/package/docguard-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What It Does

Adds 6 DocGuard commands to Spec Kit:

| Command | Description |
|---------|-------------|
| `speckit.docguard.guard` | Validate project against canonical docs (130+ checks, 18 validators) |
| `speckit.docguard.diagnose` | Diagnose issues + generate AI-ready fix prompts |
| `speckit.docguard.score` | CDD maturity score (0-100) with multi-signal breakdown |
| `speckit.docguard.trace` | Requirements traceability matrix (ISO 29119) |
| `speckit.docguard.generate` | Reverse-engineer canonical docs from codebase |
| `speckit.docguard.init` | Initialize CDD with compliance profiles |

## Installation

### From Community Catalog

```bash
specify extension add docguard
```

### Dev / Local Install

```bash
specify extension add --dev /path/to/spec-kit-docguard
```

### Direct URL

```bash
specify extension add --from https://github.com/raccioly/docguard/archive/refs/tags/v0.9.0.zip
```

## Requirements

- Node.js ≥ 18
- npx (included with npm)

No other dependencies — DocGuard is zero-dependency.

## Features

### Quality Labels
`guard` shows `[HIGH]`, `[MEDIUM]`, `[LOW]` badges per validator, so you know exactly where to focus.

### Config-Aware
Respects `.docguard.json` — excluded docs are skipped entirely. Orphaned files get cleanup warnings.

### AI-Ready Prompts
`diagnose` generates copy-paste prompts for your AI agent. Add `--debate` for multi-perspective analysis (Advocate/Challenger/Synthesizer).

### Research-Backed
Features inspired by peer-reviewed research:
- **AITPG** (IEEE TSE 2026) — Multi-agent test plan generation
- **TRACE** (IEEE TMLCN 2026) — Calibrated quality evaluation

Credit: [Martin Manuel Lopez](https://github.com/martinmanuel9) (ORCID [0009-0002-7652-2385](https://orcid.org/0009-0002-7652-2385))

## Compliance Profiles

| Profile | Docs Required | Use Case |
|---------|--------------|----------|
| `starter` | ARCHITECTURE.md only | Side projects |
| `standard` | All 5 canonical docs | Team projects |
| `enterprise` | All docs + strict validators | Regulated/enterprise |

## Standalone Use

DocGuard also works independently without Spec Kit:

```bash
npm install -g docguard-cli
docguard guard
docguard score --signals
docguard trace
```

## Links

- **npm**: [docguard-cli](https://www.npmjs.com/package/docguard-cli)
- **GitHub**: [raccioly/docguard](https://github.com/raccioly/docguard)
- **Philosophy**: [PHILOSOPHY.md](https://github.com/raccioly/docguard/blob/main/PHILOSOPHY.md)

## License

MIT
