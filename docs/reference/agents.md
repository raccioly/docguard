---
title: Coding Agents
parent: Reference
nav_order: 4
---

# Coding Agents

DocGuard runs from a terminal and needs no agent. When you use an agent,
DocGuard can put four kinds of files where that agent reads them:

| Files | Written by | When |
|---|---|---|
| DocGuard's skills (5) and slash commands (4) | `docguard init`; refreshed by `docguard upgrade --apply` | Always during `init`, at the location this page describes |
| DocGuard's Spec Kit extension commands (12) and hooks | Spec Kit, when DocGuard registers its extension | `init` with the `specify` CLI on `PATH` (not with `--no-spec-kit`, nor with the `starter` profile unless you pass `--spec-kit`) |
| Instruction files for each agent, generated from `AGENTS.md` | `docguard init --with agents` | Only when you ask |
| A Claude Code nudge hook in `.claude/settings.json` | `docguard hooks --claude` | Only when you ask |

No other command writes agent files. Every agent can also call DocGuard as an
MCP server. See [MCP Server](mcp.md).

## The files DocGuard installs

**Skills**, from `extensions/spec-kit-docguard/skills/`, one `SKILL.md` each:
`docguard-fix`, `docguard-guard`, `docguard-review`, `docguard-score`,
`docguard-sync`.

**Slash commands**, from `commands/`: `docguard.fix.md`, `docguard.guard.md`,
`docguard.review.md`, `docguard.score.md`. DocGuard writes them only where the
project has a commands directory for DocGuard (the fallback and `generic`
layouts below).

**Spec Kit extension commands**, declared in
`extensions/spec-kit-docguard/extension.yml`: `speckit.docguard.init`,
`guard`, `fix`, `review`, `score`, `diagnose`, `generate`, `sync`, `trace`,
`brief`, `preflight` and `complete`. Spec Kit names the files for each agent.
For a skills agent, `speckit.docguard.guard` becomes
`speckit-docguard-guard/SKILL.md`.

**Extension hooks**, which Spec Kit runs around its own commands:

| Event | Command | Mandatory |
|---|---|---|
| `before_specify` | `speckit.docguard.brief` | Yes |
| `before_tasks` | `speckit.docguard.preflight` | Yes |
| `after_implement` | `speckit.docguard.guard` | Yes |
| `after_implement` | `speckit.docguard.complete` | No (prompts) |
| `after_converge` | `speckit.docguard.complete` | No (prompts) |
| `after_tasks` | `speckit.docguard.score` | No (prompts) |

`init` reports the hooks as active only after it finds the command file that
each mandatory hook resolves to (`verifyHooks` in `cli/agent-surface.mjs`). The
extension requires Spec Kit 0.11.2 or later. `init` checks the installed
version before it initializes anything. See the
[Spec Kit guide](../guides/spec-kit.md) for the workflow.

DocGuard compares content before it writes. If you run `init` again with
nothing changed, it writes nothing.

## How DocGuard identifies your agent

DocGuard uses the integration keys of Spec Kit. It takes the first of these:

1. **The integration Spec Kit recorded**: `default_integration`, then
   `integration` in `.specify/integration.json`, then `integration`, then `ai`
   in `.specify/init-options.json`. A value must match
   `^[a-zA-Z0-9_-]{1,32}$`. DocGuard ignores any other value and never passes
   it to a subprocess.
2. **A file or directory in the project root**, checked in this order:

   | Signal | Integration key |
   |---|---|
   | `.cursor/` | `cursor-agent` |
   | `.claude/` or `CLAUDE.md` | `claude` |
   | `.gemini/` | `gemini` |
   | `.antigravity/` or `ANTIGRAVITY.md` | `agy` |
   | `.github/copilot-instructions.md` | `copilot` |
   | `.windsurf/` | `windsurf` |
   | `.codex/` | `codex` |
   | `.roo/` | `roo` |
   | `.amp/` | `amp` |
   | `.kiro/` | `kiro-cli` |
   | `.tabnine/` | `tabnine` |

   `.agents/` is not a signal: several Spec Kit integrations share it.
3. **Nothing found**: `init` initializes Spec Kit with the `generic`
   integration, and DocGuard's own files use the fallback layout.

Source: `getDetectedAgent` and `detectAIAgent` in `cli/ensure-skills.mjs`,
`resolveIntegration` in `cli/spec-kit-delegation.mjs`.

## Where the files go

There are two paths. The path depends on whether Spec Kit has written an
install manifest for the recorded integration.

### Spec Kit integration-key path

When `.specify/integrations/<key>.manifest.json` exists, DocGuard reads the file
that Spec Kit wrote for its own `constitution` command. It copies the
directory, shape (skill or command) and name separator of that file
(`readIntegrationLayout` in `cli/agent-surface.mjs`). DocGuard keeps no
per-agent table, so it follows the layout that your Spec Kit version uses.

