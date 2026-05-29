---
description: "Run the full quality gate with severity triage and actionable remediation"
handoffs:
  - label: Fix All Issues
    agent: docguard.fix
    prompt: Fix all documentation issues found by guard
  - label: Deep Review
    agent: docguard.review
    prompt: Perform semantic cross-document consistency analysis
  - label: Check Score
    agent: docguard.score
    prompt: Show CDD maturity score and improvement roadmap
---

# DocGuard Guard

Validate your project against its canonical documentation. Runs 160+ automated checks across validators.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Execution

1. Run DocGuard guard validation:
```bash
npx --yes docguard-cli@latest guard $ARGUMENTS
```

2. Parse each validator's result and build a severity-ranked findings table. Status glyphs: ✅ pass, ⚠️ warning, ❌ fail, ➖ N/A (nothing to validate — NOT a pass; the dimension was not assessed).

3. **Triage by severity**:
   - **CRITICAL**: Structure, Security, Test-Spec failures → fix immediately
   - **HIGH**: Doc Sections, Drift-Comments, Changelog, Traceability, API-Surface → fix before commit
   - **MEDIUM**: Freshness, Docs-Coverage, Doc-Quality, Metrics → fix this sprint
   - **LOW**: TODO-Tracking, Schema-Sync, Spec-Kit, Metadata → fix when convenient

4. For each failing check, provide an **exact fix** — specific file, section, and content.

5. Re-run guard after fixes. Iterate until all checks pass (max 3 iterations).

## Validators

| Validator | What It Checks |
|-----------|---------------|
| Structure | Required CDD files exist |
| Doc Sections | Canonical docs have required sections |
| Docs-Sync | External doc references are valid |
| Drift-Comments | `// DRIFT:` comments have DRIFT-LOG entries |
| Changelog | CHANGELOG.md is maintained |
| Test-Spec | TEST-SPEC.md matches actual test files |
| Environment | Environment docs and .env.example exist |
| Security | No hardcoded secrets, .gitignore configured |
| Architecture | Layer boundaries and diagrams present |
| Freshness | Docs updated after recent code changes |
| Traceability | Canonical docs linked to source code |
| Docs-Diff | Entity/route/field drift between code and docs |
| API-Surface | API-REFERENCE.md endpoints match the real API surface (OpenAPI spec / routes) |
| Metadata-Sync | Metadata headers are consistent |
| Docs-Coverage | All config files documented |
| Doc-Quality | Readability, IEEE 830 compliance |
| TODO-Tracking | TODOs are tracked |
| Schema-Sync | Schema documentation matches code |
| Spec-Kit | Spec quality (FR-IDs, sections) |
| Metrics-Consistency | Internal counts are accurate |

## Flags

- `--format json` — Output results as JSON
- `--dir <path>` — Run on a different directory
