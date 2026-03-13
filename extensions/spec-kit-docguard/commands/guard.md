---
description: "Validate project against canonical documentation"
---

# DocGuard Guard

Validate your project against its canonical documentation. Runs 130+ automated checks across 18 validators with quality labels.

## User Input

$ARGUMENTS

## Steps

1. Run DocGuard guard validation on the current project:

```bash
npx --yes docguard-cli@latest guard $ARGUMENTS
```

2. Review the output. Each validator shows:
   - **[HIGH]** — 90%+ checks passed
   - **[MEDIUM]** — 50-89% checks passed
   - **[LOW]** — Below 50% checks passed

3. If there are failures, run `speckit.docguard.diagnose` for AI-ready fix prompts.

## Validators

| Validator | What It Checks |
|-----------|---------------|
| Structure | Required files exist (ARCHITECTURE.md, TEST-SPEC.md, etc.) |
| Doc Sections | Canonical docs have required sections |
| Docs-Sync | Code changes reflected in documentation |
| Drift | `// DRIFT:` comments have DRIFT-LOG entries |
| Changelog | CHANGELOG.md is maintained |
| Test-Spec | TEST-SPEC.md matches actual test files |
| Environment | Environment docs and .env.example exist |
| Security | No hardcoded secrets, .gitignore configured |
| Architecture | Layer boundaries and diagrams present |
| Freshness | Docs updated after recent code changes |
| Traceability | Canonical docs linked to source code |
| Docs-Diff | Entity/route/field drift between code and docs |

## Flags

- `--format json` — Output results as JSON
- `--dir <path>` — Run on a different directory
