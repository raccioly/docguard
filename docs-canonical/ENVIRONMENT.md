# Environment

<!-- docguard:quality negation-load off — an environment doc precisely describes the ABSENCE of requirements (no env vars, no install step, no API keys, no database); the prohibitive phrasing is accurate and intentional, not sloppy writing -->

<!-- docguard:version 0.6.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-05-31 -->

> DocGuard needs no environment variables. It has a single optional-load npm dependency (`@babel/parser`) and optionally uses the developer's own `python3`; everything else is Node.js built-ins.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Version** | `0.6.0` |

---

## Prerequisites

| Tool | Version | Installation |
|------|---------|-------------|
| Node.js | ≥18.0.0 | [nodejs.org](https://nodejs.org) |
| npm | ≥8 | Included with Node.js |
| Git | Any | [git-scm.com](https://git-scm.com) |
| Python 3 | **Optional** — ≥3.8, enables the AST-accurate Python scanning tier; the scanners use regex otherwise | [python.org](https://python.org) |

## Environment Variables

> **None required.** DocGuard reads project files directly. No `.env` file,
> no API keys, no database connections. (Its one npm dependency, `@babel/parser`,
> needs no configuration.)

## Setup Steps

1. Clone the repository: `git clone https://github.com/raccioly/docguard.git`
2. No install needed — uses only Node.js built-in modules
3. Run directly: `node cli/docguard.mjs --help`
4. Or use via npx: `npx docguard --help`

## Development

```bash
# Run CLI locally
node cli/docguard.mjs audit

# Run the full test suite (node:test)
npm test

# Test a command on a target project
node cli/docguard.mjs diagnose --dir /path/to/project

# Quick health check
node cli/docguard.mjs guard --format json
```

## CI/CD

```bash
# GitHub Actions — use the shipped template
cp templates/ci/github-actions.yml .github/workflows/docguard.yml

# Or run CI command directly
node cli/docguard.mjs ci --threshold 70 --format json
```

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.6.0 | 2026-05-31 | DocGuard Team | v0.24.0: documented Python 3 as an optional prerequisite (enables the AST Python tier; regex fallback when absent); de-bristled the test-count example |
| 0.5.0 | 2026-03-13 | @raccioly | Added diagnose, CI template, development examples |
| 0.3.0 | 2026-03-12 | @raccioly | Proper CLI environment docs, no env vars |
| 0.1.0 | 2026-03-12 | DocGuard Generate | Auto-generated (corrected) |
