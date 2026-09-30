# Feature Specification: Spec Kit Artifact Coverage

**Feature Branch**: `feat/constitution-validation`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.spec-kit-artifact-coverage`

**Lineage**: extends `docguard.calibrated-finding-channels` (headline coverage must not read
non-coverage as success) to Spec Kit's own artifacts. Tracking issue #455.

**Input**: User description: "DocGuard validates the constitution — its contradictions and stale
claims passed guard for six months."

## Problem

A Spec Kit project keeps its governing rules in `.specify/memory/constitution.md` and its intent
in `specs/`. DocGuard ignores both in the places that matter:

- The document coverage map reports every `specs/**` file as "outside any tier". In this
  repository that was 36 of 55 untiered files. The count is so large that adopters learn to
  ignore the line. The constitution does not appear at all, because the walker skips dot
  directories.
- No claim check reads the constitution. DocGuard's own constitution said "Dependencies: None.
  Zero. Ever." while the package shipped one runtime dependency. It also named functions and
  modules that `guard` never compared to the code. Guard stayed green for six months.
- The constitution declared that no validator imports another, and
  `cli/validators/docs-sync.mjs` imported one. Nothing enforced the rule.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See Spec Kit artifacts as governed (Priority: P1)

A Spec Kit adopter runs `guard` and sees their specs and constitution counted under a Spec Kit
tier, so the "outside any tier" line lists only documents that are genuinely unenrolled.

**Why this priority**: A coverage signal dominated by false positives trains adopters to ignore
it, which hides the real untiered documents.

**Independent Test**: In a repository with `specs/001-x/spec.md`, `specs/001-x/research.md` and
`.specify/memory/constitution.md`, guard's coverage reports three Spec Kit documents and zero
untiered ones.

**Acceptance Scenarios**:

1. **Given** Spec Kit feature directories with any Markdown artifacts (spec, plan, tasks,
   research, data model, quickstart, contracts, checklists), **When** guard computes coverage,
   **Then** they count under the Spec Kit tier.
2. **Given** a constitution in `.specify/memory/` or at the repository root, **When** guard
   computes coverage, **Then** it is discovered and counted under the Spec Kit tier.
3. **Given** a `specs/` file matched by `.docguardignore`, **When** coverage is computed,
   **Then** it counts as ignored.

---

### User Story 2 - Catch false dependency claims (Priority: P1)

A maintainer's governing documents state how many runtime dependencies the project has. When
the claim disagrees with the package manifest, guard reports it.

**Why this priority**: "Zero dependencies" is a supply-chain promise adopters rely on, and it is
the claim that was false in DocGuard's own constitution.

**Independent Test**: A `package.json` with one dependency and a constitution saying "zero
runtime dependencies" produces one finding naming both numbers.

**Acceptance Scenarios**:

1. **Given** a claim of zero, none, no, or N runtime/production/npm dependencies, or a
   `Dependencies: None` line, **When** the manifest declares a different count, **Then** a
   finding reports the claimed and actual counts and the file.
2. **Given** a claim that matches the manifest, **When** guard runs, **Then** the check passes.
3. **Given** prose about dependencies between modules ("no dependencies between validators"),
   **When** guard runs, **Then** it is not treated as a package claim.

---

### User Story 3 - Check the constitution's code references (Priority: P2)

Backticked code identifiers in the constitution get the same two-revision existence check as
the canonical docs, and its count claims the same consistency check.

**Independent Test**: A constitution that names a function which existed when the constitution
was last edited and has since been removed produces a reference finding.

**Acceptance Scenarios**:

1. **Given** a constitution naming a removed identifier, **When** guard runs, **Then**
   Reference-Existence reports it against the constitution's path.

---

### User Story 4 - This repository obeys its validator-isolation principle (Priority: P2)

**Independent Test**: A repository test fails when any module in `cli/validators/` imports
another module in `cli/validators/`.

**Acceptance Scenarios**:

1. **Given** the current tree, **When** the isolation test runs, **Then** it passes because the
   shared OpenAPI discovery lives in a shared module.

### Edge Cases

- No `package.json`: the dependency check does not apply, and says so. It never asserts zero.
- A malformed `package.json`: not applicable, never a finding.
- Changelog files: skipped, as for every count claim.
- A historical statement ("v0.1 had zero dependencies"): skipped by the existing historical-
  context guard.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Guard's document coverage MUST include a Spec Kit tier that counts Markdown files
  inside Spec Kit feature directories under `specs/` and the detected constitution.
- **FR-002**: Coverage MUST discover the constitution even when it lives in a dot directory.
- **FR-003**: The coverage JSON MUST expose the Spec Kit tier count additively; no existing field
  changes meaning.
- **FR-004**: Metrics-Consistency MUST compare runtime-dependency count claims in governed
  documents and the constitution to the count declared by `package.json` `dependencies`
  (finding `MET004`). Only claims qualified by runtime, production, npm, package, external or
  third-party wording, or a `Dependencies:` label, qualify.
- **FR-005**: `MET004` MUST be an escalation without a mechanical fix: the reader decides
  whether the document or the manifest is wrong.
- **FR-006**: Reference-Existence and Metrics-Consistency MUST include the detected constitution
  in the documents they read.
- **FR-007**: The OpenAPI specification discovery used by two validators MUST live in a shared
  module, and a repository test MUST enforce that no validator imports another.

### Key Entities

- **Spec Kit tier**: the coverage bucket for Spec Kit-owned documents.
- **Dependency claim**: a number (or zero word) bound to runtime-dependency wording.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On this repository, untiered Markdown drops by the number of Spec Kit documents
  (every `specs/**` file leaves the untiered list).
- **SC-002**: DocGuard's pre-v2 constitution produces a `MET004` finding. The v2 constitution
  produces none.
- **SC-003**: Zero `MET004` findings on this repository's other documents, whose dependency
  claims are true.
- **SC-004**: The validator-isolation test fails on the pre-fix tree and passes after.

## Assumptions

- Dependency counting covers `package.json` `dependencies` (runtime). Python and other
  manifests are out of scope for this spec. The check reports not-applicable there.
- Fixture `specs/` trees nested under test or benchmark directories are not the project's Spec
  Kit artifacts. Only the top-level `specs/` counts.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `dfa1385749b66184c93bf65f5dde127192037711` — Reviewed at dfa1385 on main: all 9 tasks are checked and were delivered by #461, #471; the full suite (2368 tests) passes and guard reports 0 errors at this revision. Deviations from the plan are recorded in the task notes. Evidence: `cli/scanners/speckit.mjs`, `cli/shared-openapi.mjs`, `cli/validators/api-surface.mjs`, `cli/validators/docs-sync.mjs`, `cli/validators/metrics-consistency.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `tests/spec-kit-artifact-coverage.test.mjs`, `tests/validator-isolation.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
