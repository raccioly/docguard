# Feature Specification: One Agent-Instruction Document Role

**Feature Branch**: `feat/094-agent-instruction-role`

**Created**: 2026-11-12

**Status**: Implemented

**Spec ID**: `docguard.agent-instruction-role`

**Lineage**: First of three specs for issue 628. It replaces the seven hard-coded agent-file lists with one role, as `docguard.path-scoped-rules` (FR-001) already did for harness scopes, and it reuses that spec's instruction-file kinds and `@path` import rule (`docguard.output-ux` FR-011). Spec 095 (recorded reviews, FRS006, FRS007) and spec 096 (visibility) build on this role.

**Input**: Issue 628 and its Stage 1 investigation. On TestGuard at f89ca46, a review that measured the repository found the following:

1. **Pointer files raise their own FRS002.** `CLAUDE.md` says only "Follow `AGENTS.md`", yet it gets its own FRS002 ("107 code commits since … 2026-09-18"). In a private project, a one-line `CLAUDE.md` (`@AGENTS.md`) does the same.
2. **FRS002 never reads `GEMINI.md`.** In another private project, `GEMINI.md` is an auto-generated file last updated on 2026-04-29 that describes a project structure which no longer exists, and FRS002 does not look at it. The agent-file list in `freshness.mjs` is `AGENTS.md` and `CLAUDE.md` only.
3. **Twelve readers each keep their own list of agent files, and the lists disagree.** Stage 1 found the seven below; implementing this spec found five more: `diagnose`, `score --dora`, the hook nudge, Canonical-Sync's surface files, and `diff`/MCP references in `doc-references.mjs`.

| Reader | Files it reads |
|---|---|
| `freshness.mjs` | AGENTS, CLAUDE |
| `reference-existence.mjs` | AGENTS, CLAUDE, GEMINI |
| `diff-suspicion.mjs` | AGENTS, CLAUDE, GEMINI |
| `doc-deps.mjs` | README, AGENTS |
| `semantic-claims.mjs` | AGENTS |
| `instruction-audit.mjs` | AGENTS, CLAUDE |
| `impact.mjs` | AGENTS, CLAUDE, GEMINI |

None of them reads `.github/copilot-instructions.md`.

4. **Installed skill copies were counted as authored instructions.** The Stage 1 prototype counted vendored Spec Kit and DocGuard skill copies as the project's own instructions. All five of its hits on them were false: generic examples such as `packages/` and `app/` in third-party templates.

5. **DocGuard's own exit-code lists omit exit 4.** `docs-canonical/ARCHITECTURE.md` lists exit codes 0-3 twice, although `guard` exits 4 (`docguard.verdict-contract` FR-011, `docguard.enforcement-ladder` FR-001).

## Problem

- **A stale agent file misdirects every session, and DocGuard does not know which files are agent files.** "Agent instructions" is not a role. Each reader guesses, so a file one reader checks is invisible to the next. A `GEMINI.md` or Copilot instructions file is checked by nothing.
- **Pointer files make noise.** A file whose content is "read `AGENTS.md`" has no content of its own to go stale. Reporting it separately repeats the target's signal under another name, and teaches readers to skip FRS002.
- **Vendored copies are not the project's instructions.** A skill installed by Spec Kit or DocGuard is owned upstream. Its staleness is the upstream's concern. The project's concern is whether its copy still matches what was installed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every agent instruction file is in one role (Priority: P1)

