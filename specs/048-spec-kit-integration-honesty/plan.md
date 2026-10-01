# Implementation Plan: Honest Spec Kit Integration

**Branch**: `fix/spec-kit-integration-honesty` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- New `cli/agent-surface.mjs`: one reading of what the project's agent can
  run.
  - `readAgentSurface(projectDir)` derives the active integration's command
    layout from Spec Kit's install manifest: the path of its `constitution`
    command gives the directory, file shape and separator. It also returns
    where DocGuard's own skills and commands belong (FR-009).
  - `agentCommand(surface, name, args)` returns the invocation for a
    `speckit.docguard.<name>` or `speckit.<name>` command only when its file
    exists, else `null`. `commandHint(...)` falls back to the CLI command
    (FR-006).
  - `readMandatoryHooks(projectDir)` parses the DocGuard entries of
    `.specify/extensions.yml` (Spec Kit writes a fixed YAML shape; no YAML
    dependency).
- `cli/spec-kit-delegation.mjs`:
  - `MIN_SPEC_KIT_VERSION` read from the packaged `extension.yml`;
    `readSpecKitCapabilities` also reads `specify --version` (FR-008).
  - `registerDocGuardExtension` compares the registered version with the
    packaged one and re-registers with `--force --priority <recorded>`
    (FR-003). A disabled entry is reported, not touched.
  - `installGenericExtensionCommands` renders the manifest's commands into the
    generic commands directory (FR-001).
  - `verifyHooks` resolves every mandatory hook against the layout (FR-002).
  - `refreshSpecKitExtension(projectDir)` is the piece `upgrade --apply`
    shares with `init` (FR-004).
- `cli/ensure-skills.mjs`: `installAgentAssets(projectDir, surface)` writes
  skills and commands to the surface's targets with a content-equality gate,
  and returns the paths written (FR-009, FR-010). `agentAssetsStatus` is the
  read-only check `upgrade` reports (FR-004).
- `cli/commands/init.mjs`: installs agent files before the summary; counts
  Spec Kit's files from a before/after listing of the paths Spec Kit writes;
  prints honest hook status; hints through `commandHint` (FR-002, FR-006,
  FR-010).
- `cli/commands/upgrade.mjs`: an "Agent files" line in the report; `--apply`
  refreshes them unless this run installed a new CLI (FR-004).
- `guard`, `diagnose`, `verify`, `setup`, `fix`, `sync`, `memory`: hints via
  `commandHint` (FR-006).
- `cli/docguard.mjs`: `init --help` lists `--spec-kit` and `--no-spec-kit`
  (FR-007).
- Command files and skills: one "Running DocGuard" section with the pinned
  fallback; code blocks say `docguard …` (FR-005).
  `.github/scripts/sync-release-version.mjs` moves the pins;
  `cli/release-pr-policy.mjs` admits the command files.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. A stub `specify` on PATH reproduces Spec Kit
1.0.13's on-disk results: the install manifest, `extensions.yml`, the
registry, and skills-layout command files for Claude. Generic registers no
command files, as the real CLI does. Tests never need the real `specify`; it
is used once for the recorded verification.

## Research decisions

- **Layout from Spec Kit's install manifest, not a table.**
  - Decision: read `.specify/integrations/<key>.manifest.json`, find the
    `constitution` command file and substitute the command name.
  - Rationale: Spec Kit has 40+ integrations with five file shapes, and the
    table would drift the way the removed `--ai` flags did. The manifest
    records what Spec Kit actually wrote.
  - Rejected: a hard-coded per-agent table; scanning every dot-directory
    (could match a different agent's stale files).
- **Generic: install the commands, keep `generic` as the default.**
  - Decision: write `speckit.docguard.<name>.md` into the generic commands
    directory.
  - Rejected: picking another default integration. With no signal, any
    named agent is a guess that writes files for a tool the user may not
    have.
- **Re-register with `extension add --dev --force`.**
  - Verified on 1.0.13: replaces the entry and keeps hooks; `--priority`
    preserves a user-set priority.
  - Rejected: `specify extension update`, which reaches for the catalog
    (a download) and does not apply to `--dev` installs.
- **Runner rule as prose plus one pin per file.**
  - Decision: each file has a "Running DocGuard" section: `docguard` from
    PATH, otherwise `npx --yes docguard-cli@<version>`. Commands below are
    written `docguard …`.
  - Rationale: one pin per file keeps the release sync a cardinality-checked
    replacement. An agent reads the rule once; a shell prelude in every block
    is noise and is not portable to PowerShell.
  - Rejected: `@latest` (silent upgrades and downloads); bare `docguard`
    only (fails where DocGuard runs through `npx`).
- **Version check from `specify --version`.** It prints `specify X.Y.Z` on
  1.0.13. An unparseable answer falls back to spec 014's capability check,
  because a version table would be the drift that check avoids.
- **`--no-spec-kit` keeps DocGuard's skills (docs change, not code).** The
  flag is named for Spec Kit; DocGuard's own skills are not Spec Kit, and the
  starter profile already installs them without Spec Kit. The README row was
  wrong, so the docs change.
- **Counting Spec Kit's files**: list `.specify/` and the agent directories
  the integration manifest names, before and after delegation. A whole-tree
  walk would be slow on large repositories.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added; the YAML read is a fixed-shape line parser. |
| IX (honest assurance) | "hooks active" only after each hook resolves; hints only for commands that exist; counts measured. |
| X (spec-first) | This spec, plan and tasks precede code. |
| Security | Every path from `.specify/*.json` is checked to be relative and inside the project before a write; integration keys keep the spec 014 allowlist; `specify` still runs through argument arrays. |

Pass.

## Project Structure

```text
cli/agent-surface.mjs                     # NEW: layout, hints, hooks
cli/spec-kit-delegation.mjs               # floor, version refresh, generic commands, hook check
cli/ensure-skills.mjs                     # install targets, status
cli/commands/init.mjs, upgrade.mjs, guard.mjs, diagnose.mjs, verify.mjs,
  setup.mjs, fix.mjs, sync.mjs, memory.mjs, cli/docguard.mjs, cli/findings.mjs
extensions/spec-kit-docguard/commands/*.md, skills/*/SKILL.md, commands/docguard.*.md
.github/scripts/sync-release-version.mjs, cli/release-pr-policy.mjs
tests/spec-kit-integration-honesty.test.mjs  # NEW
README.md, docs/commands.md, extensions/spec-kit-docguard/README.md,
  docs-canonical/ARCHITECTURE.md, docs-canonical/ENVIRONMENT.md, CHANGELOG.md
testguard.claims.json                     # SPEC-KIT-HOOKS-RESOLVE-HONESTLY
```
