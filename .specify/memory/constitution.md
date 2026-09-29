# DocGuard Constitution

## Core Principles

### I. LLM-First, CLI-Second

DocGuard is built for AI coding agents. Every feature MUST be designed for agent consumption
first and human terminal use second. Skills (behavior protocols) take priority over command
step-lists. Commands that report findings MUST offer machine-readable output (`--format json`,
and SARIF/JUnit where the command supports them) alongside human-readable text, and agents MUST
be able to act on the machine contract without parsing prose.

### II. Minimal, Vetted Dependencies (NON-NEGOTIABLE)

`package.json` is the authoritative dependency list. Today it declares exactly one runtime
dependency, `@babel/parser`, exact-pinned and loaded optionally: if it is absent the CLI degrades
to the regex tier and reports that degradation instead of crashing. There are no dev
dependencies; tests use `node:test` and `node:assert`.

Any new dependency MUST be justified against Node.js built-ins, exact-pinned (no `^`, `~` or
`>=`), verified to exist on the official registry, have more than 10k weekly downloads and more
than one maintainer, have been first published more than 30 days earlier, and degrade gracefully
when missing. Spec Kit is an integration convention, not a code dependency.

### III. Documentation as Source of Truth

Canonical-Driven Development means documentation drives code. DocGuard validates code against
`docs-canonical/` and reports drift. A difference between doc and code does not by itself make
the doc wrong: when code deviates from a documented decision, either the code is fixed or the
deviation is logged in `DRIFT-LOG.md` with an inline `// DRIFT: reason` comment. `docguard guard`
is the enforcement gate.

### IV. Validator Isolation

Every module in `cli/validators/` is a self-contained function of `projectDir` and `config` that
returns results. A validator MUST NOT import another validator or command-level logic. Shared
infrastructure (file walking, ignore filtering, glob matching, document discovery) MUST live in
shared modules (`cli/shared*.mjs`, `cli/scanners/`) that validators import. Commands MAY compose
results from several validators.

### V. AI as Author, CLI as Orchestrator

DocGuard detects problems, extracts code facts and produces structured, AI-actionable output.
It writes deterministically in two cases only: code-truth sections refreshed by `sync`, and
provenance-checked mechanical fixes applied by `fix --write`. It MUST NOT author prose; human
intent and explanatory text are written by the AI agent or a person. DocGuard makes no LLM calls.

### VI. Safe Writes

A standalone file write MUST go through `safeWrite()`, which keeps a backup before overwriting.
A lifecycle operation spanning several files MUST go through `commitFileTransaction()`, so that
preparation, rollback and post-write validation cover the whole set. Overwriting an existing
user file requires an explicit flag (`--force` or `--write`); init and scaffolding commands skip
files that already exist.

### VII. Spec Kit Integration by Delegation

DocGuard is a GitHub Spec Kit community extension. `extensions/spec-kit-docguard/extension.yml`
is the authoritative declaration of its commands, skills and workflow hooks, and MUST validate
against the upstream extension manifest schema. Whether a hook is mandatory follows that hook's
`optional` field. Skills MUST use `SKILL.md` files with YAML frontmatter (`name`, `description`,
`compatibility`, `metadata`).

DocGuard does not bundle Spec Kit's core skills. It delegates Spec Kit scaffolding to the
`specify` CLI, MUST call it only with that CLI's current, documented flags, and MUST report a
failed delegation to the user instead of swallowing it.

### VIII. Local-First, No Telemetry

The deterministic core makes no network calls and collects nothing (`PRIVACY.md`). Outbound
actions MUST be user-initiated and visible: `feedback` builds a prefilled issue URL the user
chooses to open; `upgrade --pr` and similar commands shell out to the user's own authenticated
`gh`; the MCP HTTP transport binds to loopback by default and refuses a non-loopback bind without
an API key. DocGuard holds no credentials and operates no server-side component.

### IX. Honest Assurance

Every structured finding MUST carry a stable code, severity, confidence, disposition (`act` or
`escalate`), evidence status and parser tier. Output MUST NOT overstate what was checked: a
passing guard does not establish factual accuracy; partial coverage, unavailable prerequisites,
degraded parser tiers and unverified documented claims are reported, never hidden or folded into
a green result.

### X. Spec-First Development

This repository dogfoods its own extension. Every non-trivial change runs the Spec Kit pipeline
(`specs/###-slug/` spec → plan → tasks → implement/converge) with DocGuard's hooks registered
(`npm run speckit:dev`). When the area being changed has no spec, an as-built spec scoped to that
area comes first. A change MAY skip the pipeline only when it declares an exemption with a reason;
the accepted kinds are release cut, dependency bump, typo and test-only.

## Technology and Distribution Constraints

- **Language**: JavaScript, ES modules only (no CommonJS)
- **Runtime**: Node.js as declared in `package.json` `engines` (currently ≥ 18)
- **Testing**: `node:test` + `node:assert`
- **Surfaces**: the CLI; the MCP server (stdio, opt-in HTTP); the GitHub Action (`action.yml`);
  the Spec Kit extension; the Claude Desktop MCP bundle. There is no web UI and no editor
  extension.
- **Distribution**: npm (`docguard-cli`) and PyPI (`docguard`), published from GitHub Actions
  through trusted publishing (npm with provenance attestations)
- **Configuration**: `.docguard.json`, with starter, standard and enterprise profiles
- **Counts**: commands, validators, skills and hooks MUST NOT be hardcoded in prose documents;
  cite the authoritative source (`docguard --help`, `extension.yml`, the file system) instead

## Development Workflow

- PR-first: branch, push, open a pull request, let CI run, self-review, squash-merge. Releases
  are tagged only after merge on `main`. Direct commits to `main` are limited to typo fixes in
  comments or badge URLs.
- Every change updates `CHANGELOG.md`.
- `npm test` and `docguard guard` MUST pass before a change merges.
- Third-party GitHub Actions MUST be pinned to a full commit SHA. Workflows MUST NOT use
  `pull_request_target` with a checkout of PR-controlled refs.
- Security rules in `docs-canonical/SECURITY.md` and test requirements in
  `docs-canonical/TEST-SPEC.md` are mandatory.

## Governance

This constitution supersedes ad-hoc practice; `AGENTS.md` holds the operational detail and MUST
NOT contradict it. An amendment requires:

1. An edit to this file with a version bump and an updated Last Amended date
2. A `CHANGELOG.md` entry
3. `docguard guard` passing on the amending pull request

Versioning is semantic: MAJOR for removing or redefining a principle incompatibly, MINOR for a
new principle or materially expanded guidance, PATCH for clarification and wording.

**Version**: 2.0.0 | **Ratified**: 2026-03-17 | **Last Amended**: 2026-09-29
