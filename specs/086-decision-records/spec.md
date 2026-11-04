# Feature Specification: Decisions Are Recorded Completely and Their Supersession Chain Holds

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-02

**Status**: Draft

**Spec ID**: `docguard.decision-records`

**Lineage**: Fifth feature of the DocGuard × AI-DLC program (issue 607).
- It reads the ADR layouts DocGuard already recognizes for REF002's ADR citations (`collectAdrNumbers`: a single `ADR.md` with `## ADR-NNN` sections, or one file per decision under an `adr/`, `adrs/` or `decisions/` directory).
- It reads the ADR template that `docguard init` writes (`templates/ADR.md.template`: an Index table plus `**Status**:` lines).
- It ships its codes advisory (`defaultLevel: 'info'`), per `docguard.enforcement-ladder`.

**Input**: Three AWS samples treat decisions as artifacts that can be checked:
- AI-DLC asks every stage's questions in a `*-questions.md` file with `[Answer]:` tags.
- The decisions-driven sample refuses to proceed with a blank answer.
- AI-DLCOps validates ADRs against a schema: status in `proposed|accepted|rejected|deprecated|superseded`, with `supersedes`/`superseded_by` links.

Spec Kit's `/speckit-clarify` records `- Q: … → A: …` lines under `## Clarifications`. DocGuard scaffolds ADRs and checks that code citations of ADR numbers resolve (REF002). It does not check that the decision records are themselves complete and consistent.

## Problem

- **A decision with no status, or a status nobody defined** (`Status: Done`), cannot be read as in force or not.
- **Supersession goes one way.** ADR-007 says "Supersedes ADR-003", and ADR-003 still says `Accepted` with no "Superseded by". A reader of ADR-003 follows a dead decision.
- **The index disagrees with the record.** The Index table says ADR-004 is Accepted, and the record says Deprecated.
- **A question was asked and never answered.** A clarification `Q:` with no `A:`, or an `[Answer]:` tag left blank, means the downstream artifacts were written on a guess.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every ADR has a known status (Priority: P1)

**Independent Test**: An `ADR.md` with ADR-001 `Accepted`, ADR-002 with no status, ADR-003 `Done`.

**Acceptance Scenarios**:

1. **Given** that file, **Then** DEC001 names ADR-002 (no status) and ADR-003 (`Done` is not proposed, accepted, rejected, deprecated or superseded).
2. **Given** `✅ Accepted` or `Status: **superseded**`, **Then** emoji and emphasis are ignored and the status is recognized.
3. **Given** MADR front matter (`status: accepted`) in a per-file ADR, **Then** it is read.

### User Story 2 - Supersession is reciprocal and points at real records (Priority: P1)

**Independent Test**: ADR-003 `Accepted`; ADR-007 `Accepted`, "Supersedes ADR-003"; ADR-008 "Superseded by ADR-012" (no ADR-012).

**Acceptance Scenarios**:

1. **Given** that set, **Then** DEC003 reports that ADR-003 is superseded by ADR-007 but its own record neither says so nor has status `superseded`.
2. **Given** that set, **Then** DEC002 reports that ADR-008 points at ADR-012, which no record defines.
3. **Given** ADR-005 with status `superseded` and no "Superseded by", **Then** DEC004 reports it as superseded without a successor.

### User Story 3 - The index agrees with the records (Priority: P2)

**Acceptance Scenarios**:

1. **Given** an Index row `ADR-004 | … | ✅ Accepted` and the record `**Status**: Deprecated`, **Then** DEC005 names both.
2. **Given** an Index row for an ADR with no record, **Then** DEC002 reports it.

### User Story 4 - Asked questions have answers (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a feature `spec.md` whose `## Clarifications` has `- Q: Which store? → A:` (empty), **Then** DEC006 reports the line.
2. **Given** a Markdown file whose name ends in `questions.md` with `[Answer]:` and nothing after it on that line or the next non-blank line, **Then** DEC006 reports it.
3. **Given** `- Q: … → A: Postgres`, **Then** nothing is reported.

### Edge Cases

- **Template placeholders.** The scaffolded `ADR-002 | | | |` row and HTML-comment titles are ignored until the row has an ID and a status or title.
- **Numbering.** `ADR-7`, `ADR-007` and `adr-0007` are the same decision, and compare as integers like REF002.
- **Synonyms.** `Approved` reads as accepted. `Draft` and `Proposal` read as proposed. `Obsolete` reads as deprecated. `Replaced` reads as superseded. Anything else is unknown (DEC001).
- **Spec Kit artifacts in archived or terminal features** are skipped, as in spec 085.
- **Fences and comments** never define records or questions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A new Decision-Records validator (`decisionRecords`) MUST parse ADRs from both layouts: sections in one file, and one file per decision. For each ADR it reads the number, title, status, "Supersedes ADR-N" and "Superseded by ADR-N" links (prose or MADR `supersedes:`/`superseded_by:` keys), and the source line.
- **FR-002**: DEC001 MUST report an ADR whose status is missing or not one of proposed, accepted, rejected, deprecated or superseded, after the synonyms in Edge Cases.
- **FR-003**: DEC002 MUST report a supersession link or an Index row naming an ADR number that no record defines.
- **FR-004**: DEC003 MUST report a one-way supersession: A supersedes B while B neither says it is superseded by A nor has status `superseded`, or B says it is superseded by A while A does not say it supersedes B.
- **FR-005**: DEC004 MUST report an ADR with status `superseded` and no successor link, and an ADR with a successor link whose status is not `superseded`.
- **FR-006**: DEC005 MUST report an Index row whose status differs from its record's status.
- **FR-007**: DEC006 MUST report an unanswered clarification in a feature `spec.md` (`Q:` with an empty `A:` or no `A:`), and an empty `[Answer]:` in a `*questions.md` file.
- **FR-008**: DEC001 to DEC006 MUST be advisory (`defaultLevel: 'info'`). DEC002 MUST be an absence claim (`ABSENCE_CLAIM_CODES`). The validator MUST be not-applicable (verdict `empty`) on a project with no ADR and no questions.
- **FR-009**: `cli/findings.mjs`, `docs/reference/findings.md`, `docs-canonical/ARCHITECTURE.md`, `TEST-SPEC.md`, `docs/configuration.md` (the `validators.decisionRecords` switch) and `CHANGELOG.md` MUST describe it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario has a test.
- **SC-002**: The hermetic A/B on every local project changes no exit code. Every DEC finding it adds is reviewed by hand, and the per-code precision is recorded.
- **SC-003**: `docguard init`'s ADR template, freshly scaffolded, produces no DEC finding.

## Verification Notes

- **SC-002**: a first pass on the 45 local projects produced 107 DEC findings. Each was reviewed by hand, and three parser fixes followed (plan, Research decisions). That left 5, all genuine: 3 DEC001, 1 DEC003 and 1 DEC006. The final branch A/B against v0.45.2 added exactly those 5 and changed no exit code.

## Assumptions

- ADR numbering is the identity. Titles are free text.
- A decision is in force when its status is `accepted`. The validator checks consistency, not whether a decision is wise.

## Out of Scope

- Generating ADRs or answers.
- Decisions recorded outside Markdown (issues, PR threads).

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `779b8b4eae47ef3fb49fe503246405aa02680df5` — DEC001-DEC006 advisory; 107 first-pass findings hand-reviewed to 5 genuine, exactly the 5 the final A/B adds; no exit change. Evidence: `cli/validators/decision-records.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `tests/decision-records.test.mjs`, `tests/program-verification.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
