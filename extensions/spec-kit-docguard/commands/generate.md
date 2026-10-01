---
description: "Reverse-engineer canonical documentation from existing codebase"
handoffs:
  - label: Validate Generated Docs
    agent: docguard.guard
    prompt: Validate generated documentation passes all checks
  - label: Review Quality
    agent: docguard.review
    prompt: Review quality of generated documentation
---

# DocGuard Generate

Scans your codebase (JS/TS, Python, Rust, Go, Java/Kotlin, Ruby, PHP, C# — polyglot/monorepo-aware) and generates the canonical documentation memory: ARCHITECTURE.md, DATA-MODEL.md, TEST-SPEC.md, SECURITY.md, ENVIRONMENT.md, API-REFERENCE.md, SCREENS.md.

Two modes:

- **`--plan`** (AI-powered, recommended) — emits a structured agent task manifest + writes the code-truth skeleton inside `<!-- docguard:section -->` markers. The AI agent then writes the prose grounded in scanned facts. Human prose is preserved.
- **default** — purely deterministic generation: writes templated docs with TODO placeholders. Use when no AI agent is available.

With `docs.roles`, a missing or explicitly generated single-role target can
receive a full document. Existing human documents receive only bounded updates
inside unique `source=code` sections. Shared roles and malformed markers fail
before any mapped document is written, even with `--force`.

## Running DocGuard

Run `docguard` from PATH when it is installed. Otherwise run
`npx --yes docguard-cli@0.42.1`, the release these instructions ship with, in its
place. Every `docguard …` command below means one of the two.

## As-built specs for code that has none

`--spec <area>` reverse-engineers a **Spec Kit spec** for one directory of existing code:

```bash
docguard generate --spec src/billing            # preview the candidates
docguard generate --spec src/billing --write    # create specs/NNN-as-built-src-billing/spec.md
```

- DocGuard proposes one `FR-NNN` candidate per fact it can establish without an LLM: routes,
  exported symbols, environment variables and entities. Each candidate carries a
  `<!-- docguard:fact … -->` marker and a file citation. The requirement statement is left to
  you as an `<!-- agent: … -->` note. Replace each note, keep the markers, and move any fact you
  deliberately do not specify under `## Out of Scope` with a reason.
- `--write` registers the spec as `origin: as_built` with its source paths. From then on,
  `guard` reports a fact that appears in the code without a requirement, and a cited fact that
  disappears (`SPR007`). The spec cannot silently drift from the code it describes.
- It composes with the brownfield community extensions. Brownfield Bootstrap, BrownKit and
  Time Machine can draft the narrative, and DocGuard adds the fact candidates and keeps them in
  sync. Unlike Time Machine, it never re-runs `/speckit.implement` over existing code.

## User Input

$ARGUMENTS

## Steps

1. **Preview the plan** — what code-truth facts were captured + what the agent will write:

```bash
docguard generate --plan $ARGUMENTS
```

2. **Scaffold the skeleton docs** (marked sections filled with code-truth, prose sections as agent-task placeholders):

```bash
docguard generate --plan --write $ARGUMENTS
```

3. **Or get the machine-readable manifest** to drive an agent:

```bash
docguard generate --plan --format json $ARGUMENTS
```

4. **Fallback** (no AI, deterministic generation):

```bash
docguard generate $ARGUMENTS
```

2. Review the generated docs in `docs-canonical/`. Each document includes:
   - Structured sections based on industry standards
   - Data extracted from your actual codebase (routes, schemas, configs)
   - Standards citation footer referencing relevant specifications
   - DocGuard metadata headers for freshness tracking

3. Customize with `--doc <name>` to generate a specific document only.

## Generated Documents

| Document | Source | Standard |
|----------|--------|----------|
| ARCHITECTURE.md | Routes, configs, dependencies | arc42 / C4 Model |
| DATA-MODEL.md | Schema files, type definitions | C4 Component / ER |
| TEST-SPEC.md | Test files, test configs | ISO/IEC/IEEE 29119-3 |
| SECURITY.md | Auth modules, .gitignore, secrets | OWASP ASVS v4.0 |
| ENVIRONMENT.md | .env files, Docker, CI/CD configs | 12-Factor App |
| API-REFERENCE.md | Route handlers, OpenAPI specs | OpenAPI 3.1 |

## Flags

- `--doc <name>` — Generate a specific document only
- `--dir <path>` — Run on a different directory; explicit selection suppresses ancestor-root guidance
