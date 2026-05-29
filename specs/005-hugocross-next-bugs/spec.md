# Feature Specification: Fix 6 Confirmed Bugs from HugoCross Next.js Field Test

<!-- docguard:spec-type bugfix — defect spec (symptom → root cause → fix); not held to the feature-spec template -->

**Feature Branch**: `005-hugocross-next-bugs`  
**Created**: 2026-05-26  
**Status**: Draft  
**Input**: Full review session running DocGuard v0.20.0 on a production Next.js 15 App Router project (hugocross_revamp). 6 bugs confirmed — all evidence-backed, none speculative.

---

## Context

HugoCross is a stablecoin content engine built on Next.js 15 App Router with TypeScript, Tailwind, and DynamoDB. Running `docguard guard` produced a cascade of false positives and unactionable warnings. Root causes were traced to source code. Priority order per the reporter: Bug 1 > Bug 2 > Bug 4 > Bug 3 > Bug 6 > Bug 5. Bug 1 alone accounts for ~113 false-positive API-Surface warnings.

---

## Bug 1 (P0): API-Surface scanner emits wrong HTTP path for Next.js App Router

**Severity**: 🔴 Critical — makes the API-Surface validator completely unusable for Next.js App Router codebases  
**File**: `cli/scanners/routes.mjs:112`

### Root Cause (confirmed in code)

```javascript
// routes.mjs, scanNextJsRoutes()
const appDirs = ['app/api', 'src/app/api'];
for (const appDir of appDirs) {
  ...
  const relDir = relative(resolve(dir, appDir.split('/')[0]), dirname(filePath));
  const apiPath = '/' + relDir...
```

For `appDir = 'src/app/api'`:
- `appDir.split('/')[0]` → `'src'` (wrong — strips only `src/`)
- `relative(<project>/src, <project>/src/app/api/health/)` → `app/api/health`
- Emitted path: `GET /app/api/health` (wrong)
- Correct path: `GET /api/health`

For `appDir = 'app/api'` (no `src/`):
- `appDir.split('/')[0]` → `'app'` (accidentally correct)
- `relative(<project>/app, <project>/app/api/health/)` → `api/health`
- Emitted path: `GET /api/health` ✅

### Effect

Every route under `src/app/api/` produces two simultaneous warnings:
1. "Documented endpoint not found in code: GET /api/X" (the real path)
2. "Undocumented endpoint in code: GET /app/api/X" (the phantom path)

Same file, two warnings, both wrong. All 113 API-Surface checks in the test project were false positives from this one line.

### Fix

```diff
- const relDir = relative(resolve(dir, appDir.split('/')[0]), dirname(filePath));
+ const apiBase = appDir.slice(0, appDir.lastIndexOf('/'));   // 'src/app' or 'app'
+ const relDir = relative(resolve(dir, apiBase), dirname(filePath));
```

`appDir.lastIndexOf('/')` correctly identifies the parent of `api/` regardless of depth:
- `'app/api'` → `apiBase = 'app'` (unchanged from current behavior for non-src layout)
- `'src/app/api'` → `apiBase = 'src/app'` (fixes the bug)

### Acceptance Criteria

1. A Next.js project with routes under `src/app/api/health/route.ts` emits `GET /api/health` (not `GET /app/api/health`).
2. A Next.js project with routes under `app/api/health/route.ts` still emits `GET /api/health` (no regression).
3. Running `docguard guard` on a project with a matching OpenAPI spec produces 0 API-Surface false positives for Next.js App Router routes.

---

## Bug 2 (P1): Freshness check ignores `<!-- docguard:last-reviewed -->` header

**Severity**: 🟠 High — documented feature has zero effect; misleading UX  
**File**: `cli/validators/freshness.mjs` (entire function)

### Root Cause (confirmed in code)

`validateFreshness()` never reads file content. It calls only `getLastGitDate()` which runs `git log --` on the file. The `<!-- docguard:last-reviewed YYYY-MM-DD -->` header is:

