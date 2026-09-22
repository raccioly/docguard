# Tasks: Calibrated Finding Channels

**Status**: Draft — awaiting approval
**Spec**: `specs/013-calibrated-finding-channels/spec.md`
**Plan**: `specs/013-calibrated-finding-channels/plan.md`

Format: `[ID] [P?] [Story] Description` — `[P]` = parallelizable (different
files, no dependency). One PR per phase.

## Phase 1: Contract and constructor (blocking)

- [ ] T001 Add `disposition`, `evidence`, `parserTier` to the `Finding` typedef and `mkFinding` in `cli/findings.mjs`; derive `disposition` from `suggestion.kind`, default `escalate`; default `parserTier` to `not-applicable` (FR-001, FR-002, FR-006).
- [ ] T002 In `mkFinding`, call `evidenceForCode(code)` and attach `{ status, n, precision?, precisionInterval, measuredOnRunningVersion }` (FR-004). `precision-evidence.mjs` must not import `findings.mjs` (no cycle).
- [ ] T003 Omit suggestions with unsupported `kind` instead of coercing to `review`; add the omitted case to the built-in suggestion-shape tests (FR-003).
- [ ] T004 Normalize object `location` to `file:line` in `mkFinding`; fix the emitter in `cli/validators/api-doc-smells.mjs:119` (FR-009).
- [ ] T005 Replace the `reportable` predicate with `evidence.status === 'not-measured' || confidence === 'low'` (FR-014).
- [ ] T006 [P] Tests: `tests/findings-channels.test.mjs` — constructor matrix for every `confidence`/`kind`/`location` input; `reportable` matrix against measured and unmeasured codes.
- [ ] T007 [P] Contract docs: `docs-canonical/DATA-MODEL.md` (findings row + "shape stays fixed" sentence → "additive only"), `docs-canonical/ARCHITECTURE.md`, `docs-canonical/REQUIREMENTS.md`, `docs-canonical/TEST-SPEC.md`, `AGENTS.md` (Consuming Guard Output), `extensions/spec-kit-docguard/skills/docguard-guard/SKILL.md`.

**Checkpoint**: `npm test` green; `guard --format json` on this repo shows the three new fields on every finding; benchmark comparison reports no regressions.

## Phase 2: US1 + US2 — disposition and evidence on every output

- [ ] T008 [US1] `cli/writers/sarif.mjs`: emit `disposition`, `evidence.status`, `parserTier`, and `confidence` for every result (FR-007); extend `tests/sarif.test.mjs` to assert presence on a high-confidence finding.
- [ ] T009 [US1] `cli/commands/guard.mjs`: print `N to fix · M to review` in the summary (FR-008); `reportable[]` uses the T005 predicate.
- [ ] T010 [US1] `cli/validators/freshness.mjs`: remove the blanket `confidence: 'low'` map at the tail; per result, set `confidence: 'high'` when the counted quantity came from Git, `suggestion.kind: 'review'`, `disposition: 'escalate'` (FR-005). Update the adapter in `guard.mjs` (`r.confidence || 'low'` → pass-through).
- [ ] T011 [US1] Commit the freshness fixture builder (doc committed 2026-08-01, 12 backdated code commits) under `tests/fixtures/` or as a test helper; assert FRS002 → `escalate` / `high` / `not-measured` / `reportable: true` (SC-002).
- [ ] T012 [P] [US2] `cli/commands/explain.mjs`: no change to numbers; add one line stating the finding-level field that carries the same evidence.
- [ ] T013 [P] [US2] `docs-canonical/CI-RECIPES.md`: SARIF property reference updated.

**Checkpoint**: SC-001, SC-002 pass.

## Phase 3: US5 + FR-020 — constraints before any tuning

- [ ] T014 [P] [US5] Pointer comments referencing FR-018 at `cli/validators/freshness.mjs:274-275`, `cli/validators/doc-quality.mjs:32-45`, `cli/scanners/task-context.mjs:28`, `cli/validators/cross-reference.mjs:241`, `benchmarks/lib/precision-evidence.mjs` (minN) (FR-019).
- [ ] T015 [P] [US5] `tests/threshold-constraint.test.mjs`: assert each listed site carries the comment.
- [ ] T016 [US6] `cli/commands/guard.mjs`: summary prints `checked N of M validators`; badge colour capped at `green` when any active validator is `partial | missing-prerequisite | unsupported | error` (FR-020); test on a fixture with a missing prerequisite doc.
- [ ] T017 [P] [US6] `README.md` badge section: one sentence on what the colour means.

**Checkpoint**: SC-007 passes on this repository.

## Phase 4: US3 — run-time analyzer tier

