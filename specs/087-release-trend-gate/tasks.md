# Tasks: Release Trend Gate

Built from [plan.md](plan.md) and [spec.md](spec.md).

## Phase 1 — The comparison tool

- [x] T001 [US1] `tools/release-ab.mjs`: fresh copies, serial guard runs, fingerprint multiset, validator and exit comparison (FR-001)
- [x] T002 [US1] Changelog judging: changed codes named, `Exit codes:` line, uncomparable directories fail (FR-002)
- [x] T003 [US1] `release-gate.json` with corpus and `volatileCodes`, validated by `loadGateConfig` (FR-004)

## Phase 2 — The release workflow

- [x] T004 [US2] [US3] `release.yml` `release-gate` job: previous tag, `release-ab`, `budget.mjs ab`, benchmark against the released baseline; a notice with no previous tag (FR-003)

## Phase 3 — Tests, proof and docs

- [x] T005 Tests with two synthetic CLI trees for every acceptance scenario (SC-001)
- [x] T006 Run between v0.45.2 and this branch; record every change and its changelog explanation in Verification Notes (SC-002)
- [x] T007 Docs: CI-RECIPES or contributing, TEST-SPEC, CHANGELOG (FR-005)
- [x] T008 SC-003: measure the `release-gate` job on the first release that runs it, and record its time (v0.46.0: 5 min 10 s in parallel with tests; no wall-time added)
