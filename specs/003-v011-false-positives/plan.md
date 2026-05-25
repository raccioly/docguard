# Implementation Plan: Fix v0.11.0 False Positives & Add CDK-Aware Documentation

**Branch**: `003-v011-false-positives` | **Date**: 2026-05-25 | **Spec**: `specs/003-v011-false-positives/spec.md`
**Input**: Field feedback from running DocGuard v0.11.0 on the wu-whatsappinbox enterprise monorepo (98/100, 40 warnings, 5 confirmed false positives + 1 reclassified after user review).

## Summary

DocGuard v0.11.0 surfaced four false positives and one mis-suppressed real finding. This plan eliminates the FPs (drop bare `'api'` route convention, exclude test files from docs-sync, add cdk.out/out/.nuxt/.claude to IGNORE_DIRS, reject worktree paths in `globMatch`) and replaces the originally-proposed `bin/` suppression with a CDK detector that emits ONE consolidated actionable warning when ARCHITECTURE.md lacks an Infrastructure heading. Five surgical changes across three production files plus one new scanner module and one template edit.

## Technical Context

**Language/Version**: JavaScript (ES Modules), Node.js ≥ 18
**Primary Dependencies**: None (zero-dependency project)
**Storage**: N/A (file-system scanning only)
**Testing**: `node:test` + `node:assert` (built-in)
**Target Platform**: Cross-platform CLI (macOS/Linux/Windows)
**Project Type**: CLI tool — single Node.js package
**Performance Goals**: Guard run completes in <2s on a 5k-file monorepo (current p95: ~11s for the full test suite of 317 tests; per-file scan is sub-millisecond)
**Constraints**: Zero NPM dependencies, no schema changes, no breaking changes to existing config keys, no regressions in the 306 existing tests
**Scale/Scope**: 4 production files modified, 1 new scanner, 1 template, 3 test files; ~450 lines added, ~10 removed

## Constitution Check

*GATE: Must pass before implementation. Re-checked after design.*

Per the project Constitution (`.specify/memory/constitution.md`):
- ✅ **Principle I (Real-World Validation)**: Driven by actual field feedback, not theoretical concerns
- ✅ **Principle II (Zero Dependencies)**: No new NPM dependencies
- ✅ **Principle III (Composition)**: New scanner `cdk.mjs` is a pure function; the validator integrates it without coupling
- ✅ **Principle IV (Shared Infrastructure)**: Introduces `DEFAULT_IGNORE_DIRS` shared constant; existing per-validator copies left in place (deferred migration acknowledged)
- ✅ **Principle V (No Suppression of Real Findings)**: FP-5 explicitly rescinded after user review — CDK structure IS real source, gets consolidated actionable warning instead of generic per-dir noise

## Architectural Overview

Five changes in three production files, plus one new scanner module, one template edit, and one new test file. No schema or dependency changes.

### Files touched

| File | Change | LOC est. |
|---|---|---|
| `cli/shared-ignore.mjs` | Add `DEFAULT_IGNORE_DIRS` export; extend `globMatch` worktree rejection | +20 |
| `cli/validators/docs-sync.mjs` | Drop `'api'` from route convention; strict `route.*` matching for Next.js; test-file exclusion | +40, -5 |
| `cli/validators/docs-coverage.mjs` | Extend IGNORE_DIRS; honor `config.ignore`; integrate CDK detector + consolidated warning | +60, -3 |
| `cli/scanners/cdk.mjs` (new) | CDK detection scanner (`detectCDK(projectDir)`) | +50 |
| `templates/ARCHITECTURE.md.template` | Add `## Infrastructure (CDK / IaC)` section | +25 |
| `tests/docs-sync.test.mjs` | Regression tests for FP-1, FP-2 | +60 |
| `tests/docs-coverage.test.mjs` | Regression tests for FP-3, FP-4, FP-5 (CDK) | +120 |
| `tests/cdk-detection.test.mjs` (new) | Unit tests for the new scanner | +50 |
| `CHANGELOG.md` | v0.11.1 entry | +20 |

**Total: ~450 lines added, ~10 removed. 4 production files + 1 new file + 1 template + 3 test files.**

## Design Decisions

### D-001: `DEFAULT_IGNORE_DIRS` is additive, not migratory
Existing per-validator `IGNORE_DIRS` constants stay. The shared constant is exported and ready for use, but a sweep to replace all 17 copies of the `IGNORE_DIRS` declaration (across validator modules, scanner modules, and shared helpers) is out of scope (mechanical, large diff, separate spec). The validator modules we touch in this spec WILL use the shared constant.

