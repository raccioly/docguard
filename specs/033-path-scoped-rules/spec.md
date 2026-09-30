# Feature Specification: Path-Scoped Agent Rules

**Feature Branch**: `feat/path-scoped-rules`

**Created**: 2026-09-29

**Status**: Draft

**Spec ID**: `docguard.path-scoped-rules`

**Lineage**: #455 follow-up, from research into OpenHands, DeepWiki/Devin, Aider
and Cursor (ADOPT, size M). Extends `docguard.agent-instruction-budget`
(STR004/STR005 and `measureInstructionChains`) from root-to-leaf `AGENTS.md`
chains to every path-scoped instruction format. Folds in open-mercato's
"AGENTS.md structure and link validation" idea. Complements the instruction
audit of `docguard.adoption-workflow-integrity` (FR-005).

**Input**: User description: "Validate the globs and paths in path-scoped agent
instructions across harnesses, check their size per scope, and add a resolver
that says which instructions apply to a path."

## Problem

Agents now load instructions by path, not just from one root file. Each
harness has its own format:

| Harness | Files | Scope field | Loaded always when |
|---|---|---|---|
| Codex | `AGENTS.override.md` or `AGENTS.md` per directory | the directory | every file in the chain (32 KiB combined) |
| Claude Code | `CLAUDE.md` / `CLAUDE.local.md` per directory (`AGENTS.md` only without a CLAUDE file); `.claude/rules/**/*.md`; skills | the directory; `paths:` (list or comma string) | no `paths:` field, or frontmatter that does not parse |
| Cursor | `.cursor/rules/**/*.mdc` at any depth (`.md` there is ignored); nested `AGENTS.md` | `globs:` (comma string) | `alwaysApply: true` |
| GitHub Copilot | `.github/instructions/**/*.instructions.md`; the nearest `AGENTS.md` | `applyTo:` (comma string) | `applyTo: "**"`; `.github/copilot-instructions.md` |
| OpenHands | `.agents/skills/*/SKILL.md`, `.openhands/skills`, legacy `.openhands/microagents/*.md` | `paths:`; a slashless pattern matches the file name at any depth | root `AGENTS.md` and `CLAUDE.md`; a legacy file with no `triggers:` or `paths:` |

These were checked against each vendor's documentation on 2026-09-30 (task
T002) and are recorded in `docs/ai-integration.md`. The Agent Skills
specification itself has no path field; Claude Code and OpenHands add `paths:`.

DocGuard checks only part of this:

- `measureInstructionChains` (`cli/scanners/agent-instructions.mjs`) measures
  nested `AGENTS.md` chains, and the Structure validator compares them with a
  32 KiB budget (STR004). No other format is measured.
- The instruction audit (`cli/scanners/instruction-audit.mjs`) reads only root
  `AGENTS.md` and `CLAUDE.md`. It skips table rows (`t.startsWith('|')`) and
  checks a pointer only on lines with a modal word such as "must". A routing
  table ("Working on X? Read `docs/x.md`") is never checked. It runs only
  under `verify --instructions`, not in guard.
- Nothing reads frontmatter globs. A rule whose glob matches no file is dead,
  and nobody is told. `docguard agents` itself writes
  `.cursor/rules/cdd.mdc` with `globs: "**/*"`.

Two failures are silent. A rule scoped to `src/api/**` after the code moved to
`packages/api/` is never loaded again. A frontmatter value such as
`globs: **/*`, unquoted, is not valid YAML (`*` starts an alias). A strict
parser rejects it, and a lenient one may read it differently. The machine-local
`.claude/rules/openwolf.md` in this repository has exactly that line, and uses
`globs:` where Claude Code is documented to read `paths:`.

No tool answers "which instructions will an agent load when it edits this
file?".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A dead rule is reported (Priority: P1)

A maintainer moves `src/api/` to `packages/api/`. Guard reports that
`.cursor/rules/api.mdc` and `.github/instructions/api.instructions.md` have
globs that match no tracked file, and names each glob.

**Independent Test**: A fixture with one rule per harness format, each scoped
to a directory that does not exist. Guard reports one PSR001 per rule file and
nothing else from this validator.

**Acceptance Scenarios**:

1. **Given** a path-scoped rule whose every glob matches no tracked file,
   **When** guard runs, **Then** PSR001 names the file, the field and the
   globs.
