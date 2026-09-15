# Requirements

<!-- docguard:quality negation-load off — requirements define explicit failure and non-disclosure boundaries -->
<!-- docguard:version 0.6.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-09-15 -->

## Functional Requirements

| ID | Priority | Requirement | Verification |
|---|---|---|---|
| FR-001 | P1 | Score distinguishes structural maturity from unverified factual accuracy, even when candidate extraction finds nothing. | tests/score-assurance.test.mjs |
| FR-002 | P1 | Users can dispute any active finding, preview feedback, and prepare public metadata without sharing source-derived strings automatically. | tests/feedback-contributions.test.mjs |
| FR-003 | P1 | CI, diagnose, and report preserve score assurance limits in machine output. Existing score thresholds keep their numeric meaning. | tests/score-assurance.test.mjs |
| FR-004 | P1 | Detector quality is measured with independently labelled defect/control pairs, split-safe repository groups, explicit unsupported coverage, null-safe metrics, confidence limits, and case-first baseline comparison. | tests/benchmark-manifest.test.mjs, tests/benchmark-metrics.test.mjs, tests/benchmark-runner.test.mjs |
| FR-005 | P1 | Users can turn a false positive, false negative, unsupported syntax case, ambiguity, or policy dispute into a redaction-attested synthetic fixture with an opposite control, deterministic reduction, duplicate search, and optional test-only contribution. | tests/feedback-fixture.test.mjs, tests/feedback-contributions.test.mjs |
| FR-006 | P1 | Teams can bind an exact Markdown statement to safe, local, typed evidence and receive scoped verified, contradicted, stale, inconclusive, or unsupported results through verify, guard, and agent assurance without granting whole-document accuracy. Direct verification must fail CI on contradiction or invalid input and distinguish unresolved evidence with the warning exit status. | tests/evidence-manifest.test.mjs, tests/evidence-adapters.test.mjs, tests/evidence-integration.test.mjs |
| FR-007 | P1 | An agent can request a deterministic bounded task-context packet that prioritizes exact current evidence, excludes retired and unsafe material, preserves retrieval-only assurance, and abstains rather than returning weak matches. Existing task-graph behavior remains compatible. | tests/task-context.test.mjs, tests/agent-context-benchmark.test.mjs |
| FR-008 | P1 | The packed-package adoption journey distinguishes foreign hooks, composes one self-repairing managed block with user hook commands, emits complete remediation text, explains deterministic registry drift by field, follows proposed actions, and verifies the resulting state. | tests/adoption-workflow.test.mjs, tests/hooks.test.mjs, tests/hooks-contract.test.mjs, tests/spec-registry.test.mjs, tests/npm-pack-smoke.test.mjs |
| FR-009 | P1 | Reconciliation keeps changed-path inventory independent from bounded patch text and reports partial coverage instead of a ready result after timeout, overflow, or Git failure. | tests/shared-git.test.mjs, tests/reconcile.test.mjs |
| FR-010 | P1 | Instruction pointers resolve only safe exact paths or one unique basename; Git-ignored paths and nested Git checkouts are excluded from basename evidence, while ambiguity, symlinks, unsafe paths, and incomplete indexes remain explicit. | tests/instruction-audit.test.mjs |
| FR-011 | P1 | Planned requirements defer test traceability only when committed, clean, digest-current schema-v2 lifecycle evidence proves they remain planned. A structurally current registry that is new, removed from the Git index, or modified pending commit remains non-authoritative and explains restore-or-commit remediation without recommending artificial test markers. | tests/traceability-lifecycle.test.mjs |
| FR-012 | P1 | Exact finding-code policy can promote or demote one finding without weakening its validator, while intrinsic and effective severity remain visible in machine formats. | tests/severity.test.mjs, tests/sarif.test.mjs, tests/junit.test.mjs |
| FR-013 | P1 | CI, diagnose, and report expose combined READY, ATTENTION, or BLOCKED assessment while standalone score remains structural maturity rather than a guard verdict. | tests/assessment.test.mjs |
| FR-014 | P1 | Python collection-size evidence uses bounded non-executable static literal parsing and abstains on dynamic or ambiguous syntax. | tests/evidence-python-literal.test.mjs, tests/evidence-integration.test.mjs |
| FR-015 | P1 | JavaScript route discovery excludes HTTP-client calls and non-product helpers before deduplication, and composes static Express mounts across imported routers. | tests/js-ast.test.mjs, tests/routes-express-mounts.test.mjs |
| FR-016 | P1 | API contract omissions remain review-only because negative route extraction cannot prove runtime absence or authorize deletion. | tests/api-authority-precision.test.mjs, tests/api-write.test.mjs, tests/doc-role-boundaries.test.mjs |
| FR-017 | P1 | Field warning precision preserves historical prose, multiline skip reasons, test-fixture context, package-local capability counts, package-local env templates, authoritative OpenAPI selection, route-parameter equivalence, service boundaries, and runtime/schema parity. | tests/metrics-consistency.test.mjs, tests/todo-tracking.test.mjs, tests/field-context-precision.test.mjs, tests/environment.test.mjs, tests/docs-sync.test.mjs, tests/docguard-config-schema.test.mjs |

