# Tasks: Counts, Untouched Claims, Diff Overlap and Router Auth Say Only What They Can Prove

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Tests come first. Every reproduction must fail on 0.45.1 before its fix lands (SC-001).

## Phase 1 — Failing tests first (SC-001)

- [x] T001 [US1] `tests/consumer-report-precision.test.mjs`: the #593 reproduction, a stale comma count and its `fix --write` result, plain digits, ratio and identifier collateral, and a comma validator count (FR-001).
- [x] T002 [US1] Same file: `FR365`, `FR-365`, `#365` and `v3.65` with a stale and a correct control, `1,200 tests`, and an identifier before `checks` (FR-002).
- [x] T003 [US1] Same file: the #596 sentences, `test suites` and `test modules`, and `test cases` and `tests` as controls (FR-003).
- [x] T004 [US2] Same file: the #597 reproduction, an ignored directory claim, and a force-added tracked file as a control (FR-004).
- [x] T005 [US3] Same file: the #598 inventory shape, a shared table, a nearby claim, a heading that owns its subsection, and a fenced heading (FR-005).
- [x] T006 [US4] `tests/router-routes-unresolved.test.mjs`: an unreadable `use()` path with auth, the literal and path-less controls, and one-argument and non-auth calls (FR-006).
- [x] T007 Run both files on the base code: 17 of 27 cases in the first file fail, every control passes. In the second, the unreadable-path case and the non-auth case fail against Jules's version.

## Phase 2 — Implementation

- [x] T008 [US1] `cli/validators/metrics-consistency.mjs`: `COUNT_START`, the separator alternation for every count, `NOT_A_CASE_COUNT`, and quoted text in MET001 and MET002.
- [x] T009 [US1] `cli/writers/mechanical.mjs`: `applyReplaceCount` matches either spelling behind the same lookbehind and keeps the doc's grouping.
- [x] T010 [US2] `cli/scanners/speckit.mjs`: `unobservablePaths`, applied in `detectUntouchedClaims`.
- [x] T011 [US3] `cli/validators/diff-suspicion.mjs`: `headingLevels`, `referenceContext`, and the reference lines from `referenceKind`.
- [x] T012 [US4] `cli/scanners/router-routes.mjs`: `unreadScope` in the non-mount `use()` branch.
- [x] T013 `tests/anchor-cache.test.mjs`: explicit `env`, `fixtureGit` and `git init -b main` (SC-004).

## Phase 3 — Docs and generated files (FR-008)

- [x] T014 `cli/findings.mjs` help for MET001, MET003, SPK010 and DSP001; `npm run docs:reference` regenerates `docs/reference/findings.md`.
- [x] T015 `docs/reference/languages.md` Koa row; `CHANGELOG.md` `[Unreleased]` Fixed entries.
- [x] T016 `docguard specs --write`; `docguard anchors accept --file … --bulk` for each touched anchored file, after rebuilding the lock from main.

## Phase 4 — Proof (SC-002, SC-003)

- [x] T017 `npm test`, guard on this repository, and `npm run budget`.
- [x] T018 Archive A/B on this repository and every project under `~/Repo_claude`: 0.45.1 against the branch, one fresh copy per CLI, run serially.
- [x] T019 Clone A/B for SPK010 and DSP001, including the reporting project at the reported commit.
- [x] T020 Review every changed finding by hand, then fill in Implementation Outcomes.
- [x] T021 `tests/unreadable-git-metadata.test.mjs`: accept the CI runners' newer git wording for a broken gitfile, which failed every PR (the product reports git's own line). Add an FR-008 docs test to `tests/consumer-report-precision.test.mjs`.
