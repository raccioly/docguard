# Tasks: Strict by Default

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Tests come first. Each reproduction must fail on the v0.47.0 tag before the change. Private repository names never appear in a tracked file, a commit or a pull request.

## Stage A — truthful and explainable, mode selectable

### A0 — Compatibility gate (before anything else)

- [x] T001 `tests/strict-by-default.test.mjs`: load a configuration that carries `enforcement` (string and object forms) with the v0.47.0 CLI from a `git archive` copy; it must run guard without a configuration error (FR-002). If it fails, stop and report: the key must ship first in a release that only accepts it.

### A1 — Mode, exit code, output

- [x] T002 [US1] Failing tests: `"enforcement": "strict"` with an applicable validator that is `empty` exits 4 and lists it; a validator that does not apply is `skipped` with its evidence; a waiver removes it from the list (FR-006, FR-007).
- [x] T003 [US4] Failing tests: `"enforcement": "standard"` reproduces the v0.47.0 exit code on the same fixtures; no key resolves to `standard` in Stage A and the mode line says so (FR-001, FR-016, FR-019).
- [x] T004 [US3] Failing test: the closed list of codes that can exit 1 under the 0.47.0 defaults, derived by running the v0.47.0 registry, equals the list in the plan (FR-008).
- [x] T005 `cli/config.mjs` `resolveEnforcement`; `cli/enforcement.mjs`; `schemas/docguard-config.schema.json`.
- [x] T006 `cli/commands/guard.mjs`: `exitFor` under strict, the Adopt block, the mode line, JSON `enforcement` and `strict`; SARIF and JUnit rendering of an unexamined validator (FR-014 to FR-016).
- [x] T007 [US4] `cli/commands/upgrade.mjs`: the read-only strict report (FR-018), with a test that it writes nothing.

### A2 — Performed checks, causes, applicability

- [x] T008 [US1] Failing tests: `deriveVerdict` returns `empty` for a result with zero performed checks and no findings; Requirement-Anchors enabled with zero anchors is `empty`; a Doc-Ownership entry with a placeholder purpose is a finding (FR-004).
- [x] T009 [US2] `tests/validator-applicability.test.mjs`: for every registered validator, one fixture where it applies and is empty and one where it does not apply. Assert the cause, a non-empty `howToConfigure`, `applies`, and that applying the fix to the fixture makes the validator perform at least one check. The test enumerates the registry, so a new validator without fixtures fails it (FR-005, FR-006, SC-006).
- [x] T010 [US2] Failing tests: no two validators share an empty reason sentence; no validator returns `empty` without a cause (FR-005).
- [x] T011 `cli/validator-coverage.mjs`: the performed-check count in the result contract, the cause set, `applies`.
- [x] T012 Each validator in `cli/validators/`: report performed checks, implement `applies(project)` from the project's files, and own its causes and `howToConfigure`. Verify each against the code, using the audit inventories only as a starting map. Split by family if one session cannot hold all 37.

### A3 — Security classification

- [x] T013 [US3] Failing tests: a secret-shaped literal in a test path keeps its level and carries `context: test-path`; `isGatingEligible` is false for it; a value that is provably synthetic by its own text produces no finding; the existing field-context tests stay unmodified and green (FR-010).
- [x] T014 `cli/validators/security.mjs` (context, the gating-eligibility predicate, the placeholder vocabulary) and precision-evidence rows per context.

### A4 — Dogfood and proof

- [x] T015 DocGuard's own `.docguard.json` sets `"enforcement": "strict"`; each unexamined validator is fixed or waived with a reason, an owner and an expiry (FR-020, SC-005).
- [x] T016 Hermetic A/B against v0.47.0, `standard` mode, on the eight audit repositories and on DocGuard: no difference beyond FR-004 verdict corrections (SC-003). Record the result by kind of project.
- [x] T017 Strict on the same eight: label every validator reported as "applies here, examined nothing" and apply its fix (SC-001). A validator that fails the label goes back to T012.
- [x] T018 Docs for Stage A: `docs/configuration.md`, `docs/commands.md`, DATA-MODEL, ARCHITECTURE, `npm run docs:reference`, `npm run llms`, CHANGELOG; `docguard specs --write`; `anchors accept` for touched anchored files.

### A5 — Fixes from the Stage A proof (`verification.md`)

