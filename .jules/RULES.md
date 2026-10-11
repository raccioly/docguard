# Rules for every Jules routine on DocGuard

Read this before any routine file. `AGENTS.md` still applies in full; this
adds what a scheduled agent needs. The policy that enforces it on GitHub is
`.github/scripts/jules-policy.mjs`.

## 1. Preflight decides whether there is work

Run `node .jules/preflight.mjs <routine>` first. It prints `GO` with the one
target for this run, or `STOP: <reason>`.

- **STOP** means end the task now: no changes, no branch, no pull request.
  Report the reason in the task summary.
- **GO** means work on that target only, whatever else you notice. Mention
  anything else in the task summary instead.

## 2. No finding, no pull request

Open a pull request only for a change backed by evidence. If the routine finds
nothing, end the task with a one-paragraph summary. A pull request that changes
nothing, reports that something is up to date, or restates a count is closed on
arrival.

## 3. One pull request, titled by the preflight

- Use the title line preflight printed, replacing `<one-line summary>`. The
  `[jules:<routine>] <target>` prefix is how duplicates are detected; do not
  change it.
- Keep it to 10 files or fewer.
- Publish it as a pull request, not a draft and not a bare branch.
- The body has three sections:
  - **Evidence:** the exact commands you ran and their output, before and after.
  - **What changed:** what you changed.
  - **Dropped:** what you looked at and rejected, and why.

## 4. Before you open the pull request, run

```bash
git rev-parse --is-shallow-repository   # if "true": git fetch --unshallow origin
npm test
node cli/docguard.mjs guard              # exit 0 or 2 passes; 1 does not
```

CI checks out the full history, so run these on the full history too.

## 5. Never ask a question: decide, or stop

Nobody answers a scheduled run. A question leaves the task in
"waiting for your input" forever, and the finding is lost with it. That has
already happened on this repository.

When you reach a choice these rules do not settle:

- **Take the pessimistic option** if one is within scope. Pessimistic means
  the smaller change, nothing weakened, and nothing claimed that you have not
  shown with a command and its output. Then continue.
- **Otherwise, end the task** with no pull request. The task summary is
  three parts:
  - the question;
  - each option with its consequence;
  - the evidence: commands and output.

  A maintainer reads the summary.

## 6. If the suite is red before you change anything

That is your environment, not the code: CI on `main` is green. Do not fix it.
End the task and describe the failure in the summary.

## 7. Never

- edit, delete or weaken an existing test or assertion. Add a new test file
  instead.
- edit `tests/fixtures/**` or `tests/helpers/**`.
- edit `CHANGELOG.md`, `llms.txt` or `llms-full.txt`. A maintainer adds the
  changelog entry when merging.
- add a dependency.
- add a network call or telemetry to `cli/`.
- touch `.github/`, `.jules/`, `.agents/`, `.agent/`, `.specify/`, `specs/`,
  `AGENTS.md`, `CLAUDE.md`, `commands/`, `templates/`, `extensions/`,
  `docs-canonical/`, `package.json`, `package-lock.json`, `pyproject.toml`,
  `action.yml` or `packaging/`. Several of these are instructions that ship
  to every DocGuard user's agent.
- commit scratch files such as `patch.diff` or `commit_message.txt`, or
  journals such as `.jules/*.md` notes.
- quote names, paths or text from any private codebase. Use neutral domains
  only.
- mention any agent by handle in a pull request or comment.

## 8. What merges without a maintainer

Only new top-level test files, `tests/<name>.test.mjs`, merge on a green CI
with no maintainer. Everything else waits for review: an edit to an existing
file, a fix in `cli/`, a docs change. That is expected, not a failure. At most
five Jules pull requests wait at once, and each routine has at most one; past
that, preflight answers STOP.
