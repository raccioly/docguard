# Feature Specification: Fix v0.11.0 False Positives & Add CDK-Aware Documentation

**Feature Branch**: `003-v011-false-positives`
**Created**: 2026-05-25
**Status**: Draft
**Input**: DocGuard v0.11.0 — Field feedback from running on an enterprise client project (enterprise monorepo, score 98/100, 40 warnings). Five false positives confirmed in code, one originally-suspected FP rescinded after deeper review (CDK structure IS a real doc gap, not noise).

## Context

DocGuard v0.11.0 ran cleanly on a real enterprise enterprise client project project. The N/A state, section markers, API-Surface validator, and "only modify generated docs" behavior all worked as designed. Five false positives were surfaced. Acting on user input, a sixth originally-suspected FP (`bin/` flagged as undocumented) was reclassified as a legitimate finding: CDK projects DO need their `bin/` and `lib/` documented. Therefore this spec covers FP-1..FP-4 (real bugs) and replaces FP-5 with CDK-aware documentation support.

## User Scenarios & Testing

### User Story 1 — Frontend API Client Not Misclassified as Backend Route (Priority: P1)

As a developer of a monorepo with a frontend SPA (`src/api/` axios client) and a backend Express service (`backend/src/routes/`), `docguard guard` MUST classify each correctly. A frontend HTTP client that calls the API is not a route definition and must not be flagged as "no matching path in openapi.yaml".

**Why this priority**: Produces the loudest noise on every SPA-with-backend monorepo. Misclassification undermines trust in the API-Surface validator that v0.11.0 introduced.

**Independent Test**: Project with `src/api/client.ts` (frontend axios) and `backend/src/routes/userRoutes.ts` (Express). After fix, only `userRoutes.ts` appears in the route loop; `client.ts` is not in warnings.

**Acceptance Scenarios**:

1. **Given** `src/api/agentStatus.ts` is a frontend axios module, **When** `docguard guard` runs, **Then** it is NOT flagged as "Route file ... no matching paths found in openapi.yaml"
2. **Given** `src/app/api/users/route.ts` is a Next.js App Router route file, **When** `docguard guard` runs, **Then** it IS scanned for OpenAPI cross-check (filename-strict matching)
3. **Given** `src/app/api/utils/helpers.ts` is a Next.js helper inside the App Router tree (not a route file), **When** `docguard guard` runs, **Then** it is NOT flagged
4. **Given** `backend/src/routes/userRoutes.ts` exists, **When** `docguard guard` runs, **Then** it IS scanned (Express convention preserved)

---

### User Story 2 — Test Files Are Not Treated As Services Or Routes (Priority: P1)

A developer runs `docguard guard` on a project with co-located tests (`backend/src/services/__tests__/foo.test.ts` and `backend/src/routes/__tests__/userRoutes.test.ts`). DocGuard MUST not flag those test files as "Service not referenced in any canonical doc" or as Route files missing OpenAPI mappings — tests are the coverage of the service, not the service itself.

**Why this priority**: Generates ~7+ warnings per project on every monorepo with co-located tests (Jest/Vitest standard convention). Combined with FP-1, accounts for the bulk of v0.11.0 noise.

**Independent Test**: Project with `backend/src/services/__tests__/dataExportService.test.ts`. After fix, the file is NOT in the docs-sync warnings list.

**Acceptance Scenarios**:

1. **Given** a file path matches `/(^|\/)__tests__\//`, **When** the docs-sync route or service loop iterates it, **Then** it is skipped (not counted in `total`, not added to `warnings`)
2. **Given** a filename matches `/\.(test|spec)\.(ts|tsx|js|jsx|mjs|py|java|go)$/`, **When** the docs-sync route or service loop iterates it, **Then** it is skipped
3. **Given** a non-test file at `backend/src/services/userService.ts`, **When** the same loop runs, **Then** it is still checked normally

---

### User Story 3 — Build Output Is Not Treated As Source (Priority: P2)

A developer runs `docguard guard` on a CDK monorepo. DocGuard MUST NOT flag `packages/cdk/cdk.out/` (CDK synth output, generated CloudFormation) as an undocumented source directory. The same applies to `out/` (Next.js export), `.nuxt/`, and any other framework synth/build outputs.

