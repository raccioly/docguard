# Feature Specification: Adoption Workflow Integrity

**Status**: Active
**Spec ID**: `docguard.adoption-workflow-integrity`
**Created**: 2026-09-15
**Owner**: DocGuard maintainers

## Problem

DocGuard's component tests can pass while a newly installed adopter follows a
reasonable setup prompt and receives a false success, an impossible remediation,
a broken package link, or a claim that an unrelated hook belongs to DocGuard.
The product boundary is the complete installed workflow: detect the repository,
explain each finding, perform the proposed action, and verify the result. A
successful subprocess or a high structural score does not prove that workflow is
correct.

## User Scenarios & Testing

### US1 — Trust a fresh installation

As an adopter, I can install the packed release and follow its README and CLI
remediation without encountering missing files, `undefined` text, or commands
that cannot resolve the reported state.

### US2 — Distinguish findings from policy

As an enterprise owner, I can tune one stable finding code without weakening an
entire validator, while audit outputs preserve the detector's original severity
and disclose the effective enforcement policy.

### US3 — Avoid false success

As a reviewer, I see an explicit incomplete or blocked result when Git history,
diff inventory, lifecycle evidence, or instruction pointers cannot be evaluated
completely. A structural maturity grade is labeled separately from readiness.

## Functional Requirements

- **FR-001**: Release tests MUST exercise the packed package through the same
  `init → inspect → remediate → verify` path used by adopter agents, including
  pre-existing hooks and partially configured repositories.
- **FR-002**: Every structured suggestion MUST contain a supported kind and
  non-empty text. Renderers MUST omit malformed suggestions rather than print
  `undefined`, and regression tests MUST cover each built-in suggestion shape.
- **FR-003**: Hook inspection and removal MUST distinguish DocGuard-managed,
  recognized legacy, foreign, missing, and unreadable hooks. Removal MUST retain
  foreign commands surrounding a managed DocGuard block.
- **FR-004**: Reconciliation MUST obtain changed-path inventory independently
  from bounded patch text. Timeout, overflow, parse failure, or incomplete
  inventory MUST block a complete/ready claim and disclose coverage.
- **FR-005**: Instruction pointers MUST resolve exact safe repository-relative
  paths or one unique basename. Ambiguous, unsafe, missing, incomplete-index,
  and symlink cases MUST remain distinguishable and fail closed.
- **FR-006**: A requirement in a planned specification MAY defer TRC004 only
  when a committed, clean schema-v2 registry matches the committed spec path,
  immutable ID, current digest, working-tree storage, and current lifecycle
  context. Unknown or mutable lifecycle evidence MUST keep the requirement
  applicable.
- **FR-007**: `.docguard.json` MUST support exact stable-code enforcement through
  `findingSeverity`. Exact code policy takes precedence over validator policy;
  intrinsic errors remain blocking unless that exact code is configured.
- **FR-008**: Guard JSON, SARIF, and JUnit MUST retain intrinsic severity and
  disclose effective severity and policy source. Human output MUST show every
  finding even when its CI enforcement is informational.
- **FR-009**: CI, diagnose, and report MUST expose a combined readiness
  assessment derived from guard status and configured score gates. Standalone
  score output MUST identify itself as structural maturity and state that it is
  not a guard verdict.
- **FR-010**: Every relative link in the README shipped to npm MUST resolve
  inside the package. Repository-only material MUST use an absolute durable URL.
- **FR-011**: Evidence adapters MUST use bounded, deterministic parsing without
  shell execution. Unsupported dynamic syntax MUST return inconclusive coverage
  rather than an incorrect value.
- **FR-012**: A release candidate MUST be replayed read-only against the reported
  JavaScript/web and Python adopter repositories, with disposable artifacts
  removed, before publication.

## Success Criteria

- **SC-001**: The exact adopter prompt is represented by an end-to-end packed
  workflow test containing foreign-hook, invalid-remediation, and package-link
  controls.
- **SC-002**: Diff overflow and timeout fixtures cannot produce a ready
  reconciliation result.
- **SC-003**: Unique, ambiguous, unsafe, missing, symlink, and incomplete
  instruction-pointer fixtures produce distinct deterministic outcomes.
- **SC-004**: Planned lifecycle deferral passes only with trusted immutable
  evidence; dirty or in-progress controls still require traceability.
- **SC-005**: Exact-code promotion and demotion agree across guard exit code,
  JSON, human output, SARIF, and JUnit.
- **SC-006**: Full tests, frozen precision benchmark, self-guard, package smoke,
  and read-only adopter replays pass without a new supported-case regression.

## Non-Goals

- Treating a high structural score as proof that arbitrary prose is factual.
- Rewriting approved requirements to match current code automatically.
- Claiming support for dynamic language expressions that the bounded parser
  cannot prove.
- Editing adopter repositories during release qualification.
