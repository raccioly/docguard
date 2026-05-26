---
description: "Task breakdown for v0.11.1 false-positive fixes and CDK-aware documentation"
---

# Tasks: Fix v0.11.0 False Positives & Add CDK-Aware Documentation

**Input**: Design documents from `specs/003-v011-false-positives/`
**Prerequisites**: spec.md (required), plan.md (required)

**Tests**: Required — every FP fix needs at least one regression test, and the new CDK detector has full unit coverage. Spec mandates this in SC-006 and SC-007.

**Organization**: Tasks are grouped by phase (Setup → Foundation → User Stories → Polish). Within each phase, `[P]` marks tasks that can run in parallel (different files, no dependencies).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1..US5, or N/A for shared infrastructure)

## Path Conventions

Single-project layout. All paths relative to repository root. `cli/` holds production code, `tests/` holds unit tests, `templates/` holds doc skeletons.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Foundation that every downstream task depends on.

- [x] **T001** [N/A] Extend `cli/shared-ignore.mjs`: export new `DEFAULT_IGNORE_DIRS` Set; extend `globMatch()` to reject paths under `.claude/worktrees/`, `.git/worktrees/`, `.jj/` at any depth (same treatment as `node_modules`). Satisfies FR-007, FR-008.

- [x] **T002** [N/A] Update `cli/shared-source.mjs` IGNORE_DIRS to add `.nuxt`, `out`, `cdk.out` (defense-in-depth alongside T001 globMatch fix). Satisfies FR-007 cross-validation.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: CDK detector module — required by docs-coverage Check 6 and the spec 003 US5 acceptance scenarios.

- [x] **T003** [US5] Create `cli/scanners/cdk.mjs` exporting `detectCDK(projectDir)` → `{ isCDK, cdkJsonPaths, cdkPackageDirs }` and `hasInfrastructureHeading(content)`. Tree walk uses `DEFAULT_IGNORE_DIRS`; max depth 6. Satisfies FR-009.

---

## Phase 3: User Story 1 — Frontend API Client Not Misclassified (P1)

**Goal**: `src/api/client.ts` not flagged as backend route.

- [x] **T004** [US1] Modify `cli/validators/docs-sync.mjs`: drop bare `'api'` from both `expandDirs` calls (line 56 and the OpenAPI cross-check loop). Add `isValidRouteFile()` helper that, for `src/app/api`/`app/api`, only accepts `route.{ts,tsx,js,jsx,mjs}` filenames. Apply filter in both loops. Satisfies FR-001, FR-002.

- [x] **T005** [US1] [P] Add regression tests in `tests/docs-sync.test.mjs`: (a) `src/api/client.ts` not in warnings, (b) `src/app/api/users/route.ts` checked but `src/app/api/users/helpers.ts` skipped. Satisfies SC-001.

---

## Phase 4: User Story 2 — Test Files Not Treated as Services/Routes (P1)

**Goal**: `__tests__/foo.test.ts` and co-located `*.test.ts` files skipped.

- [x] **T006** [US2] Modify `cli/validators/docs-sync.mjs`: add `__tests__` and `__test__` to the file-local IGNORE_DIRS. Add `isTestFile()` helper matching `/(^|\/)__tests?__\//` and `/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|java|go)$/`. Filter route and service loops + the OpenAPI cross-check loop. Skipped files do NOT increment `total` or `warnings`. Satisfies FR-003, FR-004.

- [x] **T007** [US2] [P] Add regression tests in `tests/docs-sync.test.mjs`: (a) `__tests__/foo.test.ts` in service dir, (b) flat `auth.test.ts` and `auth.spec.ts`, (c) `__tests__/userRoutes.test.ts` in route dir with OpenAPI cross-check, (d) non-test orphan service still flagged. Satisfies SC-002.

---

## Phase 5: User Story 3 — Build Outputs and config.ignore (P2)

**Goal**: `cdk.out/`, `out/`, `.nuxt/` ignored; `config.ignore` honored everywhere.

