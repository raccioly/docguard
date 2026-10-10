---
title: Spec Kit
parent: Guides
nav_order: 2
---

# Using DocGuard with Spec Kit

[GitHub Spec Kit](https://github.com/github/spec-kit) has your coding agent
write a specification, a plan and a task list, then implement them. DocGuard
adds four things to that workflow:

- It checks the quality of those documents.
- It keeps a committed registry of each spec's lifecycle and evidence.
- It blocks a new spec that contradicts the recorded state.
- It verifies a spec as complete only when the code, tests and canonical docs
  show it.

The README's
[Spec Kit Integration](https://github.com/raccioly/docguard/blob/main/README.md#-spec-kit-integration)
section has the phase-by-phase overview. This guide covers installation, the
extension's commands and hooks, the registry and an end-to-end flow.

## What the extension adds

The extension is defined by
[`extensions/spec-kit-docguard/extension.yml`](https://github.com/raccioly/docguard/blob/main/extensions/spec-kit-docguard/extension.yml).
It requires Spec Kit 0.11.2 or later, plus `node` (18 or later) and `npx`.

### Commands

| Command | What it does |
|---|---|
| `speckit.docguard.init` | Initialize DocGuard in the project |
| `speckit.docguard.guard` | Run guard and triage the findings by severity |
| `speckit.docguard.fix` | Repair documentation, researching the code for each document |
| `speckit.docguard.review` | Read-only consistency analysis across documents |
| `speckit.docguard.score` | Structural maturity score with an improvement plan |
| `speckit.docguard.diagnose` | Every issue with a fix prompt |
| `speckit.docguard.generate` | Draft canonical docs from the existing code |
| `speckit.docguard.sync` | Refresh code-derived sections and keep human prose |
| `speckit.docguard.trace` | Requirements traceability matrix |
| `speckit.docguard.brief` | Brief current spec intent and lifecycle before a new spec |
| `speckit.docguard.preflight` | Gate the generated spec before tasks |
| `speckit.docguard.complete` | Plan the reviewed implemented-to-verified transaction |

How you invoke them depends on the agent:

- Claude Code and other skills-based agents: `/speckit-docguard-guard`.
- Spec Kit's `generic` integration: `/speckit.docguard.guard`.

For `generic`, `docguard init` writes the command files into the generic
commands directory, `.agent/commands/` by default.

Each command file runs `docguard` from `PATH` when it is installed. Otherwise it
runs `npx --yes docguard-cli@<version>`, pinned to the release the file shipped
with. It never runs `@latest`.

### Hooks

| Event | Command | Mandatory | Priority |
|---|---|---|---|
| `before_specify` | `speckit.docguard.brief` | Yes | 5 |
| `before_tasks` | `speckit.docguard.preflight` | Yes | 10 |
| `after_tasks` | `speckit.docguard.score` | No | 10 |
| `after_implement` | `speckit.docguard.guard` | Yes | 5 |
| `after_implement` | `speckit.docguard.complete` | No | 10 |
| `after_converge` | `speckit.docguard.complete` | No | 10 |

"Mandatory" means `optional: false` in the manifest. Optional hooks carry a
prompt, for example "Show CDD maturity score after task generation?". A lower
priority runs first. The briefing (priority 5) runs before the branch creation
of Spec Kit's git extension (default 10), so a blocked briefing never leaves an
empty feature branch behind. Spec Kit records the hooks in
`.specify/extensions.yml`.

### Also included

- **Five agent skills**: `docguard-guard`, `docguard-fix`, `docguard-review`,
  `docguard-score` and `docguard-sync`. `docguard init` installs them into
  your agent's skills directory. See [Coding Agents](../reference/agents.md)
  for the paths.
- **Three helper scripts** under `scripts/bash/`:
  - `docguard-check-docs.sh` returns a JSON inventory of the documents.
  - `docguard-suggest-fix.sh` returns prioritized fixes.
  - `docguard-init-doc.sh` creates a canonical document with its metadata
    header.

  They need DocGuard in `node_modules` or on `PATH`, and do not download it.
- **Two GitHub Actions starters**, `docguard-guard.yml` and
  `docguard-autofix.yml`. See [Continuous Integration](ci.md#starter-workflow).

## Install

Install the DocGuard CLI first. A global or project install lets the commands
and scripts run without `npx`:

```bash
npm install -g docguard-cli
```

### With `docguard init` (recommended)

With the `specify` CLI on `PATH`, `docguard init` sets up Spec Kit and the
extension:

1. It checks that `specify` is at least the version the extension requires
   (0.11.2) before changing anything. If it is older, it prints the upgrade
   command (`specify self upgrade`) and continues without Spec Kit.
2. It picks the Spec Kit integration for your agent: the one Spec Kit already
   recorded, otherwise an unambiguous signal in the repository (such as a
   `.claude/` directory), otherwise `generic`.
3. It runs `specify init --here --force --integration <agent>`, adding
   `--non-interactive`, `--ignore-agent-tools` and `--script` when your Spec
   Kit supports them. `generic` gets its commands directory set to
   `.agent/commands/`.
4. It registers the extension copy that ships inside the installed npm package,
   with `specify extension add <dir> --dev`. Nothing is downloaded. If a
   different version is registered, it replaces it with `--force` and keeps
   its priority. A registration you disabled stays disabled.
5. It reports the workflow hooks as active only after every mandatory hook
   resolves to a command file your agent can run. Otherwise it names each
   missing one.
6. It installs DocGuard's own skills for your agent.

Example output, with Claude Code and Spec Kit installed:

```
  🌱 Spec Kit Integration
  ✅ Spec Kit initialized (integration: claude)
  ✅ DocGuard extension registered with Spec Kit
  ✅ Workflow hooks active (before_specify → /speckit-docguard-brief, after_implement → /speckit-docguard-guard, before_tasks → /speckit-docguard-preflight)
  ✨ DocGuard AI skills installed/updated → .claude/skills/ (5 files)
```

`specify init --here --force` writes Spec Kit's files into your existing
repository. Commit or stash your work first, so the diff is easy to review.

| Situation | What `init` does |
|---|---|
| `specify` not on `PATH` | Runs DocGuard standalone and prints how to install Spec Kit |
| `--no-spec-kit` | No `specify` call and no `.specify/`. DocGuard's skills are still installed. |
| `--profile starter` | Skips Spec Kit unless you add `--spec-kit` |
| A Spec Kit step fails | Prints Spec Kit's error and the command to run by hand, then continues standalone |

Only `docguard init` and `docguard upgrade --apply` call `specify`. Other
commands print a one-line hint at most.

### By hand

```bash
# From the GitHub release archive (Spec Kit asks you to confirm the source)
specify extension add docguard --from \
  https://github.com/raccioly/docguard/releases/download/vX.Y.Z/spec-kit-docguard-vX.Y.Z.zip

# From the npm package in the project
specify extension add ./node_modules/docguard-cli/extensions/spec-kit-docguard --dev
```

`specify extension add docguard` on its own does not work with Spec Kit's
default catalogs. DocGuard is listed in the community catalog, which Spec Kit
treats as discovery only. See [Installation](../installation.md#spec-kit-extension).

### Keep it current, or remove it

`docguard upgrade --apply` and `docguard init` re-register the extension when
its version differs from the CLI's. To remove it, run
`specify extension remove docguard`.

## What guard checks in a Spec Kit project

In a project with specs, `docguard guard` runs two validators for them. Both are listed in [Finding Codes](../reference/findings.md).

**Spec-Kit (`SPK` codes)** checks the documents themselves:

- `spec.md`: the mandatory sections (User Scenarios, Requirements, Success
  Criteria) and `FR-` and `SC-` IDs.
- `plan.md`: Summary, Technical Context and Project Structure.
- `tasks.md`: phases and `T-` task IDs.
- The constitution: `.specify/memory/constitution.md` or the project root.
- Checked tasks with no implementation evidence (SPK008).
- Checked tasks that name a file the feature never changed (SPK010).
- Two feature directories that share a spec number (SPK012).

Turn the task checks off with `specKit.phantomCheck` and
`specKit.untouchedClaimCheck`. See
[Configuration](../configuration.md#spec-kit-checks--speckit).

**Spec-Registry (`SPR` codes)** checks the registry against the repository.
It reports:

- a missing or stale registry (SPR001);
- missing or reused identities (SPR002);
- lifecycle states that contradict storage (SPR004);
- overlap with prior intent (SPR005);
- checked tasks with no implementation annotation (SPR006);
- as-built drift (SPR007);
- recorded revisions lost to a squash merge (SPR008);
- asset paths that match no file (SPR009).

Run `docguard explain <CODE>` for any code.

## The spec registry

`.docguard-specs.json` is a committed index of every spec. Its order and
formatting are fixed, so the same repository always produces the same bytes.
Requirement text stays in each `spec.md`. The registry holds:

| Part | Holds | Written by |
|---|---|---|
| `specId`, `path` | The spec's immutable identity and file | `specs --write` |
| `reviewed.lifecycle` | `approval` (`draft`, `approved`, `rejected`), `delivery` (`planned`, `in_progress`, `implemented`, `verified`, `released`), `context`, `storage`, `persistenceModel` | People, through `specs approve` and `specs complete` |
| `reviewed.relations` | `extends`, `duplicates`, `conflictsWith`, `supersedes`, `supersededBy` | People, edited and reviewed in the PR |
| `reviewed.scope` | `canonicalDocs` the spec affected; `assetPaths` for files that cannot carry an annotation | People |
| `reviewed.reconciliation` | The last reviewed revision and the completion outcomes | `specs complete --write` |
| `observed` | Artifact digests, task completion, implementation and test evidence | `specs --write` |
| `tombstones` | Specs moved to Git history | `specs --write`, from the records `docguard retire` keeps in `.docguard-archive.json` |

`specs --write` refreshes the observed part and never changes the reviewed
part. Approval is never read from a spec's prose. A `**Status**: Approved` line
in `spec.md` is ignored. Reviewed fields record what the person who ran the
command attested, and the pull request that commits the registry is where that
gets reviewed.

### Spec IDs and evidence

Every active spec needs a stable, project-scoped ID near the top of `spec.md`:

```markdown
**Spec ID**: `acme.billing-export`
```

Evidence refers to requirements as `<specId>#<requirementId>`. A bare `FR-001`
is only a navigation hint, because the same local ID appears in many specs.

```js
// src/export.mjs
// @implements acme.billing-export#FR-001
```

```js
// tests/export.test.mjs
// @req acme.billing-export#FR-001
```

### The `docguard specs` commands

| Command | What it does | Writes |
|---|---|---|
| `docguard specs --check` | Exit `2` when the registry is missing, stale or inconsistent. Use it in CI. | Nothing |
| `docguard specs --write` | Refresh the observed evidence and keep the reviewed fields | `.docguard-specs.json` |
| `docguard specs preflight` | Brief the current specs before you write a new one. `BLOCKED` when the registry is stale. | Nothing |
| `docguard specs preflight --path <spec.md>` | Gate a generated draft: missing or duplicate identity, stale registry, unsafe paths, broken lineage. Text similarity is reported for review and never blocks. | Nothing |
| `docguard specs approve --id <id> [--delivery <state>]` | Show an approval, and optionally a delivery state (`planned`, `in_progress`, `implemented`). Add `--write` to record it. | With `--write` |
| `docguard specs complete --id <id> --since <ref>` | Plan the implemented-to-verified transaction and list its blockers. Add `--write --reason "<reviewed outcome>"` to apply it. `--deviation <text>` (repeatable) and `--successor <id>` record accepted deviations and a successor. | With `--write` |
| `docguard specs require --since <ref> [--message-file <file>]` | The spec-first gate: exit `1` when a change to governed paths names no spec, `2` when inconclusive | Nothing |
| `docguard specs reanchor --id <id>` | Move a revision that a squash merge discarded (SPR008) to the matching commit on HEAD's history. `--to <rev> --reason <text>` attests an anchor; `--from <rev>` selects one revision. Add `--write` to apply. | With `--write` |

Every subcommand accepts `--format json`. `preflight`, `approve`, `complete` and
`reanchor` exit `2` when their result is `BLOCKED`. The full option list is in
[Commands](../commands.md#docguard-specs).

`specs approve` refuses `verified` and `released`; only `specs complete`
records them, after checking evidence. It never moves a verified spec back.

`specs complete` blocks until all of these hold. Each blocker has its own code;
run `docguard explain SPC001` through `SPC008` for details.

- The working tree is committed and the registry is current (SPC001).
- The spec is approved and its delivery is `in_progress` or `implemented`
  (SPC002).
- Every task in `tasks.md` is checked. A living spec with evidence for every
  requirement may have no `tasks.md` (SPC003).
- At least one source file has `@implements <specId>#<req>`, at least one test
  has `@req <specId>#<req>`, and every requirement has evidence (SPC004).
- `reviewed.scope.canonicalDocs` lists the canonical documents the change
  updated (SPC005).
- Every file changed since the baseline traces to a spec (SPC006).
- Guard reports no errors (SPC007).

The write updates the registry, the spec's outcome block and
`.docguard/current-context.json` together. If a write or validation fails during
the run, all three are rolled back.

## As-built specs for existing code

For code that has no spec, such as legacy code, a refactor or a migration,
DocGuard can draft one per directory:

```bash
docguard generate --spec src/billing                       # preview the candidates
docguard generate --spec src/billing --write               # create and register the spec
docguard generate --spec src/billing --id acme.billing --write --format json
```

DocGuard writes one `FR-NNN` candidate for each fact it can establish without a
model. The facts are routes, exported JavaScript and TypeScript symbols,
environment variables read, and data entities. Each candidate cites its file
and line and carries a `<!-- docguard:fact <kind> <key> -->` marker. DocGuard
writes no requirement prose; your agent writes each statement.

`--write` creates the spec in the next free feature directory, following Spec
Kit's `feature_numbering`, and registers it with `origin: as_built` and its
`sourcePaths`. From then on, guard reports SPR007 in two cases:

- a fact under those paths that the spec neither marks nor lists under
  `## Out of Scope`;
- a cited fact that no longer exists.

An as-built spec needs no `tasks.md`. The JSON output includes `parserTier` and
`confidence`, which is `low` when the pattern fallback read the routes or
entities. See [Languages and Frameworks](../reference/languages.md).

## The spec-first gate

`docguard specs require` fails a change to governed code that names no spec. The
GitHub Action runs it with `command: spec-first`. Set the governed paths and
the accepted exemption kinds in `.docguard.json`; see
[`specFirst`](../configuration.md#spec-first-gate--specfirst). For workflow
examples, see [Continuous Integration](ci.md#spec-first-gate).

## End-to-end flow

This walks one feature through Spec Kit with the DocGuard hooks active. The
hooks run the `docguard` commands shown; run them yourself if your agent does
not.

| Step | You or your agent | DocGuard |
|---|---|---|
| 1. Specify | `/speckit.specify` | The `before_specify` hook runs `docguard specs preflight --format json`. `BLOCKED` stops the work until the registry is repaired. Otherwise the agent reads the current specs it lists. |
| 2. Identify | Add `**Spec ID**: \`org.feature\`` to the new `spec.md`. Never reuse an ID. | |
| 3. Plan | `/speckit.plan` | |
| 4. Tasks | `/speckit.tasks` | The `before_tasks` hook runs `docguard specs preflight --path <spec.md> --format json` and stops on `BLOCKED`. It then refreshes the registry with `docguard specs --write`. The optional `after_tasks` hook shows the score. |
| 5. Approve | A maintainer runs `docguard specs approve --id org.feature --delivery in_progress --write`. | Records approval in the registry, for review in the PR. |
| 6. Implement | `/speckit.implement`. Annotate code with `@implements org.feature#FR-NNN` and tests with `@req org.feature#FR-NNN`. Check off tasks. Update the canonical docs. | The `after_implement` hook runs guard. |
| 7. Review completion | List the updated docs in `reviewed.scope.canonicalDocs`. Run `docguard specs --write` and commit. | The optional `complete` hook plans the transaction: `docguard specs complete --id org.feature --since <merge-base>`. |
| 8. Verify | A maintainer runs `docguard specs approve --id org.feature --delivery implemented --write` if needed, then `docguard specs complete --id org.feature --since <merge-base> --write --reason "<reviewed outcome>"`. | Marks the spec `verified` and regenerates the current context. |
| 9. Gate | CI runs `docguard guard`, `docguard specs --check` and the spec-first gate. | |

Agents do not approve or complete on their own. The `complete` command file
tells the agent to ask the maintainer to approve, and to apply the completion
write only when the maintainer supplies the reason.

### Squash merges

A completion recorded on a pull request's own commit is lost when the PR is
squash-merged. Guard then reports SPR008. To avoid it:

1. After the PR merges, branch from the default branch's tip.
2. Run as many `specs complete --write` as you need, and commit once. The files
   completion writes do not count as changes, so several completions can share
   one revision.

`specs complete` warns when a completion is about to be recorded on a commit
the squash would discard. To repair one, run
`docguard specs reanchor --id <id> --write`.

## Related commands

- `docguard trace --features`: per-feature adherence (requirement coverage,
  task completion, task evidence, artifacts), worst first.
- `docguard reconcile --since <ref>`: a read-only review of changes since a ref
  against approved intent.
- `docguard retire`: remove completed or superseded planning material from
  active AI context. It records recovery metadata and retired requirement
  identities in `.docguard-archive.json`.

See [Commands](../commands.md) for every option, and
[Existing Projects](existing-projects.md) for adopting DocGuard on a repository
that already has code.
