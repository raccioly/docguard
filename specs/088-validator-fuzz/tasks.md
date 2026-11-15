# Tasks: Validator Fuzz Harness

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1 — The harness

- [x] T001 [US1] `tools/fuzz.mjs`: seeded generator, grammar and blocks, properties, pathological set (FR-001, FR-002)
- [x] T002 [US2] Shrinking, `--save` to `tests/fixtures/fuzz/` (FR-001)

## Phase 2 — Findings fixed

- [x] T003 Probe at about 200 KB; fix `stripHtmlComments`'s quadratic re-masking; differential proof against the old code (FR-004)

## Phase 3 — Tests, docs and proof

- [x] T004 [US1] [US2] `tests/validator-fuzz.test.mjs`: fixed seed, planted faults, reach per parser, fixture replay (FR-003, SC-001)
- [x] T005 TEST-SPEC, CONTRIBUTING, CHANGELOG, `npm run fuzz` (FR-005)
- [x] T006 Six seeds of 3,000 cases (SC-002); suite time (SC-003)

## Phase 4 — Follow-up

- [x] T007 2026-11-15 Issue 693: `--seed 7 --cases 3000` crashed with `Invalid string length`; `backtickRefs` gave every reference its whole line, so output was quadratic in a line of many tokens. `text` is now capped at `REF_TEXT_MAX`; the harness reports an unserializable result as `oversized`; the shrunk case is a pathological input and a unit test (FR-002, FR-004)