Additionally: `.docguard.json`'s `ignore` array MUST be honored by Docs-Coverage's source-directory scan, not just by some validators.

**Why this priority**: Every CDK project hits the `cdk.out/` warning. Inconsistent ignore-honoring across validators erodes confidence.

**Independent Test**: Project with `packages/cdk/cdk.out/` directory and `.docguard.json` containing `ignore: ["**/cdk.out/**"]`. After fix, no warning about `cdk.out` from Docs-Coverage.

**Acceptance Scenarios**:

1. **Given** a directory named `cdk.out`, `out`, `.nuxt`, or `.claude` exists under any source root, **When** Docs-Coverage source-dir scan runs, **Then** it is skipped
2. **Given** `.docguard.json` has `ignore: ["**/cdk.out/**"]`, **When** Docs-Coverage source-dir scan runs, **Then** ANY path matched by the ignore glob is skipped — even if the directory name isn't in the hardcoded set
3. **Given** a legitimate `out/` directory the user wants documented (rare), **When** they remove it from ignore and explicitly mention it in ARCHITECTURE.md, **Then** the warning does not appear

---

### User Story 4 — Worktree Copies Are Not Double-Counted (Priority: P2)

A developer using Claude Code (parallel-agent worktrees under `.claude/worktrees/<branch>/`), git worktrees under `.git/worktrees/`, or Jujutsu under `.jj/` runs `docguard guard`. DocGuard MUST NOT scan worktree copies as if they were sibling source — the same file appearing in two trees would produce duplicate findings and inflate test-file counts.

**Why this priority**: Every Claude-using project hits this. Per-project `.docguardignore` is a workaround but won't survive across the user base; defaults must protect them.

**Independent Test**: Project where `.claude/worktrees/feature-x/src/services/foo.ts` exists alongside `src/services/foo.ts`. After fix, the worktree copy is not scanned.

**Acceptance Scenarios**:

1. **Given** `globMatch(relPath, patterns)` from `cli/shared-ignore.mjs` evaluates a relative path containing `.claude/worktrees/`, `.git/worktrees/`, or `.jj/`, **When** the path also matches an otherwise-valid pattern, **Then** `globMatch` returns `false` (same protection as `node_modules`)
2. **Given** validators walk a directory tree, **When** they hit a top-level entry named `.claude`, `.git`, or `.jj`, **Then** they skip it (existing `startsWith('.')` behavior is preserved)
3. **Given** a project has no worktree directories, **When** validators run, **Then** behavior is unchanged

---

### User Story 5 — CDK Projects Get One Actionable Doc Reminder Instead Of Many (Priority: P2)

A developer's monorepo contains `packages/cdk/cdk.json`, `packages/cdk/bin/app.ts`, `packages/cdk/lib/stacks/`, and `packages/cdk/lib/constructs/`. ARCHITECTURE.md does not mention infrastructure. DocGuard MUST detect the CDK setup and emit ONE specific actionable warning naming the CDK location, instead of multiple generic per-directory warnings. Templates SHOULD also include an `Infrastructure (CDK / IaC)` section so newly-initialized projects start with the right shape.

**Why this priority**: Replaces what was originally proposed as a suppression (skip `bin/` when `cdk.json` exists). The right answer is to surface the gap clearly, not hide it. Improves signal without losing the finding.

**Independent Test**: Project with `packages/cdk/cdk.json` and no `Infrastructure` heading in ARCHITECTURE.md. After fix, ONE warning: "CDK detected at packages/cdk/cdk.json — add an Infrastructure section to ARCHITECTURE.md covering bin/, lib/stacks/, lib/constructs/". The per-dir warnings for `bin/`, `lib/`, `lib/stacks/`, `lib/constructs/` are suppressed in favor of this one consolidated message.

**Acceptance Scenarios**:

