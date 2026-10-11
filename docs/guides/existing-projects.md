---
title: Existing Projects
parent: Guides
nav_order: 1
---

# Adopting DocGuard in an Existing Project

You do not need complete documentation before DocGuard is useful. Adopt it in
place: let it read the code, freeze the findings that already exist, gate new
drift in CI, and pay the old findings down at your own pace.

This guide takes an existing repository from a clean branch to a first pull
request with the gate on. Each step says what to run, what it writes, and why it
comes in that order.

> **Do not start with "document everything".** A first goal of complete,
> accurate documentation for the whole system turns adoption into a long
> project that blocks the gate. Get a baseline and a passing gate first. Then
> improve the documents that matter for the next change you make.

## 1. Start from a reviewable baseline

Commit or stash your work and create a branch for the adoption:

```bash
git status            # should be clean
git switch -c adopt-docguard
```

Adoption writes several files at once. On a branch, every one of them shows up
in a normal code review, and you can drop the branch if you change your mind.

The files you can expect by the end of this guide:

| Path | Written by | Commit it? |
|---|---|---|
| `.docguard.json` | `init` | Yes |
| `docs-canonical/`, `docs-implementation/` | `generate --plan --write`, `init` | Yes |
| `AGENTS.md`, `CHANGELOG.md`, `DRIFT-LOG.md` | `init --fix` (skipped when they exist) | Yes |
| `.docguardignore` | `init` (skeleton path) or `init --fix` | Yes |
| `.docguard.baseline.json` | `guard --update-baseline` | Yes |
| Agent skills and commands (`.claude/skills/`, `.agent/`, …) | `init` | Yes, if your team shares agent setup |
| `.specify/` | `init`, when the Spec Kit CLI is installed | Yes, if you use Spec Kit |
| `.github/workflows/docguard.yml` | `init --with ci` | Yes |
| `.docguard/` | Most commands (local state) | No. It contains a `.gitignore` that ignores the whole directory |

> **Note:** Avoid `--force` on the first run. It overwrites existing files
> (keeping a `.bak` copy). Without it, DocGuard skips files that already exist.

## 2. Install DocGuard

DocGuard needs Node.js 18 or later. Git is optional, but the history-based
checks (freshness, diff suspicion, reference existence) need it. `python3` is
optional and gives syntax-tree accuracy on Python code.

For a team, pin the version as a dev dependency so everyone and CI run the same
release:

```bash
npm install --save-dev docguard-cli
npx docguard --version
```

Or install it globally with `npm i -g docguard-cli`. The other channels
(PyPI, Homebrew, Docker, the Spec Kit extension) are in
[Installation](../installation.md). The rest of this guide writes `docguard`;
use `npx docguard` if you installed it as a dev dependency.

## 3. Run `init` on the existing code

```bash
docguard init
```

On an existing repository, `init` does three things before it writes anything:

1. **Looks for documents you already have.** If two or more canonical
   documents (architecture, data model, security, and so on) sit together in a
   directory other than `docs-canonical/`, `init` offers to use that directory
   and records the mapping as `docs.roles` in `.docguard.json`. In a
   non-interactive run it adopts the directory. A Spec Kit feature folder such
   as `specs/003-feature/` is never adopted.
2. **Detects the project type** (`api`, `webapp`, `cli` or `library`) from the
   manifest at the root (`package.json`, `pyproject.toml`, `Cargo.toml`,
   `go.mod`, …). The type decides whether checks such as environment variables
   and database documentation apply. The detection table is in
   [Configuration](../configuration.md), under "Project Type Detection".
3. **Chooses smart mode or the template path.** If the repository has code but
   no canonical documents, `init` switches to smart mode.

### Smart mode (the default for existing code)

Smart mode starts when there are no canonical documents and the repository
looks like it has code: a `cli/`, `src/`, `lib/` or `app/` directory, a
Django `manage.py`, a Python web framework, or ten or more source files at the
top level.

It runs the same scan as `docguard generate --plan`, prints the plan, and
writes **only** `.docguard.json` with the `standard` profile and the detected
type. It writes no documents. Example output on a small Express service:

