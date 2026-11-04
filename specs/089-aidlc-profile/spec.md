# Feature Specification: What AI-DLC Verified at Its Gates Stays True After the Workflow Ends

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-02

**Status**: Draft

**Spec ID**: `docguard.aidlc-profile`

**Lineage**: Sixth feature of the DocGuard × AI-DLC program (issue 607).
- It reads the artifacts that AWS AI-DLC 2.11.2 writes: the record layout `aidlc/spaces/<space>/intents/<YYMMDD>-<label>/`, the legacy `aidlc-docs/`, each unit's `traceability.json` and `source-manifest.json`, and `aidlc-state.md`.
- Its codes ship advisory (`docguard.enforcement-ladder`). Absence claims follow `docguard.verdict-contract` FR-006a.
- It extends COMPARISONS.md, whose Kiro row is now partly wrong.

**Input**: AI-DLC checks traceability once, at the gate, with sensors that are advisory by default. Its `traceability` sensor fails on GAP and ORPHAN rows and resolves `OK` targets to workspace paths, but only while the stage runs. Its `source-manifest.json` lists every source path a unit created, modified or deleted. A study of AI-DLC's core, docs and tests found no check that keeps either true after the workflow finishes. DocGuard runs on every change, so it can.

## Problem

- **A verified link rots silently.** `AC1.1.1 → src/auth/login.ts` was `OK` at the code-generation gate. Two months later `login.ts` is renamed, and nothing in AI-DLC re-reads the table.
- **An advisory gate lets a GAP through.** With Guard Policy off (the default outside `enterprise`), a stage can close with `GAP` rows in its table. The record says the requirement is unbuilt, and nobody is told after the gate.
- **A unit's claimed source disappears.** A path in `source-manifest.json` that no longer exists means the unit's deliverable was removed or moved, and the record still claims it.
- **DocGuard cannot see any of this.** It does not recognize an AI-DLC workspace, so guard reports such a project as having no requirements at all.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A traceability target that no longer exists is reported (Priority: P1)

**Independent Test**: A fixture intent with `construction/u1-auth/code-generation/traceability.json` rows targeting `src/auth/login.ts` (present) and `src/auth/session.ts` (deleted).

**Acceptance Scenarios**:

1. **Given** that fixture, **Then** AID001 names `AC1.1.2 → src/auth/session.ts`, the table it came from and the unit.
2. **Given** a target that is a story or BR ID rather than a path, **Then** it is not checked as a path.
3. **Given** a target that is a directory with a trailing `/`, **Then** it exists if the directory does.

### User Story 2 - Gaps the gate let through stay visible (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a table with a `GAP` row whose stage `aidlc-state.md` marks complete (`[x]`), **Then** AID002 names the requirement as left uncovered at a closed stage.
2. **Given** a `GAP` row in a stage still in progress, **Then** nothing is reported. AI-DLC's own sensor owns open stages.
3. **Given** an `ORPHAN` row in a completed stage, **Then** AID002 reports it the same way.

### User Story 3 - A unit's claimed source still exists (Priority: P2)

**Acceptance Scenarios**:

1. **Given** `source-manifest.json` listing `src/auth/login.ts` and `src/auth/old.ts` (deleted), **Then** AID003 names `old.ts` and the unit.
2. **Given** an entry with a `repo` other than this workspace, **Then** it is skipped and counted.

### User Story 4 - Guard sees an AI-DLC workspace (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a project with `aidlc/spaces/default/intents/…`, **When** guard runs, **Then** an AI-DLC validator reports the intents, units and tables it read, with verdict `pass` when everything holds.
2. **Given** the legacy `aidlc-docs/` layout, **Then** the same checks run over it.
3. **Given** no AI-DLC workspace, **Then** the validator is `empty`.

### Edge Cases

- **Malformed JSON** in a table or manifest: one AID004 per file, naming the file. The rest still run.
- **Archived intents** (`aidlc engine intent archive`, recorded in the space's intents list) are skipped.
- **Many intents.** At most 10 findings per code, with an elision note, following SPK009.
- **Path safety.** Targets and manifest paths that escape the project (`..`, absolute) are refused, not resolved, and counted under AID004.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A scanner MUST find AI-DLC records under `aidlc/spaces/*/intents/*/` and under `aidlc-docs/`, and within each record every `traceability.json`, `source-manifest.json` and `aidlc-state.md`.
- **FR-002**: An AI-DLC validator (`aidlc`) MUST report AID001 for each `OK` or `Deferred` row whose `target` is a relative workspace path that does not exist. A target counts as a path when it contains `/` or ends in a known source extension and is not an ID.
- **FR-003**: It MUST report AID002 for each `GAP` or `ORPHAN` row in a table whose stage `aidlc-state.md` marks completed.
- **FR-004**: It MUST report AID003 for each `source-manifest.json` `writes[].path` without `repo` (or with this workspace's repo) that does not exist, unless the same manifest records it as deleted.
- **FR-005**: It MUST report AID004 for an unreadable or malformed table or manifest, and for a path that escapes the project.
- **FR-006**: AID001 to AID004 MUST be advisory (`defaultLevel: 'info'`). AID001 and AID003 MUST be absence claims (`ABSENCE_CLAIM_CODES`). Each code MUST be capped at 10 per run, with an elision note.
- **FR-007**: The validator MUST be `empty` when no AI-DLC record exists, and MUST report the number of intents, units, tables and manifests it read in its result.
- **FR-008**: `COMPARISONS.md` MUST gain an AI-DLC section and correct the Kiro row. `docs-canonical/ARCHITECTURE.md`, `TEST-SPEC.md`, `docs/reference/findings.md`, `docs/configuration.md` and `CHANGELOG.md` MUST describe the validator.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario has a test against fixtures shaped like AI-DLC 2.11.2's own documented examples.
- **SC-002**: On a scratch project run through `aidlc config` with hand-placed construction records, `guard` reports exactly the seeded drift.
- **SC-003**: The hermetic A/B on every local project changes nothing in projects without AI-DLC records.

## Verification Notes

- **SC-002**: an AI-DLC 2.11.2 project set up through `aidlc config --harness claude` had three planted faults:
  - a traceability row marked OK whose target does not exist;
  - a GAP row in a stage marked complete;
  - a manifest write, committed, whose file was later deleted.

  `guard` reported exactly AID001, AID002 and AID003, one each. The same run first showed six MEM001 on AI-DLC's own stock `org.md` (template placeholders and an example list), which spec 091's history rule now excludes.
- **SC-003**: the final branch A/B against v0.45.2 added no AID or MEM finding on any of the 45 local projects. None of them has AI-DLC records.

## Assumptions

- The 2.11.2 formats are the contract. A later AI-DLC format change is handled by updating fixtures pinned to the new version.
- DocGuard reads AI-DLC files and never writes them. Writing belongs to the plugin (spec 090) through AI-DLC's own mechanisms.

## Out of Scope

- Re-running AI-DLC's sensors, or judging stage quality.
- CodeKB freshness and memory rules (spec 091).

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `779b8b4eae47ef3fb49fe503246405aa02680df5` — AID001-AID004 on AI-DLC 2.11.2 records; a seeded aidlc-config project reports exactly the three planted faults; no change on projects without records. Evidence: `cli/scanners/aidlc.mjs`, `cli/validators/aidlc.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/TEST-SPEC.md`, `tests/aidlc-profile.test.mjs`, `tests/program-verification.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