1. **Given** any `cdk.json` exists anywhere in the project tree, **When** docs-coverage runs, **Then** the CDK detector flags the project as CDK-using
2. **Given** the project is CDK-using AND ARCHITECTURE.md contains no heading matching `/infrastructure|cdk|iac/i`, **When** docs-coverage runs, **Then** exactly ONE consolidated warning is emitted naming the cdk.json location and required content
3. **Given** the project is CDK-using AND ARCHITECTURE.md has an Infrastructure heading mentioning `bin/` and `lib/`, **When** docs-coverage runs, **Then** no CDK warning is emitted
4. **Given** the project is CDK-using, **When** the per-directory source-dir scan would otherwise emit warnings for `bin/`, `lib/`, `lib/stacks/`, or `lib/constructs/` inside the CDK package, **Then** those generic warnings are suppressed in favor of the consolidated CDK warning
5. **Given** `templates/ARCHITECTURE.md.template`, **When** a new project runs `docguard init`, **Then** the template contains an `## Infrastructure (CDK / IaC)` section with placeholder bullets

---

### User Story 6 — Docs-Coverage Check 1 Honors `config.ignore` (Priority: P2)

After v0.11.1 shipped, a follow-up audit reproduced a related FP-3 case the original fix missed. A user adds `.local` to `.docguard.json` `ignore`. The source-directory scan correctly suppresses any dir warning, but Check 1 (the config-file scan) still emits `Config file ".local" exists but is not mentioned in any documentation`. Both Docs-Coverage scans MUST consult `config.ignore` consistently.

**Why this priority**: The originally-reported FP-3 had two halves. Only the source-dir half was fixed in v0.11.1's first round; the config-file half remained, producing the same class of noise.

**Independent Test**: Project with `.local` file at root and `.docguard.json` containing `ignore: [".local"]`. After fix, no warning about `.local` from Check 1.

**Acceptance Scenarios**:

1. **Given** a project has a dotfile `.local`, **When** `.docguard.json` contains `ignore: [".local"]`, **Then** Check 1 does not emit a "Config file" warning for it
2. **Given** the same project without the ignore entry, **When** Check 1 runs, **Then** the warning DOES fire (baseline confirmed)
3. **Given** the ignore entry, **When** any other validator runs, **Then** behavior is unchanged (config.ignore was already honored elsewhere)

---

### User Story 7 — Test-Spec Parses Multi-Path Journey Rows (Priority: P1)

A TEST-SPEC.md Critical User Journey row commonly lists multiple test files in one cell:

```md
| 2 | Receive WhatsApp message | `path/a.test.ts`, `path/b.test.ts` | ✅ |
```

