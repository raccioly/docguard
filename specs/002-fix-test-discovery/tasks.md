# Task Breakdown: Fix Test File Discovery

**Feature**: `002-fix-test-discovery`  
**Plan**: [plan.md](file:///Users/ricardoaccioly/.gemini/canonical-spec-kit/specs/002-fix-test-discovery/plan.md)  
**Spec**: [spec.md](file:///Users/ricardoaccioly/.gemini/canonical-spec-kit/specs/002-fix-test-discovery/spec.md)  
**Generated**: 2026-03-18

## Phase 1: Shared Glob Matching

- [x] T001 Add `globMatch(relPath, patterns)` function to `cli/shared-ignore.mjs`
- [x] T002 Add `globToMatchRegex()` helper — `**/` converts to `(.*/)?` (zero-or-more segments)
- [x] T003 Add unit tests for `globMatch()`: rejects node_modules, matches valid paths, handles multiple patterns

## Phase 2: Docs-Diff Node_modules Exclusion (Bug 1)

- [x] T004 Rewrite `getTestFilesFromPatterns()` in `docs-diff.mjs` — use `globMatch()` instead of `buildIgnoreFilter()`
- [x] T005 Add directory-level `node_modules` skip via IGNORE_DIRS set
- [x] T006 Deduplicate results across multiple patterns (Set-based)

## Phase 3: Multi-Pattern Test Support (Bug 3)

- [x] T007 Verify `testPatterns` threading through `diffTests()` → `getTestFilesFromPatterns()`
- [x] T008 Add test for multiple patterns resolving files from different directories

## Phase 4: Scorer CI Detection (Bug 2)

- [x] T009 Expand CI file detection: buildspec.yml, amplify.yml, Jenkinsfile, .circleci, .gitlab-ci.yml, .travis.yml
- [x] T010 Add `turbo.json` "test" pipeline task check
- [x] T011 Add test for expanded CI detection (buildspec.yml)

## Phase 5: Verification

- [x] T012 Run `npm test` — 46/46 pass (40 existing + 6 new)
- [x] T013 Updated CHANGELOG.md
- [ ] T014 Commit, push, release

## Results

- **Tests**: 46/46 pass (40 existing + 6 new)
- **Files changed**: 4 (shared-ignore.mjs, docs-diff.mjs, score.mjs, commands.test.mjs) + CHANGELOG.md
