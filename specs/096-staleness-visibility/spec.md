# Feature Specification: Staleness Visibility — Empty Validators, Ranked FRS002, Annotated Agent Context

**Feature Branch**: `feat/096-staleness-visibility`

**Created**: 2026-11-12

**Status**: Draft (not yet planned)

**Spec ID**: `docguard.staleness-visibility`

**Lineage**: The third of three specs for issue 628. It builds on `docguard.agent-instruction-role` (spec 094) and `docguard.recorded-document-reviews` (spec 095).
- It reuses the verdict contract (`docguard.verdict-contract`): a check that selected nothing is `empty`, never `pass`.
- It reuses `requiredChecks` (`docguard.enforcement-ladder`) as the one strictness lever.

**Input**: On TestGuard at f89ca46, guard printed "16 no matches" as a single count. It printed ten undifferentiated FRS002 lines with the same wording, so readers learned to skip them. `agent --task` served `AGENTS.md:29-44` (the stale "Key files" section) as its top excerpt, with only a generic retrieval caveat.

## Problem

- **Empty looks the same as green.** A validator that selected nothing is counted, but guard never says why, and never says what configuring it would take. On TestGuard, 16 of 37 validators were empty and nobody could tell which ones mattered.
- **FRS002 is noise at volume.** It gives one line per document with identical wording and no evidence, and it is never ranked.
- **Agents are handed the stale text.** `agent --task` and the MCP task context return excerpts from documents with open staleness findings, without saying so.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Each empty validator says why and what configuring it takes (Priority: P1)

1. **Given** TestGuard at f89ca46, **Then** guard's human output lists each empty validator with a one-line reason and a "to configure" line.
   - Example: "Doc-Dependency: no section declares covers= — add covers= to a docguard:section marker and run review --accept". JSON carries the same data in `coverage.empty[]`.
2. **Given** Canonical-Sync on a non-DocGuard package, **Then** its own N/A reason is shown, not the generic no-matches text.
3. **Given** `requiredChecks: ["docDependency"]` and no `covers=`, **Then** guard exits 4. This is unchanged and documented next to `--fail-on-inconclusive`.

### User Story 2 - FRS002 is ranked, carries evidence, and is capped (Priority: P1)

1. **Given** ten due documents, **Then** FRS002 lines are sorted as follows, with the first 3 shown in full and the rest summarized in one line ("and 7 more; --verbose lists them"):
   - first, documents whose FRS002 carries spec 095 evidence (`staleness.references`), by maximum share;
   - then the rest, by commit count.
2. **Given** `--verbose` or JSON, **Then** every FRS002 is present. The cap affects human output only, and exit codes are unchanged.

### User Story 3 - Agent context names open staleness (Priority: P2)

1. **Given** `agent --task` selects an excerpt from a document with FRS006, FRS007 or an evidence-carrying FRS002, **Then** the excerpt carries a note naming the finding and its top reference. Example: "src/probe/probe.mjs changed 74% since the 2026-09-22 review".
2. **Given** the MCP `docguard_task_context` tool, **Then** it carries the same note.

## Requirements *(mandatory)*

To be written after spec 095's codes and evidence shape are settled. The list of empty-validator reasons and configuration hints is owned by each validator (a `howToConfigure` string next to its applicability), not by a central table.

## Out of Scope

- New finding codes.
- Changing exit-code semantics.
