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
- **FR-013**: JavaScript route discovery MUST reject chained HTTP-client calls,
  filter non-product evidence before deduplication, resolve bounded static path
  constants, and compose pathless or prefixed Express mounts across imported
  router symbols. Unsupported dynamic mounts MUST remain uncertain rather than
  manufacturing a route.
- **FR-014**: An authoritative-contract omission MAY establish that prose and
  OpenAPI disagree, but negative route-scan evidence MUST NOT establish runtime
  absence or authorize documentation deletion. Force flags MUST preserve this
  evidence boundary.
- **FR-015**: Release qualification MUST replay known warning classes and retain
  their evidence context: historical metrics, multiline skip reasons, repeated
  test fixtures, package-local environment templates, configured OpenAPI
  authority, normalized route parameters, service roots, and config-schema
  parity.

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
- **SC-007**: Paired fixtures prove test requests cannot hide or invent a product
  route, conventional test-helper trees are excluded, and nested imported
  routers resolve to their complete static path.
- **SC-008**: API004 never emits or applies a deletion from negative code-scan
  evidence; implemented, unknown, and not-extracted neighboring cases remain
  distinct and redacted.
- **SC-009**: Paired synthetic replicas contain none of the confirmed MET001,
  TDO001, DSY002, DSY003, SEC001-blocker, schema-parity, or package-local
  environment false positives; disposable Websec and WhatsApp replays confirm
  the same boundaries before release.

## Non-Goals

- Treating a high structural score as proof that arbitrary prose is factual.
- Rewriting approved requirements to match current code automatically.
- Claiming support for dynamic language expressions that the bounded parser
  cannot prove.
- Editing adopter repositories during release qualification.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `c283d1b70985858db2468667e60a9f772642b1a2` — Verified v0.41.0 adoption workflow integrity: PR #395 merged at f925e40; release PR #396 passed approved CI and supply-chain checks, merged at 7ec6356, and publication run 34989969217 completed npm, PyPI, GHCR, GitHub Release, extension ZIP, MCPB, and catalog sync with no accepted deviations. Evidence: `cli/assessment.mjs`, `cli/commands/hooks.mjs`, `cli/evidence/python-literal.mjs`, `cli/findings.mjs`, `cli/scanners/instruction-audit.mjs`, `cli/scanners/routes.mjs`, `cli/shared-git.mjs`, `cli/shared.mjs`, `cli/validators/traceability.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/REQUIREMENTS.md`, `docs-canonical/SECURITY.md`, `docs-canonical/TEST-SPEC.md`, `tests/adoption-workflow.test.mjs`, `tests/api-authority-precision.test.mjs`, `tests/api-write.test.mjs`, `tests/assessment.test.mjs`, `tests/doc-role-boundaries.test.mjs`, `tests/docguard-config-schema.test.mjs`, `tests/docs-sync.test.mjs`, `tests/environment.test.mjs`, `tests/evidence-python-literal.test.mjs`, `tests/field-context-precision.test.mjs`, `tests/finding-severity-config.test.mjs`, `tests/instruction-audit.test.mjs`, `tests/metrics-consistency.test.mjs`, `tests/npm-pack-smoke.test.mjs`, `tests/reconcile.test.mjs`, `tests/routes-express-mounts.test.mjs`, `tests/severity.test.mjs`, `tests/todo-tracking.test.mjs`, `tests/traceability-lifecycle.test.mjs`. Accepted deviations: none. Successor: none.
- `2ff1baaefdebfc1dd7ef2d9c5e6d1f584f8af9bb` — Durable post-merge review at 2ff1baa: taskless living-spec completion, R9 release evidence, and status-preserving maintenance passed complete reconciliation, self-guard, 1,866 tests, Node 18/20/22/24 CI, and OSV with no accepted deviations. Evidence: `cli/assessment.mjs`, `cli/commands/hooks.mjs`, `cli/evidence/python-literal.mjs`, `cli/findings.mjs`, `cli/scanners/instruction-audit.mjs`, `cli/scanners/routes.mjs`, `cli/shared-git.mjs`, `cli/shared.mjs`, `cli/validators/traceability.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/REQUIREMENTS.md`, `docs-canonical/SECURITY.md`, `docs-canonical/TEST-SPEC.md`, `tests/adoption-workflow.test.mjs`, `tests/api-authority-precision.test.mjs`, `tests/api-write.test.mjs`, `tests/assessment.test.mjs`, `tests/doc-role-boundaries.test.mjs`, `tests/docguard-config-schema.test.mjs`, `tests/docs-sync.test.mjs`, `tests/environment.test.mjs`, `tests/evidence-python-literal.test.mjs`, `tests/field-context-precision.test.mjs`, `tests/finding-severity-config.test.mjs`, `tests/instruction-audit.test.mjs`, `tests/metrics-consistency.test.mjs`, `tests/npm-pack-smoke.test.mjs`, `tests/reconcile.test.mjs`, `tests/routes-express-mounts.test.mjs`, `tests/severity.test.mjs`, `tests/todo-tracking.test.mjs`, `tests/traceability-lifecycle.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
