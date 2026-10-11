---
title: Upgrading
parent: Guides
nav_order: 5
---

# Upgrading DocGuard

A DocGuard upgrade can touch four things:

| Part | Where it lives | Checked by `docguard upgrade` |
|---|---|---|
| The CLI | Your install channel (npm, PyPI, Homebrew, Docker, …) | Yes, against npm |
| The configuration schema | `version` in `.docguard.json` | Yes |
| Agent files | DocGuard's skills and commands, and the Spec Kit extension registration | Yes |
| CI pins | The Action tag, workflow install lines, pre-commit `rev:` | No |

This guide covers how to see what is behind, what to read before upgrading, how
to upgrade each channel, and what to check afterwards.

## 1. See what is behind

```bash
docguard upgrade
```

The sample output and the table below write versions as `X.Y.Z`; use the release you pin.

```text
🔧 DocGuard Upgrade
   Checking the CLI release on npm and the .docguard.json schema...

  CLI    installed: vX.Y.Z
         latest:    vX.Y.Z (current)

  Schema project:   v0.6
         current:   v0.6 (current)
  Agent  files:     current

  ✅ Everything is up to date.
```

The report writes nothing. It asks the npm registry for the latest version, with
a 3-second timeout, and prints "could not check (offline?)" when it cannot.
Validation commands such as `guard` make no network calls.

| Command | What it does |
|---|---|
| `docguard upgrade` | Report only. Exit `0` |
| `docguard upgrade --check-only` | Report, then exit `1` if the CLI, the schema or the agent files are behind. Use it in a scheduled CI job |
| `docguard upgrade --apply --schema-only` | Skip npm. Migrate `.docguard.json` and refresh agent files |
| `docguard upgrade --apply` | Also install the newer CLI with `npm install -g docguard-cli@latest` |

### How DocGuard tells you a release is old

When the installed release is more than 14 days old, guard's text output, the
MCP server's `initialize` instructions and the context pack say so, and suggest
`docguard upgrade`. DocGuard reads its own release date from the
`CHANGELOG.md` it ships with. The note makes no network call and never claims
that a newer version exists; it only says this one is old.

It stays silent when the date cannot be read for certain, in a DocGuard source
checkout, and in guard's text output when the `CI` environment variable is set.
JSON, SARIF, JUnit and MCP tool results never carry it. The 14-day threshold is
fixed. Turn the note off everywhere with:

```bash
export DOCGUARD_NO_UPDATE_HINT=1
```

Separately, when `.docguard.json` is on an older schema, guard's text output
ends with a line suggesting `docguard upgrade --apply --schema-only`.

## 2. Read the CHANGELOG before you upgrade