```text
🔍 DocGuard Init — Smart Mode
   Detected existing project with code but no canonical docs.
...
  Code-truth surface: 1 modules · 0 test files (0 cases) · 2 endpoints · 0 entities · 0 screens · 2 env vars

  Documents to build (7):
    docs-canonical/ARCHITECTURE.md (3 code section(s), 2 agent task(s))
    docs-canonical/API-REFERENCE.md (1 code section(s), 1 agent task(s))
    ...
  ✅ Created: .docguard.json (profile: standard, type: api, 4 canonical doc(s) from the plan)
```

Any of these flags turns smart mode off and uses the template path instead:
`--skeleton`, `--profile <p>`, `--skip-prompts`, `--wizard`, `--fix`.

### The template path

The template path writes blank document templates for a profile, plus
`AGENTS.md`, `CHANGELOG.md`, `DRIFT-LOG.md`, `.docguardignore` and
`.docguard.json`. Existing files are skipped.

| Command | Use it when |
|---|---|
| `docguard init` | You want DocGuard to scan first and propose (smart mode) |
| `docguard init --profile cli --skip-prompts` | You already know the profile, and want templates without prompts |
| `docguard init --skeleton` | You want blank templates and no scan |
| `docguard init --wizard` | You want guided, interactive setup |
| `docguard init --fix` | You want any missing required files created from templates, headless |

Smart mode does not create the tracking files or install agent skills. After
step 4, run `docguard init --fix` once to add `AGENTS.md`, `CHANGELOG.md`,
`DRIFT-LOG.md`, `.docguardignore` and any missing profile templates, and to
install DocGuard's skills for your coding agent.

### Spec Kit and scaffolders

If the `specify` CLI (Spec Kit 0.11.2 or later) is on your `PATH`, the template
path also initializes Spec Kit for your coding agent and registers the DocGuard
extension. Pass `--no-spec-kit` to skip that. DocGuard's own agent skills
still install. The `starter` profile skips Spec Kit unless you pass
`--spec-kit`.

`--with <name>` adds optional scaffolders after `init` finishes. Names are
comma-separated: `agents`, `hooks`, `ci`, `badge`, `llms`, `publish`. Steps 8
and 9 use `ci` and `hooks`.

## 4. Generate the canonical documents from the code

Preview first:

```bash
docguard generate --plan
```

The plan lists the languages and frameworks found, the code-truth surface
(modules, test files, endpoints, entities, environment variables), the
documents it would build, and the prose tasks an agent must write. Add
`--format json` for the machine-readable manifest, or `--profile <p>` to
preview another profile's document set.

Then write the skeleton:

```bash
docguard generate --plan --write
```

Each document is split into marked sections:

```markdown
<!-- docguard:generated true -->

## Environment Variables

<!-- docguard:section id=env-vars source=code -->
| Variable | Required | Default | Source | Description |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Yes | — | `src/server.js` | <!-- describe --> |
| `PORT` | No | `3000` | `src/server.js` | <!-- describe --> |
<!-- /docguard:section -->

## Setup Steps

<!-- docguard:section id=setup source=human -->
> **AI task:** Write the Prerequisites and Setup Steps (clone → install → run) for this stack.
<!-- docguard:pending agent writes this section -->
<!-- /docguard:section -->
```

- **`source=code` sections** come from the same scanners `guard` uses: routes,
  entities, environment variables, modules, test files. Each row cites the
  source file it came from. Running `guard` straight after `generate` reports
  nothing about DocGuard's own output.
- **`source=human` sections** are prose that needs judgement: what the system
  is for, why the layers exist, how to set it up. DocGuard writes no prose. It
  leaves an AI task in each one. Have your coding agent write them, and review
  the result like any other change. `docguard diagnose` prints fix prompts for
  every open issue, and `docguard fix --doc <name>` prints the prompt for one
  document. See [AI Integration](../ai-integration.md).

Why this split: facts that can be read from code stay correct because a tool
refreshes them (step 11), and the sentences that need a human are marked as
such instead of being guessed.

`generate --plan --write` also adds the documents it creates to
`requiredFiles.canonical` in `.docguard.json`. Re-running it is safe. It
inserts missing sections and refreshes unpinned code sections. It never
replaces prose in a `source=human` section, and it keeps a `.bak` of any
document you edited.

> **Note:** `guard` does not report a `docguard:pending` placeholder. To list
> the prose still owed, search for the marker:
> `grep -rn "docguard:pending" docs-canonical docs-implementation`.

