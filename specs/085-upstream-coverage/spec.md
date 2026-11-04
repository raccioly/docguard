# Feature Specification: Every Requirement Reaches a Task, and Every Task Cites a Real Requirement

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-02

**Status**: Draft

**Spec ID**: `docguard.upstream-coverage`

**Lineage**: Fourth feature of the DocGuard × AI-DLC program (issue 607).
- It extends the Spec-Kit validator (SPK001 to SPK012) and `docguard.spec-kit-artifact-coverage`, which made Spec Kit artifacts a governed tier.
- It applies `docguard.enforcement-ladder` (spec 083): new codes ship advisory (`defaultLevel: 'info'`), so they never change an exit code until a project promotes them.
- Its statuses mirror the traceability statuses that AI-DLC's `traceability` sensor uses (OK, GAP, ORPHAN), applied to Spec Kit's own chain: spec → plan → tasks.

**Input**: AI-DLC checks two things at each gate. Its `upstream-coverage` sensor requires every deliverable to mention the upstream artifacts it consumes. Its `traceability` sensor fails on a GAP (an upstream requirement nothing covers) and on an ORPHAN (a downstream row naming a requirement that does not exist). Spec Kit's `/speckit-analyze` makes the same judgment once, by asking the model, and the result is not kept. DocGuard checks spec quality (SPK003 to SPK005) and phantom completions (SPK008, SPK010), but never whether the chain is connected.

## Problem

- **A requirement can be planned for and never built.** If no task in `tasks.md` cites `FR-007`, nothing implements it on purpose, and the feature can be marked complete without it.
- **A task can cite a requirement that does not exist.** After the spec is renumbered or trimmed, `tasks.md` still says "(FR-012)". The reference is dead, and a reader cannot tell what the task was for.
- **A downstream artifact can float free.** A `plan.md` that never names its `spec.md`, or a `tasks.md` that names neither `plan.md` nor `spec.md`, was not generated from them or has drifted from them.
- **A user story can have no tasks.** Spec Kit's template labels tasks `[US1]`. A story with no labeled task is unplanned.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Uncovered and dead requirement IDs are named (Priority: P1)

As a spec author, I see which requirements no task covers and which task references point at nothing, before I start implementing.

**Independent Test**: A feature whose spec defines FR-001 to FR-003 and SC-001, and whose tasks cite FR-001, FR-003 and FR-009.

**Acceptance Scenarios**:

1. **Given** that feature, **Then** SPK013 names FR-002 as uncovered, at `spec.md:<line>`.
2. **Given** that feature, **Then** SPK014 names FR-009 at the `tasks.md` line that cites it, as defined nowhere in `spec.md`.
3. **Given** a requirement cited only by `plan.md`, **Then** it is not uncovered. The plan is a deliberate decision about it.
4. **Given** a `tasks.md` that cites no requirement ID at all, **Then** no SPK013 is reported for that feature. The Spec-Kit result notes that requirement coverage could not be checked, because a task list that never uses IDs is a convention choice, not a set of gaps.
5. **Given** success criteria (SC-###) and tasks that cite at least one SC, **Then** an SC no task or plan cites is reported. If the tasks never cite SC IDs, no SC is reported.
6. **Given** `FR-007` defined with sub-requirements `FR-007.1` and `FR-007.2`, and a task citing `FR-007.1`, **Then** neither `FR-007` nor its sub-requirements are reported as uncovered.

### User Story 2 - Downstream artifacts cite their upstream (Priority: P2)

As a reviewer, I know that a feature's plan was made from its spec and its tasks from its plan.

**Independent Test**: Three features: a plan that names `spec.md`; a plan that names no upstream; and tasks that name neither `plan.md` nor `spec.md` nor any FR ID.

**Acceptance Scenarios**:

1. **Given** a `plan.md` that does not mention `spec.md` (by link, path or filename) and cites no requirement ID of the spec, **Then** SPK015 reports it.
2. **Given** a `tasks.md` that mentions neither `plan.md` nor `spec.md` and cites no requirement ID, **Then** SPK015 reports it.
3. **Given** an artifact that cites requirement IDs but never the file name, **Then** nothing is reported. Citing the requirements is citing the spec.

### User Story 3 - Every user story has a task (Priority: P2)

**Independent Test**: A spec with stories P1 and P2 labeled 1 and 2, and tasks labeled `[US1]` only.

**Acceptance Scenarios**:

1. **Given** tasks that use `[USn]` labels and none for story 2, **Then** SPK016 names User Story 2.
2. **Given** tasks that use no `[USn]` labels at all, **Then** nothing is reported.

### Edge Cases

- **Sub-requirements.** `FR-001a` is its own requirement. A task citing `FR-001` does not cover `FR-001a`, and a citation of `FR-001a` resolves when the spec defines it.
- **ID ranges.** "FR-004 to FR-006" and "FR-004–FR-006" in a task cover FR-004, FR-005 and FR-006. Ranges with a different prefix on each end are not expanded.
- **Requirement IDs of other specs.** A task citing `docguard.verdict-contract#FR-002` refers to another spec, which spec 027 already resolves. Fully qualified IDs are skipped here.
- **Archived or retired features** (`.docguard-archive.json`, the document-lifecycle terminal states) are not checked.
- **Code fences and HTML comments** in either artifact do not define or cite IDs.
- **Caps.** At most 10 SPK013 and 10 SPK014 per feature, with a note counting the rest, following SPK009 and SPK012.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: For each feature directory with `spec.md` and `tasks.md`, the Spec-Kit validator MUST report SPK013 for every FR or SC ID defined in `spec.md` that neither `tasks.md` nor `plan.md` cites. Each prefix is checked only when `tasks.md` cites at least one ID of that prefix from this spec: FR IDs when tasks cite FRs, SC IDs when tasks cite SCs. A definition is a list item, table row or heading that starts with the ID, whatever follows it. A dotted sub-requirement (`FR-007.1`) and its parent cover each other.
- **FR-002**: It MUST report SPK014 for every unqualified FR or SC ID cited in `tasks.md` or `plan.md` that `spec.md` does not define, at the citing line.
- **FR-003**: It MUST report SPK015 for a `plan.md` that names neither `spec.md` nor any requirement ID the spec defines, and for a `tasks.md` that names neither `plan.md`, `spec.md` nor any such ID.
- **FR-004**: When `tasks.md` uses `[USn]` labels, it MUST report SPK016 for every user story `n` in `spec.md` (from `### User Story n` headings) with no labeled task.
- **FR-005**: Ranges ("FR-004 to FR-006", "FR-004–FR-006", "FR-004..FR-006") with the same prefix MUST expand to every ID between them. Fenced code and HTML comments MUST be ignored.
- **FR-006**: SPK013 to SPK016 MUST be registered with `defaultLevel: 'info'`, so they are advisory until a project promotes them with `findingSeverity`. SPK014 MUST carry high confidence; SPK013, SPK015 and SPK016 MUST carry disposition `escalate`.
- **FR-007**: Archived and retired features MUST NOT be checked. Each code MUST be capped at 10 per feature, with the rest counted in one note.
- **FR-008**: `cli/findings.mjs`, `docs/reference/findings.md`, `docs-canonical/TEST-SPEC.md` and `CHANGELOG.md` MUST describe the codes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario has a test, and each new code fails its fixture on the release before this change.
- **SC-002**: On this repository's 80 specs, every SPK013 and SPK014 reported is reviewed by hand. The precision of each code is recorded in Verification Notes, and a code below 0.9 precision on this repository is fixed before release.
- **SC-003**: The hermetic A/B on every local project changes no exit code, and adds only SPK013 to SPK016 findings. Each project's additions are counted in Verification Notes.

## Verification Notes

Precision was measured on 23 local projects that use Spec Kit (2026-11-02), and the parser changed four times before the codes shipped:
- Definitions written `- **FR-007** The …`, `- **FR-024 Title.**`, `- **FR-095 — …:**` and `### FR-770 — …` were missed at first. Recognizing every list, table or heading line that starts with an ID cut SPK014 across those projects from 105 to 1.
- A file name inside inline code (`` Spec: `spec.md` ``) was hidden by the inline-code rule meant for example IDs. Keeping inline code for file names cut SPK015 from 144 to 83.
- `Spec023 FR-020`, a spec number written with no space, is now read as qualified.
- Per-prefix checking stopped SC reports on teams that never cite SCs in tasks.

Sampled SPK013 IDs had 0 citations in tasks and plans: the finding is literal. Output is capped at 10 per code per project.

- **SC-002 on this repository**: all 28 SPK013 were checked by hand against their features' tasks and plans. Five were false: "TEST-SPEC, CHANGELOG (FR-007)" in a task was read as another document's FR-007, because any all-caps word before an ID counted as a qualifier. That is precision 0.82, below the 0.9 bar, so the qualifier now names only requirements documents (REQUIREMENTS, PRD, SRS, BRD). Across 30 local projects that changed two IDs and added no dangling one. This repository then has 23 SPK013, all literal, and no SPK014.
- **SC-003**: the final branch A/B added 62 SPK013, 81 SPK015, 8 SPK016 and 1 SPK014 across 12 local projects (counted before the qualifier fix, which only removes). No exit code changed.

## Assumptions

- Requirement IDs follow Spec Kit's template (`FR-###`, `SC-###`, optionally suffixed with a letter). Other ID schemes are out of scope here and handled by spec 089 for AI-DLC.
- Citing an ID in prose is citing the requirement. The check measures connection, not implementation. Implementation evidence stays with spec 021 and spec 070.

## Out of Scope

- Judging whether a task actually implements the requirement it cites.
- Checklist coverage (`checklists/*.md`). Checklists are reviewer aids whose items are not requirements.
