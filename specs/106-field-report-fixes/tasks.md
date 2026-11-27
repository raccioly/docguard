# Tasks: Field-Report Fixes

**Spec**: `specs/106-field-report-fixes/spec.md`
**Plan**: `specs/106-field-report-fixes/plan.md`

## Phase 1: Reproduce

- [x] T001 Build the seven issue trees with the v0.50.0 code and record what each reports.
- [x] T002 `tests/field-report-fixes.test.mjs`: one test per issue tree; run it on the base code and record that each fails.

## Phase 2: Implementation

- [x] T003 FR-001, FR-002: strict demotion follows the merged config; the demoted-secrets line; the corpus property test.
- [x] T004 FR-003: `cli/shared-languages.mjs`.
- [x] T005 FR-004: secret scan reads Apex and Visualforce; SEC011 names unscanned languages.
- [x] T006 FR-005, FR-006: Apex tests and tags; `detectTests` uses `isTestSource`.
- [x] T007 FR-007: Salesforce DX profile and project type.
- [x] T008 FR-008: SPK008 tiers b and c.
- [x] T009 FR-009, FR-010: non-credential shapes; Storybook and `test-utils` context.
- [x] T010 FR-011 to FR-013: `exitCode` and `outcome`; the two schemas; docs; the ci summary.
- [x] T011 FR-014, FR-015: DCV003 documentation folders; TRC002 and unedited scaffolds.

## Phase 3: Verification

- [x] T012 FR-016: CHANGELOG, `docs/`, `npm run llms`, `npm run docs:reference`.
- [x] T013 `npm test` by exit code, the CI lint, `docguard guard` on this repository.
- [x] T014 Hermetic A/B against v0.50.0 on DocGuard, the benchmark corpus and the other local repositories.
- [x] T015 Scrub check, pull request, CI, merge.