**Independent Test**: A fixture repository with root `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, a nested `packages/api/AGENTS.md`, an authored `.claude/skills/deploy/SKILL.md`, a Cursor rule, and an `AGENTS.md` under `tests/fixtures/`.

**Acceptance Scenarios**:

1. **Given** the fixture, **Then** the role lists every one of those files except the fixture copy. Each entry has its kind and says whether it is root-level, so harnesses load it unconditionally.
2. **Given** `GEMINI.md` last committed 40 commits ago, **Then** Freshness reports it (FRS002), which it did not before.
3. **Given** the same fixture, **Then** the root-level readers all read the same set: Reference-Existence, Diff-Suspicion, the semantic-claims inventory, the instruction audit, `diff --since`, and the Doc-Dependency candidates. That set is AGENTS.md, CLAUDE.md, GEMINI.md, `.github/copilot-instructions.md`, plus any `requiredFiles.agentFile` entry.
4. **Given** `requiredFiles.agentFile: ["docs/AGENT-GUIDE.md"]`, **Then** that file is in the role too.

### User Story 2 - Pointer files are reviewed through their target (Priority: P1)

**Independent Test**: TestGuard's `CLAUDE.md` (a heading, a review marker, "Follow `AGENTS.md` — it is the project's workflow and rules for every agent.", and a two-line note), and a one-line `@AGENTS.md`.

**Acceptance Scenarios**:

1. **Given** either file and an old review date, **Then** Freshness reports no FRS002 for it. It records a skip that names the target: "CLAUDE.md points to AGENTS.md; reviewed through it".
2. **Given** `AGENTS.md` itself is due, **Then** FRS002 is reported once, for `AGENTS.md`.
3. **Given** a `CLAUDE.md` with substantive content of its own (DocGuard's, 24 lines), **Then** it is not a pointer and Freshness checks it as before.
4. **Given** a pointer whose only target is outside the role or the project (`@.wolf/OPENWOLF.md`, untracked), **Then** it is a pointer with no reviewed target. It gets no FRS finding, and the skip says that nothing in the repository carries its instructions.

### User Story 3 - Vendored copies are excluded and checked for drift instead (Priority: P1)

**Independent Test**: A repository whose `.specify/integrations/claude.manifest.json` lists `.claude/skills/speckit-plan/SKILL.md` with its sha256, a DocGuard-installed `.claude/skills/docguard-guard/SKILL.md`, and an authored skill.

**Acceptance Scenarios**:

1. **Given** the fixture, **Then** the two vendored skills are marked vendored, each with its source (`spec-kit:claude` or `docguard`). Freshness does not report them, and only the authored skill is checked.
2. **Given** the manifest-listed skill edited after install, **Then** PSR005 reports it: "`.claude/skills/speckit-plan/SKILL.md` differs from the copy Spec Kit installed (claude integration 1.1.3); reinstall it or move the change to an authored file". Disposition `escalate`, confidence high.
3. **Given** the manifest-listed skill unedited, **Then** there is no PSR005 and the check counts as passed.
4. **Given** a manifest that is not valid JSON, or that lists a path outside the project, **Then** that manifest is ignored for vendoring. The check reports partial coverage naming it, and it is never a finding.

### User Story 4 - DocGuard's own exit-code lists are complete (Priority: P2)

**Acceptance Scenarios**:

1. **Given** `docs-canonical/ARCHITECTURE.md`, **Then** both exit-code lists include 4 with its meaning.

### Edge Cases

- **Symlinked instruction files** are never followed, matching `instructionFilesOnDisk`.
- **More than 200 instruction files**: the role keeps the first 200 (`MAX_INSTRUCTION_FILES`) and reports the rest as skipped, as Path-Scoped-Rules does.
- **A pointer that imports another pointer** resolves transitively, up to `MAX_IMPORT_HOPS`. A cycle has no reviewed target.
- **A file listed in two manifests with different hashes** is vendored by both. PSR005 fires only if it matches neither.
- **A `.docguardignore`d instruction file** is not in the role.
- **Git unavailable**: the role uses the working-tree walk and says so, as Path-Scoped-Rules does.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: One module MUST define the agent-instruction role and list its documents as `{ path, kind, root, pointer, vendored }`. Inclusion rules:
  - Instruction-file kinds come from `instructionKind`, plus `GEMINI.md` at any depth, plus `requiredFiles.agentFile` entries.
  - The files are tracked files that are not ignored and not non-product paths (`isNonProductPath`).
  - `cursor-ignored` files are excluded.
  - Symlinks are not followed, and the list is capped at `MAX_INSTRUCTION_FILES`.
- **FR-002**: The role MUST mark as root-level: `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md` at the project root (when the file exists, tracked or not, as the readers it replaces required), plus every `requiredFiles.agentFile` entry. Every reader of agent files MUST read the root-level, non-vendored documents in place of its own list: Reference-Existence, Diff-Suspicion, Canonical-Sync, the semantic-claims inventory, the instruction audit, `diff --since` (`impact`), `diff`/MCP references (`doc-references.mjs`), the Doc-Dependency candidates, `diagnose`, `score --dora` and the hook nudge. Each reader keeps its other inputs (canonical docs, README, the constitution). A scan test fails on any other agent-file list under `cli/` (the `requiredFiles.agentFile` defaults are configuration, not a reader).
- **FR-003**: Freshness MUST check every non-pointer, non-vendored document in the role, in place of `requiredFiles.agentFile || ['AGENTS.md', 'CLAUDE.md']`.
- **FR-004**: A document is a pointer when both of the following hold:
  - Its body has at most 6 non-empty lines once frontmatter, headings, HTML comments and blank lines are removed, and at most 2 of them name no file (no `@path` import, Markdown link or backticked `.md`/`.mdc` path). A short `CLAUDE.md` that imports OpenWolf and then lists three dev commands has instructions of its own and is not a pointer (found by the SC-002 A/B).
  - It imports a file through an `@path` import (the `claudeImportsIn` rule), or it names another role document through a Markdown link or a backticked `.md`/`.mdc` path. A short file that only links to a non-instruction document (a five-line AGENTS.md that says "see `docs/CONTRIBUTING.md`") is not a pointer: it is the instructions.

  The pointer's target is the first named role document. Imports resolve transitively, up to `MAX_IMPORT_HOPS`. If no named file is a role document, the pointer has no reviewed target.
- **FR-005**: A pointer MUST NOT receive FRS001, FRS002 or FRS003. Freshness MUST record a skip naming its target, or saying that it has none.
- **FR-006**: A document is vendored when either holds:
  - A Spec Kit integration manifest (`.specify/integrations/*.manifest.json`, `files: { path: sha256 }`) lists it. Source: `spec-kit:<integration>`.
  - It is a skill Spec Kit registered for an extension: a `registered_skills` name, or a `registered_commands` id rendered as a skill directory (`speckit.docguard.guard` → `speckit-docguard-guard`), in `.specify/extensions/.registry`. Source: `spec-kit-extension:<extension>`.
  - The project has a `.specify/` directory and the skill is one of Spec Kit's own command skills (`speckit-analyze`, `-checklist`, `-clarify`, `-constitution`, `-converge`, `-implement`, `-plan`, `-specify`, `-tasks`, `-taskstoissues`), which older layouts install without a manifest. Source: `spec-kit`.
  - Its first lines (after frontmatter) carry a `<!-- generated by <tool> … -->` header, the convention a tool uses for a file it rewrites on refresh. A header that tells the project to edit freely and delete the line hands ownership to the project. Source: `generated:<tool>`.
  - It is a skill whose directory name is one DocGuard ships (`extensions/spec-kit-docguard/skills/*`), in any harness skills directory. Source: `docguard`.

  The registry gets the same treatment as a manifest: unreadable means a limitation, never a finding. Only manifest entries carry hashes, so only they are checked by PSR005.

  Manifest paths that are absolute, contain `..`, or are not strings MUST be ignored. A manifest that does not parse MUST be ignored, and the run reports partial coverage naming it.
- **FR-007**: New code **PSR005**, Path-Scoped-Rules: a file a Spec Kit manifest lists whose sha256 differs from every recorded hash. Severity `warn`, disposition `escalate`, confidence `high`.
  - The message MUST name the file, the integration and its version.
  - DocGuard-installed copies are not compared, because `upgrade` already reports them as out of date against the running version, and a pinned older CI would otherwise make every copy drift.
- **FR-008**: Behavior MUST be unchanged for a project whose only agent files are a root `AGENTS.md` and a non-pointer `CLAUDE.md`, except that readers which read only one of the two now read both.
- **FR-009**: `docs-canonical/ARCHITECTURE.md` exit-code lists MUST include exit 4. `cli/findings.mjs` (PSR005; the FRS001-FRS003 help gains the pointer rule), `docs/reference/findings.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md` (the role and `requiredFiles.agentFile`) and `CHANGELOG.md` MUST describe the change.
- **FR-011**: Vendoring MUST be visible and MUST NOT be claimable by text alone. A root-level document is vendored only through an install record with a hash (a Spec Kit manifest), never through a header, a registry entry or a name. Guard's summary line MUST count vendored instruction files ("N vendored instruction file(s), not reviewed for staleness"). `coverage.vendoredInstructions[]` MUST list each one with its source and reason (`install manifest`, `extension registry`, `Spec Kit core skill name`, `DocGuard-shipped skill name`, `generated-by header`). (Orchestrator conditions on spec 095 decision 4, 2026-11-12.)
- **FR-010**: The benchmark corpus MUST gain PSR005 defect and clean-control pairs in both splits, each in its own repository group and causal family. The fixture runner copies files without Git history, so Freshness cases (the pointer rule) cannot be benchmarked there; they are covered by the tests (SC-001) and the A/B (SC-002), and spec 095's history-replay benchmark measures them.

### Key Entities

- **Agent-instruction document**:
  - `path`: POSIX, project-relative.
  - `kind`: the `instructionKind` value, `gemini-memory`, or `configured`.
  - `root`: boolean.
  - `pointer`: `null`, or `{ target: string|null, via: 'import'|'link'|'path' }`.
  - `vendored`: `null`, or `{ source, integration?, version?, hashes? }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario of US1-US3 has a test that fails on 0.47.0 and passes after this change, with positive controls for FR-008.
- **SC-002**: A guard A/B, 0.47.0 against this change, run with one fresh `git clone --local` per CLI, serially, on DocGuard, TestGuard at f89ca46 and every other local project (private projects are referred to by what they contain, never by name). It changes only findings that FR-001 to FR-007 explain, and each one is reviewed by hand. Expected on the Stage 1 set:
  - TestGuard: no FRS002 for `CLAUDE.md`.
  - A project with a one-line `@AGENTS.md` `CLAUDE.md`: no FRS002 for it.
  - A project with an OpenWolf-import `CLAUDE.md`: no FRS002 for it.
  - The project with the stale `GEMINI.md`: FRS002 for it.
- **SC-003**: Guard wall time on DocGuard stays within the `budget` job's ×1.15 (`npm run budget`).

## Assumptions

- **New warnings**: projects with authored skills, rules, Copilot instructions, nested `AGENTS.md` or `GEMINI.md` will see FRS002 or FRS003 where they saw nothing. This is the coverage the role exists for. Ranking and capping FRS002 is spec 096.
- **Spec Kit manifests** record the hash of what was written (verified on Spec Kit 1.1.3 manifests in two local projects). If a future Spec Kit drops the hashes, a file is still vendored by being listed, and PSR005 does not apply to it.

## Out of Scope

- **Recorded reviews, FRS006 and FRS007** (spec 095).
- **Empty-validator visibility, FRS002 ranking and capping, and `agent --task` annotations** (spec 096).
- **Adding Gemini as a harness to `rules --for`.** Scope semantics for `GEMINI.md` are not verified against Gemini's documentation, and it needs its own check.
- **Comparing DocGuard-installed copies** (FR-007 explains why).

## Verification Notes

Verified 2026-11-12 on the branch head. Private projects are not named.

- **SC-001**: `tests/agent-instruction-role.test.mjs` has 21 cases. On the base it fails at import, because the role module does not exist. Its behavioral assertions were also checked against the base CLI on real repositories:
  - the base reports FRS002 for TestGuard's pointer `CLAUDE.md`;
  - the base never examines a `GEMINI.md`;
  - the base has no PSR005.

  The existing suites for Freshness, Reference-Existence, Doc-Dependency, semantic claims, instruction audit, impact and Path-Scoped-Rules pass unchanged (FR-008).
- **Suite**: `npm test`: 4,377 tests, 4,373 pass, 1 skipped, 3 failed on the first full run. The three were:
  - the benchmark manifest count, updated from 26 to 30;
  - two detector-digest checks, because the first re-recorded baseline lacked `detectorsDigest`.

  The baseline was re-recorded on the final detectors with their digest. The affected files then pass, 54 of 54.
- **Benchmark (FR-010)**: `node benchmarks/run.mjs --external --baseline benchmarks/baseline.json`, comparison PASS, no regressions, four added cases.
  - The evaluation pair first abstained. Path-Scoped-Rules returned "no agent instruction files" before checking vendored copies in a project whose only instruction files were installed skills. That was fixed, and the pair then matched its unchanged labels.
  - Aggregate: 15 defect and 15 clean-control cases, precision 1 (Wilson 95% lower bound 0.796).
- **SC-002**: A/B of main (`020fa51`) against the branch. One fresh `git clone --local` per project per CLI, `guard --format json`, run serially with no other load. 27 local projects plus TestGuard at f89ca46.
  - **Totals**: 18 projects changed. No exit code changed. No error was added. No PSR005 fired.
  - **Removed** (10 projects): FRS002 on a pointer `CLAUDE.md`. Each was read by hand: `@AGENTS.md`, "Follow `AGENTS.md`", or an OpenWolf `@.wolf/OPENWOLF.md` import plus one line. TestGuard is one of them.
  - **Added, intended coverage**:
    - a stale `GEMINI.md` (155 commits, auto-generated, describes a structure that no longer exists);
    - a nested `app/web/AGENTS.md`;
    - one project's `.github/copilot-instructions.md`;
    - a project's own authored skills and rules;
    - a shipped `templates/.../AGENTS.md`;
    - two shipped `starter-kit/global/{CLAUDE,GEMINI}.md` templates (FRS003).
  - **Added, noise this spec cannot see**: an OpenWolf-installed `.claude/rules/openwolf.md` (7 projects), and TestGuard-installed `testguard` skill copies (5 projects). Neither carries a generated-by header or an install record. Spec 096's ranking and capping addresses the volume. A `generated by` header from those installers would make them vendored (FR-006).
  - **Found by the A/B and fixed before this note**:
    - Spec Kit extension skills (`speckit-docguard-*`, `speckit-git-*`) and manifest-less core `speckit-*` skills were reported as authored. They are now vendored from `.specify/extensions/.registry` and core names.
    - A short `CLAUDE.md` with its own dev commands was taken as a pointer. The own-line limit in FR-004 now excludes it.
    - A websec-validator skill with a `generated by` header was reported as authored. It is now vendored.
- **SC-003**: `npm run budget -- --base <main archive>` PASS:
  - guard on DocGuard 41,158 → 38,673 ms;
  - no new errors;
  - package +9 KB;
  - no new dependency.

  The 10 FRS002 on DocGuard's own documents come from this branch's commit count (15 code commits since their 2026-11-03 review), not from the code. The base CLI reports the same ten on this tree.
- **Limitation recorded at review (2026-11-12):** PSR005 compares the sha256 of the bytes on disk, so a Windows checkout with `core.autocrlf` would change every manifest copy. Since spec 095, a copy that differs only in CRLF line endings is reported as such ("only in line endings (CRLF)").

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `d531756de886c5f89d64125a22a8fb07bb9aafe9` — Verified the one agent-instruction role, pointer and vendored-copy handling and PSR005 against the shipped ARCHITECTURE entry (spec 094) and the recorded A/B and budget run. Evidence: `cli/shared-agent-instructions.mjs`, `cli/validators/freshness.mjs`, `cli/validators/path-scoped-rules.mjs`, `docs-canonical/ARCHITECTURE.md`, `tests/agent-instruction-role.test.mjs`, `tests/program-verification.test.mjs`. Accepted deviations: none. Successor: none. Blobs: `cli/shared-agent-instructions.mjs`=`b8ac4b54994ec04e5588cb211e7b831171444293`, `cli/validators/freshness.mjs`=`37c768ce699c12ff61bc799a3c136bff35f9e727`, `cli/validators/path-scoped-rules.mjs`=`6ee39950753106b4a8916804759ef9c0e0d2fab6`, `docs-canonical/ARCHITECTURE.md`=`f3860b5d2c0de06da36eec0695c5b127039d52b4`, `tests/agent-instruction-role.test.mjs`=`e3665c1cfe7a5f602070c54e2729f9afb366af8c`, `tests/program-verification.test.mjs`=`9d469f964d8b5646bce82e396b052e5dc53ad369`.
<!-- docguard:implementation-outcomes:end -->
