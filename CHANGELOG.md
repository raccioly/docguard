# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-03-13

### Added
- **Docs-Diff Validator** — New validator checks for entity/route/field drift between code and canonical docs. Integrated into `guard` and `diagnose` runs.
- **File Existence Checks** — `test-spec` validator now verifies that source files and test files referenced in the Source-to-Test Map actually exist on disk (catches stale references).
- **Dynamic Score Suggestions** — Score output now shows specific, AI-actionable suggestions per doc (e.g., "TEST-SPEC.md: missing section: ## Coverage Rules → Run `docguard fix --doc test-spec`") instead of generic advice.
- **Recommended Test Patterns** — TEST-SPEC.md template now includes guidance on config-awareness tests, regression guards, edge cases.
- **Mermaid Diagram** — ARCHITECTURE.md now includes a visual architecture diagram.

### Fixed
- **Scoring: Config-Awareness** — `calcEnvironmentScore` and `calcSecurityScore` now respect `needsEnvExample: false` — CLI projects no longer penalized for missing `.env.example`.
- **Scoring: node:test Recognition** — `calcTestingScore` now checks `.docguard.json` `testFramework` and `package.json` scripts for `node --test`, giving full marks for built-in test runners.
- **Scoring: Fake Bonus Removed** — Removed `docguard:version` metadata bonus from `calcDocQualityScore` — it was inflating scores by awarding points for a non-existent feature.
- **Circular Dependencies** — Extracted `c` (colors) and `PROFILES` into new `cli/shared.mjs`, breaking 14 circular import cycles between `docguard.mjs` and all command files.
- **CI Workflow** — Fixed failing CI by removing deleted `audit` command steps, adding `--force` to interactive `init`, and adding `diagnose` step.

### Changed
- **`audit` command** — Now an alias for `guard` (old `audit.mjs` deleted).
- **Architecture + Security validators** — Enabled by default in `.docguard.json`.
- **Guard checks** — Increased from 52 to 86 with all validators enabled.
- **Test suite** — 30 → 33 tests, including config-awareness and regression guards.

## [0.7.3] - 2026-03-13

### Added
- **Spec-Kit Extension** — DocGuard is now available as a GitHub Spec Kit community extension. 6 commands registered (`guard`, `diagnose`, `score`, `trace`, `generate`, `init`) with `after_tasks` hook for automatic validation. Located in `extensions/spec-kit-docguard/`.

## [0.7.2] - 2026-03-13

### Added
- **Config-aware traceability** — `guard`, `diagnose`, and `trace` now respect `.docguard.json` `requiredFiles.canonical`. Excluded docs are skipped entirely.
- **Orphan detection** — Warns when files exist in `docs-canonical/` but are excluded from config, with actionable cleanup instructions: "Delete them or add to .docguard.json".

### Fixed
- Trace no longer hardcodes all 6 docs — only evaluates what the user's config requires.

## [0.7.1] - 2026-03-13

### Added
- **Traceability Validator** — New `validateTraceability` runs automatically in `guard` and `diagnose`. Checks that each canonical doc (ARCHITECTURE, DATA-MODEL, TEST-SPEC, SECURITY, ENVIRONMENT) has matching source code artifacts. Reports PARTIAL/UNLINKED/MISSING coverage.
- **DocGuard in Generated Tech Stacks** — `docguard generate` now always includes DocGuard in the Documentation Tools table of generated ARCHITECTURE.md.

### Fixed
- **Guard warnings resolved** — TEST-SPEC.md `watch.mjs` partial coverage justified with ISO 29119 §7.2; DRIFT-LOG.md populated with template-string entries.
- **Test file regex** — `.test.mjs` and `.spec.mjs` files now match in traceability and trace commands.
- **51 guard checks** (was 46) — all passing on DocGuard itself.

## [0.7.0] - 2026-03-13