| Integration style | DocGuard's skills | DocGuard's slash commands | Extension commands |
|---|---|---|---|
| Skills (for example `claude`, `codex`, `cursor-agent`, `copilot`) | The integration's skills directory | Not written | Written by Spec Kit into the same skills directory |
| Commands (for example `gemini`, `kiro-cli`) | Not written: the agent reads commands, not skills | Not written | Written by Spec Kit into the agent's commands directory |
| `generic` | `.agent/skills/` | `.agent/commands/` | Written by DocGuard into the generic commands directory, because Spec Kit registers none for `generic` |

When DocGuard runs `specify init` itself, it passes `--integration <key>`. For
`generic` it also passes `--integration-options "--commands-dir .agent/commands/"`.
DocGuard checks that paths read from `.specify/*.json` stay inside the project
before it writes anything.

### Fallback `.agent/` layout

Without a Spec Kit manifest (Spec Kit not installed, `--no-spec-kit`, the
`starter` profile, or `specify init` failed), DocGuard places its own files
by the detected key alone:

| Key | Skills directory | Commands directory |
|---|---|---|
| `claude` | `.claude/skills/` | none |
| `cursor-agent` | `.cursor/skills/` | none |
| `codex`, `agy` | `.agents/skills/` | none |
| `generic` recorded without a manifest | `.agent/skills/` | the recorded `--commands-dir`, else `.agent/commands/` |
| Any other key, or no agent | `.agent/skills/` | `.agent/commands/` |

Extension commands and hooks need Spec Kit, so DocGuard writes none on this
path.

### What this produces per agent

Observed with `docguard init` and Spec Kit 1.1.3. With another Spec Kit
version the integration-key path follows that version's manifest.

| Agent | Detected by | Skills directory | Commands directory | Extension command files | Invocation |
|---|---|---|---|---|---|
| Claude Code (`claude`) | `.claude/`, `CLAUDE.md` | `.claude/skills/` | none | `.claude/skills/speckit-docguard-<name>/SKILL.md` | `/speckit-docguard-guard` |
| Codex (`codex`) | `.codex/` | `.agents/skills/` | none | `.agents/skills/speckit-docguard-<name>/SKILL.md` | `$speckit-docguard-guard` |
| Cursor (`cursor-agent`) | `.cursor/` | `.cursor/skills/` | none | `.cursor/skills/speckit-docguard-<name>/SKILL.md` | `/speckit-docguard-guard` |
| GitHub Copilot (`copilot`) | `.github/copilot-instructions.md` | `.github/skills/` with Spec Kit; `.agent/skills/` without | `.agent/commands/` without Spec Kit | `.github/skills/speckit-docguard-<name>/SKILL.md` | `/speckit-docguard-guard` |
| Gemini CLI (`gemini`) | `.gemini/` | not written | none | `.gemini/commands/speckit.docguard.<name>.toml` | `/speckit.docguard.guard` |
| Kiro CLI (`kiro-cli`) | `.kiro/` | not written | none | `.kiro/prompts/speckit.docguard.<name>.md` | `/speckit.docguard.guard` |
| Antigravity (`agy`) | `.antigravity/`, `ANTIGRAVITY.md` | `.agents/skills/` without Spec Kit; with Spec Kit, its manifest decides | none without Spec Kit | From the Spec Kit manifest | From the Spec Kit manifest |
| Generic (`generic`) | no signal | `.agent/skills/` | `.agent/commands/` | `.agent/commands/speckit.docguard.<name>.md` | `/speckit.docguard.guard`, and `/docguard.guard` for DocGuard's own commands |
| Windsurf (`windsurf`), Roo (`roo`) | `.windsurf/`, `.roo/` | `.agent/skills/` | `.agent/commands/` | none | `/docguard.guard` |
| Amp (`amp`), Tabnine (`tabnine`) | `.amp/`, `.tabnine/` | From the Spec Kit manifest; `.agent/skills/` without Spec Kit | `.agent/commands/` without Spec Kit | From the Spec Kit manifest | From the Spec Kit manifest |
| Any other Spec Kit integration | Recorded in `.specify/` only | From the Spec Kit manifest | none | From the Spec Kit manifest | From the Spec Kit manifest |

Spec Kit 1.1.3 rejects `windsurf` and `roo` ("not found in catalog"). DocGuard
passes the key anyway. It prints the error from Spec Kit with the command to
retry by hand, and installs its own files in the fallback layout. It never
substitutes another agent.

## Invoking commands

DocGuard names a slash command only when its file exists in the project
(`agentCommand` in `cli/agent-surface.mjs`). Otherwise it prints the CLI
command, such as `docguard guard`. The layout sets the prefix and separator:

| Layout | Example |
|---|---|
| Skills, most agents | `/speckit-docguard-guard` |
| Skills, `codex`, `zcode`, `command-code` | `$speckit-docguard-guard` |
| Skills, `kimi` | `/skill:speckit-docguard-guard` |
| Commands, including `generic` | `/speckit.docguard.guard` |
| DocGuard's own commands in a commands directory | `/docguard.guard` |

These prefixes mirror the invocation styles of Spec Kit 1.0.13. The agent loads
DocGuard's own skills (`docguard-guard` and the rest) through its skill
mechanism. DocGuard does not print an invocation for them.

## Instruction files from AGENTS.md

`init` writes `AGENTS.md` from a template when the file does not exist.
`docguard init --with agents` then writes one instruction file per agent from
it (`cli/commands/agents.mjs`):

| Agent key (`--agent`) | File |
|---|---|
| `cursor` | `.cursor/rules/cdd.mdc` |
| `copilot` | `.github/copilot-instructions.md` |
| `cline` | `.clinerules` |
| `windsurf` | `.windsurfrules` |
| `claude` | `CLAUDE.md` |
| `gemini` | `.gemini/settings.json` (a JSON object with the project name, canonical docs and rules) |

DocGuard skips an existing file unless you pass `--force`. Pass `--agent <key>`
to write one file. DocGuard refuses any other key and prints the list above.

To keep the family in step with `AGENTS.md`:

```bash
docguard agents --sync     # regenerate every file that carries the sync marker, and create missing ones
docguard agents --check    # exit 2 when a marked file is older than AGENTS.md
```

`--sync` stamps each file with a hash of `AGENTS.md` (an HTML comment, or a
`_docguardSync` field in JSON). DocGuard treats a file without the marker as
yours: `--sync` skips it with a warning and `--check` does not judge it.

Two things to know:

- Files that `init --with agents` writes carry the marker, so `--sync` keeps
  them current. Files that DocGuard wrote before v0.44 carry none. Run
  `docguard agents --sync --force` once to adopt them. `--force` replaces every
  one of the six files, including one you wrote by hand. Add `--agent <key>` to
  limit it to one. It does not overwrite your canonical docs.
- `agents` is a deprecated alias of `init --with agents`. `agents --sync` and
  `agents --check` run only the agent-file sync. They do no scaffolding, skill
  installation or Spec Kit step.

## What each harness loads

`docguard rules --for <path>` lists the instruction files that a harness loads
for one path, why each applies and how many bytes they add. `--harness` takes one
of `codex`, `claude`, `cursor`, `copilot` or `openhands`
(`HARNESSES` in `cli/scanners/instruction-scopes.mjs`).

```bash
docguard rules --for src/api/users.ts --harness cursor --format json
```

| Harness | Files it loads | Scope field |
|---|---|---|
| `codex` | `AGENTS.override.md` or `AGENTS.md` per directory, root to leaf | none |
| `claude` | `CLAUDE.md` or `CLAUDE.local.md` per directory (`AGENTS.md` only when no CLAUDE file exists up the chain); `.claude/rules/**/*.md`; skills | `paths:` |
| `cursor` | `.cursor/rules/**/*.mdc` at any depth (`.md` there is ignored); nested `AGENTS.md` | `globs:`, or `alwaysApply: true` |
| `copilot` | `.github/copilot-instructions.md`; `.github/instructions/**/*.instructions.md`; the nearest `AGENTS.md` | `applyTo:` |
| `openhands` | `.agents/skills/*/SKILL.md`, `.openhands/skills`, legacy `.openhands/microagents`; root `AGENTS.md` and `CLAUDE.md` | `paths:` |

We checked these formats against each vendor's documentation on 2026-09-30.
[AI Integration](../ai-integration.md) has the details, including how each
harness treats a slashless pattern. The Path-Scoped-Rules validator reports
stale scopes and broken pointers (PSR001 to PSR004). The Structure validator
measures each `AGENTS.md` chain against its byte budget (STR004, STR005). See
[Finding Codes](findings.md).

## Claude Code nudge hook

```bash
docguard hooks --claude            # install
docguard hooks --claude --remove   # remove
```

This adds a `PostToolUse` entry to the project's `.claude/settings.json` that
runs `docguard nudge-hook`. After the agent edits a canonical document, the
hook reminds it to run guard on the changed files. After the agent edits a
code file, the hook points it to `docguard impact` when a canonical doc or a
root `AGENTS.md`, `CLAUDE.md` or `GEMINI.md` names it as a whole file name: `config.js` is not
named by `tsconfig.json`. DocGuard adds or removes only its
own entry, and it leaves a `settings.json` that is not valid JSON untouched.
`init` never installs it.

## Related

- [MCP Server](mcp.md): DocGuard's tools for any MCP client.
- [Spec Kit guide](../guides/spec-kit.md): the extension, hooks and spec lifecycle.
- [AI Integration](../ai-integration.md): the JSON contract, SARIF, context files and agent workflow.
- [Commands](../commands.md): every command and option.