- Injected by `docguard generate` into every generated doc template (6 occurrences in `generate.mjs`)
- Listed in every template file under `templates/`
- Checked by `score.mjs:291` for ALCOA+ compliance
- Suggested as the fix action in the freshness warning text itself (`score.mjs:336`)

But `freshness.mjs` never reads it. Updating the header has zero effect on the freshness check.

### Effect

- Uncommitted doc updates keep firing freshness warnings regardless of the header value
- The fix suggestion ("add `<!-- docguard:last-reviewed YYYY-MM-DD -->`") is actively misleading
- The ALCOA+ "review metadata present" check passes while the freshness check fires simultaneously — two checks disagree on the same file

### Fix

Add a `readLastReviewedDate(docPath)` helper that parses the header:

```javascript
function readLastReviewedDate(docPath) {
  try {
    const content = readFileSync(docPath, 'utf-8');
    const m = content.match(/<!--\s*docguard:last-reviewed\s+(\d{4}-\d{2}-\d{2})\s*-->/);
    return m ? new Date(m[1]) : null;
  } catch {
    return null;
  }
}
```

In `validateFreshness()`, prefer the header over `git log`:

```javascript
const headerDate = readLastReviewedDate(docPath);
const docDate = headerDate ?? getLastGitDate(docFile, dir);
```

The header is the authoritative review date; git log is the fallback proxy.

### Acceptance Criteria

1. A doc file with `<!-- docguard:last-reviewed 2026-05-26 -->` set to today's date does NOT fire a freshness warning, even if the git commit predates the threshold.
2. A doc file with no `docguard:last-reviewed` header still uses `git log` as before (no regression for existing projects).
3. A doc file with a stale `<!-- docguard:last-reviewed 2020-01-01 -->` header DOES fire a freshness warning (the header is respected, not ignored).

---

## Bug 3 (P2): Environment docs extractor misses non-backtick table rows

**Severity**: 🟡 Medium — false positives for vars documented in pipe tables  
**File**: `cli/validators/environment.mjs:47`

### Root Cause (confirmed in code)

The `documented` set is built exclusively from backtick-quoted var names:

```javascript
const varRe = /`([A-Z][A-Z0-9_]*[A-Z0-9])`/g;
while ((m = varRe.exec(content)) !== null) {
  ...
  documented.add(m[1]);
}
```

Variables documented in a standard markdown pipe table WITHOUT backticks around the name are silently missed:

```markdown
| DYNAMODB_TABLE_JOBS | DynamoDB table for job records | required |
```
→ NOT found (no backticks)

```markdown
| `DYNAMODB_TABLE_JOBS` | DynamoDB table for job records | required |
```
→ Found ✅

Note: `grepEnvUsage()` in `shared-source.mjs` correctly captures the full name from code (no normalization happens there). The bug is in the `documented` extraction only.

### Effect

Projects documenting env vars in clean pipe tables (common DocGuard-generated format) are flagged as "used in code but not documented" despite having complete ENVIRONMENT.md documentation. Every suffixed variant (`DYNAMODB_TABLE_JOBS`, `DYNAMODB_TABLE_SOURCES`, etc.) is flagged separately.

### Fix

Add a pipe-table row parser alongside the backtick parser:

```javascript
// Also extract pipe-table first columns: | VAR_NAME | ... |
const tableRe = /^\|\s*([A-Z][A-Z0-9_]*[A-Z0-9])\s*\|/gm;
while ((m = tableRe.exec(content)) !== null) {
  if (m[1].length < 3) continue;
  if (SYSTEM.has(m[1])) continue;
  documented.add(m[1]);
}
```

The fix is additive — backtick extraction continues to work.

### Acceptance Criteria

1. `ENVIRONMENT.md` with `| DYNAMODB_TABLE_JOBS | desc | required |` (no backticks) is treated as documenting `DYNAMODB_TABLE_JOBS`.
2. `ENVIRONMENT.md` with `` | `DYNAMODB_TABLE_JOBS` | desc | `` (with backticks) continues to work (no regression).
3. System vars in a pipe table (e.g., `| PATH | ...`) are still excluded via the SYSTEM set.

---