- [x] T018a FR-007 as amended: only a validator with zero checks and cause `needs-declaration` or `needs-content` (or one that could not observe at all) exits 4; partial results and `layout-not-recognized` go to a "could not read" list in text and JSON. Failing tests first.
- [x] T018b `applies` defects: Metadata-Sync on a package marked private or never published; API-Surface on a project with a UI framework and no route; Generated-Staleness reading a draft status out of body text; Spec-Registry returning `empty` with no cause after comparing specs; Requirement-Anchors counting template placeholder rows as requirement IDs.
- [x] T018c Documents kept outside `docs-canonical/`: a validator whose document the project maps through `docs.roles` (spec 093) reads it there, and its fix text names the mapping before it suggests creating a file.
- [x] T018d Fix texts: no text tells a project to move code or documents; Test-Spec accepts the older "Service-to-Test Map" heading; Requirement-Anchors says where a Spec ID comes from; Doc-Dependency and Requirement-Anchors examples name a product source file, not a configuration file; Metadata-Sync names the workspace package it read.
- [x] T018e Run the proof again (T016, T017) and update `verification.md`.

- [x] T018f From the second proof run: Metadata-Sync applies only when a document states a version (a consistency check does not ask for something to compare); Requirement-Anchors does not count decision, open-item or task IDs as requirement IDs; the Docs-Diff fix text offers the `docs.roles` mapping for the architecture document; the Test-Spec fix text names both map headings. Then re-check only the affected rows.

- [x] T018g From the third proof pass: Metadata-Sync counts only a version stated for this package (another tool's minimum version in a guide is not one); Requirement-Anchors is not applicable when the only identifiers are decision, open-item or task IDs (its unread-form branch must not treat them as requirement-like), and template placeholder rows are not counted anywhere; Traceability reports requirements traced as its performed count, does not count placeholder rows as requirements, and does not pass on a project with no requirement; the Docs-Diff mapping offer finds an architecture document in a subfolder. Then re-check the affected rows.

- [x] T018h From the fourth proof pass (SC-001 met; SC-003 not): the placeholder-row rule drops real requirements whose text mentions a slot-like token in prose (`{file}`, `{name}`, `<region>`); a row is a template row only when nothing but the slot carries the requirement. The Docs-Diff mapping offer must not list wrong candidates. Then re-check `standard` against `main` on the affected repositories.

## Stage B — the default changes

- [x] T019 [US1] Failing tests: no `enforcement` key resolves to `strict`; every registered validator runs whatever the profile or the project's own `validators` block says; a `validators.<key>: false` entry is not honored under strict and is reported in one line with the two ways to switch a validator off on purpose (FR-001, FR-003 as amended).
- [x] T020 [US3] Failing tests: under strict an intrinsic error of Security or Architecture is a warning until its code is gating; a code in the closed list stays an error; `findingSeverity` overrides in both directions (FR-008).
- [x] T021 [US3] Failing test: the gating set is derived from the evidence and a code without evidence that meets the bar cannot be in it (FR-009).
- [x] T022 [US5] Failing tests: an item the additions table lists under the running or previous minor is labeled "new in vX.Y"; with `asOf` set, a later item is pending and does not affect the exit code; a validator or gating code missing from the table fails a test (FR-012, FR-013).
- [x] T023 [US4] Failing tests: `guard --update-baseline` under strict; the baselined count on every run and in JSON; an uninitialized project still exits 3 with one line (FR-011, US4 scenario 3).
- [x] T024 [US6] Failing tests: `init` writes no key by default; `--enforcement standard` writes it; the wizard writes it only for a non-default answer; the closing text states the mode (FR-017).
- [x] T025 Implementation: `resolveEnforcement` default, `cli/shared.mjs` `resolveFindingEnforcement`, `cli/precision-evidence.mjs` gating set, `cli/strict-additions.mjs`, `cli/commands/init.mjs`.
- [x] T025a [US1] Suspect reviews (FR-021): failing tests, then Freshness treats a reviewed agent-instruction document whose review is suspect, or one with no review record, as applies-and-unexamined with the re-review fix. Needs spec 095's review-signal functions on this branch.
- [x] T026 The issue 628 fixture (SC-004), with spec 095's codes where they are available.
- [x] T027 Strict on the eight audit repositories: open and label every finding that fails a build (SC-002). Repeat T016 and T017 on the Stage B build.
- [x] T028 Docs: README quick start, `docs/upgrading-to-strict.md`, CI-RECIPES, `action.yml`, the Spec Kit extension's guard command, the breaking-change CHANGELOG entry (FR-022); `docguard specs --write`; `anchors accept`.

- [x] T028a From the Stage B proof (SC-001 and SC-002 met; SC-003 met once FR-019 lists spec 095's codes): `docguard review --accept` with several paths records every one or refuses; a blocking row for unexamined documents states the document cause, never "<validator> is pass".
- [x] T028b Port from spec 096: FRS002 ranked and capped at three per run; the "possibly stale" mark on agent and MCP excerpts.

## Stage C — evidence

- [ ] T029 Grow the precision corpus so codes can reach the bar; the eight audit repositories stay a holdout and are never used to tune a rule.
- [ ] T030 Spec 095's history-replay benchmark feeds FRS006 and FRS007 evidence; they become gating by FR-009, not by a default severity (FR-021).
- [ ] T031 `docguard policy` shows each code's gating status and what it lacks.
