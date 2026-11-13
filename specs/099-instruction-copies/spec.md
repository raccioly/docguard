# Feature Specification: Agent-Instruction Copies

**Feature Branch**: `fix/instruction-copies`

**Created**: 2026-11-13

**Status**: Draft

**Spec ID**: `docguard.instruction-copies`

**Lineage**: Extends `docguard.agent-instruction-role` (spec 094), which already keeps instruction files under test, fixture and example paths out of the role, and `docguard.recorded-document-reviews` (spec 095), whose FRS006, FRS007 and FRS009 read that role. The new finding joins Path-Scoped-Rules (`docguard.path-scoped-rules`), which owns the other checks on how agents find their instruction files.

**Input**: Found on 2026-11-13 in a project that runs DocGuard with strict enforcement and fails its gate on warnings. The project ships a scaffolder: `templates/<app>/files/AGENTS.md` is a form it writes into other applications' repositories, and it starts `# Rules for agents and people working on {{appName}}`. Adding a root package script made FRS007 report that this template never mentions the script. No commit could clear it: `docguard review --accept` records HEAD, which must already contain the script, and the gate refuses every commit that carries the script first. The project renamed its template to `AGENTS.md.template`. Two files named `AGENTS.md` also confuse agents: one searching the repository for `AGENTS.md` may read the template first.

## Problem

1. **A template is reviewed as this repository's instructions.** The role drops a nested instruction file under `fixtures/`, `testdata/`, `examples/`, `tests/` and the other non-product segments (spec 094), but not under `templates/`. FRS006, FRS007 and FRS009, the strict `unexamined` list and the excerpt-staleness marks then judge a form written for another project against this one.
2. **Nothing says that a copy shares a name with the real file.** An agent asked to read `AGENTS.md` may open whichever match a search returns first, and Codex and Claude Code load a nested `AGENTS.md` or `CLAUDE.md` when they work in its folder.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A template is not reviewed as this repository's instructions (Priority: P1)

1. **Given** a reviewed root `AGENTS.md` and a reviewed `templates/app/files/AGENTS.md`, **When** a commit adds a root package script that neither mentions, **Then** FRS007 names the root `AGENTS.md` and not the template.
2. **Given** the same template, **Then** it gets no FRS001–FRS003, FRS006, FRS009, strict `unexamined` entry, PSR001–PSR005 finding or excerpt-staleness mark.
3. **Given** `agentInstructions.governing` naming the template, **Then** it is in the role again.

### User Story 2 - A copy that shares the real file's name is reported (Priority: P1)

1. **Given** a root `AGENTS.md` and `templates/app/files/AGENTS.md`, **When** guard runs, **Then** PSR006 names the template, the file it shares a name with, and suggests `AGENTS.md.template`.
2. **Given** a root `CLAUDE.md` and `tests/fixtures/repo/CLAUDE.md`, **Then** PSR006 names the fixture with low confidence.

### User Story 3 - Nested instruction files that govern a folder stay quiet (Priority: P1)

1. **Given** a root `AGENTS.md` and `packages/api/AGENTS.md` (a monorepo package), **Then** no PSR006.
2. **Given** `packages/templates/AGENTS.md` or `templates/AGENTS.md` (the file governs the folder named `templates`), **Then** no PSR006, and the file stays in the role.
3. **Given** a template `AGENTS.md` and no other `AGENTS.md`, **Then** no PSR006: nothing shares its name.

### Edge Cases

- A copy listed in `.docguardignore` (or `ignore`) is not considered: the project has said the file is not its to validate.
- `.cursor/rules/templates/x.mdc` and `.claude/skills/templates/SKILL.md` are harness files the harness loads: a template segment inside a dot-directory does not make a copy, and SKILL.md and rule files never take part in PSR006 because their names repeat by design.
- `.github/copilot-instructions.md` is matched by its path tail (`templates/app/.github/copilot-instructions.md`), not by basename.
- A root file is never a copy, whatever it contains.
- `src/main/java/com/example/AGENTS.md`: a package segment is not an example directory (as spec 094 and `isNonProductPath` already say).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A non-root agent-instruction file MUST be left out of the agent-instruction role when a directory named `templates`, `template`, `_templates`, `__templates__`, `scaffold`, `scaffolds`, `boilerplate` or `boilerplates` (case-insensitive) is an ancestor of the file's own folder and appears before the first path segment that starts with `.`. The folder that holds the file does not count: `templates/AGENTS.md` governs `templates/`. Every reader of the role (Freshness FRS001–FRS010, the strict `unexamined` list, excerpt staleness, Path-Scoped-Rules) then skips it.
- **FR-002**: `agentInstructions.governing` (an array of glob patterns) MUST put a matching tracked file back in the role even when FR-001 or the test, fixture and example rule of spec 094 would drop it, and such a file MUST NOT be reported by PSR006. `.docguardignore` and `ignore` still win.
- **FR-003**: New code **PSR006** (Path-Scoped-Rules, warning): a tracked, not-ignored file whose instruction name is shared with at least one governing file, and that is a copy. The instruction names are the basenames `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `GEMINI.md`, the path tail `.github/copilot-instructions.md`, and the basename of each `requiredFiles.agentFile`. A file is a copy when FR-001 drops it (confidence high) or when a test, fixture or example segment (`isNonProductPath`) is an ancestor of its own folder (confidence low: a fixture project may need the name; `.docguardignore` is the alternative). A governing file is a root file, or a nested file that is not a copy, or one `agentInstructions.governing` names. One finding per copy, naming the governing file it shares a name with and suggesting `<name>.template`.
- **FR-004**: PSR006 MUST be in the findings catalog with `docguard explain PSR006`, the generated findings reference, `docs-canonical/DATA-MODEL.md` (the config key), the config schema and CHANGELOG.
- **FR-005**: The benchmark corpus MUST gain a PSR006 defect case (a template copy) and a clean control (a monorepo package `AGENTS.md`).
- **FR-006**: A project with no instruction file under a template, test, fixture or example path MUST see no change.

## Success Criteria *(mandatory)*

- **SC-001**: The reported case reproduces as a failing test before the change (a reviewed template plus a new root script gives FRS007 on the template) and passes after it, while the root `AGENTS.md` is still flagged.
- **SC-002**: Each user story has a test; `npm test` and `node cli/docguard.mjs guard` pass.
- **SC-003**: The benchmark comparison shows the new cases and no new false positive or negative elsewhere.

## Out of Scope

- `docguard rules --for <path>` keeps listing every file a harness would load, copies included: that listing is what an agent actually sees.
- Instruction files sitting directly in a `tests/`, `examples/` or `fixtures/` folder (`tests/AGENTS.md`) keep spec 094's behavior: out of the role. PSR006 does not call them copies.
- Detecting a copy by its content (unrendered `{{placeholders}}`). A real instruction file can document a template language; dropping it from review under a strict gate is worse than a missed warning.

## Amendment 2026-11-13 (spec 100)

Spec 099 was not released when it was generalized by `docguard.file-kinds` (spec 100). Its classifier and its override now come from spec 100: `instructionCopyOf`, `TEMPLATE_DIRS` and `isDeclaredGoverning` are replaced by `fileKind` in `cli/shared-file-kind.mjs`, the template vocabulary gained `starter-kit(s)` and `skeleton(s)`, and matching is case-insensitive for every directory kind. `agentInstructions.governing` was replaced by `fileKinds.own` before release; wherever FR-001 to FR-003 and the user stories say `agentInstructions.governing`, read `fileKinds.own`. PSR006 keeps its meaning.
