# Tasks: Required Checks and Evidence-Based Rule Promotion

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Tests come first. The US1 reproductions must fail on the 081 commit before the change.

## Phase 1 — Failing tests first

- [ ] T001 [US1] `tests/enforcement-ladder.test.mjs`: `requiredChecks: ["apiSurface"]` with no API reference exits 4 and names API-Surface. With a matching reference it does not exit 4 (FR-001).
- [ ] T002 [US1] Same file: required `drift` with no DRIFT comments (`empty`) exits 4. With a reasoned N/A marker it passes (FR-001, FR-002).
- [ ] T003 [US1] Same file: required and disabled → `REQ001` error, exit 1. Unknown key → `REQ002` naming the valid keys, and the other requirements still apply (FR-002, FR-003).
- [ ] T004 [US1] Same file: no `requiredChecks` → no `requiredChecks` result in the validator list, and exit code unchanged (SC-002 control).
- [ ] T005 [US1] Same file: `ci` with an undecided required check → readiness BLOCKED with `CI_REQUIRED_CHECK_UNDECIDED` (FR-004).
- [ ] T006 [US3] Same file: two `ci --format json` runs; the history entries carry `docguardVersion`, `codes` (`{ n, level }`) and `verdicts` (FR-005).
- [ ] T007 [US2] Same file: `buildPolicyReport` with synthetic history: ready-to-promote, noisy-blocking, insufficient evidence (fewer than `window`), entries with gaps excluded, old entries without `codes` skipped and counted; and the `policy --format json` CLI writes nothing (FR-006 to FR-010).

## Phase 2 — Implementation

- [ ] T008 `cli/required-checks.mjs`.
- [ ] T009 `cli/commands/guard.mjs`: the synthetic result, exit 4 in `exitFor`, and text output.
- [ ] T010 `cli/assessment.mjs` and `cli/commands/ci.mjs` (readiness and history fields).
- [ ] T011 `cli/commands/policy.mjs`, plus `cli/docguard.mjs` dispatch and help.
- [ ] T012 `cli/findings.mjs` REQ001 and REQ002; `schemas/docguard-config.schema.json` `requiredChecks`.

## Phase 3 — Docs and generated files

- [ ] T013 `docs-canonical/DATA-MODEL.md` (requiredChecks, history fields, policy report), `ARCHITECTURE.md` (Required checks and policy row), `TEST-SPEC.md` row; `docs/commands.md` (`policy`, exit 4 from required checks); `docs/configuration.md`; `npm run docs:reference`; `CHANGELOG.md`; `npm run llms`.
- [ ] T014 `docguard specs --write`; `anchors accept` for touched anchored files.

## Phase 4 — Proof

- [ ] T015 `npm test`, `guard`, `npm run budget`.
- [ ] T016 Hermetic A/B against the 081 commit on every local project (SC-002).
