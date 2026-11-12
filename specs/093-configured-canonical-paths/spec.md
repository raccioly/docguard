# Feature Specification: Score and Section Checks Read the Canonical Documents the Configuration Names

**Feature Branch**: `maint/2026-11-11`

**Created**: 2026-11-11

**Status**: Draft

**Spec ID**: `docguard.configured-canonical-paths`

**Lineage**: Corrects one defect reported against 0.47.0 (issue 625) and closes the open half of issue 619.
- It applies the role resolution of `docguard.dogfood-findings` (FR-002), which already finds the one same-named document in `requiredFiles.canonical`, to the two readers that bypassed it: docQuality in `score`, and the section checks STR003 and STR007.
- It keeps the single section registry of `docguard.authoring-contract` (FR-002): `score` and guard read the same document.
- It re-pins the claimspec schemas vendored by `docguard.ignore-reasons` (FR-009) to the TestGuard release that ships the evidence fields `docguard.requirement-anchors` FR-045 and FR-046 read.

**Input**: Issue 625, with a reproduction against the installed 0.47.0 package, and the pending schema re-pin of issue 619.

1. A project lists its five canonical documents under `docs/canonical/` in `requiredFiles.canonical`. `docguard score` gives Structure 100%, but docQuality says every document is "file missing" and scores 0%. ALCOA+ Original says "No docs-canonical/ directory found" and Available says "No docs directory found".
2. TestGuard v0.22.0 and v0.22.1 ship `inputs.dependencyHashes`, `inputs.dependencyClosure` and `run.claimsSource`. DocGuard's vendored claimspec schemas are still those of v0.18.3.

## Problem

- **Two readers bypass the resolver.** `resolveDocRole` reads an explicit `docs.roles` mapping, then the default path, then the one same-named document in `requiredFiles.canonical` or the canonical tree. The testing, security, environment and architecture score categories use it. docQuality and the section checks use `remapDocPath`, which knows only `docs.roles`. For the #625 layout they look for `docs-canonical/ARCHITECTURE.md`, find nothing, and either count the document as missing (docQuality) or skip it (STR003, STR007).
- **ALCOA+ reads only the canonical directory.** Original and Available test whether `docs-canonical/` exists. Attributable and Contemporaneous read the documents in that directory, so for the #625 layout Contemporaneous passes after checking nothing.
- **A suggestion names a path.** The docQuality suggestion built `docguard fix --doc` from the path with `docs-canonical/` removed, so a relocated document produced `--doc docs/canonical/architecture`, which `fix` does not accept.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The score reads the documents the configuration lists (Priority: P1)

**Independent Test**: The #625 reproduction: five complete documents under `docs/canonical/`, listed in `requiredFiles.canonical`, no `docs-canonical/` directory.

**Acceptance Scenarios**:

1. **Given** the #625 layout, **Then** docQuality is above 0 and equals the score the same documents get under `docs-canonical/`.
2. **Given** the #625 layout with an incomplete ARCHITECTURE.md, **Then** the suggestion does not say "file missing" and names `docguard fix --doc architecture`.
3. **Given** the #625 layout, **Then** ALCOA+ Original and Available are met.
4. **Given** the #625 layout with one document last modified 40 days ago, **Then** ALCOA+ Contemporaneous is a gap.
5. **Given** a project with no canonical document anywhere, **Then** Original is still a gap.

### User Story 2 - Guard checks the sections of those documents (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the #625 layout with an ARCHITECTURE.md that lacks its required sections, **Then** STR003 is reported for `docs/canonical/ARCHITECTURE.md`.
2. **Given** the #625 layout with complete documents, **Then** there is no STR003.

### User Story 3 - Existing layouts are unchanged (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the default `docs-canonical/` layout, **Then** docQuality, ALCOA+ and STR003 behave as before.
2. **Given** an explicit `docs.roles.architecture` mapping and an incomplete same-named document in `requiredFiles.canonical`, **Then** the mapping wins.
3. **Given** two same-named documents in `requiredFiles.canonical`, **Then** the role is ambiguous and keeps its default path, as `resolveDocRole` already decides.

### User Story 4 - The vendored schemas match the TestGuard release DocGuard reads (Priority: P2)

**Acceptance Scenarios**:

1. **Given** the vendored schemas, **Then** they are byte-identical to TestGuard v0.22.1 and the recorded revision and hashes say so.
2. **Given** a `path` ignore entry, the only kind `ignore --format claimspec` writes, **Then** it validates.
3. **Given** the vendored common schema, **Then** `claimsSource` requires `external: true` and `sha256`, the shape the evidence adapter reads.

### Edge Cases

- A mapped role path that is a symlink still fails `resolveDocRole`. The section checks then read the pure mapping, as they did before, and do not throw.
- A `requiredFiles.canonical` entry that is not Markdown, does not exist, or resolves outside the project is not counted by ALCOA+.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: docQuality MUST read each role's document from the path `resolveDocRole` resolves: an explicit `docs.roles` mapping, the default path, or the one same-named document in `requiredFiles.canonical` or the canonical tree.
- **FR-002**: STR003 and STR007 MUST read the same path as FR-001.
- **FR-003**: ALCOA+ MUST read the canonical documents as the canonical tree plus every existing Markdown entry of `requiredFiles.canonical` inside the project. Original and Available MUST be met when that set is not empty or the canonical directory exists. Attributable and Contemporaneous MUST read that set.
- **FR-004**: The docQuality suggestion and its `fix --doc` argument MUST name the document by file name and role, never by a relocated path.
- **FR-005**: The default layout, an explicit `docs.roles` mapping and an ambiguous pair of same-named documents MUST behave as before.
- **FR-006**: `schemas/claimspec/v1/` MUST be byte-identical to TestGuard v0.22.1, with `CLAIMSPEC_VENDOR` recording that release, its commit and the file hashes. The exported `path` entries MUST still validate.
- **FR-007**: `cli/findings.mjs` (STR003), `docs/reference/findings.md`, the canonical ARCHITECTURE and DATA-MODEL documents and `CHANGELOG.md` MUST describe the new behavior.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each of FR-001 to FR-004 has a test that fails on 0.47.0 and passes after, with positive controls for FR-005.
- **SC-002**: A guard and score A/B (0.47.0 against this change), on this repository and every other local project, from one fresh `git clone --local` per CLI, run serially, changes only findings and scores that FR-001 to FR-004 explain. Every change is reviewed by hand.
- **SC-003**: The #625 reproduction scores docQuality above 0 with no "file missing" and ALCOA+ Original and Available met.

## Assumptions

- A relocated document missing a section now gets STR003 where it got nothing. That is a new warning on projects with this layout, and it is the check the configuration asked for.
- The re-pin changes no DocGuard output: DocGuard exports only `path` entries, and the evidence adapter checks its fields by hand rather than through these schemas.

## Out of Scope

- Changing `listCanonicalDocs`, which many validators share. ALCOA+ adds the configured entries locally.
- Validating TestGuard evidence documents against the vendored evidence schema.
