# Research: Spec Kit Init Delegation

Sources: `github/spec-kit` CHANGELOG and source at main (2c0a57a, 2026-09-29), the installed
`specify 1.0.13`, and the DocGuard code paths named in `plan.md`.

## R1 — Which Spec Kit releases accept which options

- **Decision**: Detect capability from `specify init --help` and require `--integration`.
  Pass `--non-interactive`, `--ignore-agent-tools` and `--script` only when the help lists them.
  Declare the minimum supported release as 0.10.0 in messages.
- **Rationale**: Upstream deprecated `--ai` in favour of `--integration` in 0.7.1 (#2218),
  deprecated `--no-git` in 0.8.2 (#2357), made non-interactive init default to Copilot in 0.8.7
  (#2414), and removed `--ai`, `--ai-commands-dir`, `--ai-skills` and `--no-git` in 0.10.0
  (#2872, #2873). Between 0.7.1 and 0.9.x both forms work, so reading the help is exact where a
  version table would only approximate. Help text is bundled, offline, and fast.
- **Alternatives considered**: Parse `specify --version` and branch on a version table; rejected
  because the table would itself drift and pre-release builds report non-comparable strings.
  Try the new flags and fall back to the old on failure; rejected because a partially applied
  `init --force` cannot be retried safely.

## R2 — Legacy (pre-`--integration`) CLIs

- **Decision**: No legacy invocation path. An older CLI gets a message naming 0.10.0 and the
  upgrade command (`specify self upgrade`, or `uv tool install specify-cli --force --from
  git+https://github.com/github/spec-kit.git` for CLIs predating `self upgrade`).
- **Rationale**: Upstream no longer supports those releases; keeping a second flag set doubles
  the test matrix for a population that `specify self upgrade` fixes in one command.

## R3 — Agent detection sources

- **Decision**: Read `.specify/integration.json` `default_integration` (then `integration`),
  then `.specify/init-options.json` `integration`, then its legacy `ai` field. Apply the existing
  `^[a-zA-Z0-9_-]{1,32}$` allowlist to every value. A project is initialized when either file
  exists.
- **Rationale**: Current Spec Kit writes `integration.json` as the authoritative state and keeps
  `init-options.json` for compatibility (it still writes `ai`, confirmed on 1.0.13).

## R4 — Filesystem signals

- **Decision**: Keep the signal→key map, but drop `.agents → agy`: `.agents/skills` is shared by
  the `codex`, `agy`, `zed` and `muse` integrations (upstream marks `agy` not multi-install safe
  for this reason). Keep `.windsurf` and `.roo`: those keys are absent from 1.0.13's integration
  list, and the adopter must see Spec Kit's rejection rather than have DocGuard substitute an
  agent. `.codex/` stays mapped to `codex` (it is Codex's own config directory, not shared).
- **Alternatives considered**: Query `specify integration list` to validate keys first; rejected
  as a second subprocess whose table output is not a stable contract.

## R5 — Extension registration

- **Decision**: After a successful init, run `specify extension add <packageRoot>/extensions/
  spec-kit-docguard --dev` unless `.specify/extensions/.registry` already lists `docguard`.
- **Rationale**: `--dev` installs from a local directory (upstream `extensions/command_add.py`),
  so registration needs no network, matches the running DocGuard version exactly, and the
  catalog entry (currently 0.41.6) cannot lag. Verified in this repository: the command writes
  `.specify/extensions/docguard/`, `.specify/extensions/.registry` and the hook registry
  `.specify/extensions.yml`, and registers commands for the default integration.
- **Alternatives considered**: `specify extension add docguard` from the catalog; rejected for
  the network call (Constitution VIII) and the version lag.

## R6 — Where initialization may run

- **Decision**: Only `docguard init` delegates. `ensureSpecKit()` stops spawning and becomes a
  one-line hint.
- **Rationale**: `ensureSkills()` runs on every write-capable command (`cli/docguard.mjs`). With
  working flags, the existing code would run `specify init --here --force` during `sync`, `fix`
  or `generate`. Constitution VI requires explicit consent for bulk writes.

## R7 — Testing a subprocess contract

- **Decision**: Tests put an executable stub named `specify` first on `PATH`. The stub records its
  argv to a file and mimics three behaviours selected by an environment variable: current CLI
  (accepts `--integration`), removed-flag CLI (rejects `--ai` with Spec Kit's message), and
  pre-0.7 CLI (help without `--integration`). POSIX only; the Windows `cmd.exe /c specify.cmd`
  branch is covered by unit-testing argument construction.