2. **Given** a rule with two globs where one still matches, **Then** PSR001
   names only the dead glob, with low confidence. (Findings carry `error` or
   `warn`; `info` is only a configured reweighting.)
3. **Given** an always-on rule (no scope field, `alwaysApply: true`, or
   `applyTo: "**"`), **Then** PSR001 never fires for it.

### User Story 2 - Paths named in instructions resolve (Priority: P1)

`AGENTS.md` has a routing table that points agents at `docs/api-guide.md`,
which was renamed. Guard reports the broken pointer, with the line.

**Acceptance Scenarios**:

1. **Given** a backticked path or Markdown link in any instruction file,
   including table rows and nested files, that resolves to nothing, **Then**
   PSR002 names the file, line and path.
2. **Given** a path relative to the instruction file's own directory (for
   example `scripts/run.sh` inside a skill folder), **Then** it resolves
   against that directory first, then the project root.
3. **Given** a bare file name, **Then** it is not checked: one that exists
   anywhere counts as resolved, and one that matches nothing is an example
   ("`ux.md`"), not a pointer.
4. **Given** a URL, an anchor-only link, a path inside a fenced code block or
   the frontmatter, a pattern, an `UPPER_CASE` placeholder segment
   (`FEATURE_DIR/spec.md`), or a sentence that says the file may be absent
   ("check if `.specify/extensions.yml` exists"), **Then** it is not checked.
5. **Given** a skill, **Then** only its own bundled files (`scripts/`,
   `references/`, `assets/`, as the Agent Skills specification names them)
   are checked, against the skill's folder. A skill is a procedure over
   runtime paths; its other paths are not pointers.
6. **Given** a pointer to a path the repository's ignore rules exclude,
   **Then** it names a machine-local file on purpose and is not reported.

### User Story 3 - Which instructions apply to this file? (Priority: P1)

A developer runs `docguard rules --for packages/api/users.ts`. DocGuard lists,
per harness, each instruction file an agent would load for that path, why it
applies (always, directory chain, or the glob that matched), and the total
bytes.

**Acceptance Scenarios**:

1. **Given** a path, **When** `rules --for` runs, **Then** each harness
   section lists the applying files in load order with bytes and reason.
2. **Given** `--format json`, **Then** the same data is machine-readable.
3. **Given** a path that does not exist yet, **Then** the resolver still
   answers. Scope is a pattern match, not a file lookup.
4. **Given** `--harness cursor`, **Then** only that harness is listed.
5. **Given** a machine-local instruction file that git ignores, **Then** it is
   listed and marked `local`.

### User Story 4 - Size per scope (Priority: P2)

Guard reports when the instructions one harness loads for some path exceed the
instruction budget. It names one example path per distinct set of rules.

1. **Given** Cursor rules whose always-on plus glob-matched bytes for
   `src/**` total more than the budget, **Then** PSR003 names the harness, one
   example path, the files and the total.
2. **Given** an allowance in `agentInstructions.allowances` keyed by
   `<harness>` or by `<harness>:<path>` for any path in the reported group,
   **Then** the allowance replaces the budget, as it does for STR004. Any
   path in the group, not only the example, so the key survives a new file
   sorting first.
3. **Given** nested `AGENTS.md` chains, **Then** PSR003 does not report them.
   STR004 already does.

### Edge Cases

- Frontmatter that does not parse, or a scope field of the wrong type, is
  PSR004. That rule's scope is `unknown` and left out of PSR001 and PSR003.
  It is never treated as "matches nothing".
- A pattern that is valid for the harness but uses syntax DocGuard does not
  evaluate (`[...]` classes, `!` negation, nested braces) is not a defect in
  the rule. The rule's scope is `unknown`, and the check reports `partial`
  coverage naming the rule and pattern.
- An unquoted scalar that starts with `*` is PSR004 with a fix: quote it.
- A scope key another harness reads (`globs:` in a Claude Code rule) is
  PSR004: the harness ignores it and loads the rule by its default, which is
  "always" for a Claude Code rule. A `.md` file in `.cursor/rules` is PSR004:
  Cursor loads only `.mdc`.
- Instruction files under test, fixture and example paths are test data and
  are skipped by guard; `rules --for` still lists them.
