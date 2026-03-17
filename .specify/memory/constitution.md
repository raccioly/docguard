<!-- Sync Impact Report
  Version change: 0.0.0 → 1.0.0
  Modified principles: N/A (initial creation)
  Added sections: Core Principles (7), Technology Constraints, Extension & Spec Kit Compliance, Governance
  Removed sections: N/A
  Templates requiring updates: ✅ constitution-template.md (reference only, not modified)
  Follow-up TODOs: None
-->

# DocGuard Constitution

## Core Principles

### I. LLM-First, CLI-Second

DocGuard is built for AI coding agents. Every feature MUST be designed for LLM consumption first, with CLI as a secondary interface. Skills (behavior protocols) take priority over CLI commands (step-lists). When DocGuard detects an AI agent environment, it MUST surface skill-based instructions. CLI output MUST be machine-parseable (JSON mode) alongside human-readable text.

### II. Zero NPM Runtime Dependencies (NON-NEGOTIABLE)

DocGuard has zero `node_modules` at runtime. All Node.js functionality uses built-in modules only (`node:fs`, `node:path`, `node:child_process`, `node:test`, `node:url`, `node:readline`, `node:os`, `node:assert`). This maximizes portability, eliminates supply chain risk, and ensures instant `npx` usage. Dev dependencies are also zero — tests use `node:test`. DocGuard depends on spec-kit as a **framework convention** (`.specify/` directory structure, skill architecture, constitution pattern). This is an integration, not a code dependency. When the `specify` CLI is available, DocGuard MUST leverage it for initialization and skill management.

### III. Documentation as Source of Truth

Canonical-Driven Development means documentation drives code, not the other way around. DocGuard enforces this by validating code against `docs-canonical/` and detecting drift. Any deviation from canonical docs MUST be logged in `DRIFT-LOG.md` with `// DRIFT: reason` inline comments. The `docguard guard` command is the enforcement gate.

### IV. Validator Isolation

Each of the 19 validators is a pure, self-contained function. Validators receive `projectDir` and `config`, then return results. No validator may import another validator or depend on command-level logic. This ensures adding or modifying validators never breaks existing ones.

### V. AI as Author, CLI as Orchestrator

The CLI detects problems and generates structured prompts. The AI agent writes the actual documentation. DocGuard MUST NOT generate final documentation content itself — it provides research instructions, templates, and validation. The `fix`, `diagnose`, and `generate` commands produce AI-actionable output, not finished documents.

### VI. Safe Writes

All file write operations MUST use defensive patterns. Before overwriting any file, DocGuard creates backups. The `--force` flag is required to overwrite existing files. Init and setup commands skip files that already exist unless explicitly forced.

### VII. Spec Kit Extension Compliance

DocGuard is a community extension of GitHub Spec Kit. It MUST follow spec-kit conventions: `extension.yml` schema, skill architecture (`SKILL.md` files with YAML frontmatter), workflow hooks (`after_implement`, `before_tasks`, `after_tasks`), and the `.specify/` directory structure. DocGuard MUST always install spec-kit core skills alongside its own skills so users get the complete spec-driven development workflow.

## Technology Constraints

- **Language**: JavaScript (ES Modules only, no CommonJS)
- **Runtime**: Node.js ≥ 18 (for native `node:test` and ES module support)
- **Dependencies**: None. Zero. Ever. This is a hard constraint.
- **Distribution**: npm (`docguard-cli`) + PyPI (`docguard`)
- **Testing**: `node:test` + `node:assert` (built-in, no framework)
- **Extension**: VS Code Extension API for editor integration
- **Config**: `.docguard.json` for project-level customization
- **Profiles**: starter, standard, enterprise compliance levels
- **Output**: Text (human) + JSON (machine) dual output for all commands

## Extension & Spec Kit Compliance

- DocGuard MUST declare all skills, scripts, hooks, and commands in `extension.yml`
- DocGuard MUST bundle spec-kit core skills so users don't need a separate install
- All 4 DocGuard skills (`docguard-guard`, `docguard-fix`, `docguard-review`, `docguard-score`) MUST follow spec-kit skill architecture: YAML frontmatter with `name`, `description`, `compatibility`, `metadata`
- Workflow hooks MUST be optional (never force execution)
- The `ensureSkills()` function MUST auto-detect and install both DocGuard skills AND spec-kit core skills
- DocGuard MUST detect agent environment (LLM vs CLI) and adapt its output accordingly

## Governance

This constitution supersedes all ad-hoc practices. Amendments require:
1. Documentation of the change in `DRIFT-LOG.md` if deviating
2. Update this constitution with a version bump
3. Update `CHANGELOG.md` with the change
4. All PRs MUST pass `docguard guard` before merge

Versioning follows semantic versioning:
- **MAJOR**: Principle removal or backward-incompatible redefinition
- **MINOR**: New principle added or materially expanded guidance
- **PATCH**: Clarification, wording, typo fix

**Version**: 1.0.0 | **Ratified**: 2026-03-17 | **Last Amended**: 2026-03-17
