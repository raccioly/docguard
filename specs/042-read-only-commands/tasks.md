# Tasks: Read-Only Commands Write Nothing

**Status**: In progress.
**Spec**: `specs/042-read-only-commands/spec.md`
**Plan**: `specs/042-read-only-commands/plan.md`

## Phase 1: Tests first (each reproduces a reported bug before the fix)

- [ ] T001 `tests/read-only-commands.test.mjs`: build a temporary git project
  without `.agent/`, then run each read, report, check and preview invocation
  in a fresh copy of it. Assert that `git status` and the file listing outside
  `.git/` and `.docguard/` are unchanged, and that no Spec Kit hint is
  printed. Must fail before the fix for `rules --for`, `generate --spec`,
  `sync`, `reconcile`, `upgrade` and an unknown command (FR-001–FR-004,
  SC-001).
- [ ] T002 `tests/read-only-commands.test.mjs`: explicit writers other than
  `init` (`generate --plan --write`, `sync --write`, `hooks --claude`) create
  no `.agent/` or `.specify/` (FR-004). `init` still installs skills and
  commands, and a second `init` rewrites none of them (FR-001, SC-003).
- [ ] T003 `tests/read-only-commands.test.mjs`: state directory tests.
  - A run that writes the plan cache leaves `git status` clean, and `git add
    -A` stages nothing under `.docguard/`.
  - An existing `.docguard/.gitignore` is kept.
  - A symlinked `.docguard` is not written through.
  - Each writer (history, fix memory, feedback, nudge state, context pack,
    active context) leaves the ignore file behind (FR-005).
- [ ] T004 `tests/read-only-commands.test.mjs`: dirty checks ignore
  `.docguard/`, including committed files that a later run rewrites. Covers
  `memory --pack`'s `dirty`, `getHeadInfo`, and `nonLifecycleChanges`. A
  change outside `.docguard/` still counts (FR-006, SC-002).
- [ ] T005 `tests/read-only-commands.test.mjs`: the docs describe the rule
  and the state directory (FR-007).
- [ ] T006 `tests/ensure-skills-idempotent.test.mjs`: drive `init` instead of
  the bare `generate` that used to scaffold.

## Phase 2: Implementation

- [ ] T007 `cli/docguard.mjs`: remove the global `ensureSkills` call and
  `READ_ONLY_COMMANDS` (FR-001–FR-004).
- [ ] T008 `cli/writers/state-dir.mjs`: `ensureStateDir`. Route every
  `.docguard/` writer through it (FR-005).
- [ ] T009 `cli/shared-git.mjs`, `cli/scanners/semantic-claims.mjs`,
  `cli/scanners/revision-anchor.mjs`: `OWN_STATE_PATHSPEC` in the three dirty
  checks (FR-006).

## Phase 3: Docs and verification

- [ ] T010 `docs-canonical/SECURITY.md`, `DATA-MODEL.md`, `ENVIRONMENT.md`,
  `ARCHITECTURE.md`, `CHANGELOG.md` (FR-007).
- [ ] T011 Registry entry (`.docguard-specs.json`), then `docguard specs
  --write` and `npm run llms`.
- [ ] T012 `testguard.claims.json`: claim READ-ONLY-COMMANDS-WRITE-NOTHING,
  probed with `--confirm 3`. Then the gate, `npm test` and `docguard guard`.