- A generated file carrying the `docguard:agents-sync` marker is still checked
  for PSR001 and PSR004, since its scope is live, but not for PSR002. Its body
  is a copy of `AGENTS.md`, which is checked at the source.
- "Tracked" means listed by `git ls-files`. Without git, DocGuard walks the
  tree with the ignore filters and reports the check as `partial`.
- More than 200 instruction files: the first 200 in path order are checked and
  the rest are counted.
- A glob matching thousands of files: matching stops at the first hit for
  PSR001. PSR003 groups paths by the set of rules that apply, so the work is
  bounded by the number of distinct sets.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DocGuard MUST discover the instruction files in the Problem table
  and parse each one's frontmatter with a built-in reader for the subset these
  formats use: scalars, quoted strings, comma-separated strings, flow lists and
  block lists. Anything else MUST be reported, not guessed.
- **FR-002**: For each harness, DocGuard MUST derive each file's scope: always,
  directory subtree, or a glob list. The field names MUST be verified against
  each harness's documentation and recorded, with the date checked, in
  `docs/ai-integration.md`.
- **FR-003**: A Path-Scoped Rules validator MUST report:
  - **PSR001** (warn, escalate): a glob that matches no tracked file; low
    confidence when other globs in the same file still match;
  - **PSR002** (warn, act): a path named in an instruction file, including
    table rows, links and nested files, that does not resolve;
  - **PSR003** (warn, escalate): the bytes one harness loads for some path
    exceed the budget or allowance;
  - **PSR004** (warn, act): unreadable frontmatter, a wrong-typed scope field,
    an unquoted scalar starting with `*`, a scope key the harness does not
    read, or a rule file the harness does not load.

  Each finding MUST name the file, the harness and the line or field.
- **FR-004**: PSR003 MUST use `agentInstructions.maxBytes` (default
  `DEFAULT_INSTRUCTION_BUDGET`, 32768) and `agentInstructions.allowances`. It
  MUST NOT report nested `AGENTS.md` chains, which STR004 covers.
- **FR-005**: `docguard rules --for <path> [--harness <name>] [--format json]`
  MUST list, per harness, the files that apply to the path in load order, with
  the reason, bytes and a total. It MUST NOT write anything.
- **FR-006**: Path arguments and pointers MUST be project-relative. An
  absolute path, `..`, or a symlink leaving the project is refused.
- **FR-007**: A project with no agent instruction files MUST get a
  `not-applicable` validator result and no new findings. A project whose only
  instruction file is a root `AGENTS.md` gets PSR002 for it: its routing
  table is the case in User Story 2.
- **FR-008**: Glob matching MUST use `compileGlob` from `cli/shared-ignore.mjs`.
  A pattern it cannot represent MUST be reported as not checked (partial
  coverage), not a silent mismatch.
- **FR-009**: `docguard agents` MUST keep writing a valid, quoted glob in
  `.cursor/rules/cdd.mdc`, and a test MUST parse it with the FR-001 reader.
- **FR-010**: README, `docs/commands.md`, `docs/configuration.md`,
  `docs/ai-integration.md` and ARCHITECTURE MUST document the validator, the
  codes and the `rules` command.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the five-harness fixture, each PSR code fires exactly where
  seeded, and nowhere else.
- **SC-002**: `rules --for` on the fixture matches a hand-written expected
  table for 10 paths, across all five harnesses.
- **SC-003**: On this repository, guard adds no error-severity finding, and
  guard's wall time grows by 3% or less (median of 5 A/B runs).
- **SC-004**: A project without agent instruction files produces the same
  guard findings before and after, apart from the validator list.

## Assumptions

- Instruction files are small. Reading all of them each run costs less than
  the existing Structure check.
- The byte budget is a proxy for context cost. Harnesses other than Codex may
  not truncate at 32 KiB, but every byte loaded is paid on every turn.
- Guard checks tracked files, because guard evaluates the repository.
  Machine-local rules appear only in `rules --for`.

## Out of Scope

- Rewriting or moving rules. DocGuard reports; the agent or maintainer edits.
- Judging whether two rules contradict. That stays a `verify --instructions`
  task for the calling agent.
- Keyword- or description-triggered skills. They are not path-scoped, and
  `rules --for` lists them as `not path-scoped`.
