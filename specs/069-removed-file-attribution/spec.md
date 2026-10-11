# Feature Specification: Removed Files Are Attributed to the Spec That Removes Them

**Feature Branch**: `fix/deleted-file-attribution`

**Created**: 2026-10-11

**Status**: Draft

**Spec ID**: `docguard.removed-file-attribution`

**Lineage**: Extends reconciliation attribution (`docguard.document-lifecycle`, spec 006) and reviewed asset paths (`docguard.asset-path-attribution`, spec 039). Found completing `docguard.jules-policy` (spec 067), whose FR-011 requires removing `.jules-setup.sh`.

**Input**: Completing specs 065–067 blocked on SPC006 for the deleted `.jules-setup.sh`, though spec 067 names its removal as a requirement.

## Problem

Reconciliation links a changed file to a spec when the file is the spec's recorded evidence, when its diff names one of the spec's requirements, or when the spec's reviewed `assetPaths` cover it. A deleted source or test file meets none of these: it is gone from the tree, so it is no spec's evidence; its diff holds only the removed lines; and an `assetPaths` entry for it covers no tracked file, which is SPR009. Every deleted source file is therefore "unsupported or ambiguous", and a spec whose work includes removing code can never be completed (SPC006), even when the spec names the removal as a requirement.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A spec that removes a file can be completed (Priority: P1)

1. **Given** a source file deleted in the reconciliation range, **and** a current, approved spec whose spec, plan or tasks name that exact path, **Then** reconciliation links the deletion to that spec and completion is not blocked by it.
2. **Given** the spec names a directory (`legacy/`) and the whole directory is removed, **Then** deletions under it are linked; a named directory that still exists claims nothing.

### User Story 2 - Naming a path is not a shortcut for evidence (Priority: P1)

1. **Given** a file that was changed or added, not deleted, and is named only in a spec's prose, **Then** it stays unresolved: it can still carry an annotation.
2. **Given** a deleted file named only by a spec that is not current or not approved, **Then** it stays unresolved.
3. **Given** a spec naming `scripts/old.sh` and `legacy/`, **When** `scripts/old.sh.mjs`, `x/scripts/old.sh` or `legacy-two/b.mjs` is deleted, **Then** none is linked.

## Requirements *(mandatory)*

- **FR-001**: A file deleted in the reconciliation range that no evidence, requirement reference or asset path links MUST be linked to every current, approved spec whose Spec Kit artifacts (`spec.md`, `plan.md`, `tasks.md` and the spec's other artifact files) name that path as a whole token, or name, with a trailing `/`, a directory containing it that no longer exists.
- **FR-002**: The rule MUST apply only to deleted files. A modified, added, renamed-to or copied-to path MUST keep today's attribution.
- **FR-003**: A path named only by a spec that is not current or not approved MUST NOT link, and a name MUST match the whole path: no prefix, suffix or substring match.
- **FR-004**: The reconciliation documentation and the SPC006 help MUST say that a removed file is attributed by naming it in the spec that removes it.

## Success Criteria *(mandatory)*

- **SC-001**: The User Story 1 cases fail before the change and pass after; the User Story 2 cases pass before and after, guarding behaviour that must not change.
- **SC-002**: The full suite and guard pass, and `docguard specs complete --id docguard.jules-policy` is no longer blocked by `.jules-setup.sh`.

## Out of Scope

- Linking a deleted file to the spec whose evidence it was at the base revision. That needs the registry as it stood at the base; naming the removal is the reviewed signal.
