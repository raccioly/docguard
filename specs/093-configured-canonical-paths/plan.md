# Implementation Plan: Score and Section Checks Read the Canonical Documents the Configuration Names

**Branch**: `maint/2026-11-11` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002 | `cli/shared-doc-roles.mjs`: new `resolveDocPath(projectDir, config, path)`, the project-relative path of `resolveDocRole` for a role's default path; a non-role path is returned unchanged, and a mapping `resolveDocRole` rejects falls back to `docRolePath`. `cli/commands/score.mjs` `calcDocQualityScore` and `cli/validators/structure.mjs` (STR003, STR007) call it instead of `remapDocPath`. |
| FR-003 | `cli/commands/score.mjs`: `alcoaCanonicalDocs`, `listCanonicalDocs` plus the existing Markdown entries of `requiredFiles.canonical` inside the project. `computeAlcoaCompliance` reads it, and Original and Available are met when it is not empty or `docs-canonical/` exists. |
| FR-004 | `calcDocQualityScore` derives `--doc` from the role's default file name; `getSuggestion` shows the file's base name. |
| FR-006 | `schemas/claimspec/v1/{ignore,common}.schema.json` copied from TestGuard tag v0.22.1 (commit `9cdac55`); `CLAIMSPEC_VENDOR` updated. |
| FR-007 | `cli/findings.mjs` STR003 help; `npm run docs:reference`; `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`; `CHANGELOG.md`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/configured-canonical-paths.test.mjs` holds the #625 reproduction, the controls and the re-pin checks. The existing score, structure, doc-role, nested-canonical and ignore-reasons suites run unchanged.
**Constraints**: no new dependency; `remapDocPath` stays pure because `cli/scanners/memory-plan.mjs` relies on it.

## Research decisions

- **What exists.** `resolveDocRole` (`docguard.dogfood-findings` FR-002) already resolves a missing default to the one same-named entry of `requiredFiles.canonical`. Four score categories use it; docQuality and the section checks were the exceptions. Reusing it keeps one rule for where a role lives.
- **Why a local ALCOA+ set.** `listCanonicalDocs` feeds docs-sync, validator markers, semantic claims and readability. Widening it would move findings in validators the report does not concern. ALCOA+ adds the configured entries itself.
- **Why `||` for Original and Available.** A project with an empty `docs-canonical/` directory met both before; keeping the directory test preserves that.
- **The #619 field names.** The released evidence schema names `run.claimsSource` (`$defs/claimsSource`: `external: true`, `sha256`), `inputs.dependencyHashes` and `inputs.dependencyClosure` (`complete` or `indeterminate`), the names the adapter from #620 reads. No adapter change is needed.
- **Rejected:** making `remapDocPath` read the filesystem (it is pure by contract); pinning to v0.22.0 (v0.22.1 is the latest release with the same fields).

## Risks

- **New STR003 warnings** on projects whose canonical documents sit outside `docs-canonical/` and lack sections. The A/B lists every one.
- **docQuality moves** on those projects, from 0 or a partial score to the documents' real score. The A/B lists every one.

## Verification

1. `npm test`; `node cli/docguard.mjs guard`; `npm run budget`.
2. A/B: `git archive` of `v0.47.0` and of the branch head as CLIs; one fresh `git clone --local` of each local project per CLI; `guard --format json` and `score --format json` serially; findings diffed by code, location and message, and score categories compared.
