# Feature Specification: Fix Env-Var Detector False Negative & Accuracy Terminology

<!-- docguard:spec-type bugfix — defect spec (symptom → root cause → fix); not held to the feature-spec template -->

**Feature Branch**: `004-v020-env-var-false-negative`  
**Created**: 2026-05-26  
**Status**: Draft  
**Input**: Field test of DocGuard v0.20.0 on the canonical-spec-kit project itself (79/79 guard pass, 96/100 score). Two issues surfaced that prevent the score from reaching 100/100.

---

## Context

DocGuard v0.20.0 was run on a live project with a documented env-var (`PYTEST_CURRENT_TEST`) that is accessed in code via `os.environ.get("X")`. The env-var detector reported it as "in docs but missing from code" — a false negative. Separately, the word "accuracy" appears in both `docguard memory` and `docguard score` but is computed against different denominators, creating confusion.

These are two independent defects discovered in the same session.

---

## Bug 1: Env-Var Detector Has Zero Python Support

### Evidence

`PYTEST_CURRENT_TEST` is present in `ENVIRONMENT.md` **and** in production code:

```python
# src/quick_recon/run_history.py:54
if os.environ.get("PYTEST_CURRENT_TEST"):
```

`docguard memory --diff` output:

```
PYTEST_CURRENT_TEST: in docs, not found in code  ← FALSE NEGATIVE
```

### Root Cause (CORRECTED after code audit)

The original bug report assumed the Python env-var scanner existed and just
missed the `.get()` form. Source code audit reveals a more fundamental
problem: **the env-var scanner has no Python support at all.**

`cli/shared-source.mjs` `grepEnvUsage()` regex list (before fix):

```javascript
const patterns = [
  new RegExp(`process\\.env\\.${NAME}`, 'g'),
  new RegExp(`process\\.env\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
  new RegExp(`import\\.meta\\.env\\.${NAME}`, 'g'),
];
```

All three are JavaScript. `.py` files are walked (they're in
`CODE_EXTENSIONS`), but none of the patterns can match Python access forms —
so EVERY documented Python env var is reported as "in docs, not in code",
not just the `.get()` ones. The user reported `PYTEST_CURRENT_TEST` because
it stood out, but the bug also hits `os.environ["X"]`, `os.environ.get("X")`,
and `os.getenv("X")` identically.

The `cli/commands/explain.mjs` text claims `os.environ` is scanned for
Python — aspirational documentation, not actual behavior.

### Fix

Add three patterns to the regex list, one per common Python access form:

```javascript
new RegExp(`os\\.environ\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
new RegExp(`os\\.environ\\.get\\s*\\(\\s*['"]${NAME}['"]`, 'g'),
new RegExp(`os\\.getenv\\s*\\(\\s*['"]${NAME}['"]`, 'g'),
```

Applied additively — no JS pattern changes, no schema or config changes.

### Acceptance Criteria

1. A file containing `os.environ.get("PYTEST_CURRENT_TEST")` causes `PYTEST_CURRENT_TEST` to be counted as **present in code**.
2. A file containing `os.environ["DATABASE_URL"]` continues to work as before.
3. Both forms in the same file are correctly deduplicated (var counted once, not twice).
4. `docguard memory --diff` no longer reports a false negative for this variable after fix.

---

## Bug 2: "Accuracy" Points at Two Different Denominators

### Evidence

Same project, same run:

| Command | Output |
|---|---|
| `docguard memory` (env-var domain) | `Accuracy: 0% (0/1 doc claims match code)` |
| `docguard score` | `Memory accuracy: 93%` |

Same word, same project, wildly different numbers.

### Root Cause

- `docguard memory` computes accuracy over **domains with ≥1 claim** only.
- `docguard score` computes accuracy over **all domains** (domains with no claims count as pass).

Neither calculation is wrong. The labelling is the problem.

### Fix

**Option A (preferred)**: Rename `memory` per-domain metric to `Claim match rate` to visually distinguish it from the score-level `Accuracy`.

**Option B**: Add a denominator note inline:
```
Accuracy: 0% (0/1 claimed vars found in code — full-project accuracy: 93%)
```

### Acceptance Criteria

1. Running `docguard memory` and `docguard score` on the same project does not surface two "Accuracy" numbers with different values and no explanation.
2. The relationship between the per-domain metric and the score-level metric is visible without consulting the docs.

---

## Impact

| Issue | Current score impact | After fix |
|---|---|---|
| Env-var false negative | 96/100 (loses points for "code missing claim") | 97–100/100 |
| Accuracy label confusion | No score impact; UX impact | No change |

---

## Out of Scope

- No changes to the scoring algorithm.
- No changes to `ENVIRONMENT.md` template or the env-var *list* (the variable is correctly documented).
- No new validators.

---

## Notes

This spec was generated from v0.20.0 field test results. The env-var false negative is a **confirmed regression** path — the variable is genuinely present in code and the detector simply does not match the `.get()` form. No ambiguity about whether this is a real bug.

The accuracy-label issue was surfaced because v0.20.0 introduced `memory --diff`, which now makes the per-domain breakdown visible for the first time. Pre-v0.20.0, the confusion was latent.

---

*Field test date: 2026-05-26 — canonical-spec-kit @ v0.20.0 (79/79 guard pass)*

---

**See also**: [`specs/005-hugocross-next-bugs/spec.md`](../005-hugocross-next-bugs/spec.md) — 6 additional bugs from the same v0.20.0 field test cycle on a Next.js project.
