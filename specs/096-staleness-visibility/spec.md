# Feature Specification: Staleness Visibility — Empty Validators, Ranked FRS002, Annotated Agent Context

**Feature Branch**: `feat/096-staleness-visibility`

**Created**: 2026-11-12

**Status**: Implemented

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

### Functional Requirements

- **FR-001**: Guard MUST show, in default text output, under each validator that selected nothing (verdict `empty`) or is missing its prerequisite document:
  - the reason, as before;
  - one line "to check it: <hint>".

  Hints live in one table keyed by validator (`CONFIGURE_HINTS` in `cli/validator-coverage.mjs`). A test requires an entry for every registered validator; `null` means the validator always selects something in a DocGuard project. Guard JSON MUST carry `emptyValidators: [{ key, name, status, reason, howToConfigure }]`. The compact projection (`--compact`, MCP) carries only their keys, because each reason is already on its validator and the budget job caps agent-facing bytes. `docguard explain <validator>` prints the hint ("When it selects nothing").
- **FR-002**: Canonical-Sync outside DocGuard's own package MUST report `not-applicable` with its reason (verdict `skipped`), not a generic `no-matches`. An unreadable package or `cli/` tree keeps its existing outcome.
- **FR-003**: In default text output, Freshness MUST list FRS002 findings in this order, then show the first `FRS002_SHOWN` (3) and summarize the rest in one line ("and N more … (--verbose lists them)"):
  1. documents whose FRS002 carries spec 095 `staleness` evidence, by maximum share;
  2. the rest, by commit count.

  `--verbose` and JSON keep every finding. Exit codes and counts are unchanged.
- **FR-004**: `agent --task`, and the MCP task context built by the same packet code, MUST attach `staleness` to an excerpt when a file the excerpt names (on a line inside the excerpt) crossed the FRS006 threshold since its document's review point. The review point is a recorded review whose fingerprint changed, or else the marker; the FRS006 exclusions apply. The text output prints one warning line under the excerpt header. `schemas/docguard-task-context.schema.json` defines the field.
- **FR-005**: `cli/findings.mjs` is unchanged (no new codes). DATA-MODEL (guard JSON `emptyValidators`, the task-context `staleness`), ARCHITECTURE and `CHANGELOG.md` MUST describe the change.

## Success Criteria *(mandatory)*

- **SC-001**: Each acceptance scenario has a test that fails on the base and passes after.
- **SC-002**: On TestGuard at f89ca46:
  - guard shows a "to check it" line under each of its empty validators;
  - FRS002 shows 3 of 9 lines plus the summary;
  - `agent --task "change how probe.mjs plans faults"` marks the `AGENTS.md:29-44` excerpt as naming `src/probe/probe.mjs` 74%.
- **SC-003**: The budget job passes, including agent-facing bytes (+10%).

## Out of Scope

- New finding codes.
- Changing exit-code semantics.
- The fixed `AGENTS.md` candidate in the task-context packet. Moving it to the agent-instruction role would change the frozen agent-context benchmark's selection, and needs its own evaluation.

## Verification Notes

Verified 2026-11-12 on the branch head. Private projects are not named.

- **SC-001**: `tests/staleness-visibility.test.mjs` passes 6 of 6. The full suite ran 4,405 tests: 4,399 pass, 0 fail, 6 skipped.
- **SC-002, TestGuard at f89ca46**:
  - Every empty validator shows "↳ to check it: …". For example, Doc-Dependency says to add `covers=` and run `review --accept <doc>#<id>`.
  - Freshness shows FRS008 and FRS006 for `AGENTS.md`, FRS007, three FRS002 (TEST-SPEC first, by its evidence) and "[FRS002] and 5 more document(s) … (--verbose lists them)".
  - `agent --task "change how probe.mjs plans faults"` prints, under `AGENTS.md:29-44`: "⚠ possibly stale: names src/probe/probe.mjs 74% — most of its lines are new since this document's 2026-09-22 review".
- **SC-003, budget**: `npm run budget -- --base <main worktree>` PASS.
  - Guard on DocGuard went 24,103 → 22,942 ms; no new errors.
  - `bytes:mcp:docguard_guard:sparse-doc-control` went 36,988 → 37,791 (+2%).
  - A first run measured +25% on that metric, because the compact projection repeated every empty validator's reason. The compact view now lists keys only, and `explain <validator>` carries the hint.
  - An earlier run against a `git archive` base (no `.git`) reported guard time +115%. That base skips the git-based checks, so the comparison did not hold. Against a real worktree of main, interleaved medians were 30.4 s on main and 26.5 s on this branch.
- **A/B, main → branch, 28 local projects**:
  - No exit code changed.
  - The spec 095 codes are unchanged from that A/B: FRS006 2, FRS007 5, FRS008 60.
  - Verdict changes: Canonical-Sync empty → skipped in 19 projects (FR-002), and Freshness pass → fail in 3 projects (warnings).
