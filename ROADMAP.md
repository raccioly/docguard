# DocGuard Roadmap

<!-- docguard:version 0.4.0 -->
<!-- docguard:status living -->
<!-- docguard:last-reviewed 2026-03-14 -->
<!-- docguard:owner @raccioly -->

> The planned evolution of DocGuard and Canonical-Driven Development (CDD).

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Version** | `0.4.0` |
| **Last Updated** | 2026-03-12 |
| **Owner** | [@raccioly](https://github.com/raccioly) |

---

## Vision

Make **Canonical-Driven Development** the industry standard for AI-age software projects — where documentation drives development and machines enforce compliance.

---

## Current Phase

| Phase | Name | Status | Timeline |
|:-----:|------|:------:|----------|
| 0 | Research & Standard | ✅ Complete | Mar 2026 |
| 1 | Core CLI | ✅ Complete | Mar 2026 |
| 2 | Polish & Adoption | ✅ Complete | Mar 2026 |
| 3 | AI Generate Mode | ✅ Complete | Mar 2026 |
| 4 | Integrations | ✅ Complete | Mar 2026 |
| 5 | Dashboard (SaaS) | 💭 Future | Q4 2026 |

---

## Phase 0: Research & Standard ✅

Defined the CDD methodology and created the DocGuard specification.

- [x] Landscape analysis (Spec Kit, AGENTS.md, Kiro, Cursor)
- [x] CDD philosophy and three pillars
- [x] Full standard specification (STANDARD.md)
- [x] Agent compatibility research (10+ AI coding agents)
- [x] Competitive comparisons with honest limitations

## Phase 1: Core CLI ✅

Built the zero-dependency CLI tool with 9 validators and 8 core templates.

- [x] `docguard audit` — scan project, report documentation status
- [x] `docguard init` — create CDD docs from professional templates
- [x] `docguard guard` — validate project against canonical docs
- [x] 9 validators: structure, doc-sections, docs-sync, drift, changelog, test-spec, environment, security, architecture
- [x] 8 core templates with versioning headers, badges, and revision history
- [x] Stack-specific configs (Next.js, Fastify, Python, generic)
- [x] GitHub CI workflow (Node 18/20/22)
- [x] MIT license, CONTRIBUTING.md, issue templates

## Phase 2: Polish & Adoption ✅

Expanded the CLI with scoring, diffing, and agent integration.

- [x] `docguard score` — CDD maturity score (0-100) with weighted categories and bar charts
- [x] `docguard diff` — canonical docs ↔ implementation comparison
- [x] `docguard agents` — auto-generate configs for 6 AI agents (Cursor, Copilot, Cline, Windsurf, Claude, Gemini)
- [x] `--format json` output for CI integration
- [x] `--fix` flag for auto-creating missing files
- [x] `--force` flag for overwriting existing files
- [x] `--agent <name>` flag for targeting specific agents
- [x] 8 additional templates: KNOWN-GOTCHAS, TROUBLESHOOTING, RUNBOOKS, VENDOR-BUGS, CURRENT-STATE, ADR, DEPLOYMENT, ROADMAP
- [ ] npm publish (`npx docguard` works globally)

## Phase 3: AI Generate Mode ✅

The killer feature — reverse-engineer documentation from existing codebases.

- [x] `docguard generate` command
- [x] Framework auto-detection (15+ frameworks: Next.js, React, Vue, Angular, Fastify, Express, Django, etc.)
- [x] Database detection (8+: PostgreSQL, MySQL, MongoDB, DynamoDB, SQLite, etc.)
- [x] ORM detection (Drizzle, Prisma, TypeORM, Sequelize, Knex)
- [x] Route scanning → ARCHITECTURE.md route listing
- [x] Schema/model scanning → DATA-MODEL.md entity extraction
- [x] Test file analysis → TEST-SPEC.md service-to-test mapping
- [x] Env var scanning → ENVIRONMENT.md with categorized variables
- [x] Auth detection → SECURITY.md pre-fill
- [x] Hosting detection (Amplify, Vercel, Docker, Fly.io, Railway, Render)
- [x] Import analysis → Circular dependency detection + layer boundary validation from ARCHITECTURE.md

## Phase 4: Integrations ✅

Deep integration with development tools and platforms.

- [x] GitHub Action (reusable action.yml with PR score comments, thresholds)
- [x] Pre-commit hook generator (guard validation)
- [x] Pre-push hook generator (minimum score enforcement)
- [x] Commit-msg hook (conventional commits validation)
- [x] Badge service (shields.io CDD score, type, guarded-by badges)
- [x] CI command (guard + score pipeline, JSON output, thresholds)
- [x] npm publish preparation (.npmignore, prepublishOnly, CI dry-run)
- [x] VS Code extension (status bar score, inline diagnostics, 6 commands)

## Phase 5: Dashboard 💭

Web-based CDD governance for teams and organizations.

- [ ] Web dashboard showing CDD scores across repos
- [ ] Historical trend graphs
- [ ] Team leaderboards
- [ ] Drift alerts (Slack/email)
- [ ] Compliance reports (PDF export)

---

## Contributing

We welcome contributions at any phase! See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

Priority areas for contributions:
- **Templates** — Add stack-specific templates (Django, Spring Boot, Go)
- **Validators** — Write new validation rules
- **Testing** — Run DocGuard against your projects and report issues
- **Documentation** — Improve the standard and guides
