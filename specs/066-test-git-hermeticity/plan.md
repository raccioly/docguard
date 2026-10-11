# Implementation Plan: Test Git Hermeticity

**Branch**: `test/git-hermeticity` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | New `tests/helpers/git.mjs`: `FIXTURE_GIT` (`-c core.hooksPath=<null device> -c commit.gpgsign=false -c tag.gpgsign=false`), `FIXTURE_GIT_SHELL` (the same, shell-quoted, for tests that build `git …` command lines) and `fixtureGit(cwd, args, options)`. Every fixture git call in `tests/` (69 test files and `tests/fixtures/generated-docs-projects.mjs`) passes the options. |
| FR-002 | Fixture setup that discarded `spawnSync` results goes through `fixtureGit()`, which throws with git's stderr. Wrappers that returned `spawnSync` results (`shared-git`, `spec-first`, `as-built-specs`, `asset-path-attribution`, `lifecycle-evidence-gaps`, `unreadable-git-metadata`, `python-extraction`, `ignore-reasons`, `output-ux`, the generated-docs fixture) now return stdout and throw on failure. The one expected failure, a conflicting merge in `lifecycle-evidence-gaps`, keeps `spawnSync` and asserts the conflict. `execFileSync`/`execSync` calls already threw. |
| FR-003 | No change needed: under `init.defaultBranch=trunk` every fixture that assumes `main` already passes `-b main`. The CI job's `trunk` default keeps it so. |
| FR-004 | `tests/test-git-hermeticity.test.mjs`: the helper against `hostileGitEnv()` (a per-spawn hostile config in the helper) with a control; a failing fixture step; a scan of `tests/` for git spawns that bypass the helper. |
| FR-005 | `cli/commands/demo.mjs` commits its scratch fixture with hooks and signing off. `benchmarks/agent-context/run.mjs` builds its frozen fixtures with no global or system config, as `benchmarks/lib/runner.mjs` already does. |
| FR-006 | `.github/workflows/ci.yml`: new `hermeticity` job, mirroring TestGuard's. |
| FR-007 | `CONTRIBUTING.md` and `docs-canonical/TEST-SPEC.md`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/test-git-hermeticity.test.mjs` (new), plus the full suite run under a hostile `GIT_CONFIG_GLOBAL` locally and in CI.

## Research decisions

- **Per-invocation options, not an isolated environment.** Setting `GIT_CONFIG_GLOBAL=/dev/null` for the whole suite would make every test green and hide the product's behaviour on real machines: spec 065's defects (hooks installed into a global `core.hooksPath`) only show because the product meets the hostile config. Rejected. A few tests that already isolated their git environment (`agent-evidence`, `output-ux`) keep doing so; that is their own deliberate choice.
- **Disable hooks with `core.hooksPath=<null device>`.** It overrides a global `core.hooksPath` and the repository's `.git/hooks` alike, and only for that invocation. `--no-verify` was rejected: it skips pre-commit and commit-msg but not prepare-commit-msg, post-commit or post-checkout, and `git checkout`/`clone` do not accept it.
- **Leave the branch to `git init -b`.** Adding `init.defaultBranch=main` to the options would hide a fixture's assumption instead of stating it. The CI config sets `trunk`, so an unpinned assumption fails there.
- **A throwing helper, not status assertions at each call.** `fixtureGit()` reports the command, directory and stderr in one place, and returns stdout, which is what most wrappers needed. Tests that must inspect a non-zero status keep `spawnSync` with `FIXTURE_GIT`.
- **The demo's fixture is DocGuard's scratch repository.** It is copied to a temp directory DocGuard creates and deletes; the user's hooks have no business there. TestGuard made the same call for its scratch tree. Only the commit needs the options: `init`, `config` and `add` run no hooks and do not sign. The guard run on that fixture still uses the ambient config.
- **Product code is otherwise untouched.** `cli/shared-git.mjs`, `hooks`, `setup` and `upgrade` are spec 065's; their tests' remaining failures under the hostile config are listed in the spec's Out of Scope.
- **A static scan over a lint rule.** The repository has no linter; a test that reads `tests/` costs nothing and runs everywhere `npm test` runs. Its exemption marker requires a written reason.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| VI (safe writes) | The demo writes only to its own temp directory, as before. |
| IX (honest assurance) | Fixture failures can no longer pass as product results; product code still meets the real config. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
tests/helpers/git.mjs                       # NEW: FR-001, FR-002, FR-004 (hostileGitEnv)
tests/test-git-hermeticity.test.mjs         # NEW: FR-001..FR-006
tests/*.test.mjs (69 files), tests/fixtures/generated-docs-projects.mjs   # FR-001, FR-002
cli/commands/demo.mjs                       # FR-005
benchmarks/agent-context/run.mjs            # FR-005
.github/workflows/ci.yml                    # FR-006
CONTRIBUTING.md, docs-canonical/TEST-SPEC.md, CHANGELOG.md   # FR-007
```
