# Tasks: Honest Spec Kit Integration

**Status**: Not started.
**Spec**: `specs/048-spec-kit-integration-honesty/spec.md`
**Plan**: `specs/048-spec-kit-integration-honesty/plan.md`

## Phase 1: Tests first (each reproduces its bug before the fix)

- [x] T001 `tests/spec-kit-integration-honesty.test.mjs`: a stub `specify`
  reproducing Spec Kit 1.0.13's files. Generic init leaves both mandatory
  hooks resolvable; a removed hook file suppresses "hooks active" and names
  the hook (FR-001, FR-002, SC-001).
- [x] T002 Same file: a registered 0.40.0 triggers one
  `extension add --dev --force --priority`; an equal version makes no call; a
  disabled entry is not touched (FR-003, SC-002).
- [x] T003 Same file: `upgrade` reports stale agent files without writing;
  `upgrade --apply` refreshes them (FR-004).
- [x] T004 Same file: every command and skill file states the runner rule
  with a pin equal to `package.json`; the release sync moves every pin
  (FR-005, SC-003).
- [x] T005 Same file: hints in a Claude project, in a generic project and
  with no Spec Kit name only existing commands (FR-006, SC-004).
- [x] T006 Same file: `--no-spec-kit` makes no `specify` call and still
  installs skills; `init --help` lists both flags (FR-007).
- [x] T007 Same file: one floor across manifest, constant, README and
  ENVIRONMENT; a `specify` below it is neither initialized nor registered
  (FR-008, SC-006).
- [x] T008 Same file: a Claude project gets `.claude/skills/docguard-*` and no
  `.agent/`; the summary counts Spec Kit's files (FR-009, FR-010, SC-005).
- [x] T009 Same file: the docs describe the behaviour (FR-011).

## Phase 2: Implementation

- [x] T010 `cli/agent-surface.mjs` (FR-002, FR-006, FR-009).
- [x] T011 `cli/spec-kit-delegation.mjs` (FR-001, FR-002, FR-003, FR-008).
- [x] T012 `cli/ensure-skills.mjs`, `cli/commands/init.mjs`,
  `cli/docguard.mjs` (FR-007, FR-009, FR-010).
- [x] T013 `cli/commands/upgrade.mjs` (FR-004).
- [x] T014 Hints in `guard`, `diagnose`, `verify`, `setup`, `fix`, `sync`,
  `memory`, `findings` (FR-006).
- [x] T015 Command files and skills; release sync and path allowlist
  (FR-005).

## Phase 3: Docs and verification

- [x] T016 README, `docs/commands.md`, extension README,
  `docs-canonical/ARCHITECTURE.md`, `docs-canonical/ENVIRONMENT.md`,
  CHANGELOG (FR-011).
- [x] T017 Verify against the real `specify` 1.0.13 (generic and Claude,
  version refresh); claim SPEC-KIT-HOOKS-RESOLVE-HONESTLY probed
  `--confirm 3`; gate; `npm test`; `npm run llms`; `specs --write`; `guard`.
