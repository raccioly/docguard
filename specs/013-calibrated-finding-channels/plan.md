# Implementation Plan: Calibrated Finding Channels

**Status**: Implemented
**Spec**: `specs/013-calibrated-finding-channels/spec.md`
**Branch**: `feat/calibrated-finding-channels` (one PR per phase; PR-first per AGENTS.md)

## Summary

Split the single `confidence` field into three orthogonal channels
(`confidence`, `disposition`, `evidence`), compute the analyzer tier at run
time and disclose degradation, let adjudications accrue without changing a
detector, and bind future data-driven tuning to a strictly proper scoring
rule. Every change is additive to the published finding contract. No
dependency is added. No model is involved.

## Technical Context

- Runtime: Node.js 18+ ES modules; built-ins only; `@babel/parser` stays the
  one optional-load dependency (constitution II).
- Analyzer entry points already return the tier signal: `parseJsTs` →
  `{ ast, ok, error }` (`cli/scanners/js-ast.mjs:65`), `extractPythonFiles` →
  `null` or per-file `{ ok }` (`cli/scanners/py-ast.mjs`). The feature routes
  that signal outward; it does not add parsing.
- Evidence per code already exists at run level
  (`cli/precision-evidence.mjs#precisionEvidenceBlock`); the feature attaches
  it per finding.
- The disposition signal already exists as `suggestion.kind` (56 `fix`, 39
  `review`, 3 `suppress`, 1 `report` across `cli/`); the feature promotes it to
  a first-class field and stops it being dropped on SARIF export.
- Published surfaces affected: `guard --format json` (`findings[]`,
  `reportable[]`, `precisionEvidence`), SARIF `properties`, feedback records,
  `schemas/docguard-precision-evidence.schema.json`,
  `schemas/docguard-benchmark-baseline.schema.json`, the generated
  `cli/precision-evidence-data.mjs`, and the contract text in `AGENTS.md`,
  `docs-canonical/DATA-MODEL.md`, `docs-canonical/ARCHITECTURE.md`,
  `docs-canonical/REQUIREMENTS.md`, `docs-canonical/TEST-SPEC.md`,
  `docs-canonical/CI-RECIPES.md`, and the `docguard-guard` skill.

## Constitution Check

| Principle | Status |
|---|---|
| I LLM-first | Pass — every new channel lands in JSON/SARIF before prose. |
| II Minimal deps (non-negotiable) | Pass — zero new dependencies; `@babel/parser` and `python3` remain optional-load and now *disclose* absence instead of degrading silently, which is the principle's stated intent. |
| III Docs as source of truth | Pass — spec precedes code; contract docs updated in the same PR as each schema change. |
| IV Validator isolation | Pass — tier is computed in scanners/shared helpers and consumed via `applicability`; no validator imports another. A shared `summarizeTiers` helper lives in `cli/shared-source.mjs`. |
| V AI as author | N/A |
| VI Safe writes | N/A — no file writes added. |
| VII Spec-kit compliance | Pass — spec/plan/tasks in `specs/013-…`; registry refreshed with `docguard specs --write` after approval. |

## Verified basis

Every requirement in the spec rests on a claim verified by execution or by
source on v0.42.0 @ `08e7e2c`. Claims that did not survive verification were
dropped or downgraded (see the review record). In particular:

- `@babel/parser` absence is *not* a realistic run-time condition (hard,
  exact-pinned dependency, installed); the realistic tier variation is the
  Python interpreter (verified: `extractPythonFiles` returns both routes with
  `python3`, `null` without) and per-file parse failure. FR-010 is scoped to
  those.
- Whole-validator read failures *are* surfaced (verified: an unreadable
  canonical doc produced `applicability: error` with the path in four
  validators). Per-file swallow sites exist but none was demonstrated to lose
  a finding silently; they are out of scope unless a fixture shows loss.
- `policy_disagreement` and `ambiguous` are already valid manifest
  classifications and already excluded from ratios by `metrics.mjs`. FR-015/16
  add the *path* and the *count*, not the classification.

## Project Structure

```text
specs/013-calibrated-finding-channels/
├── spec.md
├── plan.md
└── tasks.md

cli/
├── findings.mjs                 # the three channels + location normalization
├── precision-evidence.mjs       # per-code evidence, projected onto findings
├── shared-source.mjs            # tierFor() / summarizeTiers()
├── scanners/{routes,schemas}.mjs  # attach tier + tierReason to items
├── validators/{freshness,api-surface,docs-sync,schema-sync,...}.mjs
├── writers/sarif.mjs            # channels in result.properties
├── feedback-fixture.mjs         # adjudication contribution
└── commands/{guard,feedback,explain}.mjs

benchmarks/lib/{metrics,compare,precision-evidence}.mjs
schemas/docguard-{benchmark-baseline,precision-evidence}.schema.json
tests/findings-channels.test.mjs, tests/threshold-constraint.test.mjs,
tests/parser-tier.test.mjs, tests/feedback-sampling.test.mjs
```

