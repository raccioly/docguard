# Feature Specification: Compact Guard Response for Agents

**Feature Branch**: `feat/compact-guard-response`

**Created**: 2026-09-30

**Status**: Active

**Spec ID**: `docguard.compact-guard-response`

**Lineage**: #455 follow-up. `docguard.non-regression-budgets` measured the MCP
guard response and `docguard.mcp-doc-tools` found it is the largest
agent-facing output. This spec removes the copies inside it without dropping
any fact.

**Input**: User description: "The guard JSON repeats every finding up to three
times. Give agents a compact response by default and keep the full contract
one argument away."

## Problem

`docguard_guard` (MCP) returns the full guard JSON contract. On
`benchmarks/fixtures/sparse-doc-control` it is 47.8 KB, and the same facts
appear several times:

- `findings` lists every finding (9.1 KB).
- `reportable` lists the reportable subset again, whole (5.9 KB).
- `validators[].findings` lists every finding a third time (9.1 KB), beside
  `validators[].errors` and `warnings`, which repeat the messages.
- Every finding carries its code's precision `evidence` object, repeated for
  each finding with the same code, and also summarized in `precisionEvidence`.

About a third of the response is copies. An agent pays for every byte on every
guard call, and a long response pushes the findings it must act on out of its
attention.

The CLI's `guard --format json` output is a documented contract that CI scripts
parse. It must not change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An agent gets every fact once (Priority: P1)

An agent calls `docguard_guard` with no arguments. It receives each finding
once, each code's evidence once, and each validator's status and counts, in a
response at least 30% smaller than the full one on the fixture.

**Acceptance Scenarios**:

1. **Given** a guard run, **When** the compact form is built, **Then** every
   finding's code, validator, severity, effective severity, confidence,
   disposition, parser tier, message, location, suggestion and reportable flag
   is present exactly once.
2. **Given** several findings with one code, **Then** that code's evidence
   appears once, under `evidenceByCode`.
3. **Given** the validator list, **Then** each validator keeps its key, name,
   status, effective status, counts and applicability, without finding copies.
4. **Given** the compact form, **Then** status, counts, baseline figures,
   next step and coverage equal the full form's.

### User Story 2 - The full contract stays one argument away (Priority: P1)

1. **Given** `docguard_guard` with `detail: "full"`, **Then** the response is
   the full guard JSON contract, as today.
2. **Given** `docguard guard --format json`, **Then** the output is unchanged.
3. **Given** `docguard guard --format json --compact`, **Then** the output is
   the compact form.

### Edge Cases

- A finding whose enforcement came from configuration keeps its `enforcement`
  object; an intrinsic one, which the severity already states, drops it.
- `redactedContext` is dropped when it is null.
- A finding without a code (a legacy validator's plain message) keeps its
  message; no fact depends on a code being present.
- The compact form names itself (`detail: "compact"`) and says how to get the
  full one, so an agent that needs the full contract knows it exists.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `compactGuardResult(full)` MUST build the compact form from the
  full guard result without recomputing anything, so both forms always agree.
- **FR-002**: The compact form MUST contain every finding once, drop
  `reportable` (derivable from `findings[].reportable`), drop the finding
  arrays and message arrays from `validators[]` (keeping their counts), and
  move per-finding evidence to `evidenceByCode`, once per code. That evidence
  is the agent-facing view, which withholds a precision that is not quotable.
  The raw benchmark statistics per code (`precisionEvidence.codes`) stay in
  the full form only, so an agent is never handed an unquotable rate.
- **FR-003**: `docguard_guard` MUST return the compact form by default and the
  full contract with `detail: "full"`. Its input schema and description MUST
  say so.
- **FR-004**: `guard --format json` MUST be byte-for-byte unchanged apart from
  timings; `--compact` MUST select the compact form.
- **FR-005**: A reconstruction test MUST prove the compact form loses nothing:
  every finding field an agent acts on, every count, and every code's evidence
  can be read back and equals the full form's.
- **FR-006**: README, `docs/ai-integration.md`, `docs/commands.md` and the
  CHANGELOG MUST document the compact default and how to get the full contract.

## Success Criteria *(mandatory)*

- **SC-001**: The MCP guard response on `sparse-doc-control` is at least 30%
  smaller (the `bytes:mcp:docguard_guard:sparse-doc-control` budget row).
- **SC-002**: On this repository the compact response is at least 30% smaller
  than the full one.
- **SC-003**: The reconstruction test passes on this repository and on every
  benchmark fixture it runs against.

## Assumptions

- Agents read findings and counts; the per-validator finding copies and the
  `reportable` subset served people reading raw JSON, who keep them in the
  full form.
- MCP clients pass tool arguments through, so `detail: "full"` is always
  reachable.

## Out of Scope

- Changing the CLI's default JSON, SARIF or JUnit output.
- Changing which findings guard emits.
