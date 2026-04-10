# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **VSCode Extension Performance** — Replaced blocking synchronous I/O operations (`fs.existsSync`, `fs.readFileSync`) with asynchronous equivalents (`vscode.workspace.fs.stat`, `vscode.workspace.fs.readFile`) in the UI thread. Use `Promise.all` to evaluate diagnostic checks concurrently, eliminating main thread blocking.


## [0.9.11] - 2026-03-18

### Added
- **`globMatch()` in `shared-ignore.mjs`** — Purpose-built positive file matching with hardcoded `node_modules` exclusion at any depth. Distinct from `buildIgnoreFilter()` (which is for ignore/skip filtering).
- **6 new tests** — `globMatch` node_modules rejection (2), valid path matching (1), multi-pattern (1), CI detection (1), function load (1). Total tests: 46.

### Fixed
- **Docs-Diff no longer scans `node_modules` for test files** — `getTestFilesFromPatterns()` now uses `globMatch()` instead of repurposing `buildIgnoreFilter()`. The `**` glob no longer matches through `node_modules/` directories.
- **CI detection supports enterprise systems** — `calcTestingScore()` now recognizes `buildspec.yml`, `amplify.yml`, `Jenkinsfile`, `.circleci/config.yml`, `.gitlab-ci.yml`, `.travis.yml`, and `turbo.json` with a `"test"` task.
- **Multi-pattern test resolution works correctly** — `testPatterns` array resolves files from all patterns with proper deduplication via Set.

## [0.9.10] - 2026-03-18

### Added — Unified Ignore System & Scorer Alignment
- **`cli/shared-ignore.mjs`** — New shared ignore utility with `buildIgnoreFilter()` and `shouldIgnore()`. All validators now share consistent glob matching for `config.ignore`, `securityIgnore`, and `todoIgnore`.
- **`testPatterns` config** — New array field in `.docguard.json` for multiple test location patterns. Backward-compatible: `testPattern` (string) auto-normalizes to `testPatterns` (array).
- **7 new tests** — Shared ignore utility (4 unit tests), securityIgnore integration (1), placeholder exclusions (1), testPatterns config (1). Total tests: 40.

