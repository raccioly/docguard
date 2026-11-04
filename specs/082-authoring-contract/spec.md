# Feature Specification: What DocGuard Tells Authors to Write Is What Its Validators Accept

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-03

**Status**: Draft

**Spec ID**: `docguard.authoring-contract`

**Lineage**: Generalizes `docguard.doc-validator-fidelity` (spec 079). That spec made the validators agree with each other and tested the five section templates against STR006. This spec makes the guidance agree with the validators.

It borrows AI-DLC's idea that a stage's instructions and its gate check one artifact contract. Here the stage is a person or an agent writing a canonical document. The program is issue 607.

**Input**: The canonical documents' required sections are written down in seven places that have drifted apart:

| Where | What it says |
|---|---|
| `cli/validators/structure.mjs` (STR003) | the required sections |
| `cli/commands/score.mjs` | the same list, but DATA-MODEL and the environment-variable section are always required, where STR003 exempts CLI and library projects |
| `cli/commands/explain.mjs` | the STR003 text |
| `cli/commands/fix.mjs` | the "WRITE THE DOCUMENT" lists `fix` gives agents |
| `cli/scanners/memory-plan.mjs` | the section prompts `memory --plan` gives |
| `cli/writers/doc-generators.mjs` | the generated documents |
| `extensions/spec-kit-docguard/skills/docguard-fix/SKILL.md` and its `.agent/` mirror | the Spec Kit skill text |

The skill and the `fix` prompts tell agents to write sections the validator does not accept as the required ones: "Technology Choices" where STR003 asks for Tech Stack, and "Auth Mechanism" and "Secrets Inventory" where it asks for Authentication and Secrets Management. An agent that follows DocGuard's own guidance writes a document that fails DocGuard. Separately, the `enterprise-ai` profile's `requiredSections` (Risk Assessment and Threat Model in SECURITY.md) is read by nothing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Following DocGuard's guidance passes DocGuard (Priority: P1)

**Independent Test**: Write a document whose headings are the ones the guidance names, then run STR003 on it.

**Acceptance Scenarios**:

1. **Given** the section list for a canonical document, in the `fix` prompt, the Spec Kit skill or explain's STR003 text, **Then** each required section appears there under a heading `docHasSection` accepts for it. Recommended sections may follow.
2. **Given** a document made of exactly the headings in that list, each with one sentence, **Then** STR003 reports nothing for it.

### User Story 2 - Every template and generator yields a document the validators accept (Priority: P1)

**Acceptance Scenarios**:

1. **Given** each canonical template with every placeholder filled by one sentence, **Then** STR003 and STR006 report nothing.
2. **Given** `doc-generators.mjs` output for a fixture project, **Then** STR003 reports nothing.
3. **Given** a template, **Then** the parser that reads its document type finds what the template promises:

   | Template | What its reader must find |
   |---|---|
   | ADR | a record with a status (`parseAdrFile`) |
   | REQUIREMENTS | requirement IDs (`definedIds`) |
   | RUNBOOKS, TROUBLESHOOTING | at least two scenario headings (the incident evidence of `score --dora`) |
   | CHANGELOG | an `[Unreleased]` section (Changelog validator) |

### User Story 3 - The score and the validator agree (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a CLI project (`needsDatabase: false`) with no DATA-MODEL, **Then** the Doc Quality score requires the same sections as STR003, and the missing DATA-MODEL is no gap.

### User Story 4 - A profile's extra sections are reported, advisory first (Priority: P3)

**Acceptance Scenarios**:

1. **Given** the `enterprise-ai` profile and a SECURITY.md without "Risk Assessment", **Then** STR007 names it. STR007 ships `defaultLevel: 'info'` (spec 083), so no exit code changes until a project promotes it.

### Edge Cases

- **Doc roles**: `remapDocPath` still maps a default path to a project's own file. The registry is keyed by default path.
- **Synonyms**: guidance may use any heading `docHasSection` accepts, such as "Technology Stack" for Tech Stack.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `cli/authoring-contract.mjs` MUST be the one registry of canonical document sections. Each document is keyed by default path. Each section MUST carry its heading, whether it is required or recommended, the project-type condition that exempts it, and one line on what to write. The registry MUST also carry a profile's extra sections.
- **FR-002**: STR003 (`validateDocSections`), the Doc Quality score, explain's STR003 text and the `fix` prompts MUST read their section lists from the registry.
- **FR-003**: The Spec Kit `docguard-fix` skill and its `.agent/` mirror MUST carry the section list in a generated marker block, refreshed by `npm run docs:reference` and checked for staleness by a test.
- **FR-004**: Every section-name prompt in `memory-plan.mjs` MUST be a registry section.
- **FR-005**: A round-trip test MUST cover US1, US2 and US3.
- **FR-006**: STR007 MUST report a profile's required section that is missing, at `defaultLevel: 'info'`.
- **FR-007**: `docs/reference/findings.md`, `docs-canonical/TEST-SPEC.md`, `ARCHITECTURE.md` and `CHANGELOG.md` MUST describe the registry and STR007.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario has a test. The US1 test fails on the guidance text before this change.
- **SC-002**: The hermetic A/B against v0.45.2 changes no guard exit code. Every `score` change is recorded in Verification Notes and comes only from US3.

## Verification Notes

Hermetic A/B on 2026-11-03: v0.45.2 against this branch, 45 local projects, with `guard` and `score --format json`, one fresh clone per project per CLI, run serially.
- **Score.** 42 projects identical. 3 Doc Quality scores moved by 2 points: two rose and one fell. The fall came from a project with `needsDatabase` and `needsEnvVars` false that has both sections; they no longer count either way. No total score, grade or `score` exit code changed (SC-002).
- **Guard.** 33 projects identical, and no finding was removed anywhere. The 159 additions are advisory codes from specs 085 and 086, which change no exit code, and MET001 ×2. The one exit change, 0 to 2, is this repository's own main branch: its docs say "34 validators" while this branch ships 36, and this branch updates those docs. STR007 was added on no project, since none uses the `enterprise-ai` profile.

## Assumptions

- A canonical template's prose is written for people and stays hand-written. Templates are tested against the registry, not generated from it.

## Out of Scope

- New required sections. The registry records what STR003 requires today; changing that is a separate decision.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `779b8b4eae47ef3fb49fe503246405aa02680df5` — One section registry read by STR003, score, explain, fix and the Spec Kit skill; guidance and templates round-trip; A/B: no exit change, 3 Doc Quality scores moved 2 points from the exemptions. Evidence: `cli/authoring-contract.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/TEST-SPEC.md`, `tests/authoring-contract.test.mjs`, `tests/program-verification.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