### Added
- **Quality Labels in Guard** — Each validator now displays `[HIGH]`, `[MEDIUM]`, or `[LOW]` quality labels for actionable triage. Inspired by CJE quality stratification (Lopez et al., TRACE, IEEE TMLCN 2026).
- **Standards Citations in Generated Docs** — All 6 generated canonical docs now include a standards reference footer citing the governing industry standard (arc42/C4, ISO 29119, OWASP ASVS, OpenAPI 3.1, 12-Factor App). Inspired by RAG-grounded standards alignment (Lopez et al., AITPG, IEEE TSE 2026).
- **`docguard trace` Command** — New requirements traceability matrix generator. Maps canonical docs ↔ source code ↔ tests with TRACED/PARTIAL/UNLINKED/MISSING coverage signals. Supports `--format json`.
- **`docguard score --signals` Flag** — Multi-signal quality breakdown showing per-signal contribution bars with quality labels. Inspired by CJE composite scoring.
- **`docguard diagnose --debate` Flag** — Multi-perspective AI prompts using three-agent Advocate/Challenger/Synthesizer pattern. Inspired by AITPG multi-agent role specialization and TRACE adversarial debate.
- **Agent-Aware Prompt Complexity** — `diagnose` auto-detects AI agent tier from AGENTS.md and adjusts prompt verbosity (concise for advanced models, step-by-step for smaller models). Inspired by CJE equalizer effect (Lopez et al., TRACE 2026).
- **Research & Academic Credits** — Added full IEEE-style citations for AITPG and TRACE papers, ORCID, and concept attribution table to CONTRIBUTING.md. Added research credits to README.md and academic foundations to PHILOSOPHY.md.

### Changed
- **15 commands total**: added `trace` (alias: `traceability`)
- **Version bump**: 0.6.0 → 0.7.0

## [0.6.0] - 2026-03-13

### Added
- **Doc Tool Detection** — `generate` now detects 8 existing doc tools (OpenAPI, TypeDoc, JSDoc, Storybook, Docusaurus, Mintlify, Redocly, Swagger). Built-in YAML parser for OpenAPI specs (zero deps). Leverages existing tools instead of replacing them.
- **Deep Route Scanning** — Parses actual route definitions from source code across 6 frameworks: Next.js (App Router + Pages Router), Express, Fastify, Hono, Django, FastAPI. OpenAPI-first: uses spec if available, falls back to code scanning.
- **Deep Schema Scanning** — Parses schema definitions from 4 ORMs: Prisma (fields, types, relations, enums), Drizzle, Zod, Mongoose. Generates mermaid ER diagrams automatically.
- **`API-REFERENCE.md` Generator** — New canonical doc generated from deep route scanning. Groups endpoints by resource, shows auth status, handler names, and per-endpoint parameter/response tables.
- **`docguard publish --platform mintlify`** — Scaffolds Mintlify v2 docs from canonical documentation. Generates `docs.json`, `introduction.mdx`, `quickstart.mdx`, and maps all canonical docs to `.mdx` pages with proper frontmatter.
- **AGENTS.md Standard Compliance** — Enhanced AGENTS.md template with Permissions & Guardrails section, Monorepo Support, Safety Rules, and `agents.md` standard tags.
- **Scanner Modules** — New `cli/scanners/` directory with `doc-tools.mjs`, `routes.mjs`, `schemas.mjs`.

### Changed
- **ARCHITECTURE.md** — Now arc42-aligned (all 12 sections: §1-§12) with C4 Model mermaid diagrams (Level 1 Context, Level 2 Container), Runtime View sequence diagrams, Deployment View, and Glossary.
- **DATA-MODEL.md** — Enhanced with field-level detail from ORM parsing (types, required, PK/UK, defaults), relationship tables, enum sections, and auto-generated mermaid ER diagrams.
- **Dynamic Version** — Banner and `--version` now read from `package.json` (no more stale hardcoded version strings).
- **Version bump**: 0.5.2 → 0.6.0
- **14 commands total**: added `publish` (alias: `pub`)

## [0.5.0] - 2026-03-13

### Added
- **`docguard diagnose`** — The AI orchestrator. Chains guard→fix in one command. Runs all validators, maps every failure to an AI-actionable fix prompt, and outputs a complete remediation plan. Three output modes: `text` (default), `json` (for automation), `prompt` (AI-ready). Alias: `dx`.
- **`guard --format json`** — Structured JSON output for CI/CD and AI agents. Includes profile, validator results, and timestamps.
- **Compliance Profiles** — Three presets (`starter`, `standard`, `enterprise`) that adjust required docs and validators. Set via `--profile` flag on init or `"profile"` in `.docguard.json`.
- **`score --tax`** — Documentation tax estimate: tracks doc count, code churn, and outputs estimated weekly maintenance time with LOW/MEDIUM/HIGH rating.
- **`init --profile starter`** — Minimal CDD setup (just ARCHITECTURE.md + CHANGELOG) for side projects.
- **GitHub Actions CI template** — Ships in `templates/ci/github-actions.yml`, ready-to-use workflow.
- **`watch --auto-fix`** — When guard finds issues, auto-outputs AI fix prompts.
- **Init auto-populate** — After creating skeletons, outputs `docguard diagnose` prompt instead of manual instructions.
- **Guard → Diagnose hint** — Guard output now prompts `Run docguard diagnose` when issues exist.

