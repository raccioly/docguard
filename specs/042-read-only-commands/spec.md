# Feature Specification: Read-Only Commands Write Nothing

**Feature Branch**: `fix/read-only-commands`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.read-only-commands`

**Lineage**:
- Extends `docguard.specify-init-delegation` (spec 014). Its FR-009 already
  says only an explicit `docguard init` may initialize Spec Kit. This spec
  applies the same rule to DocGuard's own agent skills and slash commands.
- Replaces the v0.26 dispatcher rule, a deny-list of read-only commands
  (`READ_ONLY_COMMANDS` in `cli/docguard.mjs`). Every command missing from
  that list scaffolded, including ones documented as read-only.
- Touches the plan cache from `docguard.code-derived-diagrams` (spec 035,
  cache version 3). The cache format does not change.

**Input**: Bug report (2026-09-30), confirmed by reproduction:
1. `docguard rules --for <path>` is documented as read-only, yet it creates
   `.agent/skills/` and `.agent/commands/` and prints "Spec Kit is not
   initialized".
2. `docguard generate --spec <area>` (a preview without `--write`) and
   `docguard sync` (a dry run by default) install the same files.
3. `guard`, `sync`, `generate --plan` and `memory --pack` write into
   `.docguard/`, which nothing gitignores in a user's project. `git add -A`
   then commits the plan cache, and the next `memory --pack` reports
   `dirty: true`.

## Problem

The dispatcher runs the skill installer (`ensureSkills`) before every
command except those on a hand-kept list of read-only commands. A command
missing from the list scaffolds by default. An audit of every command and mode
in a project without `.agent/` found scaffolding in:
- `rules --for`;
- `generate --spec <area>` without `--write`;
- `sync` without `--write`;
- `reconcile --since <ref>`, with or without `--check`;
- `upgrade` without `--apply`;
- `watch`;
- `hooks --claude`;
- an unknown command name (`docguard bogus`) or a removed alias (`docguard
  gen`), which install 17 files and then fail with "Unknown command".

The explicit write modes (`generate --write`, `sync --write`) never scaffolded,
because the dispatcher treats `--write` as headless. So the preview installed
setup files and the real write did not.

The documentation already states the intended contract: `docs/ai-integration.md`
says `docguard init` installs `/docguard.*` into `.agent/commands/`.

DocGuard also keeps local state in `.docguard/`:
- `plan.cache.json`;
- `history.jsonl`;
- `fixed.json`;
- `feedback/`;
- `nudge-state.json`;
- `context-pack.md`;
- `current-context.json`.

Its own code calls the directory gitignored (`cli/writers/history.mjs`,
`cli/writers/baseline.mjs`). It is gitignored only in this repository, and no
command ignores it in a user's project. Once one of these files is committed,
each run modifies it, and DocGuard's own dirty checks report the change:
- the `memory --pack` header;
- the `report` and `reconcile` HEAD identity;
- the `specs complete` and `specs reanchor` clean-tree gates.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inspecting a project changes nothing (Priority: P1)

A developer runs a read, report, check or preview command in a project that
has no `.agent/` directory. The working tree is byte-for-byte what it was.

**Acceptance Scenarios**:

1. **Given** a project without `.agent/`, **When** the developer runs `docguard
   rules --for src/index.js`, **Then** no file is created and no Spec Kit hint
   is printed.
2. **Given** the same project, **When** the developer runs `generate --spec
   src` or `sync` without `--write`, **Then** `git status` and every file
   outside `.git/` and `.docguard/` are unchanged.
3. **Given** the same project, **When** the developer mistypes a command,
   **Then** DocGuard prints "Unknown command" and writes nothing.
4. **Given** the same project, **When** the developer runs `docguard init`,
   **Then** the skills and slash commands are installed exactly as before.

### User Story 2 - DocGuard's state never reaches a commit (Priority: P1)

A developer runs `guard` or `sync`, then `git add -A && git commit`. The
commit contains no DocGuard cache, and the next `memory --pack` reports a
clean tree.

**Acceptance Scenarios**:

1. **Given** a command that writes `.docguard/plan.cache.json`, **When** the
   developer runs `git status`, **Then** nothing under `.docguard/` is listed.
2. **Given** `.docguard/` files committed by an earlier DocGuard version,
   **When** a later run rewrites them, **Then** `memory --pack` still reports
   `dirty: false`, and `specs complete` does not name them as changes.
3. **Given** a real source change, **Then** every dirty check still reports it.

### Edge Cases

- **An existing `.docguard/` without the ignore file** (created by an earlier
  version): the next DocGuard write adds it.
- **A user-written `.docguard/.gitignore`**: it is left untouched.
- **`.docguard` is a symlink or a file**: nothing is written through it, as
  the plan cache already refuses today.
- **A project outside git**: the ignore file is harmless, and the dirty checks
  report unknown as before.
- **A nested package** (`--dir packages/api`): its own `.docguard/` is
  excluded. Other paths in the repository still count toward dirty.
- **`--help` on any command**: exits before dispatch, unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Only the setup family may install DocGuard's agent skills and
  slash commands (`.agent/skills/`, `.agent/commands/`) or print the Spec Kit
  setup hint:
  - `docguard init` in every mode (`--with`, `--wizard`);
  - the aliases that run `init` (`setup`, `agents`, `hooks`, `badge`,
    `llms`, `publish`).

  No other command, in any mode, may do either. That includes an unknown
  command name or a removed alias.
- **FR-002**: `docguard rules --for <path>` MUST write nothing, as its
  documentation says.
- **FR-003**: Preview and dry-run modes MUST write nothing outside DocGuard's
  state directory. This covers:
  - `generate --spec <area>` and `generate --plan` without `--write`;
  - `sync` without `--write`;
  - `reconcile` without `--write`;
  - `upgrade` without `--apply`.
- **FR-004**: Every read, report, check and preview mode of every command MUST
  leave the working tree unchanged. That means the same `git status
  --porcelain --untracked-files=all` output, and the same bytes in every file
  outside `.git/` and `.docguard/`. Explicit writers that are not `init`
  (`generate --write`, `sync --write`, `hooks --claude`, `reconcile --write`)
  MUST NOT create `.agent/` or `.specify/`.
- **FR-005**: The `.docguard/` state directory MUST ignore itself. Every
  DocGuard writer that creates `.docguard/` or writes into it MUST first ensure
  that `.docguard/.gitignore` exists and contains `*`. An existing
  `.docguard/.gitignore` is left as it is. DocGuard MUST NOT edit the
  project's own `.gitignore` for this.
- **FR-006**: DocGuard's dirty-tree checks MUST NOT count files under the
  project's `.docguard/`, including files an earlier version committed:
  - the `git.dirty` value `memory --pack` prints;
  - the HEAD identity `report` and `reconcile` record;
  - the clean-tree gates of `specs complete` and `specs reanchor`.

  Changes anywhere else still count.
- **FR-007**: The documentation MUST describe the rule and the state
  directory:
  - `docs-canonical/SECURITY.md`'s command-safety section states the
    scaffolding rule and the self-ignoring state directory;
  - `docs-canonical/DATA-MODEL.md`'s generated-caches section notes that
    `.docguard/` ignores itself;
  - `docs-canonical/ENVIRONMENT.md`'s sandbox paragraph names `sync --write`,
    not a bare `sync`, as a writer;
  - `docs-canonical/ARCHITECTURE.md` says the skill installer runs only from
    `init`;
  - `CHANGELOG.md` records the fix under `## [Unreleased]`.

