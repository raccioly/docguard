# Tasks: DORA Evidence

Built from [plan.md](plan.md) and [spec.md](spec.md).

## Phase 1 — The DORA view

- [x] T001 [US1] Export `domainAccuracy` from `cli/commands/memory.mjs` (FR-002)
- [x] T002 [US1] `cli/commands/score-dora.mjs`: the eight documentation items with evidence and `improve` (FR-002, FR-004)
- [x] T003 [US2] `cli/commands/score-dora.mjs`: the seven AI capabilities, small batches via `runGit`, version control and AI stance (FR-003)
- [x] T004 [US1] `score --dora` in `cli/commands/score.mjs` and `cli/docguard.mjs`, human and JSON; no change without the flag (FR-001)
- [x] T005 [US1] `schemas/docguard-dora.schema.json` (FR-004)

## Phase 2 — Trusted MCP context

- [x] T006 [US3] Sensor cache keeps `fileCodes`; `docsForPath` adds the `docs` map (FR-005)

## Phase 3 — Tests, docs and proof

- [x] T007 Tests in `tests/dora-evidence.test.mjs` for every acceptance scenario, plus the byte-identity check without `--dora` (SC-001, SC-003)
- [x] T008 Docs: commands, ai-integration, ARCHITECTURE, DATA-MODEL, TEST-SPEC, CHANGELOG (FR-006)
- [x] T009 Run on this repository and record the scores in Verification Notes (SC-002)
