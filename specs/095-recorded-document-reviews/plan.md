# Implementation Plan: Recorded Document Reviews and Per-Reference Staleness

**Branch**: `feat/095-recorded-document-reviews` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001–FR-004 | New `cli/scanners/doc-reviews.mjs`. It reads, validates and serializes `.docguard-doc-reviews.json`, extracts references (backticks, links, slash-paths, fenced blocks included), applies the exclusions, and builds the entry (doc-lock `fingerprint()` tiers). `cli/commands/review.mjs`: `--accept <doc>` without `#id` records it through `commitFileTransaction`; an identical rerun writes nothing. |
| FR-005 | New `cli/scanners/reference-staleness.mjs`. One `git diff -M --numstat` and one `--diff-filter=A` per review point. The document is blamed, and a reference re-measured from its line's commit, only for references over the threshold. |
| FR-006–FR-009, FR-014 | New `cli/validators/freshness-reviews.mjs`, called from `validateFreshness`, also in repositories under 3 commits. It emits FRS006–FRS010 and attaches evidence to canonical FRS002/FRS003. The recorded review date counts for FRS002/FRS003. |
| FR-010 | `cli/shared.mjs` `resolveFindingEnforcement` reads `{ role: level }`. `cli/config.mjs` validates it (`FINDING_SEVERITY_ROLES`). `schemas/docguard-config.schema.json` gains the `oneOf` and `freshness.referenceShare`. |
| FR-011 | `cli/commands/guard.mjs`: `staleInstructionsOf()`, the JSON field and the text line (default and `--quiet`). `cli/findings.mjs` `mkFinding` carries `documentRole`, `staleness` and `surface`. |
| FR-012 | `benchmarks/history-replay/run.mjs`, with results for the public repositories. |
| FR-013 | `cli/findings.mjs` FRS006–FRS010, `docs/reference/findings.md`, DATA-MODEL, ARCHITECTURE, `review` help, AGENTS.md, CHANGELOG, `schemas/docguard-doc-reviews.schema.json`. |

## Project Structure

```text
cli/scanners/doc-reviews.mjs            # new
cli/scanners/reference-staleness.mjs    # new
cli/validators/freshness-reviews.mjs    # new
cli/validators/freshness.mjs, cli/commands/{guard,review}.mjs, cli/{findings,shared,config,docguard}.mjs
schemas/docguard-doc-reviews.schema.json (new), schemas/docguard-config.schema.json
benchmarks/history-replay/              # new
tests/recorded-document-reviews.test.mjs
```

## Research decisions

- **A separate reviews file.** The doc lock rejects unknown top-level fields (`lockProblem`). Approved by the orchestrator; the new file's `extensions` rule avoids a third file later.
- **Numstat, not blame, for the share.** On the Stage 1 sample it ranked references the same as blame (74/70, 47/48, …), at about 14 ms per call against 5–55 s of blame per repository.
- **FRS008 and FRS009 default to warn.** Both conditions are facts, not heuristics (orchestrator decision 2).
- **Rejected:**
  - Directory-level churn (false in the Stage 1 sample).
  - FRS006 for unmarked documents (0 true of 7).
  - An LLM judgment (not deterministic).

## Verification

`npm test`; guard on DocGuard; `npm run budget`; the SC-002 TestGuard demo; the A/B on 28 local projects (counts of FRS006–FRS010 reported to the orchestrator); the history-replay benchmark.