## Success Criteria *(mandatory)*

- **SC-001**: In a temporary git project without `.agent/`, each command and
  mode in the read, report, check and preview list (at least 50 invocations,
  covering every command) leaves `git status` and the file listing unchanged.
  Before the fix, the same test fails for at least `rules --for`,
  `generate --spec`, `sync`, `reconcile`, `upgrade` and an unknown command.
- **SC-002**: After a run writes the plan cache, `git add -A && git commit`
  commits nothing under `.docguard/`. `memory --pack` then reports
  `dirty: false`, and a committed `.docguard/` file that a later run rewrites
  still gives `dirty: false`.
- **SC-003**: `docguard init` still installs the skills and slash commands,
  and a second `init` rewrites none of them.

## Assumptions

- The files in `.docguard/` are local, regenerable or per-developer state.
  The existing code comments already treat the directory as gitignored.
  `current-context.json` is a projection of the committed registry.
- A developer who wants to refresh installed skills after upgrading DocGuard
  re-runs `docguard init`. Existing files are kept.

## Out of Scope

- Moving the plan cache out of the project, under `.git/` or into an OS
  cache directory (rejected in plan.md).
- Removing `.docguard/` files that an earlier version committed. DocGuard does
  not change the git index; the CHANGELOG gives the command.
- What `init --with <name>` and its aliases write beyond skills. They are
  explicit setup commands.
- Warning when the installed skills are older than the running package.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `d17dee0a5924795582cae3b0fcd97bfdbad93c76` — Reviewed at d17dee0 on main: all 12 tasks are checked and were delivered by #501, #508; the full suite (2909 tests) passes and guard reports 0 errors at this revision. Evidence: `cli/commands/memory.mjs`, `cli/docguard.mjs`, `cli/ensure-skills.mjs`, `cli/shared-git.mjs`, `cli/writers/fix-memory.mjs`, `cli/writers/history.mjs`, `cli/writers/state-dir.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/ENVIRONMENT.md`, `docs-canonical/SECURITY.md`, `tests/read-only-commands.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