The v0.11.0 validator stripped ALL backticks then called `existsSync()` on the resulting comma-joined string, producing a 100% false-positive rate on multi-path rows. It also failed for glob references like `idor_*.test.ts (3 suites)` (Journey #8 of an enterprise client project).

**Why this priority**: 100% FP rate on a common documentation pattern is high-noise. Every enterprise project with E2E Journey coverage tables hits this.

**Independent Test**: TEST-SPEC.md with one Journey row referencing two backtick-quoted comma-separated test files that both exist on disk. After fix, the row passes with zero warnings.

**Acceptance Scenarios**:

1. **Given** a Journey row cell `` `a.test.ts`, `b.test.ts` `` and both files exist, **When** Test-Spec runs, **Then** the row counts as 1 passed check with zero warnings
2. **Given** the same row but only one file exists, **When** Test-Spec runs, **Then** the row passes (at-least-one semantic — matches the author's intent for "covered by either")
3. **Given** a Journey row cell `` `foo_*.test.ts` `` expanding to ≥1 existing file, **When** Test-Spec runs, **Then** the row passes via glob expansion
4. **Given** a Journey row cell `` `legacy/old.test.ts (2 suites)` `` where the literal path is missing but the annotation is present, **When** Test-Spec runs, **Then** the row passes (trust the author's explicit coverage claim)
5. **Given** a row whose paths do not exist AND has no `(N suites)` annotation, **When** Test-Spec runs, **Then** the warning lists ALL paths attempted

### Edge Cases

- What if `cdk.json` exists but `bin/` and `lib/` do not? → Still detected as CDK; warning still fires (user is mid-setup; document intent)
- What if a project has its own `bin/` unrelated to CDK (e.g., CLI tool)? → No sibling `cdk.json`, CDK detector inactive, generic per-dir warning applies (unchanged)
- What if multiple `cdk.json` files exist (multi-package monorepo)? → Detector emits ONE warning naming the first match; further packages contribute paths to the same message
- What if the user adds the Infrastructure section but doesn't mention `bin/`? → Pass (heading presence is the signal; granular check is out of scope)
- What if `.docguard.json` has `ignore: ["**/cdk.out/**"]` but a validator's hardcoded IGNORE_DIRS already excludes `cdk.out`? → Both apply; ignore is a no-op there but no error
- What if `.claude/worktrees/` contains a `package.json` (it always does — workspace copy)? → `getWorkspaceDirs` does not enter `.claude/` (top-level dotfile guard), so worktree packages are not added as workspace roots

## Requirements

### Functional Requirements

- **FR-001**: docs-sync MUST drop the bare `'api'` entry from its route-dir convention list. Backend route conventions remain `src/routes`, `routes`. Next.js App Router conventions remain `src/app/api`, `app/api`.
- **FR-002**: For Next.js App Router directories (`src/app/api`, `app/api`), docs-sync MUST only count files whose basename matches `route.{ts,tsx,js,jsx,mjs}` (Next.js convention) as route files. Helper files in the tree are ignored.
- **FR-003**: docs-sync route and service loops MUST skip files whose relative path matches `/(^|\/)__tests__\//` OR whose filename matches `/\.(test|spec)\.(ts|tsx|js|jsx|mjs|py|java|go)$/`. Skipped files do not contribute to `total` or `warnings`.
- **FR-004**: docs-sync's internal `IGNORE_DIRS` set MUST include `__tests__` and `__test__` to prevent descending into test directories at all.
- **FR-005**: docs-coverage's `IGNORE_DIRS` set MUST include `cdk.out`, `out`, `.nuxt`, `.claude` in addition to the existing entries.
- **FR-006**: docs-coverage's `checkSourceDirs` MUST honor `config.ignore` patterns via `shouldIgnore(relPath, config)` before flagging a directory.
- **FR-007**: `globMatch` in `cli/shared-ignore.mjs` MUST reject paths containing `.claude/worktrees/`, `.git/worktrees/`, or `.jj/` at any depth — same treatment as `node_modules`.
- **FR-008**: A shared `DEFAULT_IGNORE_DIRS` constant MUST be exported from `cli/shared-ignore.mjs` containing the union of common ignore patterns. Validators that need to extend it MAY but MUST start from this shared base. Existing per-validator `IGNORE_DIRS` constants are NOT required to migrate in this spec (deferred — see Out of Scope), but the constant MUST exist so future validators have a single source of truth.
- **FR-009**: A CDK detector MUST identify a project as CDK-using when any `cdk.json` file exists in the project tree below `projectDir` (excluding `node_modules`, `.git`, etc.). The detector returns the relative path(s) of detected `cdk.json` file(s).
- **FR-010**: docs-coverage MUST emit a single consolidated warning when (a) CDK is detected AND (b) `docs-canonical/ARCHITECTURE.md` contains no heading matching `/^#+\s+(infrastructure|cdk|iac)/im`. The warning text MUST name the cdk.json location and the required content (`bin/`, `lib/stacks/`, `lib/constructs/`).
- **FR-011**: When the CDK consolidated warning fires, the generic per-directory warnings ("Source directory `packages/cdk/bin/` is not referenced in ARCHITECTURE.md", and the same for `lib`, `lib/stacks`, `lib/constructs`) MUST be suppressed for paths inside the CDK package(s).
- **FR-012**: `templates/ARCHITECTURE.md.template` MUST include an `## Infrastructure (CDK / IaC)` section with placeholder bullets for app entrypoint, stacks, constructs, and a note about `cdk.json` / `cdk.context.json`. The section MUST be clearly skippable for non-CDK projects (header comment).
- **FR-013**: Zero new NPM dependencies — pure Node.js built-ins only.
- **FR-014**: All existing tests in `tests/` MUST continue to pass. New tests MUST be added covering each FR.
- **FR-015**: docs-coverage Check 1 (`checkConfigFiles`) MUST honor `config.ignore` patterns via `shouldIgnore(entry, config) || shouldIgnore(entry + '/', config)` before flagging a dotfile/config entry. Closes the second half of the originally-reported FP-3 (audit confirmed `.local` ignored at config level but still flagged by Check 1).
- **FR-016**: Test-Spec MUST parse Journey row cells containing multiple comma-separated backtick-quoted paths (e.g. `` `a.test.ts`, `b.test.ts` ``). For each segment: strip backticks, trim, evaluate independently. The row passes if ANY referenced path has evidence on disk: literal `existsSync`, glob expansion (single-segment `*`/`?`/`[…]`), or a `(N suites)` / `(N tests)` annotation matching `/\s*\(\d+\s+(suites?|tests?)\)\s*$/i`.

### Out of Scope (deferred to future specs)

- Migrating all 17 modules that define their own `IGNORE_DIRS` constant (validators, scanners, shared) to import `DEFAULT_IGNORE_DIRS` from shared-ignore.mjs (mechanical, large diff; track separately)
- IR-1 (`--diff-only` flag), IR-2 (per-validator severity), IR-3 (draft-staleness warning), IR-4 (`sync --section`), IR-6 (`.docguardignore` template at init), IR-7 (extended Next.js detection), IR-8 (`routesGlob` / `servicesGlob` config overrides). All to be folded into a v0.12 feature spec.
- `generate.mjs` auto-populating the Infrastructure section with real bin/ and lib/ filenames. Templates only for this spec; auto-fill is a separate effort.

### Key Entities

- **DEFAULT_IGNORE_DIRS**: A new exported constant in `cli/shared-ignore.mjs` containing the canonical list of directory names that should never be scanned (build outputs, VCS dirs, worktree dirs, package caches).
- **CDKDetection**: `{ isCDK: boolean, cdkJsonPaths: string[] }` returned by the new detector. Lives in `cli/scanners/cdk.mjs` (new file) or extends `cli/scanners/project-type.mjs`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Running `docguard guard` on a project with `src/api/client.ts` + `backend/src/routes/userRoutes.ts` produces zero "Route file" warnings for the frontend client and one (correct) warning for the backend route if the OpenAPI mapping is missing.
- **SC-002**: Running `docguard guard` on a project with co-located `__tests__/` directories produces zero "Service not referenced" or "Route file" warnings for the test files (currently ~7 per WhatsApp project).
- **SC-003**: Running `docguard guard` on a CDK monorepo with `packages/cdk/cdk.out/` produces zero warnings naming `cdk.out/` from Docs-Coverage.
- **SC-004**: Running `docguard guard` on a Claude-using project with `.claude/worktrees/<branch>/...` produces results identical to running on the same project without worktree copies (no double-counting).
- **SC-005**: Running `docguard guard` on a CDK project with no Infrastructure section in ARCHITECTURE.md produces exactly ONE CDK-specific warning, not 3-4 generic per-directory warnings.
- **SC-006**: All existing tests in `tests/` continue to pass (`npm test` — currently 40+ test files, all green).
- **SC-007**: New tests added: at least one regression test per FP and one per CDK acceptance scenario (1 + 1 + 1 + 1 + 5 = 9 minimum new tests).
- **SC-008**: On the an enterprise client project project (the source of this feedback), re-running `docguard guard` after these fixes drops warnings from 40 to ≤15 (the genuine drift findings the user already acknowledged: 4 missing services, 7 stale test paths, env vars, freshness).
- **SC-009**: `.local` (and any other user-named dotfile) added to `.docguard.json` `ignore` is suppressed by Check 1 — verified by regression test in `tests/docs-coverage.test.mjs`.
- **SC-010**: A TEST-SPEC.md Journey row with two comma-separated backtick paths whose files exist produces 1 passed check, 0 warnings. Glob patterns with `*` and `(N suites)` annotations are recognized. Verified by regression tests in `tests/test-spec.test.mjs`.
