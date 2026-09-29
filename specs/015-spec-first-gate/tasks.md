# Tasks: Spec-First Change Gate

**Status**: Complete — SC-004 replay recorded in the PR (14 of 19 governed merges uncovered)
**Spec**: `specs/015-spec-first-gate/spec.md`
**Plan**: `specs/015-spec-first-gate/plan.md`

## Phase 1: Classifier (US1–US3)

- [x] T001 [US1] `cli/scanners/spec-first.mjs`: `collectChange()` (merge base, bounded inventory via `getDiffSnapshot`, commit messages) and `classifySpecFirst()` (governed filter, references, exemption) per FR-001–FR-005.
- [x] T002 [US1] `cli/commands/specs.mjs` + `cli/docguard.mjs`: `specs require --since <ref> [--message-file <path>] [--format json]`, exit 0/1/2 (FR-006, FR-007); help text.
- [x] T003 [P] `tests/spec-first.test.mjs`: temporary Git repo covering not-governed, uncovered, covered by path, covered by ID, covered by spec edit, unresolved reference, valid/invalid exemption, default governed set, unknown ref → inconclusive, JSON shape.

## Phase 2: Enforcement in this repository (FR-008, FR-010)

- [x] T004 `.docguard.json`: `specFirst.paths: ["cli/**"]`.
- [x] T005 `.github/workflows/ci.yml`: `spec-first` job on `pull_request`; PR body passed through `env` into a file; fails on exit 1 and 2.
- [x] T006 `.github/workflows/scheduled-release.yml`: add `Spec-Exempt: release — …` to the release PR body.
- [x] T007 `action.yml`: `command: spec-first` branch reading `PR_BODY`/`BASE_REF` from env; inconclusive fails.

## Phase 3: Documentation and verification

- [x] T008 [P] `AGENTS.md` rule (FR-009); `docs-canonical/CI-RECIPES.md` recipe; `docs-canonical/ARCHITECTURE.md` row; `README.md` specs row.
- [x] T009 SC-004: run the check over this repository's last 40 merges and record the distribution in the PR.
- [x] T010 `CHANGELOG.md`; `npm run llms`; `docguard specs --write` after staging; `docguard guard`; `npm test`.
