# SpecGuard Roadmap

<!-- specguard:version 0.1.0 -->
<!-- specguard:status living -->
<!-- specguard:last-reviewed 2026-03-12 -->
<!-- specguard:owner @raccioly -->

> The planned evolution of SpecGuard and Canonical-Driven Development (CDD).

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Version** | `0.1.0` |
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
| 2 | Polish & Adoption | 🔄 In Progress | Q2 2026 |
| 3 | AI Generate Mode | ⏳ Planned | Q2-Q3 2026 |
| 4 | Integrations | 💭 Future | Q3 2026 |
| 5 | Dashboard (SaaS) | 💭 Future | Q4 2026 |

---

## Phase 0: Research & Standard ✅

Defined the CDD methodology and created the SpecGuard specification.

- [x] Landscape analysis (Spec Kit, AGENTS.md, Kiro, Cursor)
- [x] CDD philosophy and three pillars
- [x] Full standard specification (STANDARD.md)
- [x] Agent compatibility research (10+ AI coding agents)
- [x] Competitive comparisons with honest limitations

## Phase 1: Core CLI ✅

Built the zero-dependency CLI tool with 8 validators and 15 templates.

- [x] `specguard audit` — scan project, report documentation status
- [x] `specguard init` — create CDD docs from professional templates
- [x] `specguard guard` — validate project against canonical docs
- [x] 8 validators: structure, docs-sync, drift, changelog, test-spec, environment, security, architecture
- [x] 15 templates with versioning headers, badges, and revision history
- [x] Stack-specific configs (Next.js, Fastify, Python, generic)
- [x] GitHub CI workflow (Node 18/20/22)
- [x] MIT license, CONTRIBUTING.md, issue templates

## Phase 2: Polish & Adoption 🔄

Improve the CLI experience and drive initial adoption.

- [ ] `specguard score` — CDD maturity score (0-100) with category breakdown
- [ ] `specguard diff` — show canonical vs implementation differences
- [ ] `specguard agents` — auto-generate agent-specific files from AGENTS.md
- [ ] `--format json` output for CI integration
- [ ] `--fix` flag for auto-creating missing files
- [ ] Better error messages with suggested fixes
- [ ] npm publish (`npx specguard` works globally)
- [ ] Publish to npm registry

## Phase 3: AI Generate Mode ⏳

The killer feature — reverse-engineer documentation from existing codebases.

- [ ] `specguard generate` command
- [ ] Framework auto-detection (Next.js, Fastify, Django, etc.)
- [ ] Route scanning → API-REFERENCE.md generation
- [ ] Schema scanning → DATA-MODEL.md generation
- [ ] Test file analysis → TEST-SPEC.md population
- [ ] Import analysis → ARCHITECTURE.md layer boundaries

## Phase 4: Integrations 💭

Deep integration with development tools and platforms.

- [ ] GitHub Action (reusable marketplace action)
- [ ] PR comments with CDD score changes
- [ ] Pre-commit hook generator
- [ ] VS Code extension (inline CDD warnings)
- [ ] Badge service (dynamic CDD score badge for README)

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
- **Testing** — Run SpecGuard against your projects and report issues
- **Documentation** — Improve the standard and guides
