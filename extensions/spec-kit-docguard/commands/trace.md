---
description: "Generate requirements traceability matrix"
handoffs:
  - label: Fix Coverage Gaps
    agent: docguard.fix
    prompt: Fix traceability gaps found in the matrix
  - label: Run Guard
    agent: docguard.guard
    prompt: Validate traceability checks pass
---

# DocGuard Trace

Generate a requirements traceability matrix mapping canonical docs ↔ source code ↔ tests. Config-aware — respects `.docguard.json` exclusions and detects orphaned files.

## Running DocGuard

Run `docguard` from PATH when it is installed. Otherwise run
`npx --yes docguard-cli@0.43.0`, the release these instructions ship with, in its
place. Every `docguard …` command below means one of the two.

## User Input

$ARGUMENTS

## Steps

1. Run DocGuard trace on the current project:

```bash
docguard trace $ARGUMENTS
```

2. Review the matrix. Each canonical doc gets a coverage signal:
   - **TRACED** — doc + source code + tests all linked
   - **PARTIAL** — doc exists, source found, no test coverage
   - **UNLINKED** — doc exists but no matching source code
   - **MISSING** — doc not found

3. Orphaned files (exist but excluded from config) are flagged with cleanup instructions.

## Standards

Maps against industry standards per document type:

| Document | Standard |
|----------|----------|
| ARCHITECTURE.md | arc42 / C4 Model |
| DATA-MODEL.md | C4 Component / ER (Chen) |
| TEST-SPEC.md | ISO/IEC/IEEE 29119-3 |
| SECURITY.md | OWASP ASVS v4.0 |
| ENVIRONMENT.md | 12-Factor App |
| API-REFERENCE.md | OpenAPI 3.1 |

## Flags

- `--format json` — Output as JSON
- `--dir <path>` — Run on a different directory

## Research

Inspired by ISO/IEC/IEEE 29119 traceability requirements (Lopez et al., AITPG, IEEE TSE 2026).
