# Feature Specification: Test Git Hermeticity

**Feature Branch**: `test/git-hermeticity`

**Created**: 2026-10-11

**Status**: Draft

**Spec ID**: `docguard.test-git-hermeticity`

**Lineage**: Ports the fix TestGuard made in raccioly/testguard#206 (`test/helpers/git.mjs` and its `hermeticity` CI job) after an audit ran DocGuard's suite under the same hostile global git config. Runs alongside spec 065, which owns the hook-install and `upgrade --pr` failures that config also exposes.

**Input**: "Under a hostile global git config, `npm test` gives 189 failures across 34 test files. Make the suite green both normally and under that config, without hiding it from the product code."

## Problem

1. **The suite depends on the machine's global git config.** Tests build throwaway repositories with plain `git init`, `git commit`, `git clone` and `git checkout`, so the machine's global config applies to every fixture. On a machine whose global config sets a `core.hooksPath` of failing hooks, `commit.gpgsign=true` with a gpg that fails, and `init.defaultBranch=trunk` (the config TestGuard's CI uses), the suite reported 189 failures in 34 files out of 3,281 tests (2026-10-11, Node 24, macOS). Agent sandboxes and husky-style setups carry such configs; CI runners carry none, so CI cannot reproduce the failures.
2. **Some fixtures failed silently.** Many setup calls were `spawnSync('git', …)` whose status nobody read. A fixture commit that failed left a repository with staged but uncommitted files, and the test asserted against that:
   - `tests/shared-git.test.mjs` counted "0 commits" and failed on the count, far from the cause;
   - all 20 `tests/generated-docs-e2e.test.mjs` cases reported CHG003 ("code staged but CHANGELOG.md is not"), a finding about the broken fixture, not the product.

   A test whose setup can fail without failing the test can also pass without testing what it claims. Keeping the new status checks but emptying the fixture options shows how many did: under the hostile config, 107 tests that had passed now fail at a fixture step that had failed unnoticed (21 of the 24 tests in `tests/v020-consolidation.test.mjs` and 11 in `tests/generated-docs-consistency.test.mjs` among them).
3. **`docguard demo` runs the user's hooks on its own scratch repository.** `demo` copies a fixture to a temp directory and commits it, so history-aware validators have history. The commit ran the machine's global hooks and signing, and its status was not checked. On such a machine the demo repository had no commit at all, and the global pre-commit hook ran on a repository the user never asked DocGuard to touch.
4. **The agent-context benchmark's frozen fixtures had the same exposure.** `benchmarks/agent-context/run.mjs` commits each task fixture with the ambient config, so its tests (`tests/agent-context-benchmark.test.mjs`, `tests/symbol-map.test.mjs`) failed on such a machine.
5. **Nothing keeps it fixed.** No CI job runs the suite under a hostile config, and nothing stops a new test from spawning git without isolation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A contributor's machine config cannot turn the suite red (Priority: P1)

1. **Given** a global git config with failing hooks, mandatory signing through a failing gpg and `init.defaultBranch=trunk`, **When** `npm test` runs, **Then** every test that does not exercise hook installation passes, as it does on a machine with no global config.
2. **Given** the same config, **When** a fixture commit is made with the fixture options, **Then** no global hook runs and the commit is unsigned; **and** the same commit without the options fails, proving the config is in effect.

### User Story 2 - A broken fixture fails loudly (Priority: P1)

1. **Given** a fixture git step that fails, **Then** the test fails with git's own error message, at the step that failed.
2. **Given** a new test that spawns git without the fixture options, **Then** the suite fails and names the file and line, unless the call carries a `fixture-git-exempt:` comment giving its reason.

### User Story 3 - Product code still meets the real config (Priority: P1)

1. **Given** the fixture options, **Then** they are passed per git invocation and never set in the environment, so DocGuard's own git calls in the same test still see the machine's config.
2. **Given** `docguard demo` on a machine with failing global hooks and mandatory signing, **Then** its scratch fixture is committed and no global hook runs.

### User Story 4 - CI proves it on every change (Priority: P2)

1. **Given** a push or pull request, **When** CI runs, **Then** a `hermeticity` job writes the hostile config, fails if a plain commit still succeeds or a fresh repository is not on `trunk`, and runs `npm test` under it.

## Requirements *(mandatory)*

- **FR-001**: Every git invocation a test makes to build or inspect a fixture repository MUST disable hooks (`core.hooksPath=<null device>`) and commit and tag signing, through one shared helper, `tests/helpers/git.mjs`. The options MUST be passed per invocation and never set in the environment for the suite.
- **FR-002**: A fixture git step that fails MUST fail the test with git's stderr. A test MUST NOT continue after a fixture git call whose exit status it did not check, except where failure is the expected outcome and the test then asserts the resulting state.
- **FR-003**: A fixture that depends on a branch name MUST pin it when it initialises the repository (`git init -b main`); none may inherit `init.defaultBranch`.
- **FR-004**: The suite MUST fail when a test file spawns git (`spawnSync`, `execFileSync`, `execFile`, `spawn`, `execSync`, `exec`) without the fixture options, unless the call carries a `fixture-git-exempt:` comment with its reason. A test MUST prove the options neutralise a hostile config, with a control showing the same commit fails without them.
- **FR-005**: Code that creates its own scratch repository, `docguard demo` and the agent-context benchmark's frozen fixtures, MUST commit there without running the machine's hooks or signing. DocGuard's git calls on the user's own repository MUST stay unchanged and meet the ambient config.
- **FR-006**: CI MUST run the full suite under a global config whose hooks (pre-commit, prepare-commit-msg, commit-msg, post-commit, pre-push, post-checkout) all fail, whose commit and tag signing is mandatory through a gpg that always fails, and whose default branch is `trunk`, after a step that fails if that config is not in effect. Its actions MUST be pinned to full commit SHAs, and it MUST NOT run on `pull_request_target`.
- **FR-007**: The contributor docs and the test specification MUST state the rule: fixture git goes through the helper; product git does not.

## Success Criteria *(mandatory)*

- **SC-001**: Under the hostile config, the suite's failures drop from 189 to only the hook-install and `upgrade --pr` cases spec 065 owns (6), and to 0 once spec 065 lands; the normal run stays at 0 failures. The demo reproduction fails before its fix and passes after.
- **SC-002**: The full suite passes normally, and `docguard guard` on this repository reports no finding this change introduced.
- **SC-003**: Each requirement has a test: the helper against a hostile config with its control, a failing fixture step, the bypass scan, `demo` on a hostile machine, and the CI job's shape.

## Out of Scope

- `docguard hooks`, `setup`'s hook step and `upgrade --pr` under a global or system `core.hooksPath` (spec 065). Under the hostile config their tests still fail: `tests/hook-fail-open.test.mjs` (3), `tests/commands.test.mjs` ("distinguishes an existing foreign hook"), `tests/field-report-followups.test.mjs` ("names lefthook and simple-git-hooks configuration") and `tests/upgrade-pr-e2e.test.mjs` ("full happy path"). This spec converts only their fixture git calls.
- Git spawned indirectly by a test through a variable command name or a shell script (for example a fake `git` on `PATH`); the bypass scan reads direct spawns of `git`.
- Background `git gc`/maintenance in fixtures (#486); CI already disables it, and the hostile config keeps the same settings.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `bc28a68109745855fd96156f822f490706864f61` — Reviewed at main after #546 and #551: npm test passes under the hostile global git config (0 of 3,310 failing, down from 189) and normally; the CI hermeticity job proves the config bites before running the suite; docguard demo commits past global hooks. The 31 converted tests carry a reconciliation-only @implements reference. Deviations: none. Evidence: `.github/workflows/ci.yml`, `benchmarks/agent-context/run.mjs`, `cli/commands/demo.mjs`, `docs-canonical/TEST-SPEC.md`, `tests/test-git-hermeticity.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
