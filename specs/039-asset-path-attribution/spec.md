# Feature Specification: Reviewed Asset Paths for Spec Reconciliation

**Feature Branch**: `feat/asset-path-attribution`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.asset-path-attribution`

**Lineage**:
- Extends `docguard.canonical-requirement-links`, which added a second way to
  trace a change to approved intent.
- Sits beside `docguard.as-built-specs`: its `sourcePaths` field is a reviewed
  scope list with a different meaning (the facts guard re-scans).
- Found while verifying specs 037 and 038: a maintenance completion of
  `docguard.agent-instruction-budget` was blocked by files that belong to
  `docguard.symbol-map`.

**Input**: User description: "Attribute frozen benchmark assets in spec
reconciliation." Maintainer decision (2026-09-30): a hand-reviewed
`reviewed.scope.assetPaths` list on the owning spec's registry entry.

## Problem

`docguard specs complete` classifies every file changed since the spec's last
reviewed revision. A source or test file is traced to a spec in two ways:
- it is part of that spec's recorded evidence;
- its changed text names a spec requirement.

Anything else is `unsupported_or_ambiguous`, and one such file blocks every
completion (SPC006).

Some files can't name their spec:
- Spec 036's benchmark fixtures (a 29-module sample project);
- its hidden evaluators and reference solutions.

Their bytes are pinned by digest in the frozen v2 protocol, so adding an
annotation breaks the protocol. Every living spec reviewed before 036 merged
(specs 014–035) now fails maintenance completion on those files, although no
one doubts which spec they belong to.

The same shape exists in any project: vendored snapshots, generated data,
recorded fixtures, golden files. The owner is known, but the file can't
carry a comment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A reviewed owner resolves a frozen file (Priority: P1)

A maintainer lists a spec's frozen directories under `reviewed.scope.assetPaths`
in the registry. Reconciliation traces a change under those paths to that
spec. A completion of any spec no longer stops on them.

**Acceptance Scenarios**:

1. **Given** spec A lists `bench/fixtures/sample/`, **When** a file under it
   changes, **Then** reconciliation links the change to A and does not report
   it as unsupported.
2. **Given** a file outside every asset path with no requirement identity,
   **Then** it is still unsupported, exactly as today.
3. **Given** an asset path naming one file (no trailing `/`), **Then** only that
   file is attributed, not files that share its prefix.
4. **Given** `docguard.agent-instruction-budget`'s maintenance completion in this
   repository, **When** spec 036 lists its frozen assets, **Then** the
   completion no longer reports them as unresolved.

### User Story 2 - A stale attribution is reported, not trusted (Priority: P1)

**Acceptance Scenarios**:

1. **Given** an asset path that matches no tracked file, **Then** guard reports
   `SPR009` naming the spec and the path.
2. **Given** an asset path that is absolute, contains `..`, or reaches into
   `.local`, **Then** the registry is invalid (`SPR003`), like any other
   reviewed path.
3. **Given** an asset path that contains a wildcard, **Then** the registry is
   invalid: an attribution is an exact list a person reviews.

### Edge Cases

- **Two specs list the same path:** the change links to both, as a file
  carrying two specs' annotations does.
- **A path is also in a spec's recorded evidence:** it links once.
- **`assetPaths` is absent:** the registry, its JSON and every output are
  byte-identical to today.
- **An asset path names a directory that contains source files annotated for
  another spec:** each file links to every spec that claims it; nothing is
  hidden.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The registry's reviewed scope MUST accept an optional
  `assetPaths` list of repository-relative paths. An entry ending in `/` names
  a directory and covers every file under it. Any other entry names one file.
  Absolute paths, `..`, `.local` and wildcards MUST make the registry invalid
  (SPR003). The list is kept sorted and unique.
- **FR-002**: Reconciliation MUST link a changed file to every spec whose
  `assetPaths` covers it, in addition to the existing evidence and
  requirement-identity links. Files covered by no asset path are classified
  exactly as before.
- **FR-003**: Guard MUST report `SPR009` for each asset path that matches no
  tracked file. The finding names the spec and the path; it is a warning with
  disposition `act` (remove or correct the path).
- **FR-004**: A registry without `assetPaths` MUST serialize, validate and
  reconcile byte-identically to today (`specs --write` rewrites nothing).
- **FR-005**: This repository's registry MUST list spec 036's frozen assets:
  - the `ledger-service` fixture;
  - the three `ledger-*` hidden evaluators;
  - the three `ledger-*` references.

  With those listed, the maintenance completion of
  `docguard.agent-instruction-budget` MUST report no unresolved changed files.
- **FR-006**: The registry schema (`schemas/docguard-specs.schema.json`),
  DATA-MODEL's registry field table, `docs/commands.md`'s `specs complete`
  section and the CHANGELOG MUST describe `assetPaths` and SPR009;
  `docguard explain SPR009` MUST explain it.

## Success Criteria *(mandatory)*

- **SC-001**:
  - With spec 036's assets listed, `specs complete --id
    docguard.agent-instruction-budget` no longer lists any `benchmarks/`
    file as unresolved.
  - Without them, it does (the test reproduces today's block).
- **SC-002**: A registry with no `assetPaths` is byte-identical after
  `specs --write`.
- **SC-003**: Every attribution is explicit: no glob, no inference from task
  text, no directory implied by another field.

## Assumptions

- Registry reviewed fields are edited by a person and reviewed in the pull
  request, as `canonicalDocs` and lifecycle states are today.
- "Tracked file" means a file git lists; outside git, files on disk count.

## Out of Scope

- Inferring ownership from task text or directory mentions (rejected: a
  context mention would claim unrelated changes).
- Reading DocGuard's own benchmark manifest format (rejected: it would help
  only this repository).
- Changing how attributed files are then classified (they follow the existing
  linked-file rules).

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `78b3b30dfb50f5eb49cba53a68fcf5825892b177` — Reviewed at 78b3b30 on main: all 8 tasks are checked and were delivered by #493, #495; the full suite (2444 tests) passes and guard reports 0 errors at this revision. #495 added the FR-006 docs test that completion required. Evidence: `cli/scanners/reconciliation.mjs`, `cli/scanners/spec-registry.mjs`, `cli/validators/spec-registry.mjs`, `docs-canonical/DATA-MODEL.md`, `tests/asset-path-attribution.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
