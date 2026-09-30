# Implementation Plan: Read-Only Commands Write Nothing

**Branch**: `fix/read-only-commands` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/docguard.mjs`: delete the dispatcher's global `ensureSkills` call and
  the `READ_ONLY_COMMANDS` deny-list that gated it (FR-001–FR-004).
  - `runInit` already calls `ensureSkills` at the end of its skeleton path.
    It becomes the only caller. The setup wizard (`runSetup`) imports it but
    never called it, and the dispatcher skipped `setup` and `init`, so the
    wizard's behaviour does not change.
  - The aliases `agents`, `hooks`, `badge`, `llms` and `publish` all run
    `runInit` with `skipPrompts`, which takes the skeleton path. So the setup
    family keeps its behaviour, and every other command loses a side effect
    it was never documented to have.
  - Unknown commands and removed aliases now fail before any write.
- `cli/writers/state-dir.mjs` (new): `ensureStateDir(projectDir)`.
  - Creates `.docguard/` if it is missing.
  - Refuses a symlinked or non-directory `.docguard`.
  - Writes `.docguard/.gitignore` containing `*` with an exclusive create, so
    an existing file is never replaced.
  - Returns whether the directory can be used (FR-005).
- Every writer into `.docguard/` calls it before writing:
  - `cli/scanners/memory-plan.mjs` (plan cache);
  - `cli/writers/history.mjs`;
  - `cli/writers/fix-memory.mjs`;
  - `cli/commands/feedback.mjs`;
  - `cli/commands/hooks.mjs` (nudge state);
  - `cli/commands/memory.mjs` (context pack);
  - `cli/commands/specs.mjs` (active context, before its file transaction).
- `cli/shared-git.mjs`: export `OWN_STATE_PATHSPEC`, which is `['--', ':/',
  ':(exclude).docguard']` (FR-006).
  - `git status` runs with the project as its working directory, so the
    exclusion names that project's `.docguard/`.
  - `:/` keeps the rest of the repository in scope, as today.
  - The three dirty checks append it:
    - `getHeadInfo` (report, reconcile);
    - `gitEvidence` (`memory --pack`);
    - `nonLifecycleChanges` (`specs complete`, `specs reanchor`).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/read-only-commands.test.mjs` builds one
temporary git project:
- it has `init --skip-prompts --no-spec-kit`, then has `.agent/` removed, and
  is committed;
- each command and mode runs in a fresh copy of it;
- the test compares `git status --porcelain=v1 --untracked-files=all` and a
  SHA-256 listing of every file outside `.git/` and `.docguard/`, before and
  after the run.

Other tests:
- a git fixture for the state directory and the three dirty checks;
- `tests/ensure-skills-idempotent.test.mjs` now drives `init` instead of the
  bare `generate` that used to scaffold.

**Constraints**: nothing reads the network in tests except `upgrade`, which
already falls back after a 3-second timeout when offline. Either way it writes
nothing, so the assertion does not depend on the network.

## Research decisions

- **Allow-list by construction, not a longer deny-list.**
  - Decision: remove the dispatcher's installer call. Only `runInit` calls
    `ensureSkills`.
  - Rationale: the deny-list failed open. Every command added since v0.26
    (`rules`, `reconcile`) and every unknown name scaffolded, because it was
    missing from the list. With no dispatcher call, a new command cannot
    scaffold unless its own code installs skills.
  - Rejected: adding `rules`, `sync`, `generate`, `reconcile`, `upgrade` and
    `watch` to `READ_ONLY_COMMANDS`. That fixes today's cases and leaves the
    next command broken the same way.
  - Rejected: an allow-list at the dispatcher (`SETUP_COMMANDS`). Every
    member already reaches `ensureSkills` through `runInit`, so the call
    would run twice.
- **Explicit writers other than init do not scaffold either.**
  - Decision: `generate` (bare, `--write`), `sync --write`,
    `reconcile --write`, `hooks --claude` and `upgrade --apply` write only
    their own outputs.
  - Rationale: `--write` modes never scaffolded, because the dispatcher
    treats `--write` as headless. Scaffolding only in the bare legacy
    `generate` was an accident of that gate, not a design.
  - Rationale: SECURITY.md lists these commands by their own outputs.
  - Cost: installed skills are no longer refreshed as a side effect of
    `generate`, `sync`, `rules` or `watch`. `docguard init` refreshes them and
    keeps existing files. It is the documented installer.
