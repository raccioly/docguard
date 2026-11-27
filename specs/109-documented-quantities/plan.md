# Implementation Plan: Quantities in Instruction Documents

**Spec**: [spec.md](spec.md) (`docguard.documented-quantities`)

| FR | Change |
|---|---|
| FR-001 | `cli/scanners/semantic-claims.mjs`: `shellComment`, `SHELL_FENCE`, the bare-`s` duration pattern. |
| FR-002 to FR-004 | `cli/validators/metrics-consistency.mjs`: `checkQuantityClaims`, `ciBudgets`, `scriptCalled`. |
| FR-005 | `cli/findings.mjs` MET005 to MET007; `npm run docs:reference`; CHANGELOG. |

## Decisions

1. **In Metrics-Consistency, not a new validator.** It already compares documented numbers with their source of truth (MET001 to MET004), and a new validator would apply and examine nothing on many projects under strict.
2. **A budget is a ceiling.** Above it is a contradiction (warn); ten times below it is only evidence (info).
3. **Same command only.** A duration is compared only on a line that names a package script that a workflow step runs, so a prose "a review takes 30 minutes" is never compared.