### Changed
- **Guard refactored**: `runGuardInternal()` extracted for reuse by diagnose, CI, and watch (no subprocess needed).
- **CI rewritten**: Uses `runGuardInternal` directly instead of spawning subprocess. Includes profile and validator data in JSON.
- **Watch rewritten**: Uses `runGuardInternal` (no process.exit killing the watcher). Proper debounced re-runs.
- **Version bump**: 0.4.0 → 0.5.0
- **13 commands total**: audit, init, guard, score, diagnose, diff, agents, generate, hooks, badge, ci, fix, watch
- **30 tests** across 17 suites (up from 24/14)

## [0.4.0] - 2026-03-12

### Added
- **`docguard badge`** — Generate shields.io CDD score badges for README (score, type, guarded-by)
- **`docguard ci`** — Single command for CI/CD pipelines (guard + score, JSON output, exit codes)
- `.npmignore` for clean npm publish
- `--threshold <n>` flag for minimum CI score enforcement
- `--fail-on-warning` flag for strict CI mode
- npm publish dry-run in CI workflow on tag push

### Changed
- Score command refactored with `runScoreInternal` for reuse by badge/ci
- CI workflow now runs actual test suite + dogfoods DocGuard on itself
- 10 total commands (audit, init, guard, score, diff, agents, generate, hooks, badge, ci)

## [0.3.0] - 2026-03-12

### Added
- **`docguard hooks`** — Install pre-commit (guard), pre-push (score enforcement), and commit-msg (conventional commits) git hooks
- **GitHub Action** (`action.yml`) — Reusable marketplace action with score thresholds, PR comments, and fail-on-warning support
- **Import analysis** in architecture validator — Builds full import graph, detects circular dependencies (DFS), auto-parses layer boundaries from ARCHITECTURE.md
- **Project type intelligence** — Auto-detect cli/library/webapp/api from package.json
- `.docguard.json` with `projectTypeConfig` (needsE2E, needsEnvVars, etc.)
- 15 real tests covering all commands (node:test)

### Changed
- Architecture validator now auto-detects layer violations from ARCHITECTURE.md (no config needed)
- Validators respect projectTypeConfig — no false positives for CLI tools

### Fixed
- Environment validator no longer warns about .env.example for CLI tools
- Test-spec validator no longer warns about E2E journeys for CLI tools

## [0.2.0] - 2026-03-12

### Added
- **`docguard score`** — Weighted CDD maturity score (0-100) with bar charts, grades A+ through F
- **`docguard diff`** — Compares canonical docs against actual code (routes, entities, env vars)
- **`docguard agents`** — Auto-generates agent-specific config files for Cursor, Copilot, Cline, Windsurf, Claude Code, Gemini
- **`docguard generate`** — Reverse-engineer canonical docs from existing codebase (15+ frameworks, 8+ databases, 6 ORMs)
- **Freshness validator** — Uses git commit history to detect stale documentation
- **Full document type registry** — All 16 CDD document types with required/optional flags and descriptions
- 8 new templates: KNOWN-GOTCHAS, TROUBLESHOOTING, RUNBOOKS, VENDOR-BUGS, CURRENT-STATE, ADR, DEPLOYMENT, ROADMAP

### Fixed
- Diff command false positives — entity extraction no longer picks up table headers

## [0.1.0] - 2026-03-12

### Added
- Initial release of DocGuard CLI
- `docguard audit` — Scan project, report documentation status
- `docguard init` — Initialize CDD docs from professional templates
- `docguard guard` — Validate project against canonical documentation
- 9 validators: structure, doc-sections, docs-sync, drift, changelog, test-spec, environment, security, architecture
- 8 core templates with docguard metadata headers
- Stack-specific configs: Next.js, Fastify, Python, generic
- Zero dependencies — pure Node.js
- GitHub CI workflow (Node 18/20/22 matrix)
- MIT license
