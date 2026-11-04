# Feature Specification: Agent Memory Stays True to the Code, Is Fed Verified Facts, and Is Consolidated Without Guessing

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-02

**Status**: Draft

**Spec ID**: `docguard.memory-governance`

**Lineage**: Seventh feature of the DocGuard × AI-DLC program (issue 607).
- It builds on `docguard.aidlc-profile` (spec 089) for finding AI-DLC spaces.
- It builds on the existing `docguard memory` command (`cli/commands/memory.mjs`, the accuracy drill-down of endpoints, entities, env vars and tech stack).
- Its codes ship advisory (spec 083), and its absence claims follow spec 081.

**Input**: AWS's agent-memory guidance treats memory as a governed data asset: lineage, staleness flags, retention, and consolidation of session history into durable facts, which it calls "technically straightforward but operationally demanding". AI-DLC keeps three kinds of memory:
- layered rules in `aidlc/spaces/<space>/memory/{org,team,project}.md` and `phases/*.md`, which its learning loop extends when a person corrects the agent;
- per-stage `memory.md` diaries;
- a CodeKB per repository in `codekb/<repo>/`.

AI-DLC re-checks the CodeKB only when its stage reruns, and has no consolidation step. A learned rule that names a deleted file keeps steering every later stage.

Constraints from AI-DLC itself: plugins may not contribute `memory`, and the learning loop marks persisted rules with content hashes. DocGuard therefore never writes `org.md`, `team.md`, `project.md` or `phases/*.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A learned rule or CodeKB entry that names something gone is reported (Priority: P1)

**Independent Test**: A space whose `project.md` has a rule naming `src/legacy/auth.ts` (deleted) and `src/auth/login.ts` (present), and whose `codekb/app/architecture.md` names `src/old-router.ts` (deleted).

**Acceptance Scenarios**:

1. **Given** that space, **Then** MEM001 names the rule's line in `project.md` and `src/legacy/auth.ts`.
2. **Given** that space, **Then** MEM002 names the CodeKB file, its line and `src/old-router.ts`.
3. **Given** a rule naming an environment variable in backticks (`DATABASE_URL`) that no code reads and no `.env.example` declares, **Then** MEM001 reports it, using the same environment scan as ENVIRONMENT.md checks.
4. **Given** a reference that is clearly an example (inside a fenced block) or a URL, **Then** nothing is reported.

### User Story 2 - DocGuard feeds AI-DLC verified facts (Priority: P1)

**Independent Test**: `docguard memory --export aidlc --write` on a project with canonical docs and an AI-DLC space.

**Acceptance Scenarios**:

1. **Given** the command without `--write`, **Then** it prints the digest it would write and writes nothing.
2. **Given** `--write`, **Then** it writes `aidlc/spaces/<space>/knowledge/docguard/canonical-memory.md` through `safeWrite`. The digest holds:
   - the verified API endpoints, entities, environment variables and tech stack that `docguard memory` already compares with code;
   - only facts whose comparison passed;
   - a header with the DocGuard version, the commit and the time.

   The command then prints the `aidlc engine knowledge onboard` command that indexes the file. It does not run it.
3. **Given** a space that does not exist, **Then** the command exits 1, names the spaces that do exist, and writes nothing.

### User Story 3 - Diaries are consolidated without guessing (Priority: P2)

**Independent Test**: Three intents whose `memory.md` diaries repeat "Use the repository pattern for persistence" twice (once with different spacing and case) and mention a deleted path once.

**Acceptance Scenarios**:

1. **Given** that space, **When** `docguard memory --consolidate aidlc` runs, **Then** it reports one deduplicated entry seen twice, with both source locations, and one entry flagged stale because its path is gone.
2. **Given** `--format json`, **Then** each entry carries `text`, `occurrences[]`, `references[]` and `stale`.
3. **Given** any run, **Then** no file under `memory/` changes. The report is a proposal for a person or the learning loop.

### Edge Cases

- **Paths in rules** are recognized only as backticked tokens that contain `/` or end in a source extension. Prose words are never read as paths.
- **Rules in a narrower layer that override a broader one** are not judged here; AI-DLC's doctor already reports rule drift.
- **Large spaces.** At most 10 findings per code, with an elision note.
- **No AI-DLC space.** The validator is `empty`. `--export` and `--consolidate` exit 1 with a one-line reason.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The AI-DLC validator MUST report MEM001 for each backticked path or environment variable in a space's `memory/{org,team,project}.md` or `memory/phases/*.md` that does not exist in the project (paths) or in the project's environment scan (variables).
- **FR-002**: It MUST report MEM002 for each backticked path in `codekb/<repo>/*.md` that does not exist.
- **FR-003**: MEM001 and MEM002 MUST be advisory (`defaultLevel: 'info'`) absence claims, capped at 10 each, and MUST ignore fenced code, HTML comments and URLs.
- **FR-004**: `docguard memory --export aidlc [--space <name>] [--write]` MUST build the digest from comparisons that passed, MUST print it without `--write`, and with `--write` MUST write only `aidlc/spaces/<space>/knowledge/docguard/canonical-memory.md` through `safeWrite`. It MUST print, and never run, the AI-DLC command that onboards the file.
- **FR-005**: `docguard memory --consolidate aidlc [--space <name>] [--format json]` MUST read every intent's stage `memory.md` diaries in the space, normalize entries (trim, collapse whitespace, lowercase, strip list markers), group exact normalized duplicates with all their source locations, extract backticked references, and flag an entry stale when a referenced path does not exist. It MUST write nothing, and MUST NOT summarize or rewrite entry text.
- **FR-006**: `docs/commands.md` (`memory` section), `docs-canonical/ARCHITECTURE.md`, `DATA-MODEL.md`, `TEST-SPEC.md`, `docs/reference/findings.md` and `CHANGELOG.md` MUST describe the codes and options.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario has a test.
- **SC-002**: A test asserts that no file under any `memory/` directory changes during `--export --write` or `--consolidate`.
- **SC-003**: The hermetic A/B changes nothing in projects without AI-DLC spaces.

## Verification Notes

- **SC-003**: the final branch A/B against v0.45.2 added no MEM finding on any local project. None of them has an AI-DLC space.
- **Precision on a stock project**: on a fresh AI-DLC 2.11.2 project, MEM001 first flagged six references in AI-DLC's own `org.md`. These were template placeholders (`aidlc/spaces/<active-space>/memory/project.md`) and an example list (`pyproject.toml`, etc.). Placeholders and globs are no longer paths. In a git repository, a missing path is now reported only when history once had it, and the stock file reports nothing.

## Assumptions

- AI-DLC's knowledge folder is team-owned input that AI-DLC indexes on request. Writing one file there, under a `docguard/` subfolder, at the user's explicit `--write`, is within DocGuard's safe-write rule (Constitution VI).
- Consolidation is deterministic. Semantic merging (two differently worded rules that mean the same thing) needs a model, which DocGuard does not run (Constitution V).

## Out of Scope

- Writing or pruning AI-DLC memory layers.
- Running `aidlc` commands from DocGuard.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `779b8b4eae47ef3fb49fe503246405aa02680df5` — MEM001/MEM002 history-backed; export and consolidate read-only by default; a stock AI-DLC org.md reports nothing; no change on projects without spaces. Evidence: `cli/commands/memory-aidlc.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/TEST-SPEC.md`, `tests/memory-governance.test.mjs`, `tests/program-verification.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
