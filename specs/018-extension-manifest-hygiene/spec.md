# Feature Specification: Extension Manifest Hygiene

**Feature Branch**: `fix/extension-manifest-hygiene`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.extension-manifest-hygiene`

**Lineage**: Constitution VII (the manifest is the authoritative declaration and MUST validate
against the upstream schema). Tracking issue #455.

**Input**: User description: "Bring DocGuard's Spec Kit extension manifest in line with current
upstream Spec Kit and make the catalog submission read it instead of repeating it."

## Problem

`extensions/spec-kit-docguard/extension.yml` passes upstream validation, but it tells Spec Kit
and adopters several things that are not true:

- It requires `speckit_version: ">=0.1.0"`, but it uses per-event hook lists with priorities
  (Spec Kit 0.10.0) and the `after_converge` event (0.11.2). An adopter on an older Spec Kit can
  install it, and its hooks then silently fail to register.
- It omits `extension.category` and `extension.effect`, first-class fields since 0.10.2 that
  the community catalog shows for DocGuard.
- The `before_specify` briefing has no priority, so whether it runs before or after the git
  extension creates a feature branch depends on authoring order. A blocked briefing can leave
  an empty branch behind.
- `requires.framework` and `provides.workflows` are not upstream fields. The second collides
  in name with Spec Kit's own workflow concept.
- `templates/extensions.yml` tells adopters to copy it to `.specify/extensions.yml`, but its
  shape is not what Spec Kit writes there (no `installed` or `settings`, and top-level keys
  Spec Kit does not use).
- The manifest lists 9 tags where Spec Kit's publishing guide allows 2–5. The catalog
  submission script therefore kept its own 5-tag list, along with its own copy of the Spec Kit
  floor and description, so the manifest and the catalog could disagree without anyone
  noticing.
- `commands/guard.md` promises "160+ automated checks", a count that drifts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install only where the hooks work (Priority: P1)

**Independent Test**: The manifest's Spec Kit floor is at least the newest version whose
features it uses, and a test derives that floor from the hook events and fields present.

**Acceptance Scenarios**:

1. **Given** the manifest uses `after_converge`, **When** the contract test runs, **Then** the
   declared floor is ≥ 0.11.2.

---

### User Story 2 - Predictable hook order (Priority: P2)

**Acceptance Scenarios**:

1. **Given** DocGuard and the git extension both hook `before_specify`, **When** Spec Kit
   orders hooks, **Then** DocGuard's briefing (explicit priority 5) runs before branch creation
   (default 10).

---

### User Story 3 - One source for catalog metadata (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a release, **When** the submission is built, **Then** its Spec Kit floor,
   description, category, effect and tags equal the manifest's.

### Edge Cases

- A manual install that copies `templates/extensions.yml` must produce a file Spec Kit
  recognizes, with hooks in the same order and optionality as the manifest.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The manifest MUST declare `requires.speckit_version: ">=0.11.2"` together with
  `extension.category: "docs"` and `extension.effect: "read-write"`.
- **FR-002**: Every DocGuard hook MUST declare an explicit priority. The `before_specify`
  briefing MUST use priority 5.
- **FR-003**: The manifest MUST NOT use non-schema keys under `requires` or `provides`. The
  GitHub workflow templates move to a DocGuard-namespaced top-level key.
- **FR-004**: `templates/extensions.yml` MUST have the shape Spec Kit writes to
  `.specify/extensions.yml` (`installed`, `settings`, `hooks` with `extension`, `command`,
  `enabled`, `optional`, `priority`), and a contract test MUST keep it equal to the
  manifest's hooks.
- **FR-005**: The manifest MUST carry 2–5 tags, and the catalog submission MUST read the Spec
  Kit floor, description, category, effect and tags from the manifest.
- **FR-006**: The extension's command documents MUST NOT state counts of checks, validators
  or skills.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A contract test fails if the manifest uses a hook event newer than its declared
  Spec Kit floor.
- **SC-002**: The submission's tags, floor and description differ from the manifest's in zero
  fields.
- **SC-003**: Registering the extension with `specify` 1.0.13 succeeds and lists `category`
  `docs`, `effect` `read-write`.

## Assumptions

- Adopters on Spec Kit older than 0.11.2 already cannot run DocGuard's init delegation
  (spec 014 requires ≥ 0.10.0). Raising the floor makes that visible at install time.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `dfa1385749b66184c93bf65f5dde127192037711` — Reviewed at dfa1385 on main: all 8 tasks are checked and were delivered by #463, #471; the full suite (2368 tests) passes and guard reports 0 errors at this revision. Deviations from the plan are recorded in the task notes. Evidence: `.github/scripts/speckit-submission.py`, `docs-canonical/TEST-SPEC.md`, `extensions/spec-kit-docguard/extension.yml`, `extensions/spec-kit-docguard/templates/extensions.yml`, `tests/catalog-submission.test.mjs`, `tests/hooks-contract.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
