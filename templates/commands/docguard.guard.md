---
description: Run DocGuard guard validation — check all validators and fix any issues
handoffs:
  - label: Fix Issues
    agent: docguard.fix
    prompt: Fix all documentation issues found by guard
  - label: Check Score
    agent: docguard.score
    prompt: Show CDD maturity score after fixes
---

# /docguard.guard — Validate CDD Compliance

You are an AI agent enforcing Canonical-Driven Development (CDD) compliance using DocGuard.

## Step 1: Run Guard (machine-readable)

```bash
npx docguard-cli guard --format json
```

Read the JSON contract — do not parse prose:

| Field | Meaning |
|-------|---------|
| `status` | `PASS` / `WARN` / `FAIL` (severity-aware; matches the exit code: 0/2/1) |
| `findings[]` | Structured issues: `{code, severity, confidence, message, location, suggestion}` |
| `nextStep` | The single suggested follow-up command (`null` on PASS) |
| `reportable[]` | Low-confidence findings (possible false positives) — verify before acting |
| `coverage` | Markdown tier map: `canonical / tracked / ignored / unclassified[]` |
| `semanticClaims.count` | Documented counts/limits/enums NOT yet verified against code |
| `validators[]` | Per-validator results, including `na` (nothing to validate ≠ pass) |

## Step 2: Understand each finding before fixing

- Every finding carries a stable code (e.g. `STR001`, `ENV003`, `XRF002`). Run
  `npx docguard-cli explain <CODE>` for its contract, cause, and remediation.
- `confidence: "low"` means the scanner itself is unsure — verify against the
  code before changing anything, and report real false positives with
  `npx docguard-cli feedback`.
- A finding's `suggestion` may include a ready-to-run `command` or an inline
  `pragma`. Prefer those over inventing your own fix.

## Step 3: Fix, suppress, or escalate

1. **Mechanical issues first**: `npx docguard-cli fix --write` applies safe,
   provenance-checked fixes (broken anchors, stale counts/versions). Never
   hand-edit what the tool can fix deterministically.
2. **Prose/content issues**: follow the `/docguard.fix` workflow (research →
   write real content).
3. **Genuine false positives**: suppress at the finding site with the code —
   `// docguard:ignore <CODE>` on (or above) the flagged line — or mark a whole
   validator not-applicable in a doc:
   `<!-- docguard:validator <key> n/a — reason -->`. Always include the reason.
   Never suppress to silence a real issue.
4. If `semanticClaims.count > 0`, offer to run `npx docguard-cli verify --semantic`
   and check each extracted claim against the code — a green guard asserts
   structure, not the truth of documented numbers.

## Step 4: Report

Show the user:
1. `status` and pass/total, plus anything in `coverage.unclassified` (docs no
   validator watches — suggest enrolling or ignoring them)
2. Each finding fixed (by code), each suppressed (with reason), each reported
   as a false positive
3. Final score: `npx docguard-cli score`
