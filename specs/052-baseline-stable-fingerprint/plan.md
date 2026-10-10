# Implementation Plan: Baseline Fingerprints Ignore Advisory Hints

**Branch**: `fix/baseline-stable-fingerprint` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/writers/baseline.mjs`:
  - `ADVISORY_TAILS`, a map from finding code to the pattern for its advisory tail; TRC004 is the only entry.
  - `fingerprintFinding` hashes the message with the tail removed (FR-001, FR-004).
  - `legacyFingerprint` keeps the old preimage (FR-002).
- `cli/commands/guard.mjs`: matching tries the new fingerprint first, then the legacy one. Each finding consumes one unit from whichever entry matched (FR-002). `saveBaseline` already calls `fingerprintFinding` (FR-003).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. Unit tests on fingerprints, and an end-to-end fixture where a new test file changes TRC004's soft-match hint.

## Research decisions

- **A per-code tail list, not a new finding field.** An `identity` field would change the public JSON finding shape for one validator. The tail list is explicit, reviewable and testable. Rejected: stripping anything after " — ", which would also remove real message content.
- **Legacy fallback, not a forced re-freeze.** Re-freezing admits new drift, the very cost #478 reports. The fallback keeps old baselines working until the user re-freezes on purpose.
- **Only TRC004 is affected.** I searched every validator message for appended advisory text (candidate, similar, nearest, did-you-mean). TRC004's soft-match hint is the only one.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | Suppression stays visible and counted. Nothing new is hidden: only the volatile tail is ignored. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/writers/baseline.mjs                    # ADVISORY_TAILS, fingerprint, legacy fingerprint
cli/commands/guard.mjs                      # dual lookup
tests/baseline-stable-fingerprint.test.mjs  # NEW
docs/configuration.md                       # baseline section
CHANGELOG.md
```
