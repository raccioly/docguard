# Requirements

<!-- docguard:quality negation-load off — requirements define explicit failure and non-disclosure boundaries -->
<!-- docguard:version 0.2.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-09-14 -->

## Functional Requirements

| ID | Priority | Requirement | Verification |
|---|---|---|---|
| FR-001 | P1 | Score distinguishes structural maturity from unverified factual accuracy, even when candidate extraction finds nothing. | tests/score-assurance.test.mjs |
| FR-002 | P1 | Users can dispute any active finding, preview feedback, and prepare public metadata without sharing source-derived strings automatically. | tests/feedback-contributions.test.mjs |
| FR-003 | P1 | CI, diagnose, and report preserve score assurance limits in machine output. Existing score thresholds keep their numeric meaning. | tests/score-assurance.test.mjs |
| FR-004 | P1 | Detector quality is measured with independently labelled defect/control pairs, split-safe repository groups, explicit unsupported coverage, null-safe metrics, confidence limits, and case-first baseline comparison. | tests/benchmark-manifest.test.mjs, tests/benchmark-metrics.test.mjs, tests/benchmark-runner.test.mjs |
| FR-005 | P1 | Users can turn a false positive, false negative, unsupported syntax case, ambiguity, or policy dispute into a redaction-attested synthetic fixture with an opposite control, deterministic reduction, duplicate search, and optional test-only contribution. | tests/feedback-fixture.test.mjs, tests/feedback-contributions.test.mjs |
| FR-006 | P1 | Teams can bind an exact Markdown statement to safe, local, typed evidence and receive scoped verified, contradicted, stale, inconclusive, or unsupported results through verify, guard, and agent assurance without granting whole-document accuracy. | tests/evidence-manifest.test.mjs, tests/evidence-adapters.test.mjs, tests/evidence-integration.test.mjs |
| FR-007 | P1 | An agent can request a deterministic bounded task-context packet that prioritizes exact current evidence, excludes retired and unsafe material, preserves retrieval-only assurance, and abstains rather than returning weak matches. Existing task-graph behavior remains compatible. | tests/task-context.test.mjs, tests/agent-context-benchmark.test.mjs |

## Non-Functional Requirements

| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-001 | Security | Untrusted input passed to subprocesses uses argv-based invocation and validation appropriate to the command. | tests/security-init-injection.test.mjs |
| NFR-002 | Portability | The distributed CLI runs on supported Node versions. Babel supplies the full JS/TS tier; the CLI retains a regex fallback when the parser is absent. | tests/npm-pack-smoke.test.mjs |
| NFR-003 | Correctness | Cached memory plans invalidate when relevant working-tree inputs, configuration, or scanner implementation change. Unreadable or unsupported cache inputs cause a miss. | tests/plan-disk-cache.test.mjs |

## Success Criteria

The full supported-runtime test matrix and guard determine local release readiness. The reviewed benchmark records observed detector precision and recall with explicit coverage limits; its finite confidence interval is not universal accuracy. The frozen R7 evaluation supports opt-in task context through equal measured correctness, 50% fewer median steps, and 17% lower median latency against context packs. It also recorded 80% more median uncached input and does not establish universal agent productivity.

## User Scenarios

A developer edits a source file without committing. The next memory plan reflects that change. An agent requests context for one qualified requirement and receives current hashed excerpts and linked tests, or an explicit abstention. The agent inspects a high structural grade and sees that factual accuracy remains unverified. A contributor challenges a confident finding, previews a metadata-only report, checks existing work, and supplies a synthetic regression example voluntarily.

## Traceability Matrix

The verification column above links each requirement to executable tests. The tests carry explicit requirement annotations. Fixture content and example IDs cannot satisfy a real requirement.

## Revision History

| Version | Date | Changes |
|---|---|---|
| 0.2.0 | 2026-09-11 | Replace template requirements with implemented trust, feedback, and cache contracts |