Every release has an entry in
[CHANGELOG.md](https://github.com/raccioly/docguard/blob/main/CHANGELOG.md).
New releases often add checks or read code that was invisible before, so a
project that passed can start reporting findings. The entry says which.

For example, the 0.43.0 entry opens with **Upgrading from 0.42.x**. No new
check in that release fails a build: every new finding is a warning or an
escalation. The worst case is `guard` moving from PASS to WARN (exit `2`). That
still fails CI that runs with `--fail-on-warning`, or that treats any non-zero
exit as failure. The most likely triggers it lists:

| Code | What starts being reported |
|---|---|
| STR004 | An `AGENTS.md` instruction chain over 32 KiB, where Codex stops reading |
| TDO002 | A comment that starts with a bare `TODO` or `FIXME` |
| SPR006, SPR007 | In Spec Kit projects, checked tasks with no `@implements` annotation, and as-built specs that drifted |
| PSR001–PSR004 | Agent instruction files (including a root `AGENTS.md`) that point at missing paths, or whose path scopes match nothing or cannot be read |
| ENV003 | On Go, Java, Kotlin, Ruby, Rust, PHP and C# projects, environment variables read in code (and Spring `${X}` placeholders) that the docs do not list |
| SCH002, ENV findings | On Python projects, SQLAlchemy models and pydantic `BaseSettings` fields the docs do not mention |

The same entry lists behaviour changes. Among them:

- The GitHub Action installs the CLI version it was released with, not
  `@latest`. Set `docguard-version: latest` to keep following npm.
- `docguard mcp` refuses a tool call whose `projectDir` is outside the
  directory it serves. Start it with `--root <dir>` for each other tree.
- `sync`, `fix` and `generate` no longer run `specify init`. Run
  `docguard init` or `specify init` yourself.
- The Spec Kit extension requires Spec Kit 0.11.2 or later.
- In a Claude Code project, `docguard init` installs DocGuard's skills into
  `.claude/skills/` instead of `.agent/`. An existing `.agent/` is left in place.
- A `.docguardignore` `dir/` pattern matches that directory at any depth, as
  in `.gitignore`. This can hide findings that fired before.
- The MCP tool `docguard_guard` returns the compact form. Pass
  `detail: "full"` for the previous shape.
- API-Surface reports `partial` on Go, Java, Ruby and Rust services, and
  Environment reports `partial` when a source language has no environment
  patterns. Both used to say `checked`. The exit code does not change, but the
  badge colour and coverage counts do.

Read every entry between your version and the one you are moving to, including
the `[Unreleased]` section if you install from the repository.

## 3. Upgrade the CLI for your install channel

| Channel | Upgrade | Pin a version |
|---|---|---|
| npm, global | `npm install -g docguard-cli@latest`, or `docguard upgrade --apply` | `npm install -g docguard-cli@X.Y.Z` |
| npm, dev dependency | `npm install --save-dev docguard-cli@latest` | Exact version in `package.json`, plus the lockfile |
| npx | Ask for it: `npx docguard-cli@latest guard` | `npx docguard-cli@X.Y.Z guard` |
| PyPI (`pip`) | `pip install --upgrade docguard-cli` | See the note below |
| PyPI (`pipx`) | `pipx upgrade docguard-cli` | See the note below |
| PyPI (`uv`) | `uv tool upgrade docguard-cli` | See the note below |
| Homebrew | `brew update && brew upgrade raccioly/tap/docguard` | Homebrew installs the tap's current version |
| Docker (MCP server) | `docker pull ghcr.io/raccioly/docguard:latest` | `ghcr.io/raccioly/docguard:X.Y.Z` (no `v`) |
| GitHub Action | Change the tag in `uses: raccioly/docguard@vX.Y.Z` | The tag pins the CLI. `docguard-version: <x.y.z>` or `latest` overrides it |
| pre-commit framework | Change `rev:`, or run `pre-commit autoupdate` | `rev: vX.Y.Z` |
| Claude Desktop | Download the new `docguard-v<version>.mcpb` from the release page and install it in place of the old one | The bundle's version |
| Spec Kit extension | Refreshed from the installed CLI; see step 4 | Follows the CLI |

> **Note:** The PyPI package is a small wrapper, and its own version does not
> decide which CLI runs. It looks for `node_modules/docguard-cli` in the current
> directory and each parent. If it finds one, it runs that copy. Otherwise it
> runs `npx -y docguard-cli@latest`, which always means the newest release on
> npm. To pin the CLI for a Python project, add `docguard-cli` as an npm dev
> dependency at the project root; the wrapper then uses it.

> **Note:** `docguard upgrade --apply` always installs with
> `npm install -g`. If you use another channel, upgrade through that channel,
> then run `docguard upgrade --apply --schema-only` with the new CLI. That
> migrates the schema and refreshes agent files without touching npm.

If you generated a workflow with `docguard init --with ci`, its install step
pins an exact version (`npm install --global --ignore-scripts
docguard-cli@<version>`). Edit that line too.

## 4. Migrate the configuration and refresh agent files

```bash
docguard upgrade --apply --schema-only   # any channel
docguard upgrade --apply                 # npm global installs only
```

`--apply` acts only on what is behind:

1. **The CLI** (without `--schema-only`). If npm has a newer release, it runs
   `npm install -g docguard-cli@latest`. A new release can change the number of
   validators or checks, so it reminds you to run `docguard fix --write` to
   refresh counts your documents quote.
2. **The schema.** It migrates `.docguard.json` to the current schema version.
   The migrations are additive: an empty `severity` map, an empty
   `findingSeverity` map, `project` renamed to `projectName` in very old files.
   It also rewrites a `requiredFiles` written as a bare array into the object
   form the validators read. Any other broken `requiredFiles` shape is reported,
   not guessed at.
3. **Agent files.** It rewrites DocGuard's skills and commands that differ from
   the installed CLI's copies. If the project's Spec Kit registration is from
   another DocGuard release, it re-registers the extension (this needs the
   `specify` CLI on your `PATH`).

When the same run installs a newer CLI, the running process still holds the old
version's files. It skips the agent-file refresh and asks you to run
`docguard upgrade --apply` again. `docguard init` also refreshes them.

`--apply` exits `1` when the CLI install fails (the schema migration still
runs), or when the Spec Kit extension needed a refresh that failed or could not
run because `specify` is not on your `PATH`.

### Opening the schema migration as a pull request

```bash
docguard upgrade --apply --schema-only --pr
```

With `--pr`, the schema migration goes to a pull request instead of being
written in place. It needs the GitHub CLI (`gh`). DocGuard then:

1. creates and checks out a branch named `docguard/upgrade-schema-<version>-<id>`
   from your current `HEAD`;
2. writes `.docguard.json` and commits only that file;
3. pushes the branch to `origin`;
4. opens the pull request with `gh pr create`.

You are left on the new branch. Start from a clean working tree. If any step
fails, the command exits `1`; run it without `--pr` to migrate in place. When
the schema is already current, there is nothing to migrate and no pull request
is opened.

`--pr` covers only the schema. Without `--schema-only`, the same run can still
install the CLI globally and refresh agent files in your working tree.

## 5. Check the result

1. Confirm the version: `docguard --version`.
2. Run `docguard guard`. Findings that the new release introduces are not in
   your baseline, so they show as new. For each one, choose:
   - fix it;
   - demote its code with `"findingSeverity": { "<CODE>": "low" }`, which keeps
     it visible without failing the build;
   - or, after reading `docguard guard --no-baseline`, freeze it with
     `docguard guard --update-baseline`.
3. If you use Spec Kit, run `docguard specs --check`.
4. Commit the result in one pull request: the migrated `.docguard.json`, the
   refreshed agent files, any baseline change and the new CI pins.

To record which release the project was last checked with, run
`docguard guard --pin` after a passing run. It writes `docguardVersion` into
`.docguard.json` (it refuses after a FAIL run). From then on, guard prints a
note when a different CLI version runs against the project.

> **Note:** Baselines survive upgrades. A finding keeps its fingerprint unless
> its code, file or message wording changes, so a release that rewords a
> message brings that finding back as new. The `[Unreleased]` section of the
> CHANGELOG describes one such case being fixed: TRC004's soft-match hint no
> longer counts toward the fingerprint, and existing baselines keep working.

## Keep CI reproducible

- Pin the Action tag, or set `docguard-version` to an exact version. Pinning
  the tag pins the CLI.
- Pin the version in any `npm install`, `npx` or Docker line.
- Do not rely on the PyPI wrapper alone in CI, because it runs `@latest` unless
  a local npm install is present.
- To hear about new releases without taking them automatically, run
  `docguard upgrade --check-only` on a schedule. It exits `1` when anything is
  behind.

See [CI](ci.md) for complete workflows, and [Installation](../installation.md)
for first-time setup on each channel.