> **Note:** If your documents live somewhere else and you mapped them with
> `docs.roles`, DocGuard writes into a mapped document only inside one
> `source=code` section you added to it. The rules are in
> [Configuration](../configuration.md), under "Existing documentation layouts".

Plain `docguard generate` (without `--plan`) also exists. It writes pre-filled
documents in one step, and `--force` overwrites existing ones with a `.bak`
copy. This guide uses `--plan` because you see the plan before anything is
written.

How much DocGuard can read depends on the language. JavaScript, TypeScript and
Python are read with a syntax tree. Go, Java, Kotlin, Ruby, Rust, PHP and C# are
read by pattern, and the result is reported as partial. The per-language detail
is in [Languages](../reference/languages.md).

## 5. Run `guard` and read the findings

```bash
docguard guard
```

Guard prints one line per validator, then each finding with its code, message
and suggested fix:

```text
  ⚠️  Traceability [MEDIUM]  3/4 checks passed
     ⚠ [TRC002] TEST-SPEC.md — exists but no matching source code found (unlinked doc)
       → Link a source file explicitly with a header annotation if the code lives in a non-standard location
         // @doc TEST-SPEC.md
  ...
  ❌ FAIL — 29/37 passed, 3 blocking issue(s), 6 warning(s)
  8 to fix · 1 to review (fix = DocGuard names the correction; review = the judgement is yours)
  Check coverage: 12 of 31 validator(s) checked · 2 disabled · 19 no matches
```

How to work through a first run:

1. **Fix the structural errors first.** Missing required files (STR001,
   STR002) block the gate and are mechanical. `docguard init --fix` creates
   them from templates.
2. **Then the "to fix" findings.** DocGuard names the correction.
   `docguard diagnose` turns them into prompts for your agent.
3. **Then judge the "to review" findings.** These are signals, such as a
   document that many commits have passed since its last review. The right
   answer can be "checked, still correct".
4. **Look up any code you do not recognise** with `docguard explain <CODE>`, or
   in the [finding reference](../reference/findings.md).

The "Check coverage" line says how many validators actually checked something.
A validator with "no matches" found nothing to check, which is not the same as
passing.

Guard exits `0` on pass, `1` on blocking errors, `2` on warnings only, and `3`
when the project has no `.docguard.json`. Every exit code, and the five fields
on each finding, are explained in [Troubleshooting](troubleshooting.md). Every
command and flag is in the [Commands Reference](../commands.md).

You do not need to fix everything now. Fix what is cheap, then freeze the rest.

## 6. Freeze the existing findings with a baseline

```bash
docguard guard --update-baseline
git add .docguard.baseline.json
```

This writes `.docguard.baseline.json` at the repository root. From then on,
`guard`, `ci` and `report` suppress the frozen findings and gate only new ones.
The baseline covers errors and warnings alike.

Why now: the gate you turn on in step 8 should block new drift from the first
day, without failing every pull request on findings that predate the adoption.

What is fingerprinted, for each finding:

- its code;
- its file path, without the line number;
- its message, with every number masked.

Line churn and changing counts ("13 commits since…") therefore do not break the
match. Each fingerprint also stores how many times it occurred: freezing one
instance suppresses one, and a second instance of the same finding in the same
file is reported.

Suppression is always visible:

```text
  📋 8 pre-existing finding(s) suppressed by .docguard.baseline.json — 8 warning (--no-baseline to show)
     baseline is 0 day(s) old; 8 still suppressed.
```

`guard --format json` carries the same facts in `baselineSuppressed`,
`baselineBySeverity`, `baselineStillFiring`, `baselineStale` and
`baselineAgeDays`.

| To | Run |
|---|---|
| See everything, ignoring the baseline once | `docguard guard --no-baseline` |
| Ignore the baseline permanently | Set `"baseline": false` in `.docguard.json` |
| Drop entries for findings you fixed | `docguard guard --update-baseline` |

> **Note:** Re-freezing captures everything that fires at that moment,
> including new findings. Run `docguard guard --no-baseline` and read the list
> before you re-freeze.

> **Note:** `--update-baseline` cannot be combined with `--changed-only`, and
> exits `1` if you try. The baseline must freeze the full validator set.

The baseline does not change `docguard score`. More detail is in
[Configuration](../configuration.md), under "Adoption baseline".

## 7. Choose a profile and plan when to graduate

A profile sets which documents are required and which validators run.

