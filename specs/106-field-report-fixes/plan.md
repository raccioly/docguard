# Implementation Plan: Field-Report Fixes

**Spec**: [spec.md](spec.md) (`docguard.field-report-fixes`)

## Summary

Seven issues, one pull request. The Apex gap (712 to 714) is one new leaf module with one language entry and many consumers. The others are local changes with a regression test each.

| FR | Change |
|---|---|
| FR-001 | `cli/enforcement.mjs` `strictFindingContext({ config })` returns `offByDefault` without the validators the merged config turns on; `cli/commands/guard.mjs` passes `config` and its legacy branch reads `gatingContext.offByDefault`. |
| FR-002 | `cli/commands/guard.mjs`: count demoted product secrets after enforcement; `strict.demotedProductSecrets`; one text line. |
| FR-003 | New `cli/shared-languages.mjs` (leaf, no imports): `APEX`, `APEX_EXTENSIONS`, `isApexPath`, `isApexTestName`, `declaresApexTest`, `metadataApiName`, `isSalesforceProject`. |
| FR-004 | `cli/validators/security.mjs`: `CODE_EXTENSIONS` gains the Apex and Visualforce extensions; SEC011 counts the unscanned source files by language (`countLanguages`, `describeLanguageCounts`); `cli/shared-source.mjs` `LANGUAGE_NAMES` gains Apex and Visualforce, `SLASH_COMMENT_EXTS` gains Apex. |
| FR-005 | `cli/shared-trace-patterns.mjs` `TEST_PATTERNS` (Apex test names); `cli/scanners/requirement-evidence.mjs` `isTestSource` and the implementation selector; `cli/scanners/pattern-lexer.mjs` `EXTENSIONS` maps the Apex extensions to the Java lexer; `cli/validators/traceability.mjs` local `CODE_EXT`. |
| FR-006 | `cli/validators/test-spec.mjs` `detectTests` and `hasTestFilesRecursive`. |
| FR-007 | `cli/scanners/project-type.mjs` manifest and profile; `cli/config.mjs` `autoDetectProjectType`. |
| FR-008 | `cli/scanners/speckit.mjs` `EVIDENCE_CODE_EXTS`, `scanRepoForEvidence`. |
| FR-009 | `cli/validators/security.mjs` `nonCredentialShape(key, value)`. |
| FR-010 | `cli/validators/security.mjs` `secretContext`; `cli/shared-file-kind.mjs` `TEST_DIRS`. |
| FR-011 | `cli/commands/guard.mjs` `exitDecision(data)` → `{ exitCode, outcome }`, used by every format; `cli/shared-guard-json.mjs` keeps both in compact; `cli/commands/ci.mjs`. |
| FR-012 | Two schemas; `tests/guard-exit-contract.test.mjs`; AGENTS.md; README. |
| FR-013 | `cli/assessment.mjs`. |
| FR-014 | `cli/validators/docs-coverage.mjs` `checkSourceDirs`. |
| FR-015 | `cli/validators/traceability.mjs` TRC002. |

## Technical Context

- **Language/runtime**: JavaScript (ES modules), Node.js 18+. No new dependency.
- **Constraints**: Constitution IV (the new module is a leaf). No change to the `projectType` enum or the config schema. `errors` keeps its meaning. `findTestFiles` is not changed.

## Decisions

1. **Explicit choice, not promotion.** Product-context secrets do not become gating under the default. Gating codes come from measured precision (`deriveGatingSet`, 30 labelled cases and a Wilson lower bound of 0.85); SEC001 has 2. Making a default run fail on product secrets is a change to security semantics for every adopter and needs a decision from the maintainer. FR-002 makes the demotion visible instead.
2. **The merged config is the choice.** A profile that turns security on is a choice the project made, the same as the key. Only the defaults are not.
3. **Apex is one entry.** The other extension lists (drift, docs-diff, freshness, todo tracking, reference existence, trace, generate, inventory, reconciliation, watch) were audited. They read code to compare it with documents; they are not named by the field report and each addition changes findings on Salesforce trees. They stay as they are in this change and are listed in the pull request as a follow-up.
4. **`.cls` and LaTeX.** Scanning a LaTeX class for secrets is harmless. A `.cls` file is a test only by an Apex test name or `@isTest`, so a LaTeX repository gains no test. Project type keys off `sfdx-project.json`.
5. **`exitCode` and `outcome` are added, nothing is renamed.** Renaming `errors` would break every consumer that reads it.

## Verification

- One test per issue tree, written first and run on the base code (each fails).
- A corpus property test: no fixture has a lower effective level in strict than in standard (FR-001).
- `npm test` by exit code; the CI lint; `docguard guard` on this repository.
- Hermetic A/B against v0.50.0: DocGuard, the benchmark corpus, the other local repositories (one fresh `git archive` per CLI, run one at a time).