- [ ] T018 [US3] **Investigate first**: why `scanRoutesDeep` did not select the Flask scanner for `src/main.py` with `requirements.txt` present, while `extractPythonFiles` returned both routes. Record the framework-gating rule in the task; adjust the fixture (not the gate) unless the gate is wrong.
- [ ] T019 [US3] `cli/shared-source.mjs`: `tierFor()` and `summarizeTiers()` (FR-010); unit tests for every branch (`ok:true`, `ok:false`, `null`, per-file `ok:false`, fallback-language extension).
- [ ] T020 [P] [US3] `cli/scanners/routes.mjs`: attach `tier`/`tierReason` to each route (FR-011).
- [ ] T021 [P] [US3] `cli/scanners/schemas.mjs`: attach `tier`/`tierReason` to each schema/model (FR-011).
- [ ] T022 [US3] `cli/validators/api-surface.mjs`, `docs-sync.mjs`, `schema-sync.mjs`: propagate `parserTier` to findings; set `applicability: partial` with cause + file count on any regex-fallback for an AST language (FR-012).
- [ ] T023 [US3] `cli/validators/traceability.mjs`, `diff-suspicion.mjs`, `security.mjs` (direct `parseJsTs` consumers): same propagation for `ok:false` files.
- [ ] T024 [US3] `cli/commands/guard.mjs`: tier counts line when any degraded tier is present (FR-008).
- [ ] T025 [US3] Differential test: Flask fixture, `PATH` with `node` + `git` only; assert applicability, `parserTier`, and finding presence differ as SC-004 states. Skip with a named reason when no interpreter is available on the CI host.
- [ ] T026 [P] [US3] `docs-canonical/ARCHITECTURE.md` language-tier table: add the run-time disclosure column.

**Checkpoint**: SC-004 passes; `architecture` and `environment` behaviour unchanged.

## Phase 5: US4 — feedback sampling and adjudication record

- [ ] T027 [US4] `cli/commands/feedback.mjs`: default selection = T005 predicate; print `K measured high-confidence finding(s) excluded; --all includes them` (FR-014); test on a 17-finding unmeasured fixture (SC-003).
- [ ] T028 [US4] `cli/feedback-fixture.mjs`: `buildAdjudicationContribution(manifest, { classification, rationale, date })` producing a corpus row with opposite control and attestations (FR-015); `feedback --preview` offers it beside the test-only template.
- [ ] T029 [US4] `benchmarks/lib/metrics.mjs`: per-code `adjudicated: { policyDisagreements, ambiguous }` integer counts; ratios untouched (FR-016). Test: adding a row leaves every ratio byte-identical.
- [ ] T030 [US4] `benchmarks/lib/compare.mjs`: removal of an adjudication row without a tombstone is a regression (FR-017).
- [ ] T031 [US4] Schemas: `schemas/docguard-benchmark-baseline.schema.json`, `schemas/docguard-precision-evidence.schema.json` — add `adjudicated`; bump envelope version per the existing versioning rule.
- [ ] T032 [US4] `benchmarks/lib/precision-evidence.mjs` + `npm run generate:precision-evidence`: project the counts into `cli/precision-evidence-data.mjs`; `cli/precision-evidence.mjs#describeEvidenceForCode` prints `N adjudicated disagreement(s) on record, not counted in precision`.
- [ ] T033 [US4] Author the first adjudication row deliberately (a reviewed `policy_disagreement` for one existing measured code) so the path is exercised end to end; re-review and regenerate the baseline (SC-005).
- [ ] T034 [P] [US4] `docs-canonical/DATA-MODEL.md` feedback and corpus paragraphs; `CONTRIBUTING.md` adjudication path.

**Checkpoint**: SC-003, SC-005, SC-006 pass.

## Phase 6: Closeout

- [ ] T035 Full suite; `node benchmarks/run.mjs --baseline benchmarks/baseline.json` reports no regressions; `docguard guard` passes on this repository; `npm pack --dry-run`.
- [ ] T036 `CHANGELOG.md` Unreleased entries per phase; `docguard specs --write`; `docguard reconcile --since <base>`; `docguard specs complete`.

## Dependencies

- Phase 1 blocks all. Phases 2 and 3 are independent of each other and of
  Phase 4. Phase 4 is independent of Phase 5. Phase 5 depends on Phase 1
  (`evidence`) and Phase 2 (`reportable[]` in guard output).
- Parallel opportunities: T006/T007; T012/T013; T014/T015/T017; T020/T021;
  T026; T034.

## Explicitly not in this task list

- Deriving `confidence` from measured precision.
- Any model, local or remote.
- Renaming `confidence`.
- A blanket audit of per-file `catch { continue }` sites.
