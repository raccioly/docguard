# Feature Specification: Fixes From Dogfooding Real Repositories

**Feature Branch**: `fix/dogfood-findings`

**Created**: 2026-10-01

**Status**: Draft

**Spec ID**: `docguard.dogfood-findings`

**Lineage**: Found by running the v0.43.0 candidate against clones of ten real repositories (Next.js, Express, Python, mixed, and projects without DocGuard docs), compared with v0.42.1. Related: `docguard.js-ts-extraction` (045), whose better model discovery exposed the SCH001 gap.

**Input**: "Validate the release against other repositories and verify everything we claim."

## Problem

Three defects appeared on real repositories:

1. `docguard score` and `docguard fix` crash with `config.requiredFiles.agentFile.some is not a function` when `.docguard.json` sets `requiredFiles.agentFile` to a string. The config schema allows a string ("Agent rule file(s)… Array means any one suffices"). v0.42.1 has the same crash.
2. Schema-Sync reports SCH001 "no DATA-MODEL.md exists" on a project whose DATA-MODEL.md is nested (`docs-canonical/03-architecture/DATA-MODEL.md`) and listed in `requiredFiles.canonical`. A document role resolves only to its default path or an explicit `docs.roles` mapping. v0.42.1 found no models on that project, so the gap was hidden.
3. Metrics-Consistency (MET004) reads a scoring-table row `| Dependencies | 5 | | |` under a `Max Points` column as "claims 5 runtime dependencies".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A string agent file works everywhere (Priority: P1)

1. **Given** `requiredFiles.agentFile: "AGENTS.md"`, **When** `score`, `score --format json` and `fix` run, **Then** none crashes, and an existing AGENTS.md counts as the agent file.

### User Story 2 - A nested canonical doc fills its role (Priority: P1)

1. **Given** no `docs.roles` mapping, a missing `docs-canonical/DATA-MODEL.md`, and exactly one canonical file named `DATA-MODEL.md` elsewhere under the canonical docs (listed in `requiredFiles.canonical` or found under the canonical directory), **Then** the dataModel role resolves to it and SCH001 does not fire.
2. **Given** two nested files with the role's name, **Then** the role is ambiguous and resolves to the default path (no guess).
3. **Given** an explicit `docs.roles` mapping, **Then** it wins, as today.

### User Story 3 - A dependency count is read only where it is one (Priority: P1)

1. **Given** a table row `| Dependencies | 5 |` whose second column header is not a count (`Max Points`, `Score`, `Weight`), **Then** MET004 ignores it.
2. **Given** a table whose second column header is a count (`Count`, `Value`, `Total`, `Number`, `#`), or a non-table line `Dependencies: 5`, **Then** MET004 still compares it with package.json.

## Requirements *(mandatory)*

- **FR-001**: Config loading MUST normalize `requiredFiles.agentFile` to an array (a string becomes a one-element array) so every reader gets one shape.
- **FR-002**: `resolveDocRole` MUST, when the role has no explicit mapping and its default path does not exist, resolve to the single canonical document whose file name equals the role's default file name; with zero or several, it MUST return the default path.
- **FR-003**: MET004 MUST read a `Dependencies` table row only when the table's header names that column as a count; non-table label lines keep today's behaviour.
- **FR-004**: The CHANGELOG MUST describe the fixes.
- **FR-005**: MET004 MUST treat "N external dependencies" as a package count only when the line names software (npm, package, runtime, library, install, …); "zero/no/none external dependencies" and the other qualifiers (runtime, production, npm, package, third-party) keep today's behaviour, except that "no/zero/none … dependency" in the singular describes a change, not the package, and is ignored. (Found on the second dogfood pass: "2 External Dependencies" in a transition-plan template.)
- **FR-006**: MET003 MUST compare "N tests" with the suite only when the line is about today's whole suite: not pinned to a commit SHA, not a subset (frontend, backend, unit, integration, e2e, …), and not in a Spec Kit artifact under `specs/` or a file named for a date. (Found on the second dogfood pass: "49 frontend files (606 tests) pass on `9c55dac6`", a feature's `research.md`, and a dated remediation plan.)

## Success Criteria *(mandatory)*

- **SC-001**: On the reproduction fixtures, `score --format json` and `fix` exit normally with a string agent file; SCH001 is silent for a nested DATA-MODEL.md; MET004 is silent for a scoring table and still fires for a count table.
- **SC-002**: The full suite passes, and guard on this repository is unchanged.

## Out of Scope

- Role resolution for documents outside the canonical directory set.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `d17dee0a5924795582cae3b0fcd97bfdbad93c76` — Reviewed at d17dee0 on main: all 5 tasks are checked and were delivered by #507; the full suite (2909 tests) passes and guard reports 0 errors at this revision. Evidence: `cli/shared-doc-roles.mjs`, `cli/validators/metrics-consistency.mjs`, `docs-canonical/DATA-MODEL.md`, `tests/dogfood-findings.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
