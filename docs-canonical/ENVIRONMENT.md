# Environment

<!-- docguard:version 0.5.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-03-13 -->

> DocGuard is a zero-dependency CLI tool. No environment variables needed.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Version** | `0.5.0` |

---

## Prerequisites

| Tool | Version | Installation |
|------|---------|-------------|
| Node.js | ≥18.0.0 | [nodejs.org](https://nodejs.org) |
| npm | ≥8 | Included with Node.js |
| Git | Any | [git-scm.com](https://git-scm.com) |

## Environment Variables

> **None required.** DocGuard is a zero-dependency CLI tool that reads project
> files directly. No `.env` file, no API keys, no database connections.

## Setup Steps

1. Clone the repository: `git clone https://github.com/raccioly/docguard.git`
2. No install needed — uses only Node.js built-in modules
3. Run directly: `node cli/docguard.mjs --help`
4. Or use via npx: `npx docguard --help`

## Development

```bash
# Run CLI locally
node cli/docguard.mjs audit

# Run tests (30 tests, 17 suites)
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
| 0.5.0 | 2026-03-13 | @raccioly | Added diagnose, CI template, development examples |
| 0.3.0 | 2026-03-12 | @raccioly | Proper CLI environment docs, no env vars |
| 0.1.0 | 2026-03-12 | DocGuard Generate | Auto-generated (corrected) |