- [x] **T008** [US3] Modify `cli/validators/docs-coverage.mjs`: extend IGNORE_DIRS to include `cdk.out`, `out`, `.nuxt`, `.claude`. Import `shouldIgnore` from `../shared-ignore.mjs`. In `checkSourceDirs`, call `shouldIgnore(relPath, config) || shouldIgnore(relPath + '/', config)` before flagging — the trailing-slash variant catches `**/x/**`-style patterns that match files INSIDE the dir. Satisfies FR-005, FR-006.

- [x] **T009** [US3] [P] Add regression tests in `tests/docs-coverage.test.mjs`: (a) `cdk.out/` not in warnings, (b) `.nuxt/` not in warnings, (c) `config.ignore: ['**/custom-build-output/**']` suppresses the corresponding dir warning. Satisfies SC-003.

---

## Phase 6: User Story 4 — Worktree Copies Not Double-Counted (P2)

**Goal**: `.claude/worktrees/`, `.git/worktrees/`, `.jj/` ignored at any depth.

- [x] **T010** [US4] Verified by T001 (`globMatch` worktree rejection) plus existing `entry.startsWith('.')` guards in tree walkers — no additional code changes required. Defense-in-depth in T002. Satisfies FR-007.

- [x] **T011** [US4] [P] Add `globMatch` worktree-rejection tests in `tests/cdk-detection.test.mjs`: paths under `.claude/worktrees/`, `.git/worktrees/`, `.jj/` rejected; node_modules regression still works; normal paths accepted. Satisfies SC-004.

---

## Phase 7: User Story 5 — CDK-Aware Documentation (P2)

**Goal**: ONE consolidated actionable warning when CDK detected and no Infrastructure heading.

- [x] **T012** [US5] Modify `cli/validators/docs-coverage.mjs`: import `detectCDK` and `hasInfrastructureHeading` from `../scanners/cdk.mjs`. Call `detectCDK(projectDir)` once in `validateDocsCoverage`; pass result to `checkSourceDirs`. New `checkCDKDocumentation` function as Check 6 — emits one warning naming the cdk.json path + required content when Infrastructure heading is missing. In `checkSourceDirs`, suppress per-dir warnings for `bin`, `lib`, `stacks`, `constructs` inside any CDK package directory when the Infrastructure heading is absent. Satisfies FR-010, FR-011.

- [x] **T013** [US5] [P] Update `templates/ARCHITECTURE.md.template`: add `## Infrastructure (CDK / IaC)` section with placeholder bullets for app entrypoint, stacks, constructs, cdk.json, cdk.out, and a Deployment Pipeline subsection. Explicit "Skip this section if the project does not use…" comment. Satisfies FR-012.

- [x] **T014** [US5] [P] Add CDK detector unit tests in `tests/cdk-detection.test.mjs`: (a) detects packages/cdk/cdk.json, (b) detects root cdk.json, (c) returns isCDK=false when absent, (d) ignores cdk.json inside node_modules/.git/cdk.out, (e) finds multi-package CDK setups, (f) `hasInfrastructureHeading` matches Infrastructure/CDK/IaC at any heading level, case-insensitive, headings only (not body text). Satisfies SC-007.

- [x] **T015** [US5] [P] Add docs-coverage CDK-integration tests in `tests/docs-coverage.test.mjs`: (a) emits exactly one consolidated CDK warning when missing, (b) silent when Infrastructure heading present, (c) suppresses per-dir warnings for `bin/`/`lib/` inside the CDK package (uses workspaces fixture), (d) detector inactive on non-CDK project with regular `bin/` (warning preserved). Satisfies SC-005.

---

---

## Phase 7.5: User Story 6 — Check 1 honors `config.ignore` (P2)

**Goal**: Close the second half of FP-3 — `config.ignore` honored consistently across both Docs-Coverage scans.

- [x] **T021** [US6] Modify `cli/validators/docs-coverage.mjs` `checkConfigFiles` (Check 1) to accept and consult `config`, calling `shouldIgnore(entry, config) || shouldIgnore(entry + '/', config)` after the dotfile/COMMON_DOTFILES filters but before the directory-skip step. Same dual-form pattern as `checkSourceDirs`. Satisfies FR-015.

