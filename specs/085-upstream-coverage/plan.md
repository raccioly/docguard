# Implementation Plan: Every Requirement Reaches a Task, and Every Task Cites a Real Requirement

**Branch**: `claude/docguard-aws-comparison-077b3f` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 to FR-005 | New `cli/scanners/chain-coverage.mjs`, a pure `chainCoverage({ spec, plan, tasks })` over file texts:<br>• `definedIds(spec)`: FR/SC IDs at the start of a requirement line (`- **FR-001**:`, `| FR-001 |`), outside code fences and HTML comments.<br>• `citedIds(text)`: every unqualified `\b(FR|SC)-\d{3}[a-z]?\b` that is not part of `<specid>#FR-…`, with same-prefix ranges expanded (`to`, `–`, `-`, `..`), and its line.<br>• `storyNumbers(spec)`: from `### User Story n` headings.<br>• `storyLabels(tasks)`: from `[USn]`.<br>• `namesFile(text, name)`.<br>It returns `{ uncovered, dangling, floating, storiesUncovered, checked }`. `checked: false` when `tasks.md` cites no ID of the spec. |
| FR-001 to FR-004, FR-006, FR-007 | `validateSpecKitIntegration` (`cli/scanners/speckit.mjs`), after the per-artifact quality checks: for each feature with `spec.md` and `tasks.md` that is not archived (`.docguard-archive.json`) and has no terminal status (`parseLifecycleStatus`), call `chainCoverage` and emit SPK013 to SPK016 with the caps and an elision note. A feature with `checked: false` adds one sentence to a `chainUnchecked` count, reported in the result's applicability reason only when every checked feature is otherwise clean. |
| FR-006, FR-008 | `cli/findings.mjs`: SPK013 to SPK016 with `defaultLevel: 'info'`; `npm run docs:reference`; TEST-SPEC row; CHANGELOG. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `tests/upstream-coverage.test.mjs`. It covers unit cases for `chainCoverage` (IDs, ranges, sub-IDs, fences, comments, qualified IDs, stories) and validator cases on fixture features (uncovered, dangling, floating plan and tasks, unchecked, archived, caps).
**Constraints**: `info` default level, so no exit code changes. Precision is measured by hand on this repository's 80 specs (SC-002).

## Research decisions

- **What exists.** `collectRequirementIdsFromContent` (`cli/shared-requirements.mjs`) finds requirement IDs in canonical docs for TRC004. It reads definitions, not citations, and treats a whole doc as one namespace. Chain coverage needs both sides per feature, so the scanner reuses its ID pattern and adds citation parsing.
- **Why plan citations count as coverage.** Plans in this repository map every FR in a table, and Spec Kit's plan template exists to decide how each requirement is met. Counting only `tasks.md` would flag requirements a plan deliberately satisfies through an existing mechanism.
- **Why `info`.** This is the first DocGuard rule to ship through spec 083's ladder. `docguard policy` will show when it is quiet enough on a project to promote.
- **Rejected:** counting checklist items (they are review prompts); parsing implementation evidence (spec 021 and 070 already do this).

## Project Structure

```text
cli/scanners/chain-coverage.mjs     FR-001 to FR-005 (new)
cli/scanners/speckit.mjs            FR-001 to FR-004, FR-007
cli/findings.mjs, docs/reference/findings.md, docs-canonical/TEST-SPEC.md, CHANGELOG.md  FR-006, FR-008
tests/upstream-coverage.test.mjs
```

## Risks

- **Precision on older specs** whose tasks name requirements only by prose. The `checked: false` rule covers task lists with no IDs at all. A partially-ID'd list is reported and reviewed under SC-002.
- **Runtime**: three small files per feature. 80 features read in well under 50 ms.

## Verification

`npm test`, `guard`, `npm run budget`; SC-002 review on this repository; hermetic A/B on every local project (SC-003).
