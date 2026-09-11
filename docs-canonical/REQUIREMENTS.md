# Requirements

<!-- docguard:version 0.2.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-09-11 -->

## Functional Requirements

| ID | Priority | Requirement | Verification |
|---|---|---|---|
| FR-001 | P1 | Score distinguishes structural maturity from unverified factual accuracy, even when candidate extraction finds nothing. | tests/score-assurance.test.mjs |
| FR-002 | P1 | Users can dispute any active finding, preview feedback, and prepare public metadata without sharing source-derived strings automatically. | tests/feedback-contributions.test.mjs |
| FR-003 | P1 | CI, diagnose, and report preserve score assurance limits in machine output. Existing score thresholds keep their numeric meaning. | tests/score-assurance.test.mjs |

## Non-Functional Requirements

| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-001 | Security | Untrusted input passed to subprocesses uses argv-based invocation and validation appropriate to the command. | tests/security-init-injection.test.mjs |
| NFR-002 | Portability | The distributed CLI runs on supported Node versions. Babel supplies the full JS/TS tier; the CLI retains a regex fallback when the parser is absent. | tests/npm-pack-smoke.test.mjs |
| NFR-003 | Correctness | Cached memory plans invalidate when relevant working-tree inputs, configuration, or scanner implementation change. Unreadable or unsupported cache inputs cause a miss. | tests/plan-disk-cache.test.mjs |

## Success Criteria

The full supported-runtime test matrix and guard determine local release readiness. Detector quality requires independent positive and negative examples. External precision, recall, and agent productivity targets belong to the evaluation plan; a structural score is not evidence of those outcomes.

## User Scenarios

A developer edits a source file without committing. The next memory plan reflects that change. An agent inspects a high structural grade and sees that factual accuracy remains unverified. A contributor challenges a confident finding, previews a metadata-only report, checks existing work, and supplies a synthetic regression example voluntarily.

## Traceability Matrix

The verification column above links each requirement to executable tests. The tests carry explicit requirement annotations. Fixture content and example IDs cannot satisfy a real requirement.

## Revision History

| Version | Date | Changes |
|---|---|---|
| 0.2.0 | 2026-09-11 | Replace template requirements with implemented trust, feedback, and cache contracts |
