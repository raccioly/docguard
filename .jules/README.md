# Google Jules on DocGuard: maintainer setup

The routines live in this repository, so changing one is a reviewed pull
request rather than an edit in the Jules UI. Jules is told only "follow this
file". The policy and its reasons are in `specs/067-jules-policy/`.

| Path | What it is |
|---|---|
| `setup.sh` | Builds the environment snapshot. Fails unless the suite and guard are green. |
| `RULES.md` | Rules every routine follows. |
| `routines/*.md` | One file per scheduled routine. |
| `preflight.mjs` | Step 0 of each routine. Picks this week's target, or answers STOP. |
| `../.github/scripts/jules-policy.mjs` | The policy behind preflight, triage and auto-merge. Unit-tested in `tests/jules-policy.test.mjs`. |

Nothing here ships: `.jules/` is not in the npm package's `files`.

## One-time configuration in the Jules UI

Open jules.google, select **raccioly/docguard** under Codebases, then set
the following.

**Configuration → Initial Setup**

- Enter `bash .jules/setup.sh`.
- Click **Run and Snapshot**. Re-snapshot after a dependency or Node change.

**Environment variables**

- None. Nothing in DocGuard or its tests needs a secret.

**Network access**

- **On.** Setup installs from npm and fetches history; preflight reads the
  public GitHub API for the PR queue and fails closed without it: no network
  means every routine STOPs.

**Proactivity / Suggested Tasks**

- **Off** for this repository. Its suggestions bypass preflight.
- Do not start the built-in Performance, Design or Security templates. The
  Sentinel, Bolt and Palette PRs they produced were closed here by the dozen.

**Knowledge (memory)**

- On. It keeps corrections you give Jules in a task.

**Global settings**

- **Reactive Mode on**, so Jules acts only on comments that tag it. Triage
  and auto-merge never tag it.
- **Commit authoring: Jules.** Triage and auto-merge identify Jules PRs by the
  `google-labs-jules[bot]` author.
- When a task finishes, use **Publish PR**, not "Publish branch". A PR you
  open yourself is authored by you, and the policy treats it as a person's.

## The scheduled tasks

Delete the old scheduled tasks first; their prompts asked Jules to decide in
the UI, and they stalled in "waiting for your input".

Create each one from the Task Input box: Planning → **Scheduled Task**,
branch `main`. Paste the prompt verbatim.

| Name | Frequency | Prompt |
|---|---|---|
| bug-hunt | Weekly, Monday | `Follow .jules/routines/bug-hunt.md exactly. Read .jules/RULES.md first. If preflight prints STOP, end the task with no changes and no pull request.` |
| test-gaps | Weekly, Wednesday | `Follow .jules/routines/test-gaps.md exactly. Read .jules/RULES.md first. If preflight prints STOP, end the task with no changes and no pull request.` |
| docs-drift | Weekly, Friday | `Follow .jules/routines/docs-drift.md exactly. Read .jules/RULES.md first. If preflight prints STOP, end the task with no changes and no pull request.` |

There is no dependency routine: Dependabot proposes bumps, and the empty
"@babel/parser is up to date" PRs it used to produce are closed as noise.

**A new task can show `Inactive`.** A task created from the Task Input box
can stay `Inactive` even though its menu offers "Pause schedule". Pause it,
then resume it, and it shows `Active`. Check the badge after creating each
task, because an `Inactive` task never runs.

**The VM is a shallow clone.** Jules clones with `--depth 1` and sets a
global `core.hooksPath /dev/null`. Setup fetches the full history before the
suite runs, because CI does, and `RULES.md` §4 tells each routine to do the
same before its checks.

## What happens to a Jules PR

1. **Triage** (`.github/workflows/jules-triage.yml`, when it opens) closes it
   if it is:
   - noise: an empty PR, a "nothing to change" report, a count sync in the
     docs, or a change only to `.jules/`;
   - off its routine's contract: a `bug-hunt` fix with no new test file, a
     `test-gaps` PR that does more than add test files, or a `docs-drift`
     PR outside the user docs;
   - the same work as an older open PR: the same `[jules:<routine>] <target>`,
     or the same files;
   - work declined within 60 days;
   - over the queue cap: five already waiting.

   It never closes a PR for what it is about, so a security or speed fix that
   is none of the above stays open for you. Otherwise it labels the PR
   `jules-automerge-eligible` or `jules-review`.
2. **CI** runs the full matrix.
3. **Auto-merge** (`.github/workflows/auto-merge.yml`, after green CI)
   compares the exact head commit CI verified with its base and merges only
   when every changed file is a new `tests/<name>.test.mjs`, pinned to that
   commit. Everything else is labelled `jules-review` and waits for you.

## Turning it down

- To pause a routine, use the task's menu in Jules.
- To reject a PR, close it unmerged. Its target is not proposed again for
  60 days.
- To retire a routine, delete the Jules task. Remove its file and its entry in
  `SCHEDULE` in `.github/scripts/jules-policy.mjs` in a pull request.