**Structure Decision**: The feature follows the existing single-project layout.
Every change lands in a directory that already owns that concern; no new
top-level directory is introduced.

## Phases

### Phase 1 — Contract and constructor (foundational, blocks everything)

`cli/findings.mjs`: add `disposition` (FR-001/002), `evidence` (FR-004),
`parserTier` (FR-006, default `not-applicable`), normalize object locations
(FR-009), omit malformed suggestion kinds (FR-003). Wire `evidence` in
`mkFinding` via `evidenceForCode`. Update `reportable` predicate (FR-014).
Contract docs and the `docguard-guard` skill updated in the same PR. Tests:
constructor matrix; every built-in suggestion shape.

### Phase 2 — US1 + US2: disposition and evidence on every output

`cli/writers/sarif.mjs`: emit `disposition`, `evidence.status`, `parserTier`,
and `confidence` unconditionally (FR-007). `cli/commands/guard.mjs`: act /
escalate counts in the summary (FR-008); `reportable[]` from the new
predicate. `cli/validators/freshness.mjs` and the freshness adapter in
`guard.mjs`: stop the blanket map; set `disposition: 'escalate'`,
`confidence: 'high'` where the quantity is read from Git (FR-005). Fixture:
git repo with >10 code commits after a doc commit (already built for
verification; commit it under `tests/fixtures/`).

### Phase 3 — US5 + FR-020: constraints that must exist before any tuning

FR-018/019 pointer comments at `cli/validators/freshness.mjs:274-275`,
`cli/validators/doc-quality.mjs:32-45`, `cli/scanners/task-context.mjs:28`,
`cli/validators/cross-reference.mjs:241`, `benchmarks/lib/precision-evidence.mjs`
(minN); a test greps them. Guard summary `checked N of M validators`; badge
colour cap (FR-020).

### Phase 4 — US3: run-time analyzer tier

`cli/shared-source.mjs`: `tierFor(parseResult|pyResult|ext)` and
`summarizeTiers(items)`. `cli/scanners/routes.mjs`, `cli/scanners/schemas.mjs`:
attach `tier`/`tierReason` to items (FR-011). Consumers set `parserTier` on
findings and `applicability: partial` on any regex-fallback for an AST
language (FR-012): `api-surface`, `docs-sync`, `schema-sync`, and the
`js-ast` consumers (`traceability`, `diff-suspicion`, `security`). Guard
summary tier counts (FR-008). Fixture: Flask app with one single-line and
one multi-line decorator plus `API-REFERENCE.md` documenting only the first;
test runs with and without an interpreter on `PATH` (build the `PATH` with
`node` and `git` symlinked, no `python3`). **First task of this phase is to
make that fixture detectable by `scanRoutesDeep`** — during verification the
AST tier returned both routes but the framework gate did not select the
scanner; that gap must be understood before the differential test is written.

### Phase 5 — US4: feedback sampling and adjudication record

`cli/commands/feedback.mjs`: new default predicate and exclusion line
(FR-014). `cli/feedback-fixture.mjs`: contribution template offers a corpus
row for `policy_disagreement` / `ambiguous` with rationale and date (FR-015).
`benchmarks/lib/metrics.mjs`: per-code `adjudicated` counts (FR-016);
`benchmarks/lib/compare.mjs`: removal of such a row without tombstone fails
(FR-017). Schema bumps: `docguard-benchmark-baseline.schema.json`,
`docguard-precision-evidence.schema.json`; regenerate
`cli/precision-evidence-data.mjs`; `explain <CODE>` prints the count. This is
the highest-risk phase (two strict schemas, a generated module, a baseline
re-review) and is sequenced last on purpose.

### Phase 6 — Closeout

Re-run benchmark comparison against the reviewed baseline (must report no
regressions — identities unchanged), full suite, `docguard guard` on this
repository, package dry run, CHANGELOG, `docguard specs complete`.

## Decisions made in this plan (flag if you disagree)

1. **Add, don't rename.** `confidence` stays; `evidence`, `disposition`,
   `parserTier` are added. Renaming is a breaking change to a published
   contract and is not needed to fix any verified problem.
2. **Adjudications are counted, never folded.** FR-003 of the precision loop
   is respected verbatim; disagreements become visible integers, not
   precision movement.
3. **Badge caps at `green`, not `yellow`.** A partial run is not a failing
   run; it is a run that cannot claim the top grade.
4. **Per-file swallow sites are out of scope** until a fixture demonstrates
   silent loss. The verified behaviour is that read failures surface.
5. **Malformed suggestion kinds are omitted**, consistent with
   `adoption-workflow-integrity#FR-002`, and the finding falls back to
   `disposition: 'escalate'` (fail closed on triage).

## Complexity Tracking

No constitution violations to justify.
