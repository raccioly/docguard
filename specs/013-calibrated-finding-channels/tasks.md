# Tasks: Calibrated Finding Channels

**Status**: Complete — all phases landed and verified
**Spec**: `specs/013-calibrated-finding-channels/spec.md`
**Plan**: `specs/013-calibrated-finding-channels/plan.md`

Format: `[ID] [P?] [Story] Description` — `[P]` = parallelizable (different
files, no dependency). One PR per phase.

## Phase 1: Contract and constructor (blocking)

- [x] T001 Add `disposition`, `evidence`, `parserTier` to the `Finding` typedef and `mkFinding` in `cli/findings.mjs`; derive `disposition` from `suggestion.kind`, default `escalate`; default `parserTier` to `not-applicable` (FR-001, FR-002, FR-006).
- [x] T002 In `mkFinding`, call `evidenceForCode(code)` and attach `{ status, n, precision?, precisionInterval, measuredOnRunningVersion }` (FR-004). `precision-evidence.mjs` must not import `findings.mjs` (no cycle).
- [x] T003 Omit suggestions with unsupported `kind` instead of coercing to `review`; add the omitted case to the built-in suggestion-shape tests (FR-003).
- [x] T004 Normalize object `location` to `file:line` in `mkFinding`; fix the emitter in `cli/validators/api-doc-smells.mjs:119` (FR-009).
- [x] T005 Replace the `reportable` predicate with `evidence.status === 'not-measured' || confidence === 'low'` (FR-014).
- [x] T006 [P] Tests: `tests/findings-channels.test.mjs` — constructor matrix for every `confidence`/`kind`/`location` input; `reportable` matrix against measured and unmeasured codes.
- [x] T007 [P] Contract docs (**skills initially missed — this task was marked complete before the skill files were touched; corrected in a follow-up commit**): `docs-canonical/DATA-MODEL.md` (findings row + "shape stays fixed" sentence → "additive only"), `docs-canonical/ARCHITECTURE.md`, `docs-canonical/REQUIREMENTS.md`, `docs-canonical/TEST-SPEC.md`, `AGENTS.md` (Consuming Guard Output), `extensions/spec-kit-docguard/skills/docguard-guard/SKILL.md`.

**Checkpoint**: `npm test` green; `guard --format json` on this repo shows the three new fields on every finding; benchmark comparison reports no regressions.

## Phase 2: US1 + US2 — disposition and evidence on every output

- [x] T008 [US1] `cli/writers/sarif.mjs`: emit `disposition`, `evidence.status`, `parserTier`, and `confidence` for every result (FR-007); extend `tests/sarif.test.mjs` to assert presence on a high-confidence finding.
- [x] T009 [US1] `cli/commands/guard.mjs`: print `N to fix · M to review` in the summary (FR-008); `reportable[]` uses the T005 predicate.
- [x] T010 [US1] `cli/validators/freshness.mjs`: remove the blanket `confidence: 'low'` map at the tail; per result, set `confidence: 'high'` when the counted quantity came from Git, `suggestion.kind: 'review'`, `disposition: 'escalate'` (FR-005). Update the adapter in `guard.mjs` (`r.confidence || 'low'` → pass-through).
- [x] T011 [US1] Freshness fixture builder (doc committed 2026-08-01, 12 backdated code commits); assert FRS002 → `escalate` / `high` / `not-measured` / `reportable: true` (SC-002). **Landed as an in-test helper in `tests/calibrated-channels-acceptance.test.mjs` rather than a committed fixture directory** — the repo builds git fixtures in-test elsewhere, and a checked-in git history is awkward to maintain.
- [x] T012 [P] [US2] `cli/commands/explain.mjs`: no change to numbers; add one line stating the finding-level field that carries the same evidence.
- [x] T013 [P] [US2] `docs-canonical/CI-RECIPES.md`: SARIF property reference updated.

**Checkpoint**: SC-001, SC-002 pass.

## Phase 3: US5 + FR-020 — constraints before any tuning

- [x] T014 [P] [US5] Pointer comments referencing FR-018 at `cli/validators/freshness.mjs:274-275`, `cli/validators/doc-quality.mjs:32-45`, `cli/scanners/task-context.mjs:28`, `cli/validators/cross-reference.mjs:241`, `benchmarks/lib/precision-evidence.mjs` (minN) (FR-019).
- [x] T015 [P] [US5] `tests/threshold-constraint.test.mjs`: assert each listed site carries the comment.
- [x] T016 [US6] `cli/commands/guard.mjs`: summary prints `checked N of M validators`; badge colour capped at `green` when any active validator is `partial | missing-prerequisite | unsupported | error` (FR-020); test on a fixture with a missing prerequisite doc.
- [x] T017 [P] [US6] `README.md` badge section: one sentence on what the colour means.

**Checkpoint**: SC-007 passes on this repository.

## Phase 4: US3 — run-time analyzer tier

