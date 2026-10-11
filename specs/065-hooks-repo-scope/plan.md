# Implementation Plan: Git Hooks Stay Inside the Repository

**Branch**: `fix/hooks-global-scope` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002, FR-003 | `cli/shared-git.mjs` gains `resolveHooksTarget(dir)` → `{ dir, owned, scope, configured, reason }`. `getHooksDir` stays the path resolver; the new function adds ownership. `cli/commands/hooks.mjs` refuses every writing mode when `owned` is false and annotates `--list`. |
| FR-004 | `cli/commands/setup.mjs` step 7 uses `resolveHooksTarget`. |
| FR-005 | `cli/commands/upgrade.mjs` `openUpgradePR` records the starting ref and the config text, and rolls back on failure. |
| FR-006 | The hook-installing tests run the CLI with `GIT_CONFIG_GLOBAL` pointing at an empty file, and `GIT_CONFIG_NOSYSTEM=1`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new; Git ≥ 2.26 for `git config --show-scope` (with a fallback, below)
**Testing**: `node:test`. `tests/hooks-repo-scope.test.mjs` (NEW) drives the CLI against temporary global and system configuration files.

## Research decisions

- **Ownership is scope plus location.** The scope says who set `core.hooksPath`; the location says who else runs those hooks. A global setting is shared by definition. A local setting can still name a shared folder (`/opt/team-hooks`), so a folder outside the working tree and the Git directory is refused too. *Rejected:* scope only (misses the local-but-shared folder); location only (a global path that happens to sit inside one repository would still run in every other one).
- **Refuse, do not fall back to `.git/hooks`.** With `core.hooksPath` set, Git never runs `.git/hooks`, so writing there would report success for a hook that never runs. *Rejected:* setting a local `core.hooksPath` for the user: it silently disables their global hooks in this repository. The message offers it as an explicit choice instead.
- **`--remove` refuses as well.** A shared folder's DocGuard hook may have been put there on purpose; removing it from one repository changes every repository. The message prints the `rm` lines.
- **`--show-scope` with a fallback.** When Git rejects the flag, a value that `git config --local` (or `--worktree`) does not return is treated as not owned.
- **`/dev/null` keeps bug-200.** It is the "hooks disabled" convention (the Jules sandbox); the existing fallback writes only inside the repository.
- **Rollback, not a pre-flight lock.** `upgrade --pr` already exits 1 on failure; restoring the starting ref, the file and the branch makes that failure leave nothing behind. A rollback step that itself fails (for example a failing `post-checkout` hook) is reported with the manual commands, never hidden.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| VI (safe writes) | Writing modes stop before any write when the folder is not owned; `upgrade --pr` undoes its own writes on failure. |
| VIII (local-first) | No network change. |
| IX (honest assurance) | DocGuard no longer reports a hook installed where it would not run, or runs where the user did not ask. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/shared-git.mjs                 # resolveHooksTarget (FR-001–FR-003)
cli/commands/hooks.mjs             # refuse / annotate (FR-001, FR-002)
cli/commands/setup.mjs             # step 7 (FR-004)
cli/commands/upgrade.mjs           # openUpgradePR rollback (FR-005)
tests/hooks-repo-scope.test.mjs    # NEW
tests/hook-fail-open.test.mjs, tests/hooks.test.mjs, other hook-installing tests   # FR-006
docs/commands.md, docs/guides/upgrading.md, docs/guides/troubleshooting.md, docs-canonical/REQUIREMENTS.md, CHANGELOG.md
```
