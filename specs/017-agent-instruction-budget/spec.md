# Feature Specification: Agent Instruction Budget and Spec Number Collisions

**Feature Branch**: `feat/agent-budget-spec-collisions`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.agent-instruction-budget`

**Lineage**: adopts two practices observed in open-mercato's `.ai/` tree (an `AGENTS.md` byte
budget enforced in CI with a shrink-only baseline, and the spec-number collisions that made
them abandon numbering) as deterministic DocGuard checks. Tracking issue #455.

**Input**: User description: "Instruction files silently exceed what agents load; parallel agents
create colliding spec numbers."

## Problem

Coding agents load project instructions under hard size limits. Codex concatenates `AGENTS.md`
files from the repository root down to the working directory and stops reading at 32 KiB by
default (`project_doc_max_bytes`). Text past the limit is dropped without warning. The rules
most likely to be cut are the most specific ones, because the nested files are appended last.
Nothing tells the maintainer that the instructions they wrote are not the instructions the
agent read.

Separately, when several agents create specs in parallel, each picks "the next number" from its
own checkout, and two features end up as `specs/016-a` and `specs/016-b`. Tools and people then
refer to "spec 016" ambiguously. open-mercato hit this often enough to abandon numbering
altogether.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know when an agent cannot read all instructions (Priority: P1)

**Independent Test**: A repository whose root `AGENTS.md` plus `packages/api/AGENTS.md` total
40 KiB produces a finding naming the chain, its size and the 32 KiB budget.

**Acceptance Scenarios**:

1. **Given** an instruction chain larger than the budget, **When** guard runs, **Then** a
   finding names the deepest file, the files in the chain, the byte total and the budget.
2. **Given** a chain within budget, **When** guard runs, **Then** the check passes.
3. **Given** `AGENTS.override.md` beside `AGENTS.md`, **When** the chain is measured, **Then**
   the override replaces that directory's file, as Codex does.

---

### User Story 2 - Freeze existing debt without letting it grow (Priority: P2)

A maintainer with an oversized chain declares an allowance for it. The chain may shrink but not
grow past the allowance. Every increase is a reviewed configuration change.

**Acceptance Scenarios**:

1. **Given** an allowance at least the chain's size, **When** guard runs, **Then** it passes.
2. **Given** the chain grows past its allowance, **When** guard runs, **Then** the finding
   reappears.
3. **Given** the chain shrinks well below its allowance, **When** guard runs, **Then** an
   informational finding suggests lowering the allowance so the ratchet stays tight.

---

### User Story 3 - Catch colliding spec numbers (Priority: P2)

**Independent Test**: `specs/016-a/` and `specs/016-b/` produce one finding naming both
directories.

**Acceptance Scenarios**:

1. **Given** two top-level feature directories with the same numeric prefix, **When** guard
   runs, **Then** a finding names both directories.
2. **Given** timestamp-prefixed feature directories, **When** guard runs, **Then** they never
   collide by number.

### Edge Cases

- Instruction files under ignored paths are not measured.
- `CLAUDE.md` has no documented hard load limit and is not measured. The budget targets the
  documented limit only.
- A `node_modules` or worktree copy of `AGENTS.md` is never measured.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Guard MUST measure every `AGENTS.md` chain (root to each directory that has an
  instruction file) in bytes, using `AGENTS.override.md` in place of `AGENTS.md` where present.
- **FR-002**: The budget MUST default to 32768 bytes and be configurable
  (`agentInstructions.maxBytes`).
- **FR-003**: A chain over its budget MUST produce a warning (`STR004`) naming the chain, its
  total and the budget. The finding is an escalation, because the reader decides what to move
  or cut.
- **FR-004**: Per-chain allowances (`agentInstructions.allowances`, keyed by the deepest file's
  path) MUST replace the budget for that chain. A chain at least 1024 bytes below its allowance
  MUST produce an informational `STR005` suggesting a lower allowance.
- **FR-005**: The Spec-Kit validator MUST report two or more top-level feature directories
  sharing a numeric prefix (`SPK012`), naming each directory.

### Key Entities

- **Instruction chain**: the ordered instruction files an agent loads for one working
  directory.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every chain over budget in the test matrix is reported, and none within budget
  is.
- **SC-002**: Growing an allowed chain by one byte past its allowance produces a finding.
- **SC-003**: This repository's chains are measured, and the result is recorded in the PR.
- **SC-004**: A duplicated spec number is reported once per number, naming every directory.

## Assumptions

- The budget models Codex, the agent with a documented hard limit. Other agents' limits can be
  expressed through `maxBytes`.