- [x] T018 [US3] **Investigated; the gate was wrong.** `detectFramework` read `package.json` alone and returned '' for every Python/Go/Rust/Java/Ruby project, so `scanRoutesDeep` could never select their walkers. Fixed via `detectEcosystems`; the fixture was correct all along. Original task text: **Investigate first**: why `scanRoutesDeep` did not select the Flask scanner for `src/main.py` with `requirements.txt` present, while `extractPythonFiles` returned both routes. Record the framework-gating rule in the task; adjust the fixture (not the gate) unless the gate is wrong.
- [x] T019 [US3] `cli/shared-source.mjs`: `tierFor()` and `summarizeTiers()` (FR-010); unit tests for every branch (`ok:true`, `ok:false`, `null`, per-file `ok:false`, fallback-language extension).
- [x] T020 [P] [US3] `cli/scanners/routes.mjs`: attach `tier`/`tierReason` to each route (FR-011).
- [x] T021 [P] [US3] `cli/scanners/schemas.mjs`: attach `tier`/`tierReason` to each schema/model (FR-011).
- [x] T022 [US3] `cli/validators/api-surface.mjs`, `docs-sync.mjs`, `schema-sync.mjs`: propagate `parserTier` to findings; set `applicability: partial` with cause + file count on any regex-fallback for an AST language (FR-012).
- [x] T023 [US3] Direct `parseJsTs` consumers: same propagation for `ok:false` files. **Scope corrected during implementation** — `traceability.mjs` does not call `parseJsTs` at all (its `.ok` is a retirement-manifest read), so the real consumers are `diff-suspicion.mjs` and `security.mjs`. Both fail closed already: diff-suspicion returns "no drift" when either revision fails to parse, and security skips an unparsed file, so neither emits a finding that could carry a misleading tier. Left unchanged deliberately; see FR-012, which downgrades coverage rather than findings.
- [x] T024 [US3] `cli/commands/guard.mjs`: tier counts line when any degraded tier is present (FR-008).
- [x] T025 [US3] Differential test: Flask fixture, `PATH` with `node` + `git` only; assert applicability, `parserTier`, and finding presence differ as SC-004 states. Skip with a named reason when no interpreter is available on the CI host.
- [x] T026 [P] [US3] `docs-canonical/ARCHITECTURE.md` language-tier table: add the run-time disclosure column.

**Checkpoint**: SC-004 passes; `architecture` and `environment` behaviour unchanged.

## Phase 5: US4 — feedback sampling and adjudication record

- [x] T027 [US4] `cli/commands/feedback.mjs`: default selection = T005 predicate; print `K measured high-confidence finding(s) excluded; --all includes them` (FR-014); test on a 17-finding unmeasured fixture (SC-003).
- [x] T028 [US4] `cli/feedback-fixture.mjs`: `buildAdjudicationContribution(manifest, { classification, rationale, date })` producing a corpus row with opposite control and attestations (FR-015); `feedback --preview` offers it beside the test-only template.
- [x] T029 [US4] `benchmarks/lib/metrics.mjs`: per-code `adjudicated: { policyDisagreements, ambiguous }` integer counts; ratios untouched (FR-016). Test: adding a row leaves every ratio byte-identical.
- [x] T030 [US4] Removal of an adjudication row without a tombstone is a regression (FR-017). **No change to `benchmarks/lib/compare.mjs` was needed**: its existing `case-removed` rule already covers every case class, adjudication rows included. Pinned by `tests/adjudication-record.test.mjs` so a later refactor cannot quietly narrow it. <!-- docguard:ignore SPK010 — verified the existing rule already covers adjudication rows; no edit was required -->
- [x] T031 [US4] Schemas: `schemas/docguard-benchmark-baseline.schema.json`, `schemas/docguard-precision-evidence.schema.json` — add `adjudicated`; bump envelope version per the existing versioning rule.
- [x] T032 [US4] `benchmarks/lib/precision-evidence.mjs` + `npm run generate:precision-evidence`: project the counts into `cli/precision-evidence-data.mjs`; `cli/precision-evidence.mjs#describeEvidenceForCode` prints `N adjudicated disagreement(s) on record, not counted in precision`.
- [ ] T033 [US4] Author the first adjudication row in the reviewed corpus. **Deliberately left open.** Writing a synthetic `policy_disagreement` into `benchmarks/corpus.json` would mean inventing a user report and a maintainer decision, and recording it as reviewed evidence — the exact failure mode this feature exists to prevent. The path is exercised end to end by `tests/adjudication-record.test.mjs` and `tests/calibrated-channels-acceptance.test.mjs` (SC-005 verified there, on a synthetic row that never enters the committed corpus). The first real row belongs to the first real disagreement.
- [x] T034 [P] [US4] `docs-canonical/DATA-MODEL.md` feedback and corpus paragraphs; `CONTRIBUTING.md` adjudication path.

**Checkpoint**: SC-003, SC-005, SC-006 pass.

## Phase 6: Closeout

- [x] T035 Full suite; the benchmark run (`benchmarks/run.mjs`, invoked with `--baseline benchmarks/baseline.json`) reports no regressions; `docguard guard` passes on this repository; `npm pack --dry-run`. This task invokes those files rather than changing them. <!-- docguard:ignore SPK010 — a verification task runs its tools, it does not modify them -->
- [x] T036 `CHANGELOG.md` Unreleased entries per phase; `docguard specs --write`; `docguard reconcile --since <base>`; `docguard specs complete`.

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