- [x] **T022** [US6] [P] Add regression test in `tests/docs-coverage.test.mjs`: project with `.local` file at root, baseline emits warning, `config.ignore: ['.local']` suppresses it. Satisfies SC-009.

---

## Phase 7.6: User Story 7 — Test-Spec multi-path parsing (P1)

**Goal**: Journey rows with multiple comma-separated paths, globs, and `(N suites)` annotations are correctly evaluated.

- [x] **T023** [US7] Modify `cli/validators/test-spec.mjs`: replace the single-string `existsSync` call in the Critical User Journeys loop with new helpers — `parseTestPathCell(cell)` (split on commas outside backticks, strip backticks per segment, drop empties) and `testEvidenceExists(projectDir, segment)` (literal exists OR glob expansion OR `(N suites)` annotation trust). Row passes if ANY segment has evidence. Satisfies FR-016.

- [x] **T024** [US7] [P] Add regression tests in `tests/test-spec.test.mjs`: (a) two backtick-quoted paths both exist, (b) only one exists, (c) glob `idor_*.test.ts (3 suites)` expands, (d) literal missing but `(2 suites)` annotation trusted, (e) all missing AND no annotation → warning lists all attempted paths. Satisfies SC-010.

- [x] **T025** [N/A] Extend `DEFAULT_IGNORE_DIRS` in `cli/shared-ignore.mjs` and the mirror set in `cli/validators/docs-coverage.mjs` with `target`, `.gradle`, `.svelte-kit` per the updated feedback. Add one regression assertion in `tests/cdk-detection.test.mjs` verifying these are present.

---

## Phase 8: Polish & Verification

- [x] **T016** [N/A] Fix Check 1 in `cli/validators/docs-coverage.mjs` to skip directories — uncovered during test development. `.nuxt`, `.claude` and similar dotdirs were being flagged as undocumented config FILES. Check 1 now `continue`s on `isDirectory()`. Verified by the FP-3 regression tests.

- [x] **T017** [N/A] Update `CHANGELOG.md` with `[0.11.1]` entry — Fixed (FP-1..FP-4 + Check 1 dir-skip), Added (CDK detector + template section + DEFAULT_IGNORE_DIRS), Internal (test count 306→317), Out of Scope (IRs deferred to v0.12). Credit an enterprise client project audit. Satisfies SC-008 documentation requirement.

- [x] **T018** [N/A] Update `.wolf/cerebrum.md` with session learnings: 6 Key Learnings, 1 Do-Not-Repeat ("Proposed FP-5 to suppress bin/ — user pushed back: CDK structure IS real source"), 3 Decision Log entries.

- [x] **T019** [N/A] Run `npm test` and verify zero regressions. **Result: 317/317 passing** (was 306; +11 new tests). Satisfies SC-006.

- [x] **T020** [N/A] Run `docguard guard` on this repo as dogfood verification. Confirmed new FPs no longer fire; surfaced real drift in own canonical docs (cli/writers/ missing from ARCHITECTURE.md, extension skill version refs stale at v0.9.9, plus a metrics-consistency mismatch on the "validator count" phrasing in this very spec). All cleaned up as part of v0.11.1.

---

## Task Dependencies

```
T001 (DEFAULT_IGNORE_DIRS) ──┬─► T003 (CDK detector) ──► T012 (docs-coverage CDK wiring)
                             │                          │
T002 (shared-source) ────────┘                          │
                                                        │
T004 (FP-1 docs-sync) ──► T005 (tests)                  │
                                                        │
T006 (FP-2 docs-sync) ──► T007 (tests)                  │
                                                        ▼
T008 (FP-3 docs-coverage IGNORE) ──┬─► T009 (tests) ──► T015 (CDK-integration tests)
                                   │                    ▲
T010 (FP-4 verified) ──► T011 (tests)                   │
                                                        │
T013 (template) ────────────────────────────────────────┤
T014 (CDK unit tests) ──────────────────────────────────┤
                                                        │
T016 (Check 1 dir-skip) ────────────────────────────────┘
                                                        │
T017 (CHANGELOG), T018 (cerebrum), T019 (npm test), T020 (dogfood) ◄┘
```
