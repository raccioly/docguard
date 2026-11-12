# Tasks: Score and Section Checks Read the Canonical Documents the Configuration Names

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Tests come first. Every reproduction must fail on 0.47.0 before its fix lands (SC-001).

## Phase 1 — Failing tests first (SC-001)

- [x] T001 [US1] `tests/configured-canonical-paths.test.mjs`: the #625 reproduction for docQuality, its equality with the default layout, and the suggestion's `fix --doc` (FR-001, FR-004).
- [x] T002 [US2] Same file: STR003 for a relocated incomplete document, and none for complete ones (FR-002).
- [x] T003 [US1] Same file: ALCOA+ Original, Available and Contemporaneous for the relocated layout, and Original for a project with no documents (FR-003).
- [x] T004 [US3] Same file: the default layout, an explicit `docs.roles` mapping, and two same-named documents (FR-005).
- [x] T005 Run the file on the base code: 6 of 11 cases fail, every control passes.

## Phase 2 — Implementation

- [x] T006 [US1] [US2] `cli/shared-doc-roles.mjs`: `resolveDocPath`.
- [x] T007 [US1] `cli/commands/score.mjs`: docQuality through `resolveDocPath`, `--doc` from the role's file name, and the suggestion's base name.
- [x] T008 [US2] `cli/validators/structure.mjs`: STR003 and STR007 through `resolveDocPath`.
- [x] T009 [US1] `cli/commands/score.mjs`: `alcoaCanonicalDocs` and the Original and Available tests.
- [x] T010 [US4] `schemas/claimspec/v1/`, `cli/claimspec-schema.mjs`: re-pin to TestGuard v0.22.1 after checking the tag against its commit; tests for the pin, the `claimsSource` shape and the exported `path` entry (FR-006).

## Phase 3 — Docs and generated files (FR-007)

- [x] T011 `cli/findings.mjs` STR003 help; `npm run docs:reference`.
- [x] T012 `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `CHANGELOG.md` `[Unreleased]`.
- [x] T013 `docguard anchors accept --file … --bulk` for each touched anchored file; `docguard specs --write`.

## Phase 4 — Proof (SC-002, SC-003)

- [ ] T014 `npm test`, guard on this repository, and `npm run budget`.
- [ ] T015 Clone A/B of guard and score on this repository and every other local project: 0.47.0 against the branch, one fresh clone per CLI, run serially.
- [ ] T016 Review every changed finding and score by hand, then record the outcome.
