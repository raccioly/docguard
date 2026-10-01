# Feature Specification: Honest Spec Kit Integration

**Feature Branch**: `fix/spec-kit-integration-honesty`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.spec-kit-integration-honesty`

**Lineage**:
- Extends `docguard.specify-init-delegation` (spec 014): how `docguard init`
  initializes Spec Kit and registers the packaged extension, and what it
  reports about both.
- Extends `docguard.extension-manifest-hygiene` (spec 018): the extension
  manifest's Spec Kit floor and hook declarations.
- Builds on `docguard.read-only-commands` (spec 042): `init` is the only
  command that installs agent files, so `upgrade --apply` must call that
  installer itself.

**Input**: A validation run of `docguard init` against Spec Kit 1.0.13
(2026-09-30) found seven confirmed defects. Each one makes DocGuard report
an integration that does not work, or name a command that does not exist.

## Problem

1. **Mandatory hooks that cannot run.** With no agent signal, `init` picks
   Spec Kit's `generic` integration. Spec Kit deliberately registers no
   extension commands for `generic` (`registered_commands: {}`). Yet
   `.specify/extensions.yml` declares two mandatory hooks,
   `speckit.docguard.brief` (before specify) and `speckit.docguard.preflight`
   (before tasks), and no file anywhere defines them. `init` still prints
   "(workflow hooks active)".
2. **A registered extension that never updates.** Registration is skipped
   whenever the registry lists DocGuard at any version. After a DocGuard
   upgrade, `init` prints "already registered" while
   `specify extension list` shows the old version. The README says the
   registered version always matches the CLI. `upgrade --apply` refreshes
   neither the extension nor the installed agent files.
3. **Hook commands that download.** The shipped command files run
   `npx --yes docguard-cli@latest …`, an unpinned download, although the
   README says nothing is downloaded. `complete.md` runs bare `docguard`.
   The skills use a third form, `npx docguard-cli`.
4. **Slash commands that do not exist.** `guard` prints `/docguard.diagnose`
   and `/docguard.feedback`, `verify` prints `/docguard.verify`, `diagnose`
   prints `/docguard.init`. None exists. In a Claude Code project the real
   names are `/speckit-docguard-guard` and `/speckit-constitution`.
5. **Undocumented and misdocumented flags.** The README says
   `--no-spec-kit` skips the `.agent/` scaffolding; it does not. `--spec-kit`
   is parsed but documented nowhere. Neither flag is in `init --help`.
6. **Two Spec Kit floors.** The README and `MIN_SPEC_KIT_VERSION` say 0.10.0.
   The manifest requires `>=0.11.2`, so registration fails on 0.10.x–0.11.1
   after `init` has already initialized Spec Kit.
7. **Files for an agent that will not read them.** In a Claude Code project
   `init` writes `.agent/skills/` and `.agent/commands/`, which Claude Code
   never reads, and recreates them when deleted. The summary says
   "Created: 12 files" and counts all of `.specify/` (about 50 files) as one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Workflow hooks that resolve (Priority: P1)

A developer runs `docguard init` in a repository with no agent signal. Spec
Kit is initialized with the generic integration. Every mandatory DocGuard
hook resolves to a command file the agent can run, and `init` says hooks are
active only after checking that.

**Acceptance Scenarios**:

1. **Given** the generic integration, **When** `init` registers the
   extension, **Then** a `speckit.docguard.<name>` command file exists in the
   generic commands directory for every command the extension declares.
2. **Given** a mandatory hook whose command file is missing, **When** `init`
   reports registration, **Then** it does not print "hooks active". It names
   each unresolved hook and the file it expected.
3. **Given** a Claude integration where Spec Kit registered the commands as
   skills, **Then** `init` confirms the hooks against
   `.claude/skills/speckit-docguard-*/SKILL.md`.

### User Story 2 - The registered extension tracks the CLI (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the registry lists DocGuard 0.40.0 and the CLI ships 0.42.1,
   **When** `init` runs, **Then** it re-registers the packaged extension and
   reports `0.40.0 → 0.42.1`.
2. **Given** the registered version equals the CLI's, **Then** `init` makes
   no registration call.
3. **Given** a disabled registration, **Then** `init` leaves it disabled and
   prints the command that re-enables it.
4. **Given** stale skills or a stale registration, **When**
   `docguard upgrade` runs, **Then** it reports them and writes nothing;
   `upgrade --apply` refreshes them.

### User Story 3 - Hints name commands that exist (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a Claude project with the extension registered, **When** `guard`
   fails, **Then** its next step reads `/speckit-docguard-diagnose`.
2. **Given** a command no installed file defines (`verify`, `feedback`,
   `explain`), **Then** the hint is the CLI command.
3. **Given** no Spec Kit and no installed command files, **Then** every hint
   is a CLI command.

### User Story 4 - Pinned, consistent command files (Priority: P2)

**Acceptance Scenarios**:

1. **Given** any shipped command or skill file, **Then** it runs `docguard`
   from PATH when present, and otherwise the release it shipped with, through
   `npx --yes docguard-cli@<version>`.
2. **Given** a release, **When** the version-sync script runs, **Then** every
   pin moves to the new version.

### Edge Cases

- **A generic commands directory outside the project** (an absolute path or
  `..` recorded in `.specify/integration.json`): nothing is written, and the
  hooks are reported unresolved.
- **A registry entry without a version**: treated as unknown; `init` does
  not re-register it.
- **`specify` absent but `.specify/` present**: no registration call; the
  hook check still runs on the files that exist.
- **`specify --version` unparseable**: the version check is skipped and the
  capability check from spec 014 decides.
- **A commands-style integration** (Gemini, OpenCode, …): Spec Kit registers
  the `speckit.docguard.*` commands in its own format, and DocGuard copies no
  skills into a directory the agent does not read.
- **A project that already has `.agent/` from an earlier release**: it is
  never deleted; DocGuard only stops writing to it when the integration does
  not read it.
- **`upgrade --apply` that also installed a newer CLI**: the running process
  holds the old assets, so it does not refresh them; it tells the user to run
  `docguard init` with the new CLI.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the active Spec Kit integration is `generic`, `init` MUST
  write every command the extension manifest declares into the generic
  commands directory, in that integration's layout
  (`speckit.docguard.<name>.md`, or `speckit-docguard-<name>/SKILL.md` in skills
  mode). It writes only inside the project and only when the content differs.
- **FR-002**: After registration, and when the extension is already
  registered, `init` MUST read `.specify/extensions.yml` and resolve every
  enabled DocGuard hook with `optional: false` to an existing command file in
  the active integration's layout. The layout comes from Spec Kit's own
  install manifest (`.specify/integrations/<key>.manifest.json`). `init`
  prints "workflow hooks active" only when every mandatory hook resolves;
  otherwise it names each unresolved hook and the expected path.
- **FR-003**: When the registry lists DocGuard at a version different from the
  packaged `extension.yml`, `init` MUST re-register the packaged extension
  (`specify extension add <dir> --dev --force`, keeping the recorded
  priority) and report both versions. An equal version means no registration
  call. A disabled registration is never re-enabled.
- **FR-004**: `docguard upgrade` MUST report installed DocGuard skills or
  commands that differ from this CLI's, and a registered extension at another
  version, without writing anything. `upgrade --apply` MUST refresh them
  through the installer `init` uses. When the same run upgraded the CLI, it
  MUST NOT refresh with the running process's older assets.
- **FR-005**: Every shipped command file (the extension's
  `commands/*.md` and DocGuard's own `commands/docguard.*.md`) and every
  shipped skill MUST state one runner rule: `docguard` from PATH when present,
  otherwise `npx --yes docguard-cli@<version>` pinned to the release. No file
  may use `@latest` or an unpinned `npx docguard-cli`. The release
  version-sync MUST move each pin, and the release-candidate path allowlist
  MUST admit the files it moves.
- **FR-006**: A command suggestion printed by `guard`, `diagnose` (text,
  prompt and the JSON `llmCommand`), `verify`, `init`, `setup`, `fix`, `sync`
  and `memory` MUST be a slash command only when that command's file exists
  in the project for the detected integration, written in that integration's
  invocation form (prefix and separator). Otherwise it MUST be the CLI
  command.
- **FR-007**: `--no-spec-kit` MUST skip Spec Kit only: no `specify` call and
  no `.specify/`. DocGuard's own skills still install, as the starter profile
  already does. `init --help` MUST list `--spec-kit` and `--no-spec-kit`.
- **FR-008**: DocGuard MUST state one Spec Kit floor. `MIN_SPEC_KIT_VERSION`
  is read from the manifest's `requires.speckit_version`. `init` MUST read
  `specify --version` and, below the floor, neither initialize nor register;
  it prints the floor and the upgrade command.
- **FR-009**: `init` MUST install DocGuard's skills and commands only where
  the detected integration reads them:
  - a skills integration: its skills directory (`.claude/skills/` for Claude
    Code);
  - `generic`, or no known integration: `.agent/`;
  - a commands-style integration with the DocGuard commands registered by
    Spec Kit: nothing more, and `init` says so.

  `init` MUST NOT create `.agent/` in a project whose integration does not
  read it.
- **FR-010**: `init`'s summary MUST count the files it created, with the
  files Spec Kit wrote counted one by one and reported separately.
- **FR-011**: The README Spec Kit section and option table,
  `docs/commands.md` (`init` and `upgrade`), the extension README,
  `docs-canonical/ARCHITECTURE.md`, `docs-canonical/ENVIRONMENT.md` and the
  CHANGELOG MUST describe this behaviour: the floor, version refresh, the
  runner rule, where agent files go, and both flags.

## Success Criteria *(mandatory)*

- **SC-001**: With the generic integration, both mandatory hook commands
  resolve to files after `init`. With a hook file removed, `init` does not
  print "hooks active" and names the hook.
- **SC-002**: A registered version that differs causes exactly one
  `extension add --force` call; an equal version causes none.
- **SC-003**: No shipped command or skill file contains `@latest` or an
  unpinned `npx docguard-cli`; every pin equals `package.json`'s version.
- **SC-004**: No printed slash command names a command whose file is absent
  from the project.
- **SC-005**: `init` in a Claude Code project creates no `.agent/` directory.
- **SC-006**: The Spec Kit floor is the same string in the manifest,
  `MIN_SPEC_KIT_VERSION`, the README and `docs-canonical/ENVIRONMENT.md`.

## Assumptions

- Spec Kit's `.specify/integrations/<key>.manifest.json` lists the files the
  integration installed, including the `constitution` command. Spec Kit 1.0.13
  writes it. Without it, DocGuard falls back to the agent signals of spec 014
  and treats the layout as unknown.
- Agents run the command files: a "runner rule" is an instruction to an
  agent, not a shell script.
- The invocation prefixes mirror Spec Kit 1.0.13's `_invocation_style.py`:
  `$` for Codex, ZCode and Command Code, `/skill:` for Kimi, `/` otherwise.

## Out of Scope

- Choosing an integration other than `generic` when no agent signal exists
  (rejected: guessing an agent writes files for a tool the user may not use).
- Rendering DocGuard's skills into commands-style formats such as Gemini's
  TOML (rejected: Spec Kit already registers the `speckit.docguard.*` commands
  in those formats).
- Deleting a `.agent/` directory earlier releases wrote.
- Output-stream, `NO_COLOR` and `upgrade` wording fixes (spec 049).

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `d17dee0a5924795582cae3b0fcd97bfdbad93c76` — Reviewed at d17dee0 on main: all 17 tasks are checked and were delivered by #506, #508; the full suite (2909 tests) passes and guard reports 0 errors at this revision. Evidence: `cli/agent-surface.mjs`, `cli/commands/diagnose.mjs`, `cli/commands/init.mjs`, `cli/commands/memory.mjs`, `cli/commands/upgrade.mjs`, `cli/ensure-skills.mjs`, `cli/spec-kit-delegation.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/ENVIRONMENT.md`, `tests/release-version-sync.test.mjs`, `tests/spec-kit-integration-honesty.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
