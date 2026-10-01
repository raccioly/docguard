# Environment

<!-- docguard:quality negation-load off — an environment doc precisely describes the ABSENCE of requirements (no install step, no database, no credential for the CLI); the prohibitive phrasing is accurate and intentional, not sloppy writing -->

<!-- docguard:version 0.12.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-09-30 -->

> The DocGuard CLI needs no environment variables. Three optional ones exist: `DOCGUARD_API_KEY` for the HTTP MCP server, `DOCGUARD_SPECIFY_TIMEOUT_MS` for `docguard init`'s calls to the `specify` CLI, and `DOCGUARD_NO_UPDATE_HINT` to silence the version-age note. DocGuard has a single optional-load npm dependency (`@babel/parser`) and optionally uses the developer's own `python3`; everything else is Node.js built-ins.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Version** | `0.12.0` |

---

## Prerequisites

| Tool | Version | Installation |
|------|---------|-------------|
| Node.js | ≥18.0.0 | [nodejs.org](https://nodejs.org) |
| npm | ≥8 | Included with Node.js |
| Git | Any | [git-scm.com](https://git-scm.com) |
| Python 3 | **Optional** — ≥3.8, enables the AST-accurate Python scanning tier; the scanners use regex otherwise | [python.org](https://python.org) |
| Spec Kit (`specify`) | **Optional** — ≥ 0.11.2 for `docguard init` to initialize Spec Kit and register the DocGuard extension (`requires.speckit_version`; an older `specify` is neither initialized nor registered) | [github/spec-kit](https://github.com/github/spec-kit) |

## Environment Variables

> **None required.** Every CLI command (`guard`, `score`, `diff`, `trace`, …)
> reads project files directly — no `.env` file, no database connections, no
> credential of any kind. (Its one npm dependency, `@babel/parser`, needs no
> configuration.)

Three **optional** variables exist:

| Variable | When it applies | Purpose |
|----------|-----------------|---------|
| `DOCGUARD_API_KEY` | `docguard mcp --transport http`: optional on loopback; **required to bind a non-loopback host** | Shared secret for the HTTP MCP server. Equivalent to `--api-key <key>`, which takes precedence. When set, every request must carry `Authorization: Bearer <key>` or `X-API-Key: <key>`, else `401`. |
| `DOCGUARD_NO_UPDATE_HINT` | guard text output, the MCP server's instructions, `memory --pack` | `1` turns off the note that the installed release is more than 14 days old (spec 038). The note makes no network call; `CI` set to a non-empty value other than `false` or `0` also silences it in guard's text output. |
| `DOCGUARD_SPECIFY_TIMEOUT_MS` | `docguard init` with the `specify` CLI installed | Timeout in milliseconds for each `specify` call. Defaults: 15000 for `specify init --help`, 60000 for `specify init` and `specify extension add`. A missing, zero or non-numeric value uses the default. |

The server binds `127.0.0.1` by default and **refuses to start** on a
non-loopback host without a key, rather than exposing project read access to
the network. The stdio transport (`docguard mcp`, the default) never reads `DOCGUARD_API_KEY`.
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

# Regenerate llms.txt / llms-full.txt after editing a canonical or optional doc
# (tests/llms-bundle-drift.test.mjs fails and names this command)
npm run llms

# Measure this tree against the budgets in budgets.json (the CI `budget` job
# runs the same comparison against the base branch)
npm run budget
```

## CI/CD

```bash
# GitHub Actions — use the shipped template
cp templates/ci/github-actions.yml .github/workflows/docguard.yml

# GitLab CI — the shipped component (see CI-RECIPES.md, Recipe 1b)
cp templates/ci/gitlab-component.yml .gitlab-ci.yml

# Or run CI command directly
node cli/docguard.mjs ci --threshold 70 --format json
```

---

## Running inside an agent sandbox

DocGuard needs no network access and no credentials, so a sandbox such as ai-jail can run it
with the default read-write project mount. `docguard guard` runs fine under `--lockdown`, which
makes everything read-only. `fix --write`, `sync --write`, `init`, `review --accept` /
`--prune`, `specs --write` and `memory --pack` write into the project, so they need the normal
mount. Read and preview modes (`sync` and `generate --spec` without `--write`, `rules --for`)
write at most the plan cache and other local state in `.docguard/`, which is best-effort and
ignores itself.

What must be visible:

- **Git metadata.** Freshness, Diff-Suspicion, Reference-Existence and the Spec-Kit
  untouched-task check (SPK010) read history. In a linked worktree, `.git` is a file that
  points at a gitdir elsewhere, and sandboxes hide that gitdir by default (ai-jail needs
  `--worktree`). DocGuard detects the case. The affected checks report `missing-prerequisite`,
  or `partial` for Spec-Kit, naming git's own error and the remedy, and never report a clean
  "no matches". Path-scoped rules and the doc ownership map list files with `git ls-files`
  and fall back to a directory walk; path-scoped rules also ask `git check-ignore`, and a path
  git cannot classify is reported as unknown rather than as missing.
- **`python3` (optional).** It provides AST-accurate Python analysis. Without it, the regex
  tier runs, and each affected validator reports the degraded parser tier. A doc section that
  covers a Python symbol cannot be compared, so the doc-dependency check reports `partial`, and
  the generated module graph says the interpreter was unavailable instead of drawing Python
  edges it cannot see. `generate --plan` names the parser tier of its endpoints and entities,
  reports `low` confidence with a note, and marks those sections partial; `generate --spec`
  reports the tier and `low` confidence; SPR007 findings on routes and entities carry
  `parserTier: regex-fallback` and `low` confidence. The pattern tier still composes router
  prefixes and Django URL configurations the same way, so on standard layouts it reports the
  same facts.
- **The `specify` CLI (optional).** It is only needed for `docguard init` to set up Spec Kit.

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.12.0 | 2026-09-30 | DocGuard Team | `sync --write`, not a bare `sync`, writes into the project; read and preview modes write only the self-ignoring `.docguard/` (spec 042) |
| 0.11.0 | 2026-09-30 | DocGuard Team | `DOCGUARD_NO_UPDATE_HINT` and the `CI` rule for the version-age note (spec 038) |
| 0.10.0 | 2026-09-30 | DocGuard Team | Freshness review: `npm run budget`; the full list of commands that write; how path-scoped rules and ownership read git; what a missing `python3` makes partial (specs 030, 033, 034, 035) |
| 0.9.0 | 2026-09-29 | DocGuard Team | Freshness review: documented `DOCGUARD_SPECIFY_TIMEOUT_MS` and the optional Spec Kit prerequisite; the agent-sandbox section (spec 022) is recorded here |
| 0.8.0 | 2026-09-18 | DocGuard Team | Freshness review: verified the MCP key contract against `cli/commands/mcp.mjs`; added `npm run llms` and the shipped GitLab CI component, both of which were missing |
| 0.7.0 | 2026-09-17 | @raccioly | Documented `DOCGUARD_API_KEY` (HTTP MCP server); corrected the blanket "no API keys" claim that contradicted SECURITY.md |
| 0.6.0 | 2026-05-31 | DocGuard Team | v0.24.0: documented Python 3 as an optional prerequisite (enables the AST Python tier; regex fallback when absent); de-bristled the test-count example |
| 0.5.0 | 2026-03-13 | @raccioly | Added diagnose, CI template, development examples |
| 0.3.0 | 2026-03-12 | @raccioly | Proper CLI environment docs, no env vars |
| 0.1.0 | 2026-03-12 | DocGuard Generate | Auto-generated (corrected) |
