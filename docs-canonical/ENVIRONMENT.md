# Environment

<!-- docguard:quality negation-load off — an environment doc precisely describes the ABSENCE of requirements (no install step, no database, no credential for the CLI); the prohibitive phrasing is accurate and intentional, not sloppy writing -->

<!-- docguard:version 0.7.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-09-17 -->

> The DocGuard CLI needs no environment variables. One optional variable, `DOCGUARD_API_KEY`, applies only to the HTTP MCP server. DocGuard has a single optional-load npm dependency (`@babel/parser`) and optionally uses the developer's own `python3`; everything else is Node.js built-ins.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Version** | `0.7.0` |

---

## Prerequisites

| Tool | Version | Installation |
|------|---------|-------------|
| Node.js | ≥18.0.0 | [nodejs.org](https://nodejs.org) |
| npm | ≥8 | Included with Node.js |
| Git | Any | [git-scm.com](https://git-scm.com) |
| Python 3 | **Optional** — ≥3.8, enables the AST-accurate Python scanning tier; the scanners use regex otherwise | [python.org](https://python.org) |

## Environment Variables

> **None required.** Every CLI command (`guard`, `score`, `diff`, `trace`, …)
> reads project files directly — no `.env` file, no database connections, no
> credential of any kind. (Its one npm dependency, `@babel/parser`, needs no
> configuration.)

One **optional** variable applies to the HTTP MCP server only
(`docguard mcp --transport http`):

| Variable | When it applies | Purpose |
|----------|-----------------|---------|
| `DOCGUARD_API_KEY` | Optional on loopback; **required to bind a non-loopback host** | Shared secret for the HTTP MCP server. Equivalent to `--api-key <key>`, which takes precedence. When set, every request must carry `Authorization: Bearer <key>` or `X-API-Key: <key>`, else `401`. |

The server binds `127.0.0.1` by default and **refuses to start** on a
non-loopback host without a key, rather than exposing project read access to
the network. The stdio transport (`docguard mcp`, the default) never reads it.
See [SECURITY.md](SECURITY.md) for the full posture.

## Setup Steps

1. Clone the repository: `git clone https://github.com/raccioly/docguard.git`
2. Run `npm ci` to install the locked Babel parser dependency for the full JS/TS extraction tier
3. Run directly: `node cli/docguard.mjs --help`
4. Or use via npx: `npx docguard-cli --help`

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
| 0.7.0 | 2026-09-17 | @raccioly | Documented `DOCGUARD_API_KEY` (HTTP MCP server); corrected the blanket "no API keys" claim that contradicted SECURITY.md |
| 0.6.0 | 2026-05-31 | DocGuard Team | v0.24.0: documented Python 3 as an optional prerequisite (enables the AST Python tier; regex fallback when absent); de-bristled the test-count example |
| 0.5.0 | 2026-03-13 | @raccioly | Added diagnose, CI template, development examples |
| 0.3.0 | 2026-03-12 | @raccioly | Proper CLI environment docs, no env vars |
| 0.1.0 | 2026-03-12 | DocGuard Generate | Auto-generated (corrected) |