### Fixed
- **`securityIgnore` globs now functional** — Security validator reads and applies `securityIgnore` patterns from `.docguard.json`. Previously, all ignore config was silently discarded. (Bug #1)
- **`todoIgnore` globs now functional** — TODO-tracking validator reads and applies `todoIgnore` patterns. (Bug #2)
- **Docs-Diff no longer scans `node_modules`** — Test file discovery uses `testPatterns` config and shared ignore filter instead of unchecked recursive walk. (Bug #3)
- **Testing score reflects co-located tests** — `calcTestingScore()` now detects `__tests__/` under `backend/`, `server/`, `packages/` in addition to `src/`. Also checks `testPatterns` config. (Bug #4 & #5)
- **Security score aligns with guard** — `calcSecurityScore()` now runs `validateSecurity()` inline and deducts points for findings. 100% security score is no longer possible when guard reports secret detections. (Bug #6)
- **Placeholder/example values not flagged** — Security scanner skips AWS example keys (`AKIAIOSFODNN7EXAMPLE`), HTML `placeholder=` attributes, OpenAPI `example:` blocks, and `password123` test fixtures. (Bug #7)
- **ROADMAP.md matching improved** — TODO-tracking now matches full text + file location context instead of a 30-char substring. (Bug #8)
- **Architecture respects `ignore` array** — Architecture validator filters files through `config.ignore` before building import graph. (Bug #9)

### Changed
- **Constitution v1.0.0 → v1.1.0** — Principle IV updated: validators MAY import shared utility modules for infrastructure (file walking, ignore filtering). Commands MAY compose validator results.
- **Security scoring weights** — Redistributed from 30/20/20/15/15 to 25/15/15/10/10/25 (25 pts now from actual secret scanning).
- **Testing suggestion** — Context-aware: suggests `testPatterns` config instead of "Add tests/ directory" when co-located tests exist.
- **`findColocatedTests()`** — Source roots expanded: `backend/`, `server/` added alongside `src/`, `app/`, `lib/`, `packages/`, `modules/`.

## [0.9.9] - 2026-03-17

### Added — Extension-First Architecture & Spec-Kit Integration Gate

#### Spec-Kit Integration Gate
- **`ensureSpecKit()`** — Runs on every command. Auto-initializes spec-kit when `specify` CLI is available. Shows a prominent yellow-box reminder every time when spec-kit is not installed (persistent, no dismiss).
- **`detectAIAgent(projectDir)`** — Maps 12 filesystem signals to spec-kit `--ai` flag values: `.cursor/` → `cursor-agent`, `.claude/` or `CLAUDE.md` → `claude`, `.gemini/` → `gemini`, `.agents/` → `agy` (Antigravity), `.github/copilot-instructions.md` → `copilot`, `.windsurf/` → `windsurf`, `.codex/` → `codex`, `.roo/` → `roo`, `.amp/` → `amp`, `.kiro/` → `kiro-cli`, `.tabnine/` → `tabnine`. Falls back to `--ai generic` when no agent detected.
- **Strong init push** — `docguard init` now shows a prominent red-bordered box when spec-kit is missing, listing exactly what users miss: 9 AI skills, constitution, SDD workflow, agent detection. Provides both `uv` and `pip` install commands.
- **Guard footer reminder** — `docguard guard` shows a 1-line spec-kit install nudge after results when not initialized.
- **Skill auto-update** — `ensureSkills()` now compares installed SKILL.md `docguard:version` against package version. Automatically overwrites stale skills on DocGuard update.

#### LLM-First Output
- **`detectAgentMode(projectDir)`** — Returns `'llm'` or `'cli'` based on filesystem signals and `.specify/init-options.json`. All adaptive commands check this.
- **`diagnose.mjs`** — All `FIX_INSTRUCTIONS` now include `llmCommand` fields (e.g., `/docguard.fix --doc architecture`). Issue collection propagates `llmCommand` to output. Remediation plan, verification checklist, and debate prompts all adapt to agent mode.
- **`guard.mjs`** — "Next step" hint now shows `/docguard.diagnose` in LLM mode.
- **`init.mjs`** — Next steps show skill commands (`/docguard.guard`, `/docguard.fix`) in LLM mode, CLI commands (`docguard diagnose`) in CLI mode.
- **`setup.mjs`** — Next steps adapt to agent mode.

#### Spec-Kit Skill Chaining
- **`docguard-guard` SKILL.md** — Now chains to `/speckit.specify`, `/speckit.plan`, `/speckit.clarify`, and checks `constitution.md`.
- **`docguard-review` SKILL.md** — Offers spec-kit skills for specification-level issues.
- **`extension.yml`** — Declares `framework: spec-kit` and `specify` as optional tool.

### Fixed
- **`npx docguard guard`** → `npx docguard-cli guard` — The npm package name is `docguard-cli`, not `docguard`. Fixed in `hooks.mjs`, `setup.mjs`, `fix.mjs`, `docguard.mjs` (pre-existing bug).
- **Hardcoded `--ai agy`** → Dynamic `detectAIAgent()` — `init.mjs` and `setup.mjs` no longer hardcode Antigravity as the agent.
- **`llmCommand` never propagated** — `collectIssues()` in `diagnose.mjs` was not copying `llmCommand` from `FIX_INSTRUCTIONS` to issue objects, so LLM-first fix hints silently fell back to CLI commands.
- **Debate prompt not LLM-aware** — `outputDebatePrompt()` now receives `agentMode` and adapts verification commands.
- **Basic-tier checklist hardcoded** — Verification checklist for basic-tier agents now adapts to LLM/CLI mode.
- **Stale "Zero dependencies" doc comments** — Updated 6 files to "Zero NPM runtime dependencies" matching the constitution.
- **Platform-aware `--script`** — `specify init` now uses `--script ps` on Windows, `--script sh` on Unix.

### Changed
- **Constitution** — Principle II amended from "Zero Dependencies" to "Zero NPM Runtime Dependencies" (spec-kit is a framework convention, not a code dependency).
- **SKILL.md metadata** — All 4 skills updated from `0.9.5`/`0.9.8` to `0.9.9`. Added `docguard:version` comment for auto-update mechanism.
- **`ensure-skills.mjs`** — Full rewrite: 6 exports (`ensureSkills`, `ensureSpecKit`, `detectAgentMode`, `detectAIAgent`, `getDetectedAgent`, `isSpecKitAvailable`, `isSpecKitInitialized`).
- **22 files changed**, +567/−203 lines.

## [0.9.6] - 2026-03-14

### Added — Enterprise AI Skills Architecture

#### AI Skills (Spec Kit Extension)
- **4 enterprise-grade SKILL.md files** modeled after spec-kit's AI behavior protocol pattern:
  - `docguard-guard` (155 lines) — 6-step execution with severity triage matrix, structured reporting
  - `docguard-fix` (195 lines) — 7-step research workflow with per-document codebase research, 3-iteration validation loops
  - `docguard-review` (170 lines) — Read-only semantic cross-document analysis with 6 analysis passes
  - `docguard-score` (165 lines) — CDD maturity assessment with ROI-based improvement roadmap
- Skills differ from commands: commands tell agents **what to run**, skills tell agents **how to think, validate, and iterate**

#### Bash Orchestration Scripts
- `common.sh` — Shared utilities (root detection, CLI detection, JSON helpers)
- `docguard-check-docs.sh` — Discover project docs, return JSON inventory with metadata
- `docguard-suggest-fix.sh` — Run guard, parse results, output prioritized fixes as JSON
- `docguard-init-doc.sh` — Initialize canonical doc with metadata header and template

#### Workflow Chaining & Hooks
- All 10 commands upgraded with YAML `handoffs` for workflow chaining (guard → fix → review → score)
- 3 spec-kit workflow hooks: `after_implement` (mandatory guard), `before_tasks` (optional review), `after_tasks` (optional score)
- `extensions.yml` template for spec-kit hook registration

#### Extension Structure
- `extension.yml` updated with `skills`, `scripts`, and `hooks` sections
- Extension README rewritten with complete skills, scripts, hooks, and workflow documentation
- `extensions/` directory now included in npm package (`package.json` files array)

## [0.9.5] - 2026-03-14

### Added — Spec Kit Alignment (Mega Release)

#### Spec Kit Scanner Rewrite
- **Correct file paths**: Now checks `.specify/specs/NNN-feature/spec.md` (v3+ standard) with fallback to legacy `specs/*/spec.md`
- **Constitution detection**: Checks `.specify/memory/constitution.md` (v3+) with fallback to root `constitution.md`
- **Spec quality validation**: Validates mandatory sections (User Scenarios, Requirements, Success Criteria), FR-IDs, SC-IDs per spec-kit spec-template.md
- **Plan quality validation**: Checks for Summary, Technical Context, Project Structure sections
- **Tasks quality validation**: Verifies phased breakdown (Phase 1, 2+) and T-xxx task IDs
- **Informational warning**: Spec-Kit validator now suggests `specify init` when no spec-kit artifacts found (was silent `0/0`)

#### Traceability Enhancement
- **SC-xxx** (Success Criteria) added to requirement ID patterns — aligns with spec-kit SC-001 format
- **T-xxx** (Task IDs) added — recognizes spec-kit T001, T002 task identifiers
- Scans `.specify/specs/` path in addition to legacy `specs/`

#### Slash Commands (Spec Kit Extension)
- New `commands/` directory with 4 AI agent slash commands: `/docguard.guard`, `/docguard.review`, `/docguard.fix`, `/docguard.score`
- Shipped as part of npm package — available via `specify extension add docguard`
- Works with Claude Code, Copilot, Cursor, Gemini, Antigravity, and more

#### REQUIREMENTS.md Template
- New `REQUIREMENTS.md.template` aligned with spec-kit FR-xxx, SC-xxx, Given/When/Then standards
- Added to `docguard init` template catalog (defaultYes: true)

#### Python Support (PyPI)
- `pyproject.toml` and `docguard_cli/wrapper.py` for `pip install docguard-cli`
- Thin Python wrapper delegates to `npx docguard-cli` — requires Node.js 18+
- Python developers can now use `docguard guard`, `docguard score`, etc.

### Fixed
- `speckit.mjs` writeFileSync → safeWrite (backup safety, same as v0.9.4 pattern)

## [0.9.4] - 2026-03-13

### Fixed — Critical: Generate File Safety (Data Loss Prevention)
- **`diagnose --auto` no longer passes `--force` to `generate`**: This was the root cause of silent doc overwriting. `diagnose --auto` now only creates missing files, never overwrites existing ones.
- **`.bak` backup on `--force`**: When `generate --force` is explicitly used, all existing files are backed up as `.bak` before being overwritten. Content is never permanently lost.
- **`--force` warning banner**: Shows how many existing files will be overwritten before proceeding.
- **`safeWrite()` helper**: All 9 write operations in generate now go through a single safety wrapper.

## [0.9.3] - 2026-03-13

### Changed — Prose-Only Extraction Engine (Breaking improvement)
- **`extractProse()` replaces `stripMarkdown()`**: Instead of stripping markdown and measuring residue (where table cells became "146-word sentences"), the new engine identifies and extracts only actual prose paragraphs. Reference docs (mostly tables/code) with <50 words of prose skip readability scoring entirely.
- **Technical vocabulary normalization**: 80+ tech terms (DynamoDB, WebSocket, middleware, TypeScript, etc.) are treated as simple 2-syllable words for Flesch scoring. Known terms don't penalize readability.
- **Markdown-aware sentence detection**: File paths (`src/auth.ts`), version numbers (`v0.9.2`), URLs, and abbreviations (`e.g.`, `i.e.`) no longer cause false sentence splits.
- **Relaxed thresholds for technical docs**: Flesch 30→15, grade 16→18, sentence length 25→30, passive voice 20→25%, negation 15→20%.
- **Impact**: Doc-Quality scores improved from 81% (13/16) to 95% (38/40) on DocGuard itself. API reference docs that scored 0/100 now skip gracefully or score fairly.

## [0.9.2] - 2026-03-13

### Fixed
- **Flesch readability false positives**: Improved `stripMarkdown()` to remove mermaid diagrams, HTML tags, definition-style lines, and lines with >60% special characters. Docs with tables no longer score 0/100.
- **Flesch threshold**: Lowered from 30→20 for technical documentation — developer docs inherently score lower than prose.
- **NUL file on macOS**: `findUnderstandingCli()` used Windows `2>NUL` redirect which created a stray `NUL` file on Mac/Linux. Now uses platform-specific `which`/`where`.
- **Unused import**: Removed `mkdirSync` from `diagnose.mjs` (was imported but never used).

### Verified
- `diagnose` is read-only by default — file creation only happens with explicit `--auto` flag.
- `metrics-consistency` properly reads `.docguardignore` patterns.

## [0.9.1] - 2026-03-13

### Fixed
- **Test detection**: `calcTestingScore` now detects co-located tests in `src/`, `app/`, `lib/`, `packages/`, `modules/` — not just top-level `tests/` directories. Projects using `src/**/__tests__/` or `src/**/*.test.*` patterns now score correctly.
- **Test-spec fallback**: Validator fallback check now scans for co-located test files and checks vitest/jest config presence.
- **Vitest config support**: Score calculation now reads `vitest.config.ts`/`jest.config.ts` include patterns to detect custom test directories.

## [0.9.0] - 2026-03-13

### Added
- **Doc Quality Validator** — 8 deterministic writing quality metrics (passive voice, readability, atomicity, sentence length, negation/conditional load). Inspired by IEEE 830/ISO 29148.
- **Understanding Integration** — Optional deep scan via the [Understanding](https://github.com/Testimonial/understanding) CLI for full 31-metric doc quality analysis. Runs automatically when `understanding` CLI is installed, providing actionable insights alongside DocGuard's native 8 metrics. Credit: Testimonial/understanding project.
- **Spec Kit Integration** — Auto-detects [Spec Kit](https://github.com/github/spec-kit) projects (`.specify/`, `specs/`, `constitution.md`, `memory/`), maps Spec Kit artifacts to CDD canonical docs, and supports `docguard generate --from-speckit` for one-command conversion. Validates spec.md requirement IDs trace to tests. Credit: GitHub Spec Kit framework.
- **Requirement Traceability (V-Model)** — scans docs for requirement IDs (REQ-001, FR-001, US-001, etc.) and validates they trace to test files. Opt-in by convention: just add IDs and DocGuard auto-enforces. Inspired by [spec-kit-v-model](https://github.com/leocamello/spec-kit-v-model) and IEEE 1016.
- **TODO/FIXME Tracking** — detects untracked code annotations and skipped tests without explanation. Inspired by [spec-kit-cleanup](https://github.com/dsrednicki/spec-kit-cleanup).
- **Schema Sync Validator** — detects database models from 7 ORM frameworks (Prisma, Drizzle, TypeORM, Sequelize, Knex, Django, Rails) and validates they're documented in DATA-MODEL.md.
- **`docguard llms` command** — generates `llms.txt` from canonical docs following the [llms.txt standard](https://llmstxt.org/) (Jeremy Howard, Answer.AI, 2024).
- **ALCOA+ Compliance Scoring** — maps existing validators to the 9 FDA data integrity attributes (Attributable, Legible, Contemporaneous, Original, Accurate, Complete, Consistent, Enduring, Available). Always shown in `docguard score` output with per-attribute evidence, gaps, and fix recommendations.
- **`enterprise-ai` profile** — EU AI Act Annex IV compliance profile with stricter freshness (14-day threshold), required DATA-MODEL.md, and Risk Assessment section in SECURITY.md.
- **OpenAPI cross-check** — if route files and an OpenAPI spec exist, validates routes have matching paths in the spec. Warns to re-run spec generator if out of sync.

### Changed
- Validator count: 14 → 18 validators, 108 → 130+ automated checks
- `docguard score` now always shows ALCOA+ compliance breakdown

## [0.8.2] - 2026-03-13

### Added
- **Docs-Coverage Validator** — detects undocumented code features: config files on disk, code-referenced configs (resolve/existsSync calls), source dirs not in ARCHITECTURE.md, README section completeness per Standard README spec.
- **Metadata-Sync Validator** — cross-checks package.json version against extension.yml and markdown file references; context-aware matching (URLs, install commands, YAML only).
- **Metrics-Consistency Validator** — catches stale hardcoded numbers in docs ("92 checks" when actual is 114); requires 2+ digit numbers and negative lookbehind for ratio patterns.
- **`.docguardignore` support** — per-project file exclusions (like `.gitignore`), parsed by `loadIgnorePatterns()` in `shared.mjs`, integrated with Metrics-Consistency and Metadata-Sync validators.

### Fixed
- **Co-located test detection** — `generate` now recursively scans `src/**/__tests__/` and `*.test.*`/`*.spec.*` files; reads `vitest.config.ts`/`jest.config.ts` for custom patterns.
- **Test files as source files** — test files are now filtered out of all source lists (services, routes, models, components, middlewares) before mapping.
- **Diagnose suggest-only** — `diagnose` no longer auto-creates files by default; pass `--auto` to enable auto-fix. Shows actionable suggestions when not in auto mode.
- **Diagnose score cap** — target score in AI prompt now capped at 100 (was showing 105/100).

### Changed
- **Guard checks** — increased from 86 to 114 with 5 new validators (docs-coverage, metadata-sync, metrics-consistency, docs-diff, freshness).
- **Validators** — increased from 9 to 14.

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
