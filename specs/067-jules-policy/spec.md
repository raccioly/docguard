# Feature Specification: Jules Automation Policy

**Feature Branch**: `ci/jules-policy`

**Created**: 2026-10-11

**Status**: Draft

**Spec ID**: `docguard.jules-policy`

**Lineage**: Found by an audit of the 261 pull requests Google Jules has opened on this repository (35 merged). Narrows the Jules half of `docguard.tokenless-scheduled-releases` (spec 011, FR-011: the existing Jules auto-merge restrictions are preserved); its Dependabot and release halves are unchanged. Ports the reviewed policy of raccioly/testguard#207 (TestGuard v0.19.0), adapted to DocGuard's layout and narrowed to new test files only.

**Input**: "Narrow auto-merge to new test files only, replace Jules triage with a tested policy script, add `.jules/`, and retire the old Jules notes."

## Problem

Jules found real defects here: new tests (#324, #337, #339, #421, #451, #516) and fixes (#334, #453 → #464). The automation around it is unsafe and noisy:

1. **Auto-merge trusts any Markdown.** `.github/workflows/auto-merge.yml` merges a green Jules PR when every path starts with `tests/` or `docs/` or ends in `.md`. That admits `AGENTS.md`, `CLAUDE.md`, `.agents/skills/**`, `.specify/memory/constitution.md`, and prompt files that ship to npm (`commands/*.md`, `templates/*.md`, `extensions/**/commands/*.md`), which every adopter's agent then follows.
2. **Auto-merge trusts edits to existing tests.** An edited assertion changes what the suite defends. #421, #451 and #516 each edited existing test files (`tests/shared-git.test.mjs`, `tests/docs-diff.test.mjs`, `tests/commands.test.mjs` and `tests/sync.test.mjs`); deleted, renamed and fixture files pass the same check.
3. **Auto-merge reads a moving, truncated file list and merges an unpinned head.** `pulls.listFiles` is read once with `per_page: 300` from the live branch; GitHub caps a page at 100, so file 101 onward is never seen. `pulls.merge` has no `sha`, so a push after CI ran can merge content CI never saw.
4. **Triage talks to Jules.** Its comments write `@jules`; with Jules' Reactive Mode on, a mention is an instruction.
5. **Triage misses most noise.** It compares only against open PRs, so a declined PR can be re-proposed the next day; it has no queue cap; and it does not recognise an empty PR (#305, #306, #316 and #327 changed no files).
6. **Triage closes real findings by keyword.** Any title matching `performance`, `optimize`, `command injection` or `execSync` is closed unread, so a genuine new security or performance finding is closed with the noise.
7. **The environment setup snapshots a red suite.** `.jules-setup.sh` runs `npm test || echo …`, so a failing suite still produces the snapshot every task starts from. It also exports dummy `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` that nothing in the repository reads.
8. **Scheduled tasks stall.** Their prompts live in the Jules UI and say "DECIDE AND PROCEED … open ONE focused DRAFT PR". Tasks stopped in "waiting for your input", and their findings were lost.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Only new tests merge without a maintainer (Priority: P1)

1. **Given** a green Jules PR that adds `tests/new-area.test.mjs`, **Then** it merges, pinned to the commit CI verified.
2. **Given** a green Jules PR that edits `tests/commands.test.mjs`, **Then** it is held for a maintainer.
3. **Given** a green Jules PR that changes `AGENTS.md`, `commands/docguard.guard.md`, `docs/commands.md`, `CHANGELOG.md`, a fixture or a test helper, **Then** it is held.
4. **Given** a green Jules PR whose branch moved after CI ran, **Then** GitHub refuses the merge.

### User Story 2 - Noise closes itself; findings reach a person (Priority: P1)

1. **Given** a Jules PR that changes no files, **Then** triage closes it with a reason.
2. **Given** a Jules PR with the same routine target or the same files as an older open PR, or as one closed unmerged in the last 60 days, **Then** triage closes it and names that PR.
3. **Given** five Jules PRs already waiting, **Then** a sixth is closed as queue-full, and that close does not count as a decline.
4. **Given** a Jules PR titled "Sentinel: fix path traversal in …" that changes `cli/`, **Then** triage keeps it and labels it for review.
5. **Given** any triage or auto-merge comment, **Then** it does not mention the agent's handle.

### User Story 3 - Routines that decide or stop (Priority: P2)

1. **Given** a scheduled task, **Then** its UI prompt is one line that points at a routine file in the repository.
2. **Given** a full queue, or an open PR from the same routine, **When** the routine runs preflight, **Then** it prints `STOP` and the task ends with no pull request.
3. **Given** a choice the rules do not settle, **Then** the routine takes the pessimistic in-scope option or ends with a summary; it never asks a question.
4. **Given** a red suite during environment setup, **Then** setup fails and no snapshot is taken.

## Requirements *(mandatory)*

- **FR-001**: A green Jules PR MUST merge without a maintainer only when it changes 1 to 10 files and every one is a newly added top-level test module (`tests/<name>.test.mjs`, status `added`). Any other path (fixtures, helpers, docs, any Markdown, `CHANGELOG.md`) and any modified, removed, renamed or copied file MUST hold the PR for a maintainer with a stated reason.
- **FR-002**: Auto-merge MUST read the changed files from the comparison of the PR base with the exact head commit the triggering CI run verified, and MUST merge pinned to that commit (`sha`). The Dependabot rule and the per-job re-verification of the CI run MUST be unchanged.
- **FR-003**: Triage MUST close as noise a Jules PR that changes no files, whose title reports that nothing needed changing, that changes only `.jules/`, or that only syncs a count in user docs.
- **FR-004**: Triage MUST close a Jules PR that is the same work as an older open Jules PR, or as a Jules PR closed unmerged within 60 days, and name that PR. The same work means the same `[jules:<routine>] <target>` title tag, or the same changed-file set ignoring `CHANGELOG.md`. A PR closed for a full queue or for breaking its routine's contract MUST NOT count as declined. Triage MUST read every open Jules PR and every Jules PR closed in the window, across pages.
- **FR-005**: Triage MUST close a new Jules PR as queue-full when 5 Jules PRs are already waiting for review.
- **FR-006**: Triage MUST NOT close a PR because of what its title or change is about. A PR that is not noise, a duplicate, previously declined, over the cap or off its routine's contract MUST stay open with a review label.
- **FR-007**: No comment written by triage or auto-merge, and no policy reason, may mention the agent's handle.
- **FR-008**: A PR tagged with a routine MUST stay within that routine's contract, or triage closes it as off-contract: `bug-hunt` adds at least one new test file; `test-gaps` only adds new test files; `docs-drift` only changes `README.md`, `README.<lang>.md` or hand-written `docs/**/*.md`.
- **FR-009**: `.jules/preflight.mjs <routine>` MUST print `GO` with exactly one target, or `STOP: <reason>` and exit 3. It MUST STOP for an unknown routine, a full queue, an open PR from the same routine, no target left after skipping targets declined in the last 60 days, and a queue it cannot read. The target MUST be chosen deterministically from the ISO week.
- **FR-010**: Routine targets MUST come from the repository: `bug-hunt` walks the validator and scanner modules that name a governing spec (`@implements docguard.<id>`); `test-gaps` walks CLI modules whose exported functions no test imports, most untested first; `docs-drift` walks the subcommands `docguard --help` lists.
- **FR-011**: `.jules/setup.sh` MUST fail closed: strict shell mode, no credentials, install from the lockfile, full history as CI uses, the full suite and `guard` must pass, and the tree must be left clean. The root `.jules-setup.sh` MUST be removed.
- **FR-012**: `.jules/RULES.md` MUST tell every routine never to ask a question: take the pessimistic in-scope option, or end the task with no pull request and a summary of the question, the options and the evidence. Each routine MUST live in `.jules/routines/<name>.md`, and each UI prompt MUST be the one line that points at it.
- **FR-013**: The persona notes `.jules/sentinel.md`, `.jules/bolt.md` and `.jules/palette.md` MUST be removed, and `AGENTS.md`, `docs-canonical/ARCHITECTURE.md` and `docs-canonical/TEST-SPEC.md` MUST describe the new policy.

## Success Criteria *(mandatory)*

- **SC-001**: Each rule has a test that fails against the previous behaviour and passes now, including replays of real PR shapes: #324 (one added test) merges; #421, #451 and #516 (edited tests) hold; the empty #305, #316 and #327 close; a security fix with code changes is kept for review.
- **SC-002**: The full suite passes, `docguard guard` on this repository reports no new errors, and `docguard specs --check` passes.

## Out of Scope

- Changing the Jules UI. After merge a maintainer points the setup field at `bash .jules/setup.sh`, recreates the three scheduled tasks with the one-line prompts from `.jules/README.md`, and turns off Suggested Tasks and the Sentinel, Bolt and Palette templates.
- Deleting the leftover Jules branches on the remote.
- Moving `npm test` in `.github/workflows/scheduled-release.yml` and the `test` job of `.github/workflows/release.yml` out of jobs that hold a write-scoped token. Any merged test file, from Jules or a person, runs there; that is a release-workflow change for its own spec.
- `SUPPLY-CHAIN-AUDIT.md`, a read-only audit prompt that predates the routines.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `bc28a68109745855fd96156f822f490706864f61` — Reviewed at main after #547: auto-merge admits only 1-10 added tests/name.test.mjs files at the verified head; triage, preflight and the three routines are tested (tests/jules-policy.test.mjs); the Jules UI now runs .jules/setup.sh (snapshot green) and the three routines are active; the removal of .jules-setup.sh is attributed by spec 069. Deviations: test-only Jules PRs merge without a CHANGELOG entry, as recorded in the plan. Evidence: `.github/scripts/jules-policy.mjs`, `.github/scripts/jules-triage.mjs`, `.github/workflows/auto-merge.yml`, `.github/workflows/jules-triage.yml`, `.jules/preflight.mjs`, `.jules/setup.sh`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `tests/jules-policy.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
