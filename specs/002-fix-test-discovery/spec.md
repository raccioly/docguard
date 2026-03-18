# Feature Specification: Fix Test File Discovery

**Feature Branch**: `002-fix-test-discovery`  
**Created**: 2026-03-18  
**Status**: Draft  
**Input**: DocGuard v0.9.10 Bug Report — 3 bugs all rooted in test file discovery

## User Scenarios & Testing

### User Story 1 — Guard Stops Scanning node_modules for Tests (Priority: P1)

A developer runs `docguard guard` on a monorepo with `testPattern: "backend/**/__tests__/**/*.test.ts"`. DocGuard finds only real project test files, not 164 files from `backend/node_modules/zod/`, `pg-protocol/`, etc.

**Why this priority**: This produces a permanently unfixable warning that erodes trust in DocGuard. Every enterprise project has node_modules.

**Independent Test**: Run guard on a project with `node_modules` containing `.test.ts` files. The "Test Files drift" check should pass (zero false positives).

**Acceptance Scenarios**:

1. **Given** a project with `testPattern: "backend/**/__tests__/**/*.test.ts"` and 164 test files in `backend/node_modules/`, **When** `docguard guard` runs, **Then** only files under `backend/src/` are counted — zero node_modules files appear
2. **Given** `config.ignore: ["node_modules"]`, **When** docs-diff walks the tree, **Then** `node_modules/` directories at any depth are skipped before entering them
3. **Given** no `config.ignore` at all, **When** docs-diff walks the tree, **Then** `node_modules` is still excluded — it is a hardcoded exclusion, not config-dependent

---

### User Story 2 — Testing Score Reflects Real CI and Guard Results (Priority: P2)

A developer's project uses AWS CodePipeline (not GitHub Actions) and passes Test-Spec 44/44. The testing score should be 100%, not capped at 70% because the scorer can't find `.github/workflows/ci.yml`.

**Why this priority**: Caps achievable score at 96/100. Contradicts guard results, confusing users.

**Independent Test**: Run `docguard score` on a project with TEST-SPEC.md (44/44 pass), a vitest config, co-located `__tests__/`, and non-GitHub CI. Score should be ≥ 85%.

**Acceptance Scenarios**:

1. **Given** a project with no `.github/workflows/ci.yml` but `buildspec.yml` exists, **When** scorer calculates testing score, **Then** the CI check awards 15 points
2. **Given** a project with `amplify.yml` containing a test step, **When** scorer runs, **Then** CI test step detected
3. **Given** a project using `turbo.json` with a `"test"` pipeline, **When** scorer runs, **Then** CI test step detected
4. **Given** Test-Spec validator passes 44/44, **When** scorer calculates testing, **Then** score is not contradicted by separate file-existence checks

---

### User Story 3 — Multiple Test Patterns Supported (Priority: P2)

A developer has unit tests at `backend/**/__tests__/**/*.test.ts` and E2E tests at `e2e/**/*.spec.ts`. Both suites should be visible to DocGuard via `testPatterns` config array.

**Why this priority**: 18 E2E tests (24% of suite) invisible. Common enterprise pattern.

**Independent Test**: Configure `testPatterns: ["backend/**/__tests__/**/*.test.ts", "e2e/**/*.spec.ts"]` and run guard. Both test locations should appear in the Test Files diff check.

**Acceptance Scenarios**:

1. **Given** `testPatterns: ["backend/**/__tests__/**/*.test.ts", "e2e/**/*.spec.ts"]`, **When** docs-diff resolves test files, **Then** files from both patterns are found (56 + 18 = 74)
2. **Given** a glob pattern with `**`, **When** resolving files, **Then** the `**` does NOT match through `node_modules` at any depth
3. **Given** backward-compatible `testPattern` (string), **When** config loads, **Then** it normalizes to `testPatterns` array — existing configs still work

---

### Edge Cases

- What if `testPatterns` contains overlapping globs? → Deduplicate results
- What if a pattern matches zero files? → No error, just empty result for that pattern
- What if `node_modules` is nested (`packages/foo/node_modules/`)? → Excluded at any depth
- What if `buildspec.yml` exists but contains no test step? → Still award CI points (file existence = CI configured)

## Requirements

### Functional Requirements

- **FR-001**: Docs-Diff validator MUST exclude `node_modules` at any directory depth when walking the file tree, regardless of config
- **FR-002**: Test file glob matching MUST NOT follow through `node_modules` directories, even when using `**` glob patterns
- **FR-003**: `testPatterns` config MUST accept an array of glob strings and resolve files from ALL patterns
- **FR-004**: Resolved test files MUST be deduplicated across patterns (same file matched by two patterns counts once)
- **FR-005**: Scorer CI detection MUST recognize: `buildspec.yml`, `amplify.yml`, `Jenkinsfile`, `.circleci/config.yml`, `.gitlab-ci.yml`, `turbo.json` (with "test" task), in addition to existing GitHub Actions YAML
- **FR-006**: Backward compatibility MUST be preserved — `testPattern` (string) normalizes to `testPatterns` (array)
- **FR-007**: The glob matching for `testPatterns` MUST use a purpose-built match function, not repurpose `buildIgnoreFilter` (which is semantically an ignore filter)
- **FR-008**: Zero new NPM dependencies — pure Node.js built-ins only

## Success Criteria

### Measurable Outcomes

- **SC-001**: Running guard on Whatsapp_Inbox produces 0 test-related false warnings (currently 1 permanent warning)
- **SC-002**: Testing score on Whatsapp_Inbox reaches ≥ 85% (currently 70%)
- **SC-003**: All 74 test files (56 unit + 18 E2E) are visible when `testPatterns` configured
- **SC-004**: All existing 40 unit tests continue to pass (zero regressions)
- **SC-005**: New tests added for glob matching, node_modules exclusion, and CI detection
