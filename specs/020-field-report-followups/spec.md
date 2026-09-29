# Feature Specification: Field Report Follow-ups

**Feature Branch**: `fix/field-report-followups`

**Created**: 2026-09-29

**Status**: Draft

**Spec ID**: `docguard.field-report-followups`

**Lineage**: completes the remaining acceptance criteria of issues #438, #437 and #436, which
9e14124 (#441) mostly resolved, and fixes #454. Triaged under #455.

**Input**: User description: "Loop the open GitHub issues into the spec workflow: close what is
done, finish what is partial."

## Problem

- **#438.** The claims-unverified badge disappears whenever the claim count is unknown. That
  is always the case under `--changed-only`, and after an extraction error. The pass badge then
  stands alone, which is the exact surface the issue asked to fix. No test protects the two
  honesty lines ("…do not establish factual accuracy", "…configured gates passed…"), and the
  issue asked for that explicitly.
- **#437.** The baseline line reports age, still-suppressed count and stale entries, but not
  what is suppressed. Nine suppressed errors and nine suppressed warnings read the same.
- **#436.** The schema-upgrade nudge prints on every non-JSON guard run. Before #441 it could
  not be cleared, because `upgrade --apply` aborted on a failed global install before migrating
  the schema. #441 moved the migration first, but no test covers that path, so the nudge could
  silently become permanent again.
- **#454.** In a husky, lefthook or simple-git-hooks repository, `docguard hooks` finds the
  manager's dispatcher and advises "re-run with --force". Following that advice replaces the
  dispatcher and silently disables every hook the manager runs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The claims caveat always travels with the pass badge (#438, P1)

**Acceptance Scenarios**:

1. **Given** `guard --changed-only`, **When** the badge prints, **Then** it includes
   `claims_unverified-unknown-lightgrey`.
2. **Given** any passing run, **Then** the output contains both honesty lines, and they print
   before the upgrade and pin nudges.

### User Story 2 - See what the baseline hides (#437, P2)

**Acceptance Scenarios**:

1. **Given** a baseline suppressing 2 errors and 1 warning, **When** guard runs, **Then** the
   baseline line reads `2 error · 1 warning`, and the JSON carries
   `baselineBySeverity: { error: 2, warn: 1, info: 0 }`, whose values sum to
   `baselineSuppressed`.

### User Story 3 - A nudge that can always be cleared (#436, P2)

**Acceptance Scenarios**:

1. **Given** a schema behind the current version and a CLI install that fails, **When**
   `upgrade --apply` runs, **Then** `.docguard.json` is migrated, the exit code is 1, and the
   next guard run prints no upgrade nudge.

### User Story 4 - Never advise disabling a hook manager (#454, P1)

**Acceptance Scenarios**:

1. **Given** `core.hooksPath` at `.husky/_` holding husky's dispatcher, **When**
   `docguard hooks --type pre-commit` runs, **Then** the output names `.husky/pre-commit`, gives
   the line to add, and does not mention `--force`.
2. **Given** the same repository with `--force`, **When** the command runs, **Then** the
   dispatcher's bytes are unchanged.
3. **Given** lefthook or simple-git-hooks, **Then** the guidance names that manager's
   configuration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The guard badge line MUST include a claims badge whose value is the count, or
  `unknown` when the count is null.
- **FR-002**: Guard's JSON MUST include `baselineBySeverity`, and the human baseline line MUST
  show the split.
- **FR-003**: `upgrade --apply` MUST migrate the schema even when the CLI install fails, so the
  schema-upgrade nudge can always be cleared by the command it names.
- **FR-004**: `docguard hooks` MUST detect husky, lefthook and simple-git-hooks. When one
  manages the target hook, it MUST NOT suggest `--force`, MUST refuse to overwrite even with
  `--force`, and MUST print the line to add and where to add it.
- **FR-005**: Regression tests MUST cover the honesty lines and their position, the
  `--changed-only` claims badge, the baseline split, the upgrade path whose install fails, and the husky reproduction from #454.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: #454's reproduction leaves `.husky/_/pre-commit` byte-identical, with and without
  `--force`.
- **SC-002**: No guard run prints a pass badge without a claims badge beside it.
- **SC-003**: Issues #438, #437, #436 and #454 can be closed citing these tests.

## Assumptions

- Per-entry triage state and budgets for the baseline (#437 criteria 3–4) change the baseline
  file format. They overlap #420 (claimspec baseline) and stay with that decision.
- The nudge keeps printing while the schema is behind. Once it can always be cleared, hiding
  it behind `--verbose` would leave most projects on an old schema without their knowing.
  The schema is `0.x`, so a "major version behind" rule would never fire.
- #454's optional `--husky` flag, which would write to a tracked file, needs a maintainer
  decision and is not included. Printed guidance covers the need without writing.