### D-002: `globMatch` rejection is path-substring, not glob
`node_modules` rejection uses a regex: `/(?:^|[/\\])node_modules(?:[/\\]|$)/`. Same approach for the worktree paths — they're directory-name patterns at any depth, not user-configurable globs.

### D-003: CDK detector returns paths, not boolean
`detectCDK(projectDir)` returns `{ isCDK: boolean, cdkJsonPaths: string[] }`. The consolidated warning uses the first path. Future enhancements (per-package warnings) get the full list without re-scanning.

### D-004: Heading detection is regex-on-content
`ARCHITECTURE.md` is checked with `/^#+\s+(infrastructure|cdk|iac)/im`. Case-insensitive, multiline, matches any heading level. No markdown AST parse needed (would add a dep).

### D-005: Per-dir warning suppression is path-prefix
When CDK warning fires, we suppress per-dir warnings whose path begins with any of `cdkJsonPaths` (after stripping `cdk.json` from the path). Simple, deterministic, no false suppression for non-CDK `bin/` dirs.

### D-006: Next.js App Router strict matching
Inside `src/app/api/` or `app/api/`, only `route.{ts,tsx,js,jsx,mjs}` filenames count as routes. This is the Next.js convention since v13. Other files (helpers, types) in the tree are intentionally skipped.

### D-007: No `bin/` suppression heuristic
Originally proposed: skip `bin/` when `cdk.json` is a sibling. Rescinded after user review — CDK `bin/app.ts` IS the project's IaC entrypoint and must be documented. The CDK detector replaces this with a consolidated actionable warning.

## Order of Operations

1. **shared-ignore.mjs** first — `DEFAULT_IGNORE_DIRS` export and `globMatch` worktree rejection. Foundation for the rest.
2. **scanners/cdk.mjs** (new) — pure read-only scanner, no behavioral coupling. Unit-testable in isolation.
3. **docs-sync.mjs** — FP-1 and FP-2. Independent of CDK work.
4. **docs-coverage.mjs** — FP-3, FP-4 (path-side), FP-5 (CDK integration). Depends on (1) and (2).
5. **templates/ARCHITECTURE.md.template** — independent edit, runs anytime.
6. **Tests** for all of the above.
7. **CHANGELOG.md** entry last, naming the released version (`0.11.1`).

## Risks

- **MEDIUM-HIGH**: Touching shared infrastructure (`shared-ignore.mjs`) ripples to any future use, but no existing validator imports `globMatch` for non-test-file purposes — verified via grep. The `DEFAULT_IGNORE_DIRS` export is additive.
- **MEDIUM**: CDK detector recursion. Scanning the tree for `cdk.json` MUST honor `node_modules` exclusion or it will be slow. Reuse `DEFAULT_IGNORE_DIRS`.
- **LOW**: Template change. Markdown only, no logic.
- **LOW**: False suppression risk in D-005. Only triggers when CDK is detected; suppression is path-scoped to the CDK package directory.

## Open Questions

None — all decisions resolved in user dialog.

## Rollback

Each change is a self-contained commit. Revert order: tests → template → docs-coverage → docs-sync → cdk.mjs → shared-ignore.mjs. CHANGELOG entry stays since it's documentation of intent even if implementation reverted.

## Project Structure

### Documentation (this feature)

```text
specs/003-v011-false-positives/
├── spec.md       # Feature spec (user stories, FRs, acceptance criteria)
├── plan.md       # This file (architectural plan, design decisions, risks)
└── tasks.md      # Phased task breakdown with T### IDs
```

### Source Code (affected paths in this single-project repository)

```text
cli/
├── shared-ignore.mjs           # DEFAULT_IGNORE_DIRS export, globMatch worktree rejection (modified)
├── shared-source.mjs           # IGNORE_DIRS additions (modified)
├── scanners/
│   └── cdk.mjs                 # NEW — detectCDK() + hasInfrastructureHeading()
└── validators/
    ├── docs-sync.mjs           # FP-1 + FP-2 (modified)
    └── docs-coverage.mjs       # FP-3 + FP-5 CDK integration + Check 1 dir-skip (modified)

templates/
└── ARCHITECTURE.md.template    # Infrastructure (CDK / IaC) section (modified)

tests/
├── docs-sync.test.mjs          # +5 regression tests for FP-1, FP-2 (modified)
├── docs-coverage.test.mjs      # +5 regression tests for FP-3, FP-5 (modified)
└── cdk-detection.test.mjs      # NEW — CDK detector + globMatch worktree tests

CHANGELOG.md                    # [0.11.1] entry (modified)
```

**Structure Decision**: Single-project layout (Node.js CLI). All changes land in `cli/` and `tests/` with one template edit. No new top-level directories.

## Complexity Tracking

> Constitution Check passed — no violations to justify.

