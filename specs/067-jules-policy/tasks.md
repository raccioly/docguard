# Tasks: Jules Automation Policy

**Status**: Complete. SC-001: `tests/jules-policy.test.mjs` (47 tests) failed before the policy existed and passes now, with replays of #324, #421, #451, #516 and the empty #305/#316/#327; SC-002: full suite 3,328 tests pass, guard passes (2,031 checks), `specs --check` current.
**Spec**: `specs/067-jules-policy/spec.md`
**Plan**: `specs/067-jules-policy/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/jules-policy.test.mjs`: merge gate with replays of #324, #421, #451, #516 and the paths the old filter admitted (FR-001); auto-merge workflow reads the verified head and pins the merge (FR-002); noise, duplicates, declines, queue cap, no subject rule, contracts (FR-003 – FR-006, FR-008); triage glue against an in-memory GitHub double, across pages, with no handle (FR-004, FR-007); preflight targets and STOP rules (FR-009, FR-010); setup, rules, routines and retired notes as files (FR-011 – FR-013). See them fail.

## Phase 2: Implementation

- [x] T002 FR-001, FR-003 – FR-010: `.github/scripts/jules-policy.mjs`
- [x] T003 FR-004, FR-007: `.github/scripts/jules-triage.mjs`, `.github/workflows/jules-triage.yml`
- [x] T004 FR-001, FR-002: `.github/workflows/auto-merge.yml`
- [x] T005 FR-009 – FR-012: `.jules/preflight.mjs`, `.jules/setup.sh`, `.jules/RULES.md`, `.jules/README.md`, `.jules/routines/*.md`; remove `.jules-setup.sh`
- [x] T006 FR-013: remove the persona notes; `AGENTS.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`

## Phase 3: Docs and verification

- [x] T007 `CHANGELOG.md`; `npm run llms`; `docguard specs --write`; `docguard guard`; `npm test` (SC-002)
