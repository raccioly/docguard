# Feature Specification: Sync Section Scope

**Feature Branch**: `fix/sync-section-scope`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.sync-section-scope`

**Lineage**: refines `docguard.document-lifecycle` FR-010 (mechanical section
applicability). Found while drafting the code-derived diagrams spec (#455).

**Input**: User description (dogfood finding): "`sync --since` never narrows
most generated sections: the matcher table uses IDs the plan does not emit."

## Problem

`sync --since <ref>` refreshes only the generated sections whose source files
changed. The `SECTION_FILE_MATCHERS` table in `cli/shared-sync-scope.mjs` was
keyed `endpoints-table`, `entities-table`, `env-vars-table`,
`integrations-table`, `screens-table` and `features-table`. The memory plan
emits `endpoints`, `entities`, `env-vars`, `integrations`, `screens`,
`feature-areas`, `component-map` and `test-inventory`. A missing key means "in
scope", so eight of the ten sections refreshed on every change, docs-only
changes included. `reconcile` also listed mechanical sections by names that no
section carries. The test for the table asserted nothing (`assert.ok(true)`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scoped sync does what it says (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a docs-only change, **When** `sync --since` runs, **Then** no
   generated section is in scope.
2. **Given** a code change, **Then** the sections a code change can affect are
   in scope, and `tech-stack` stays out unless a manifest changed.
3. **Given** an unknown section ID or an empty change set, **Then** the section
   stays in scope (the conservative default is unchanged).

### Edge Cases

- Routes, entities and env reads can live in any code file, so their sections
  match any code change. A skipped refresh the code needed would leave a stale
  doc; an unneeded one costs a no-op.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The matcher table MUST have exactly one entry per `source=code`
  section ID the memory plan emits. A test MUST fail when the two sets differ.

## Success Criteria *(mandatory)*

- **SC-001**: A docs-only change puts zero sections in scope. The tests fail on
  the previous table.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `dfa1385749b66184c93bf65f5dde127192037711` — Reviewed at dfa1385 on main: all 3 tasks are checked and were delivered by #473; the full suite (2368 tests) passes and guard reports 0 errors at this revision. Deviations from the plan are recorded in the task notes. Evidence: `cli/shared-sync-scope.mjs`, `docs-canonical/ARCHITECTURE.md`, `tests/sync-since.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