## Bug 4 (P1): Docs-Diff warning omits the failing file path

**Severity**: 🟠 High — warning is completely unactionable without the file name  
**File**: `cli/validators/docs-diff.mjs:55`

### Root Cause (confirmed in code)

```javascript
if (stale > 0) parts.push(`${stale} documented but not found in code`);
warnings.push(`${result.title} drift: ${parts.join(', ')}`);
```

`result.onlyInDocs` is populated with the actual file names but never referenced in the warning string. The user sees: `"Test Files drift: 1 documented but not found in code"` — no path, no filename.

### Effect

The team audited 52 documented test files against the filesystem manually via `find` and found all 52 exist. The check still fires. Without a filename, there is no way to debug whether this is a false positive or a real gap.

### Fix

Include the offending file paths in the warning (with a reasonable cap):

```javascript
const MAX_INLINE = 5;

if (stale > 0) {
  const shown = result.onlyInDocs.slice(0, MAX_INLINE).map(f => `\`${f}\``).join(', ');
  const extra = result.onlyInDocs.length > MAX_INLINE
    ? ` (+${result.onlyInDocs.length - MAX_INLINE} more)`
    : '';
  parts.push(`${stale} documented but not found in code: ${shown}${extra}`);
}
```

Equivalent treatment for `onlyInCode`.

### Acceptance Criteria

1. `"Test Files drift: 1 documented but not found in code"` becomes `"Test Files drift: 1 documented but not found in code: \`src/lib/services/schema-org.test.ts\`"`.
2. When there are ≤5 offending files, all are listed inline.
3. When there are >5, the first 5 are listed with `(+N more)`.
4. The fix suggestion no longer needs to say `/docguard.fix` for a case where the user just needs the filename to investigate.

---

## Bug 5 (P3): Traceability scanner ignores `// @doc` annotations AND misses App Router paths

**Severity**: 🟡 Medium — compound: annotation feature not implemented + TRACE_MAP gap  
**File**: `cli/validators/traceability.mjs`

### Root Cause (confirmed in code — two issues)

**Issue A**: `// @doc` annotations are NOT implemented. The entire `traceability.mjs` has no annotation scanner. The `TRACE_MAP` only matches on file path patterns.

**Issue B**: The `API-REFERENCE.md` TRACE_MAP entry only matches:
- `/(routes?|controllers?|handlers?)\//`
- `/(openapi|swagger)\.(json|ya?ml)/`
- `/middleware\//`

Next.js App Router route files live at `src/app/api/**` — none of these patterns match. Even a project with a fully populated `src/app/api/` tree will be reported as "API-REFERENCE.md — exists but no matching source code found".

### Effect

A route file with `// @doc API-REFERENCE.md` at line 1 (as shown in templates) still triggers "API-REFERENCE.md — exists but no matching source code found (unlinked doc)". The annotation is documented but inert.

### Fix

**For Issue A** — implement `// @doc` annotation scanning as an override:

```javascript
// In validateTraceability(), before the TRACE_MAP check:
const docAnnotations = scanDocAnnotations(projectFiles, projectDir);
// docAnnotations: Map<docBasename, Set<sourceFilePath>>

// If annotation links the doc to ≥1 source file, count as pass:
if (docAnnotations.has(docName) && docAnnotations.get(docName).size > 0) {
  passed++;
  continue;
}
```

```javascript
function scanDocAnnotations(projectFiles, projectDir) {
  const map = new Map(); // docBasename → Set<file>
  const re = /\/\/\s*@doc\s+(\S+\.md)/g;
  for (const relPath of projectFiles) {
    const ext = extname(relPath);
    if (!['.js','.mjs','.ts','.tsx','.jsx'].includes(ext)) continue;
    const full = resolve(projectDir, relPath);
    let content;
    try { content = readFileSync(full, 'utf-8'); } catch { continue; }
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const docName = basename(m[1]);
      if (!map.has(docName)) map.set(docName, new Set());
      map.get(docName).add(relPath);
    }
  }
  return map;
}
```

**For Issue B** — add Next.js App Router paths to the `API-REFERENCE.md` TRACE_MAP entry:

