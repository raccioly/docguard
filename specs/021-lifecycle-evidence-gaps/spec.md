# Feature Specification: Lifecycle Evidence Gaps

**Feature Branch**: `fix/lifecycle-evidence-gaps`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.lifecycle-evidence-gaps`

**Lineage**: extends `docguard.document-lifecycle` (FR-013, FR-016 implementation and test
evidence). Records dogfood findings (a), (b) and (c) from #455. Each was hit while building
specs 014–016 through DocGuard's own Spec Kit hooks.

**Input**: User description: "When dogfooding finds friction, improve DocGuard."

## Problem

Building this repository's own specs through the pipeline exposed three places where the
evidence the lifecycle relies on went missing without any signal at the time:

- **(a) Missing implementation annotations surface only at completion.** Spec 014 was fully
  implemented, and its tasks were checked, before any source file carried
  `@implements docguard.specify-init-delegation#FR-…`. `guard` stayed silent. `reconcile`
  classified the changed sources as `unsupported_or_ambiguous` without saying why. Only
  `specs complete` reported it (SPC004, SPC006), after the fact.
- **(b) `specs --write` ignores untracked test files without saying so.** Evidence comes from
  tracked files only. Running `specs --write` before `git add` on a new test file wrote a
  registry that showed CURRENT, then became stale (SPR001) the moment the commit landed.
- **(c) YAML annotations are invisible.** `@implements` in `action.yml` or a workflow file is
  never read, so changes to CI and to the GitHub Action can never be attributed to a spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Learn about missing implementation evidence while working (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a spec with at least one checked task and zero source files carrying
   `@implements` for any of its requirements, **When** guard runs, **Then** an escalation
   (`SPR006`) names the spec and shows the annotation form to add.
2. **Given** a spec with checked tasks and at least one `@implements`, **Then** no SPR006.
3. **Given** a spec with no checked tasks, **Then** no SPR006. Nothing is claimed yet.

---

### User Story 2 - Know what `specs --write` did not count (Priority: P2)

**Acceptance Scenarios**:

1. **Given** an untracked test file carrying `@req` annotations, **When** `specs --write`
   runs, **Then** the output names the file, says its evidence was not counted, and gives the
   remedy (`git add`, then re-run). The JSON result lists the file under `untrackedEvidence`.

---

### User Story 3 - Attribute CI and Action changes to a spec (Priority: P2)

**Acceptance Scenarios**:

1. **Given** `# @implements acme.feature#FR-001` in a tracked `.yml` or `.yaml` file, **When**
   the registry projects implementation evidence, **Then** that requirement has the file as
   evidence, and `reconcile` no longer classifies the file as unrelated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Spec-Registry validator MUST emit `SPR006` (escalation, no mechanical fix)
  for every active spec with one or more checked tasks and no implementation evidence.
- **FR-002**: `specs --write` and `specs --check` MUST report untracked test files that carry
  requirement annotations. The human output names them, and the JSON result lists them under
  `untrackedEvidence`.
- **FR-003**: Implementation evidence MUST be read from `#` comments in tracked `.yml` and
  `.yaml` files.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each dogfood scenario, replayed as a fixture, produces its new signal.
- **SC-002**: This repository's `action.yml` annotation for `docguard.spec-first-gate#FR-010`
  appears in that spec's implementation evidence.
- **SC-003**: No SPR006 on this repository once every spec with checked tasks carries an
  annotation.

## Assumptions

- `@req` in YAML is not test evidence. Workflows are not tests.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `dfa1385749b66184c93bf65f5dde127192037711` — Reviewed at dfa1385 on main: all 5 tasks are checked and were delivered by #466, #471; the full suite (2368 tests) passes and guard reports 0 errors at this revision. Deviations from the plan are recorded in the task notes. Evidence: `cli/scanners/requirement-evidence.mjs`, `cli/scanners/spec-registry.mjs`, `cli/validators/spec-registry.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `tests/lifecycle-evidence-gaps.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
