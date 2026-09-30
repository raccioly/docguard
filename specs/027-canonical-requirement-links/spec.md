# Feature Specification: Canonical Requirement Links

**Feature Branch**: `chore/release-prep-0.43`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.canonical-requirement-links`

**Lineage**: refines `docguard.document-lifecycle` FR-010–FR-012
(reconciliation). Found while completing specs 014–025 for 0.43.0.

**Input**: User description (dogfood finding): "`specs complete` refuses a
spec because a test annotated with an exact canonical requirement is
classified as unsupported."

## Problem

`reconcile` links a changed file to approved intent only through a Spec Kit
spec: the spec's artifacts, its evidence files, or a qualified spec requirement
ID in the change. A test annotated `@req docs-canonical/REQUIREMENTS.md#FR-024`
cites a requirement declared in a canonical document, which is just as exact.
Reconcile still calls it `unsupported_or_ambiguous`, and `specs complete`
refuses every spec whose window contains that change. Traceability already
accepts path-qualified canonical IDs; reconciliation did not.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A canonical citation is traced (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a changed test citing a requirement declared in a canonical
   document, **When** reconcile runs, **Then** the change is `approved_intent`,
   its `canonical` list names the requirement, and the graph has an edge to it.
2. **Given** the canonical document changed in the same range, **Then** the
   disposition is `intentional_behavior_change_review`; otherwise it is
   `possible_implementation_regression`, as for a spec link.

### User Story 2 - Only declared identities count (Priority: P1)

1. **Given** a citation of an undeclared ID, a missing document, or a path with
   `..`, **Then** the change stays unsupported.

### Edge Cases

- A change citing no canonical requirement carries no `canonical` field, so
  existing reconcile output is unchanged.
- Declared means declaration-shaped: the shared requirement parser ignores
  prose, comments, code fences and example sections.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Reconcile MUST link a changed source or test file to each
  `docs-canonical/<doc>.md#<ID>` it cites whose ID is declared in that
  document, classify it as approved intent, and add the requirement node and
  edge to the review graph.
- **FR-002**: A citation of an undeclared ID, a missing document, or a path
  containing `..` MUST NOT create a link.

## Success Criteria *(mandatory)*

- **SC-001**: The fixture test annotated with a declared canonical requirement
  is approved intent. The tests fail against the previous reconciler.
- **SC-002**: `specs complete` for specs 014–025 no longer lists
  `tests/hook-fail-open.test.mjs` as unresolved.
