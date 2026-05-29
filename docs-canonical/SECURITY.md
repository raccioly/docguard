# Security

<!-- docguard:quality negation-load off — security doc: prohibitive phrasing ("never a shell string", "can't inject", "no dependencies") is precise and intentional, not sloppy writing -->

<!-- docguard:version 0.5.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-05-29 -->

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Version** | `0.4.0` |

---

## Overview

DocGuard is a **local CLI tool** that runs entirely on the user's machine. It reads project files from the filesystem and produces terminal output. It operates **fully offline**, requires **zero authentication**, and is **credential-free**.

## Authentication

| Method | Provider | Scope |
|--------|---------|-------|
| **None required** | N/A | DocGuard is a local-only CLI tool. Runs without auth. |

DocGuard operates purely on the local filesystem. All processing stays on-machine — fully isolated from servers, APIs, and cloud services.

## Authorization

| Role | Permissions | Notes |
|------|-----------|-------|
| **User** (local machine) | Full access — read/write project files | DocGuard runs with the permissions of the user invoking it |
| **CI Pipeline** | Read-only (guard, score, ci commands) | CI typically only runs validation, not init/generate |
| **AI Agent** | Depends on AI agent permissions | AI agents run DocGuard via terminal — they inherit the user's or CI's permissions |

DocGuard uses a simple permission model: it inherits filesystem permissions from the calling process.

## Secrets Management

| Secret | Storage | Used By | Notes |
|--------|---------|---------|-------|
| **None** | N/A | N/A | DocGuard requires no API keys, tokens, or credentials |

### DocGuard Security Posture

- Treats `.env` files as **project artifacts only** (checks their existence for your project, never reads values)
- Operates **100% offline** — zero HTTP requests to any API
- Writes **only within the project directory** — all output stays local
- Runs with **standard user permissions** — elevated access is unnecessary

## Security Boundaries

| Boundary | Trusted | Untrusted |
|----------|---------|-----------|
| **File reads** | Project files within `projectDir` | DocGuard only reads files within the project directory and its own templates |
| **File writes** | `docguard init`, `docguard generate`, `docguard hooks` | Only writes to `docs-canonical/`, root docs, `.docguard.json`, `.git/hooks/` |
| **Child processes** | `git log`/`git diff` (freshness), `specify init` (Spec Kit scaffolding), `specguard` (VS Code extension) | All spawned via `execFileSync` with an argv array — never a shell string. The binary is `argv[0]` (a literal filename) and each arg a literal token, so workspace paths and config values can't inject commands |
| **User input** | CLI arguments parsed by the entry point | Agent/path inputs that reach a subprocess are allowlist-validated (`/^[a-zA-Z0-9_-]{1,32}$/`) before use |

## Command Safety Levels

| Command | Reads Files | Writes Files | Runs Git | Risk |
|---------|------------|-------------|----------|------|
| `audit` | ✅ | ❌ | ❌ | None |
| `guard` | ✅ | ❌ | ✅ (read-only) | None |
| `score` | ✅ | ❌ | ❌ | None |
| `diff` | ✅ | ❌ | ✅ (read-only) | None |
| `fix` | ✅ | ❌ | ❌ | None |
| `ci` | ✅ | ❌ | ✅ (read-only) | None |
| `badge` | ✅ | ❌ | ❌ | None |
| `init` | ✅ | ✅ Creates docs | ❌ | Low — creates new files only, never overwrites |
| `generate` | ✅ | ✅ Creates docs | ❌ | Low — creates new files only, never overwrites |
| `hooks` | ✅ | ✅ Writes `.git/hooks/` | ❌ | Low — writes executable git hooks |

## Supply Chain

| Category | Status |
|----------|--------|
| **npm dependencies** | **Zero** — DocGuard has no `node_modules` |
| **Runtime dependencies** | Node.js ≥ 18, `git` (optional, for freshness checks) |
| **Transitive dependencies** | None |
| **Known vulnerabilities** | None — no dependency tree to audit |

The zero-dependency architecture is a deliberate security decision: zero supply chain = zero supply chain attack surface.

## .gitignore Audit

DocGuard's own `.gitignore` excludes:

| Pattern | Purpose |
|---------|---------|
| `node_modules/` | npm packages (dev dependencies only — test runner) |
| `.env` | Environment files (not used, but excluded as best practice) |

## Security Rules Checklist

- [x] Code is credential-free
- [x] `.env` files are excluded from version control
- [x] All secrets are environment-variable-based
- [x] CLI operates 100% offline
- [x] Subprocesses use `execFileSync` (argv arrays, no shell); injection-prone inputs are allowlist-validated (closed #190 in CLI init, #205/#207 in the VS Code extension)
- [x] File writes are opt-in only (init, generate, hooks commands)
- [x] Git commands are read-only (`git log`, `git diff`)
- [x] Zero npm dependencies eliminates supply chain risk

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.4.0 | 2026-03-13 | DocGuard Team | Complete rewrite — documented zero-auth model, command safety levels, supply chain posture |
| 0.1.0 | 2026-03-13 | DocGuard Generate | Auto-generated skeleton |