- **The Spec Kit hint.**
  - Spec 014 FR-009 allows (MAY) other commands to print a one-line hint.
  - The hint was printed by the same `ensureSkills` call, so it goes with it.
  - Printing it from a read-only command was part of the reported bug.
- **Where the cache lives.**
  - Decision: keep `.docguard/plan.cache.json`, and make `.docguard/` ignore
    itself with a `.gitignore` containing `*`. pytest's `.pytest_cache/` and
    ruff's `.ruff_cache/` use the same convention.
  - The path documented in DATA-MODEL "Generated caches" and in
    `_DISK_CACHE_VERSION` stays the same. The cache format does not change,
    so the version stays `"3"`.
  - A CI job that caches `.docguard/` keeps working. CI-RECIPES already tells
    ephemeral runners to set an explicit cache policy for `history.jsonl`.
  - The fix covers all seven state files, not only the plan cache. It also
    works in projects that never ran `init` (`npx docguard-cli guard` in CI)
    and in projects initialized by an earlier version: the next write heals
    them.
  - Rejected: under `.git/`. Projects outside git lose the cache. Linked
    worktrees share one common git directory, so worktrees with different
    trees would overwrite each other's single cache file. The per-worktree git
    dir would need extra resolution. The other six state files would still be
    committed.
  - Rejected: an OS cache directory keyed by repository path. The cache
    becomes invisible and outlives the project. A moved or re-cloned checkout
    loses it or collides with another. The agent-sandbox setup in
    ENVIRONMENT.md mounts only the project, so every sandboxed run would miss.
  - Rejected: `init` or `init --with` appends `.docguard/` to the project's
    `.gitignore`. It edits a user-owned file, and it helps only projects that
    re-run `init` after upgrading.
- **Dirty checks.**
  - Decision: exclude the project's `.docguard/` with a git pathspec, not by
    filtering output. Git applies it before rename detection and porcelain
    formatting, so there is no path parsing.
  - The pathspec covers files an earlier version committed, which an ignore
    file cannot untrack.
  - Git has accepted `:(exclude)` with an explicit `:/` since 2.13 (2017).
- **Committed state from older versions.** DocGuard never runs `git rm`.
  The CHANGELOG entry gives `git rm -r --cached .docguard`.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| VI (safe writes) | Removing the installer call removes writes. The ignore file is created exclusively (`wx`) inside DocGuard's own directory, and never replaces a file. |
| VII (delegation) | Unchanged: only `init` delegates to `specify`. This spec extends the same boundary to DocGuard's own skills. |
| VIII (local-first) | No network call added. The state stays in the project. |
| IX (honest assurance) | A dirty check still reports every change outside DocGuard's state. Only DocGuard's own regenerable files are excluded. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/docguard.mjs                     # remove global ensureSkills + READ_ONLY_COMMANDS
cli/writers/state-dir.mjs            # NEW: ensureStateDir
cli/scanners/memory-plan.mjs         # plan cache via ensureStateDir
cli/writers/history.mjs, cli/writers/fix-memory.mjs
cli/commands/feedback.mjs, cli/commands/hooks.mjs, cli/commands/memory.mjs, cli/commands/specs.mjs
cli/shared-git.mjs                   # OWN_STATE_PATHSPEC; getHeadInfo
cli/scanners/semantic-claims.mjs     # gitEvidence
cli/scanners/revision-anchor.mjs     # nonLifecycleChanges
tests/read-only-commands.test.mjs    # NEW
tests/ensure-skills-idempotent.test.mjs  # drive init
docs-canonical/{SECURITY,DATA-MODEL,ENVIRONMENT,ARCHITECTURE}.md, CHANGELOG.md
testguard.claims.json                # READ-ONLY-COMMANDS-WRITE-NOTHING
```
