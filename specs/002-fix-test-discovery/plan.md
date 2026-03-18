# Implementation Plan: Fix Test File Discovery

**Feature**: `002-fix-test-discovery`  
**Spec**: [spec.md](file:///Users/ricardoaccioly/.gemini/canonical-spec-kit/specs/002-fix-test-discovery/spec.md)  
**Created**: 2026-03-18

## Technical Context

- **Runtime**: Node.js 18+ (zero NPM deps)
- **Test Framework**: `node:test`
- **Constitution**: v1.1.0 (shared infra allowed per Principle IV)
- **Affected Area**: Test file resolution in docs-diff validator + scoring CI detection

## Root Cause Analysis

All 3 bugs share a single root cause: **`getTestFilesFromPatterns()` in docs-diff.mjs reuses `buildIgnoreFilter()` as a file *match* function** (line 219). `buildIgnoreFilter` was designed to answer "should this file be SKIPPED?", not "does this file match a test pattern?". The regex it produces (`^pattern$|/pattern$|...`) does match files inside `node_modules` because `**` converts to `.*`, which matches any path segment including `node_modules/zod/__tests__/...`.

Additionally, `calcTestingScore()` in score.mjs hardcodes only 2 GitHub Actions files for CI detection.

## Proposed Changes

### Component 1: Shared Glob Matching

#### [MODIFY] [shared-ignore.mjs](file:///Users/ricardoaccioly/.gemini/canonical-spec-kit/cli/shared-ignore.mjs)

Add a new `globMatch()` export — purpose-built for *matching* files (not ignoring). Always excludes `node_modules` at any depth in the path. Separate from `buildIgnoreFilter()`.

```javascript
// New export: positive glob matching with built-in node_modules exclusion
export function globMatch(relPath, patterns) {
  // Always reject paths containing node_modules
  if (/(?:^|[/\\])node_modules(?:[/\\]|$)/.test(relPath)) return false;
  // Check if path matches any of the test patterns
  const regexes = patterns.map(p => globToMatchRegex(p));
  return regexes.some(r => r.test(relPath));
}
```

---

### Component 2: Docs-Diff Test File Resolution

#### [MODIFY] [docs-diff.mjs](file:///Users/ricardoaccioly/.gemini/canonical-spec-kit/cli/validators/docs-diff.mjs)

Replace `getTestFilesFromPatterns()` to use new `globMatch()` instead of `buildIgnoreFilter()`. Key changes:

1. Walk function: directory-level `node_modules` skip (before `stat()` — fast)
2. File matching: call `globMatch(relPath, patterns)` instead of `buildIgnoreFilter`
3. Deduplicate results across multiple patterns

---

### Component 3: Scorer CI Detection

#### [MODIFY] [score.mjs](file:///Users/ricardoaccioly/.gemini/canonical-spec-kit/cli/commands/score.mjs)

Expand `calcTestingScore()` CI detection (lines 496-499):

```javascript
// Current — only GitHub Actions
const ciFiles = ['.github/workflows/ci.yml', '.github/workflows/test.yml'];

// New — enterprise CI systems
const ciFiles = [
  '.github/workflows/ci.yml', '.github/workflows/test.yml',
  'buildspec.yml', 'buildspec.test.yml',
  'amplify.yml',
  'Jenkinsfile',
  '.circleci/config.yml',
  '.gitlab-ci.yml',
  '.travis.yml',
];
```

Also check `turbo.json` for a `"test"` pipeline task.

---

### Component 4: Tests

#### [MODIFY] [commands.test.mjs](file:///Users/ricardoaccioly/.gemini/canonical-spec-kit/tests/commands.test.mjs)

Add tests:
1. `globMatch()` rejects paths containing `node_modules`
2. `globMatch()` matches valid test file paths 
3. `globMatch()` handles multiple patterns
4. CI detection finds `buildspec.yml`

## Constitution Check

| Principle | Status |
|-----------|--------|
| I — Canonical docs source of truth | ✅ No docs affected |
| II — No external deps | ✅ Pure Node.js |
| III — Safe writes | ✅ No file writes |
| IV — Shared infra allowed | ✅ Adding to `shared-ignore.mjs` |
| V — Test coverage | ✅ Adding tests |

## Verification Plan

### Automated Tests
```bash
npm test  # All 40+ tests pass (+ new tests)
```

### Project Validation
```bash
# Run on Whatsapp_Inbox to verify:
# 1. No "Test Files drift" false warning
# 2. Testing score ≥ 85%
npx docguard-cli guard --verbose
npx docguard-cli score
```