```diff
'API-REFERENCE.md': {
  sourcePatterns: [
    { label: 'Route handlers', glob: /(routes?|controllers?|handlers?)\// },
+   { label: 'Next.js API routes', glob: /app\/api\// },   // App Router
    { label: 'OpenAPI spec', glob: /(openapi|swagger)\.(json|ya?ml)/ },
    { label: 'API middleware', glob: /middleware\// },
  ],
},
```

### Acceptance Criteria

1. A source file with `// @doc API-REFERENCE.md` at the top makes `API-REFERENCE.md` count as "linked" in the traceability check.
2. A Next.js project with routes under `src/app/api/` does NOT get "API-REFERENCE.md — unlinked doc" if any file under `app/api/` exists.
3. Both fixes are independent — either one alone prevents the false positive.

---

## Bug 6 (P2): `docguard upgrade --apply` does not update doc files after adding validators

**Severity**: 🟡 Medium — upgrade silently breaks a previously passing Metrics-Consistency check  
**File**: `cli/commands/upgrade.mjs`

### Root Cause (confirmed in code)

`runUpgrade()` with `--apply` does:
1. `applyCliUpgrade()` — installs new npm package
2. `migrateSchema()` — updates `.docguard.json` fields

It does NOT run `fix --write` or update `commands/docguard.guard.md`. When a new CLI version adds validators (e.g., v0.16.0 added `Canonical-Sync`, changing the count from 20 to 21), the doc still says 20 and the Metrics-Consistency validator fires immediately after the upgrade.

### Effect

A project that passes `docguard guard` at v0.16.0 fails Metrics-Consistency immediately after `npm update docguard-cli` to v0.20.0. The user did nothing wrong — the upgrade broke a green check.

### Fix (two-part)

**Minimum viable fix** — print a post-upgrade notice when the validator count changed:

```javascript
// After CLI upgrade, check if guard command docs need updating:
const prevCount = getValidatorCountFromGuardDoc(projectDir);
const newCount = getCurrentValidatorCount();
if (prevCount !== null && prevCount !== newCount) {
  console.log(`\n  ${c.yellow}⚠  Validator count changed: ${prevCount} → ${newCount}${c.reset}`);
  console.log(`     Run ${c.cyan}docguard fix --write${c.reset} to update ${c.dim}commands/docguard.guard.md${c.reset}`);
}
```

**Full fix** — run `fix --write` atomically as part of `upgrade --apply`, then print a summary of what changed.

### Acceptance Criteria

1. After `docguard upgrade --apply`, if the validator count changed, the user sees an explicit warning and the exact command to run.
2. (Full fix) After `docguard upgrade --apply`, `commands/docguard.guard.md` is updated automatically and a summary is printed.
3. If the validator count did not change, no extra output is produced (no noise for minor upgrades).

---

## Summary Table

| # | Title | File | Severity | Fix size |
|---|---|---|---|---|
| 1 | API-Surface path strips wrong prefix for `src/app/api` | `cli/scanners/routes.mjs:112` | 🔴 P0 | 2-line change |
| 2 | Freshness ignores `docguard:last-reviewed` header | `cli/validators/freshness.mjs` | 🟠 P1 | ~15 lines |
| 4 | Docs-Diff warning omits file path | `cli/validators/docs-diff.mjs:55` | 🟠 P1 | ~8 lines |
| 3 | Env docs extractor misses non-backtick table rows | `cli/validators/environment.mjs:47` | 🟡 P2 | ~8 lines |
| 6 | Upgrade --apply doesn't update validator count docs | `cli/commands/upgrade.mjs` | 🟡 P2 | ~20 lines |
| 5 | Traceability misses `// @doc` + App Router paths | `cli/validators/traceability.mjs` | 🟡 P3 | ~40 lines |

All fixes are surgical — no schema changes, no new dependencies, no breaking changes. Bugs 1, 2, and 4 together account for the bulk of the user-visible noise from the HugoCross session.

---

*Field test date: 2026-05-26 — hugocross_revamp project, DocGuard v0.20.0*