| Profile | Required canonical documents | Use it for |
|---|---|---|
| `starter` | `ARCHITECTURE.md` | Side projects and prototypes. Turns off drift, architecture, test-spec, security, environment and freshness checks |
| `standard` (default) | `ARCHITECTURE.md`, `DATA-MODEL.md`, `SECURITY.md`, `TEST-SPEC.md`, `ENVIRONMENT.md` | Team projects. Architecture (import graph) and security (secrets) checks are off |
| `cli` | `ARCHITECTURE.md`, `TEST-SPEC.md`, `SECURITY.md`, `ENVIRONMENT.md` | Command-line tools: no HTTP API or database assumed |
| `library` | `ARCHITECTURE.md`, `API-REFERENCE.md`, `TEST-SPEC.md` | Packages with a public API and no server or database |
| `enterprise` | The `standard` set | Regulated or critical systems. Every validator on, including architecture and security |

Every profile also requires an agent file (`AGENTS.md` or `CLAUDE.md`),
`CHANGELOG.md` and `DRIFT-LOG.md`.

Smart mode writes `standard`. To choose another profile at the start, run
`docguard init --profile <p> --skip-prompts` instead of plain `init`, then
step 4. `generate --plan --write` fills the code sections into the profile's
templates.

> **Note:** Settings in `.docguard.json` override the profile. `init` writes an
> explicit `validators` block and a `requiredFiles.canonical` list, so changing
> `"profile"` alone does not change what those keys already set. When you
> graduate (for example from `standard` to `enterprise`), edit `validators` and
> `requiredFiles.canonical` as well. Then run `docguard guard` to see the
> effect.

When a validator genuinely does not apply, declare it rather than switch it off.
For example, add this line to a canonical document or to `AGENTS.md`:

```markdown
<!-- docguard:validator testSpec n/a — POC, no automated tests yet -->
```

The validator then shows as `N/A` with your reason, in the repository, instead
of silently disappearing. To soften one noisy finding code without turning off
its validator, set `"findingSeverity": { "<CODE>": "low" }`. The finding stays
visible but never fails the build.

`docguard score --tax` estimates the weekly maintenance cost of the current
profile. See [Profiles](../profiles.md) and [Configuration](../configuration.md).

## 8. Turn on CI

Pick one of the two options below. Both need the full git history for the
history-based checks.

**Option A: the GitHub Action.**

> Replace `X.Y.Z` with the release you pin; [Installation](../installation.md) shows how to find the latest.

```yaml
name: DocGuard
on: [pull_request, push]
permissions: { contents: read, pull-requests: write }
jobs:
  docguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: raccioly/docguard@vX.Y.Z
        with:
          command: guard
```

The action installs the `docguard-cli` version it was released with, so pinning
the action pins the CLI. On warnings it prints a `::warning` and passes. Set
`fail-on-warning: 'true'` to fail instead. On pull requests it adds inline
annotations and a sticky comment by default (the comment needs
`pull-requests: write`).

**Option B: a generated workflow.**

```bash
docguard init --with ci --skip-prompts
```

This writes `.github/workflows/docguard.yml`, which installs a pinned CLI and
runs `docguard ci --format json --threshold 70 --no-history`. The job exits
with `ci`'s exit code, so warnings (exit `2`) fail it as well as errors.

> **Note:** `--threshold` compares the score from `docguard score`, which the
> baseline does not change. Run `docguard score` first and set the threshold at
> or below today's number, or the first run fails.

Start lenient: block on errors only, and treat warnings as information. Once
the baseline has shrunk, add `fail-on-warning` (Action) or
`--fail-on-warning` (`docguard ci`). GitLab, Jenkins, Azure DevOps and other
CI systems are covered in [CI](ci.md).

## 9. Add local Git hooks (optional)

Hooks catch drift before it reaches a pull request.

```bash
docguard init --with hooks --skip-prompts                    # all three hooks
docguard init --with hooks --type pre-commit --skip-prompts  # one hook
```

| Hook | What it runs | Blocks when |
|---|---|---|
| `pre-commit` | `docguard guard` | Guard exits `1`. Warnings (`2`) and a project with no `.docguard.json` (`3`) are allowed through |
| `pre-push` | `docguard score --format json` | The score is under 60, or the command fails |
| `commit-msg` | A conventional-commit format check | The message does not match |

`--skip-prompts` matters on an adopted project: without it, `init` asks the
document questions again before installing the hook. Skip a hook for one
commit with `git commit --no-verify`.

