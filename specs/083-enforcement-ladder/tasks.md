# Tasks: Required Checks and Evidence-Based Rule Promotion

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Tests come first. The US1 reproductions must fail on the 081 commit before the change.

## Phase 1 — Failing tests first

- [x] T001 [US1] `tests/enforcement-ladder.test.mjs`: `requiredChecks: ["apiSurface"]` with no API reference exits 4 and names API-Surface. With a matching reference it does not exit 4 (FR-001). (SC-001: 9 of the 10 tests fail on v0.45.2; the no-requiredChecks control passes, as it should)
- [x] T002 [US1] Same file: required `drift` with no DRIFT comments (`empty`) exits 4. With a reasoned N/A marker it passes (FR-001, FR-002).
- [x] T003 [US1] Same file: required and disabled → `REQ001` error, exit 1. Unknown key → `REQ002` naming the valid keys, and the other requirements still apply (FR-002, FR-003).
- [x] T004 [US1] Same file: no `requiredChecks` → no `requiredChecks` result in the validator list, and exit code unchanged (SC-002 control).
- [x] T005 [US1] Same file: `ci` with an undecided required check → readiness BLOCKED with `CI_REQUIRED_CHECK_UNDECIDED` (FR-004).
- [x] T006 [US3] Same file: two `ci --format json` runs; the history entries carry `docguardVersion`, `codes` (`{ n, level }`) and `verdicts` (FR-005).
- [x] T007 [US2] Same file: `buildPolicyReport` with synthetic history: ready-to-promote, noisy-blocking, insufficient evidence (fewer than `window`), entries with gaps excluded, old entries without `codes` skipped and counted; and the `policy --format json` CLI writes nothing (FR-006 to FR-010).

## Phase 2 — Implementation

- [x] T008 `cli/required-checks.mjs`.
- [x] T009 `cli/commands/guard.mjs`: the synthetic result, exit 4 in `exitFor`, and text output.
- [x] T010 `cli/assessment.mjs` and `cli/commands/ci.mjs` (readiness and history fields).
- [x] T011 `cli/commands/policy.mjs`, plus `cli/docguard.mjs` dispatch and help.
- [x] T012 `cli/findings.mjs` REQ001 and REQ002; `schemas/docguard-config.schema.json` `requiredChecks`.

## Phase 3 — Docs and generated files

- [x] T013 `docs-canonical/DATA-MODEL.md` (requiredChecks, history fields, policy report), `ARCHITECTURE.md` (Required checks and policy row), `TEST-SPEC.md` row; `docs/commands.md` (`policy`, exit 4 from required checks); `docs/configuration.md`; `npm run docs:reference`; `CHANGELOG.md`; `npm run llms`.
- [x] T014 `docguard specs --write`; `anchors accept` for touched anchored files.

## Phase 4 — Proof

- [x] T015 `npm test`, `guard`, `npm run budget`.
- [x] T015a `cli/commands/guard.mjs`: an advisory-only validator renders as an informational row; test in `tests/enforcement-ladder.test.mjs` (FR-012)
- [x] T017 SC-003: once this repository has 5 or more CI history entries, run `docguard policy` and check each recommendation by hand against the run logs (12 replayed entries; CI now keeps the history)
- [x] T016 Hermetic A/B against the 081 commit on every local project (SC-002).

## Verification record (2026-11-03)

- Delivered in commit 1ea9f3c. `tests/enforcement-ladder.test.mjs` passes. The hermetic A/B of 1ea9f3c against v0.45.2 changed no exit code (T016). The final branch A/B is in spec 082's Verification Notes.
