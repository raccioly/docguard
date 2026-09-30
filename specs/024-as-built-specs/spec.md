# Feature Specification: As-Built Specifications

**Feature Branch**: `feat/as-built-specs`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.as-built-specs`

**Lineage**: #455 (a practitioner's request: reverse-engineer a spec for code that has none, and
keep it correct and synced). It composes with the community Spec Kit extensions Brownfield
Bootstrap, BrownKit, Blueprint Index and Time Machine. None of them validates an as-built spec
against code. Extends `docguard.document-lifecycle` (registry) and
`docguard.lifecycle-evidence-gaps` (implementation evidence).

**Input**: User description: "Reverse-engineer a spec for an area of a project that has no
spec, make sure it is correct, validated, and synced to the code."

## Problem

Upstream Spec Kit deliberately has no retroactive specification. Its brownfield guide warns
against specifying a whole existing system, except when that inventory is the deliverable.
Teams refactoring legacy code need exactly that inventory, but for one bounded area. The
available extensions produce it from an agent's reading of the code. Nothing then checks that
the resulting requirements match the code, and nothing notices when the code changes after
the spec is written. An as-built spec that drifts is worse than none: it reads as the contract.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate an as-built spec skeleton for one area (Priority: P1)

A maintainer points DocGuard at a directory. DocGuard scans the facts it can establish
deterministically: HTTP endpoints, exported symbols, environment variables, data entities and
the tests that live there. It proposes a Spec Kit spec whose requirement candidates each cite
one fact. The coding agent writes the prose. DocGuard writes no requirement text of its own.

**Independent Test**: `docguard generate --spec src/api` on a fixture with two routes and one
exported function prints three requirement candidates, each citing its fact and source file.
With `--write`, the output is written to the next free `specs/NNN-<slug>/spec.md`.

**Acceptance Scenarios**:

1. **Given** an area with routes, exports and env vars, **When** `generate --spec <area>` runs,
   **Then** each fact becomes one `FR-NNN` candidate carrying a fact marker and a file
   citation, and the requirement statement is left as an agent task.
2. **Given** `--write`, **Then** the spec is created in the next free feature directory, and
   the registry records `origin: as_built` and `sourcePaths: [<area>]` in one transaction.
3. **Given** an area that is missing, outside the project, or yields no facts, **Then**
   nothing is written and the reason is printed.

---

### User Story 2 - Keep the as-built spec synced (Priority: P1)

After the spec is approved, the code under its source paths keeps changing. DocGuard reports
facts the spec does not account for, and facts the spec cites that no longer exist.

**Acceptance Scenarios**:

1. **Given** an as-built spec and a new route added under its source path, **When** guard
   runs, **Then** `SPR007` reports the unclaimed fact and names the spec.
2. **Given** a route removed from the code while the spec still cites it, **Then** `SPR007`
   reports the vanished fact.
3. **Given** a fact listed under the spec's `## Out of Scope` section, **Then** it is not
   reported.

---

### User Story 3 - An as-built spec needs no task list (Priority: P2)

**Acceptance Scenarios**:

1. **Given** an as-built spec with no `tasks.md`, **When** preflight and the Spec-Kit
   validator run, **Then** the missing task list is not a finding. The code already exists.

### Edge Cases

- Existing registries without `origin` or `sourcePaths` stay byte-identical (no #435-style
  verdict flip).
- A fact's identity is stable across line moves: routes key on method and path, exports on
  file and name, env vars on name, entities on name.
- Timestamp-numbered projects (`feature_numbering: timestamp`) get a timestamp prefix.
- Symlinked or out-of-project areas are refused.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `docguard generate --spec <area>` MUST collect the deterministic facts under
  `<area>`: routes (method and path), exported symbols in JS/TS modules, environment variables
  read, and data entities. It reuses DocGuard's existing scanners. Test files under the area are
  listed as existing evidence, never as candidates.
- **FR-002**: The generated spec MUST follow the Spec Kit spec template. It carries
  `**Status**: As-built`, a Spec ID, one `FR-NNN` candidate per fact with a
  `<!-- docguard:fact <kind> <key> -->` marker and a `path` citation, and agent tasks for all
  prose. DocGuard MUST NOT author requirement statements.
- **FR-003**: `--write` MUST create the spec in the next free feature directory, honouring
  `feature_numbering`. It MUST record `reviewed.lifecycle.origin: "as_built"` and
  `reviewed.scope.sourcePaths` in the registry through one file transaction.
- **FR-004**: The registry MUST accept the optional `lifecycle.origin` (`as_built`) and
  `scope.sourcePaths` fields and serialize them only when set.
- **FR-005**: The Spec-Registry validator MUST emit `SPR007` (escalation) for each as-built
  spec whose source paths contain a fact that the spec neither marks nor lists under
  `## Out of Scope`, and for each fact marker whose fact no longer exists.
- **FR-006**: Preflight and the Spec-Kit validator MUST NOT require `tasks.md` for an
  as-built spec.
- **FR-007**: `README.md` and the `speckit.docguard.generate` command document MUST explain
  the workflow, and how it composes with the brownfield community extensions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a fixture area, 100% of scanned facts appear as candidates, and a
  round-trip (generate → write → guard) produces zero SPR007.
- **SC-002**: Adding one route or removing one cited route produces exactly one SPR007.
- **SC-003**: This repository's registry is byte-identical before and after, apart from the
  new spec's own entry.
- **SC-004**: Generating an as-built spec for `cli/validators/` in this repository yields one
  candidate per exported validator function.

## Assumptions

- Facts are what DocGuard's scanners can establish without an LLM. Behaviour that no scanner
  sees stays an agent task, not a candidate.
- `approval` stays `draft` until a human reviews the prose. An as-built spec records current
  behaviour, not a decision to keep it.