If your repository uses husky, lefthook or simple-git-hooks, DocGuard does not
overwrite the manager's dispatcher. It prints where to add the command
instead: `npx docguard-cli guard --changed-only` for pre-commit and
`npx docguard-cli ci` for pre-push. `--changed-only` runs a smaller, fast
validator set on the files changed since `HEAD~1` (or `--since <ref>`).

The [pre-commit](https://pre-commit.com) framework is also supported, with the
`docguard-guard` (changed-only) and `docguard-guard-full` (pre-push) hook IDs:

```yaml
repos:
  - repo: https://github.com/raccioly/docguard
    rev: vX.Y.Z
    hooks: [{ id: docguard-guard }]
```

## 10. If you use Spec Kit

Spec Kit's own advice for existing projects holds here too: specify the next
bounded change, not the whole system. DocGuard adds two things for existing
code.

**As-built specs for areas that have none.** For one directory, DocGuard
proposes a spec built from facts it can read without a model: routes,
exported JavaScript and TypeScript symbols, environment variables read, and
data entities.

```bash
docguard generate --spec src/billing            # preview the candidates
docguard generate --spec src/billing --write    # create and register the spec
```

Each fact becomes one `FR-NNN` candidate, with a `docguard:fact` marker and the
file and line it came from. DocGuard writes no requirement prose; every
statement is a task for your agent. `--write` creates the spec in the next free
feature directory (`specs/NNN-as-built-src-billing/spec.md`) and registers it
in `.docguard-specs.json` with origin `as_built`. From then on, guard's SPR007
reports facts under that path that the spec neither covers nor lists as out of
scope.

Do this for an area you are about to change, not for every directory up
front.

**The spec registry.** `docguard specs --write` refreshes the observed
evidence in `.docguard-specs.json` and keeps your reviewed fields. Add
`docguard specs --check` to CI. It exits `2` when the committed registry is
missing, stale or inconsistent.

The extension hooks, the lifecycle commands (`specs approve`, `specs complete`)
and the spec-first gate are in [Spec Kit](spec-kit.md).

## 11. Decide how the documentation will age

After the first pull request, agree on how each kind of document stays current.

| Kind of content | Keeps current through | Commands |
|---|---|---|
| Code-truth sections (`source=code`) | Regenerated from the scanners | `docguard sync` previews; `docguard sync --write` applies; `--since <ref>` limits it to sections whose sources changed |
| Prose that describes specific code | A recorded review, re-opened when that code changes | Add `covers="src/pricing.mjs#discount"` to the section marker, then `docguard review --accept <doc>#<id> --reason "<what you checked>"`. Guard reports DLK001 when the covered code changes |
| Other prose | Freshness review signals (FRS findings) | Review the document, then record the date with `<!-- docguard:last-reviewed YYYY-MM-DD -->` under its first heading |
| Records of past decisions | Marked historical, so currentness checks skip them | `<!-- docguard:status historical -->` |
| Documents nobody should load anymore | Retired from active agent context, recoverable from git | `docguard retire --plan`, then `docguard retire --write --path <doc> --reason "<why>"` |

`docguard review --suggest <doc>` proposes `covers=` values from the paths a
document already mentions. Its suggestions are low confidence, and it never
writes. The section-marker syntax is in [Doc Sections](../doc-sections.md).

Finally, schedule the baseline burn-down. The guard output reports how many
baselined findings no longer occur. When that count is not zero, review with
`--no-baseline` and re-freeze.

## What the first pull request contains

- `.docguard.json` with the profile and validators you chose.
- The canonical documents, code-truth sections filled, prose written by your
  agent and reviewed by you (or still marked `docguard:pending`, if you chose
  to merge the skeleton first).
- `AGENTS.md`, `CHANGELOG.md`, `DRIFT-LOG.md`, `.docguardignore`.
- `.docguard.baseline.json`.
- The CI workflow, and optionally hooks configuration and agent skills.

`docguard guard` passes on the branch, and new drift fails the gate from the
next pull request on.

## Next steps

- [CI](ci.md): other CI systems, SARIF and JUnit output.
- [Spec Kit](spec-kit.md): the full spec lifecycle.
- [Monorepos](monorepo.md): several packages in one repository.
- [Troubleshooting](troubleshooting.md): exit codes, false positives, partial
  coverage.
