# Implementation Plan: Config Secrets and Analysis Disclosure

**Spec**: [spec.md](spec.md) (`docguard.analysis-disclosure`)

| FR | Change |
|---|---|
| FR-001 | `cli/validators/security.mjs`: `configSecretKind`, `scansForSecrets`, `configKeyLabel`, `configLiteral`, `configPairs`, `configSecretFindings`; shell in `CODE_EXTENSIONS`. |
| FR-002 | `cli/commands/guard.mjs` `computeUnanalyzed`; `cli/shared-guard-json.mjs` compact counts; `cli/scanners/requirement-evidence.mjs` `readsRequirementTags`. |
| FR-003 | SEC012 in `cli/validators/security.mjs` and `cli/findings.mjs`. |
| FR-004 | `cli/shared-languages.mjs`: new entries and `match` path rules in `languageFor`. |
| FR-005 | `cli/scanners/project-type.mjs` MuleSoft and `NO_ROUTE_READER`; `cli/validators/api-surface.mjs` `routeReader`; `cli/commands/generate.mjs` note. |
| FR-006, FR-007 | Schema, docs, CHANGELOG. |

## Decisions

1. **Key-based, not pattern-based.** YAML, properties and JSON do not have the `name = "value"` shape; reading them by key keeps `package.json` and `pom.xml` out.
2. **Capabilities are predicates, not flags.** A hand-written capability list would drift from the code, which is the class of bug spec 107 fixed.
3. **No route reader, no API-Surface.** One set (`NO_ROUTE_READER`) replaces the Apex-specific skip of spec 107.
