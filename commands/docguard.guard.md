---
description: Run DocGuard guard validation — check project documentation against CDD standards with 21 validators
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

# DocGuard Guard — Documentation Quality Gate

Run the DocGuard CLI to validate all documentation against Canonical-Driven Development standards.

## What to do

1. **Run the guard command**:
```bash
npx docguard-cli guard
```

2. **Parse the output**. Each of the 21 validators reports ✅ (pass), ⚠️ (warning), ❌ (fail), or ➖ (N/A — nothing to validate). **A ➖ N/A is NOT a pass**: it means the validator found nothing to check (e.g. no API-REFERENCE.md, no DB schema, no layer boundaries declared). Don't read N/A as "healthy" — read it as "not assessed".

   | Validator | What It Checks |
   |-----------|---------------|
   | Structure | Required CDD files exist |
   | Doc Sections | Canonical docs have required sections |
   | Docs-Sync | External doc references are valid |
   | Drift-Comments | `// DRIFT:` code comments logged in DRIFT-LOG.md |
   | Changelog | CHANGELOG.md is maintained |
   | Test-Spec | Tests match TEST-SPEC.md rules |
   | Environment | Environment documentation |
   | Security | No hardcoded secrets, SECURITY.md quality |
   | Architecture | Architecture documentation |
   | Freshness | Docs updated within commit window |
   | Traceability | Requirements trace to tests |
   | Docs-Diff | Doc changes match code changes |
   | API-Surface | API-REFERENCE.md endpoints match the real API surface (OpenAPI spec / routes) |
   | Metadata-Sync | Metadata headers are consistent |
   | Docs-Coverage | All config files documented |
   | Doc-Quality | Readability, IEEE 830 compliance |
   | TODO-Tracking | TODOs are tracked |
   | Schema-Sync | Schema documentation matches code |
   | Spec-Kit | Spec quality (FR-IDs, sections) |
   | Metrics-Consistency | Internal counts are accurate |

3. **Triage findings by severity**:
   - **CRITICAL**: Structure, Security, Test-Spec failures
   - **HIGH**: Doc Sections, Drift-Comments, Changelog, Traceability, API-Surface (documented-but-absent endpoint) failures
   - **MEDIUM**: Freshness, Docs-Coverage, Doc-Quality, Metrics-Consistency warnings
   - **LOW**: TODO-Tracking, Schema-Sync, Spec-Kit, Metadata-Sync warnings

4. For each failing check, provide an **exact fix** — specific file, section, and content to change.

5. After fixing, re-run `npx docguard-cli guard` to verify. Iterate until all checks pass.

6. Exit codes: 0 = all pass, 1 = failures, 2 = warnings only.