## Non-Functional Requirements

| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-001 | Security | Untrusted input passed to subprocesses uses argv-based invocation and validation appropriate to the command. | tests/security-init-injection.test.mjs |
| NFR-002 | Portability | The distributed CLI runs on supported Node versions. Babel supplies the full JS/TS tier; the CLI retains a regex fallback when the parser is absent. | tests/npm-pack-smoke.test.mjs |
| NFR-003 | Correctness | Cached memory plans invalidate when relevant working-tree inputs, configuration, or scanner implementation change. Unreadable or unsupported cache inputs cause a miss. | tests/plan-disk-cache.test.mjs |
| NFR-004 | Distribution integrity | Every relative README link in the npm artifact resolves inside that artifact; repository-only material uses an absolute URL. | tests/npm-pack-smoke.test.mjs |

## Success Criteria

The full supported-runtime test matrix and guard determine local release readiness. The reviewed benchmark records observed detector precision and recall with explicit coverage limits; its finite confidence interval is not universal accuracy. The frozen R7 evaluation supports opt-in task context through equal measured correctness, 50% fewer median steps, and 17% lower median latency against context packs. It also recorded 80% more median uncached input and does not establish universal agent productivity.

## User Scenarios

A developer edits a source file without committing. The next memory plan reflects that change. An adopter upgrades DocGuard in an existing repository and can inspect hooks, follow every proposed remediation, and verify the result without hidden initialization. An agent requests context for one qualified requirement and receives current hashed excerpts and linked tests, or an explicit abstention. The agent inspects a high structural grade and sees the separate readiness verdict and that factual accuracy remains unverified. A contributor challenges a confident finding, previews a metadata-only report, checks existing work, and supplies a synthetic regression example voluntarily.

## Traceability Matrix

The verification column above links each requirement to executable tests. The tests carry explicit requirement annotations. Fixture content and example IDs cannot satisfy a real requirement.

## Revision History

| Version | Date | Changes |
|---|---|---|
| 0.6.0 | 2026-09-15 | Exclude disposable checkout copies from pointer evidence, distinguish shipped capability counts from enabled configuration, and explain non-clean planned registries without weakening traceability |
| 0.5.0 | 2026-09-15 | Require composable managed hooks, CI-safe evidence exits, and field-level registry drift explanations |
| 0.4.0 | 2026-09-15 | Make API omission remediation review-only and add field-replay precision contracts for routes, fixtures, histories, monorepos, design sync, and config schemas |
| 0.3.0 | 2026-09-15 | Add packed adoption, fail-closed reconciliation and pointers, lifecycle-aware traceability, exact-code policy, combined assessment, Python literal evidence, and route-discovery precision contracts |
| 0.2.0 | 2026-09-11 | Replace template requirements with implemented trust, feedback, and cache contracts |
