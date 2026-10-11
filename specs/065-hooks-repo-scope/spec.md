# Feature Specification: Git Hooks Stay Inside the Repository

**Feature Branch**: `fix/hooks-global-scope`

**Created**: 2026-10-11

**Status**: Draft

**Spec ID**: `docguard.hooks-repo-scope`

**Lineage**: Corrects the hook installer (`cli/commands/hooks.mjs`, the worktree-aware `getHooksDir` from bug-200 and the fail-open hook of REQUIREMENTS FR-024), the hook step of `docguard setup`, and the pull-request mode of `docguard upgrade` (v0.14-P4). Found by a read-only audit of DocGuard under the hostile Git configuration TestGuard's CI uses.

**Input**: Handoff from the "Google Jewels environment setup" session: "When the user has a GLOBAL core.hooksPath, getHooksDir returns the global folder and DocGuard's hooks then run in EVERY repo on the machine."

## Problem

1. **DocGuard installs its hooks for every repository on the machine.** `getHooksDir` asks Git for `--git-path hooks`, which honours `core.hooksPath` wherever it is set. When the user sets it in the global (or system) configuration, `docguard hooks` writes `pre-commit`, `pre-push` and `commit-msg` into that shared folder. From then on DocGuard's hooks run in every repository on the machine: a commit in an unrelated repository was rejected by the conventional-commit hook.
2. **`--force` and `--remove` act on everyone's hooks.** `--force` replaces the user's own global hook (moving it to `.bak`), and `--remove`, run from any repository, removes the hooks from all of them.
3. **The test suite does this to a contributor's machine.** `tests/hook-fail-open.test.mjs` runs `hooks --force`; on a machine with a global `core.hooksPath`, `npm test` rewrites the contributor's global hooks.
4. **`docguard setup` uses the wrong folder.** Its hook step hard-codes `<project>/.git/hooks`: in a linked worktree `.git` is a file, and with a repo-local `core.hooksPath` Git never runs hooks from that folder.
5. **`upgrade --apply --pr` strands the user.** It creates and checks out a branch, then writes and commits `.docguard.json`. When the commit, push or pull request fails, the user is left on the new branch with the migration half applied, and nothing is rolled back.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hooks for one repository never leak to others (Priority: P1)

1. **Given** a global `core.hooksPath`, **When** `docguard hooks` runs, **Then** it writes nothing, exits 1, and explains that the folder is shared and what to do instead.
2. **Given** a global `core.hooksPath` holding the user's own hook, **When** `docguard hooks --force` runs, **Then** the hook is untouched and no `.bak` is written.
3. **Given** a DocGuard hook in a global hooks folder, **When** `docguard hooks --remove` runs, **Then** the file is untouched and the user is told how to remove it by hand.
4. **Given** a global `core.hooksPath`, **When** `docguard hooks --list` runs, **Then** it reports the hooks and names the shared folder, writing nothing.
5. **Given** a repo-local `core.hooksPath` inside the repository (e.g. `.githooks`), **Then** hooks install there as before.
6. **Given** a repo-local `core.hooksPath` pointing outside the repository, **Then** DocGuard refuses as in scenario 1.
7. **Given** no `core.hooksPath`, in a clone or a linked worktree, **Then** hooks install into the repository's common hooks folder as before; `core.hooksPath=/dev/null` keeps its bug-200 behaviour.

### User Story 2 - Setup installs where Git will run the hook (Priority: P2)

1. **Given** a linked worktree, **When** `docguard setup` reaches its hook step, **Then** it inspects and installs into the folder Git actually uses.
2. **Given** a global `core.hooksPath`, **Then** setup says the folder is shared and does not offer to install.

### User Story 3 - A failed upgrade pull request leaves the repository as it was (Priority: P2)

1. **Given** `upgrade --apply --schema-only --pr`, **When** the commit or the push fails, **Then** the user is back on the branch they started from, `.docguard.json` is as it was, and the new branch is deleted.
2. **When** the pull request cannot be opened after the push succeeded, **Then** the user is back on the starting branch and told the pushed branch's name.

## Requirements *(mandatory)*

- **FR-001**: DocGuard MUST write, overwrite or remove Git hooks only in a folder that belongs to the repository: no `core.hooksPath`, or a `core.hooksPath` set in the repository's local or worktree configuration that resolves inside the working tree or the Git directory. A `core.hooksPath` from global, system or command-line configuration, or one resolving outside the repository, MUST make `hooks` (install, `--force`, `--remove`, `--auto-fix`) write nothing and exit 1 with the folder, the configuration scope and the alternatives.
- **FR-002**: `hooks --list` MUST keep working read-only in every case and say when the hooks come from a shared folder.
- **FR-003**: The existing behaviour for repository-owned folders MUST NOT change: linked worktrees, a repo-local `core.hooksPath` inside the repository, and `core.hooksPath=/dev/null` (bug-200).
- **FR-004**: `docguard setup` MUST resolve its hook folder through the same rule as `hooks`, and MUST NOT offer to install into a folder FR-001 refuses.
- **FR-005**: When `upgrade --apply --pr` fails after creating its branch, it MUST return to the starting branch (or commit), restore `.docguard.json`, and delete the new branch if it was not pushed. When only `gh pr create` fails, it MUST return to the starting branch and name the pushed branch. A rollback step that fails MUST be reported with the manual commands.
- **FR-006**: The test suite MUST NOT write to the contributor's global or system Git hooks. The tests that install hooks MUST isolate the global configuration for that step.

## Success Criteria *(mandatory)*

- **SC-001**: Each scenario has a test that fails before the fix and passes after, run against a temporary global configuration (`GIT_CONFIG_GLOBAL`), never the real one.
- **SC-002**: The full suite passes, and guard on this repository is unchanged.

## Out of Scope

- Making the rest of the test suite hermetic under a hostile global Git configuration (`docguard.test-git-hermeticity`, spec 066).
- The hook content `docguard setup` writes (it still differs from the managed hook `docguard hooks` writes).
