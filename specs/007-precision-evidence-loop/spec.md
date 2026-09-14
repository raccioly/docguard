# Feature Specification: Independent Precision Evidence Loop

**Status**: Active
**Spec ID**: `docguard.precision-evidence-loop`
**Created**: 2026-09-14
**Owner**: DocGuard maintainers

## Problem

DocGuard has many regression tests and historical field reports, but it lacks a
single reproducible corpus that proves detector quality across repositories,
languages, parser tiers, and failure families. Finding counts cannot distinguish
better precision from broad suppression, and examples selected after seeing tool
output contaminate evaluation. Disputed findings also lack a complete path from
private evidence to a safe synthetic reproduction and neighboring control.

This feature makes quality measurable and contribution-ready. It does not claim
that a finite corpus proves arbitrary documentation correct.

## User Scenarios & Testing

### US1 — Reproduce a detector baseline

As a maintainer, I can run a deterministic local corpus and receive per-case,
per-repository, per-detector, and aggregate metrics with provenance and timing.

### US2 — Prevent benchmark leakage

As a reviewer, I can prove that development and evaluation groups do not share a
repository or causal bug family, so a tuned rule is assessed on held-out shapes.

### US3 — Challenge a finding safely

As a user, I can reduce a disputed result to synthetic content, label the failure
mode, pair it with an opposite control, and preview a duplicate-aware contribution
without publishing private repository material.

### US4 — Evaluate a detector change

As a contributor, I can compare a candidate result with a committed baseline and
see precision, recall, abstention, unsupported coverage, runtime, and case-level
regressions. A warning reduction caused by skipping supported inputs is visible.

## Functional Requirements

- **FR-001**: The corpus MUST use a versioned, JSON-schema-validated manifest
  with immutable case IDs, split, repository group, causal family, parser tier,
  detector scope, source provenance, configuration, labels, and mutations.
- **FR-002**: Sources MUST be either repository-owned synthetic fixtures or
  public repositories pinned to an exact commit. External materialization MUST
  use disposable directories, MUST NOT execute project code, and MUST clean up
  by default. Private paths and `.local` MUST be rejected.
- **FR-003**: Adjudication MUST distinguish `defect`, `clean_control`,
  `ambiguous`, `unsupported_syntax`, and `policy_disagreement`. Ambiguous,
  unsupported, and policy cases MUST NOT be silently counted as true or false
  findings.
- **FR-004**: Labels MUST be authored independently of actual output. Every
  measured scope MUST declare expected finding identities and forbidden finding
  identities; unlabelled findings inside that scope MUST fail the case.
- **FR-005**: Each defect case MUST name an opposite clean control. Synthetic
  mutations MUST use exact preconditions and fail rather than applying to an
  unexpected source revision.
- **FR-006**: The runner MUST record tool revision/version, manifest digest,
  source revision, config digest, Node/platform metadata, command status,
  finding identities, check coverage, and cold/warm wall time in deterministic
  JSON apart from an explicitly separated run-observation block.
- **FR-007**: Reports MUST calculate finding-level precision and recall, false
  positives per repository, abstention, unsupported coverage, and accepted
  repair outcomes by detector family and parser tier. Zero denominators MUST be
  represented as `null`, never as perfect quality.
- **FR-008**: Development and evaluation cases MUST be disjoint by repository
  group and causal family. Manifest validation MUST reject leakage, duplicate
  case IDs, missing controls, unsafe paths, floating revisions, and unknown
  fields.
- **FR-009**: Baseline thresholds MUST be derived only after the first reviewed
  run. A comparison MUST fail on newly missed defects, newly introduced false
  positives, or increased unsupported/abstained supported cases even if total
  warning count falls.
- **FR-010**: Runtime reporting MUST preserve cold and warm observations
  separately. Persisted timings are observational because matching environment
  labels do not establish an idle host. Runtime regression claims require at
  least five controlled samples from the same paired comparison session and a
  measured real-workload change greater than 20 percent, matching the repository
  contribution policy.
- **FR-011**: Feedback fixture manifests MUST record detector, configuration,
  expected identity, opposite control, classification, interestingness
  predicate, and provenance-redaction attestation.
- **FR-012**: False-negative intake MUST accept a user-supplied expected finding
  identity that did not appear. It MUST remain distinct from false-positive and
  unsupported-syntax intake.
- **FR-013**: Fixture reduction MUST be local and deterministic. Each candidate
  reduction MUST preserve an explicit interestingness predicate and the opposite
  control; it MUST stop without claiming success when the predicate cannot be
  reproduced.
- **FR-014**: Duplicate identity MUST derive from detector code, normalized
  classification, parser tier, and minimized fixture shape. Preview MUST provide
  an open-and-closed issue/PR search but MUST NOT submit or open a browser unless
  the user opts in.
- **FR-015**: Public contribution payloads MUST contain only reviewed synthetic
  content and bounded tool metadata. Repository names, paths, source excerpts,
  environment values, and private diagnostics MUST remain local by default.
- **FR-016**: An accepted detector change MUST include the failing reproduction,
  opposite control, executable regression test, supported/unsupported scope,
  and benchmark delta. Policy disagreement alone MUST NOT weaken a detector.
- **FR-017**: The benchmark and feedback tools MUST use Node.js built-ins,
  perform no implicit package installation, and keep ordinary `npm test` and
  consumer package contents independent from network availability.

## Evidence Model

| Class | Counts toward precision/recall | Required action |
|---|---:|---|
| defect | Yes, expected positive | Detector must emit the declared identity |
| clean_control | Yes, expected negative | Detector must not emit scoped findings |
| ambiguous | No | Preserve for adjudication; do not infer correctness |
| unsupported_syntax | No | Report explicit unsupported coverage |
| policy_disagreement | No | Resolve policy without relabeling detector accuracy |

A finding identity is `code + normalized repository-relative location`. Line
numbers, durations, prose wording, and volatile counts are excluded. A case may
scope one or more stable codes; findings outside that declared scope are retained
as observations but do not become labels.

## Source and Split Contract

Synthetic fixtures live under `benchmarks/fixtures/` and contain only
repository-owned content. External sources are listed by HTTPS Git URL and full
commit SHA; the runner clones or archives them into a temporary root, applies
bounded overlays or exact replacements, scans them, and removes the root unless
an explicit debugging flag is supplied.

`repositoryGroup` represents shared project ancestry. `causalFamily` represents
the root detector failure rather than surface syntax. No value may appear in
both `development` and `evaluation`. Controls stay in the same split as their
paired defects.

## Metric Contract

For labelled measured findings:

- precision = `TP / (TP + FP)`;
- recall = `TP / (TP + FN)`;
- false positives per repository = `FP / distinct scanned repository groups`;
- abstention = inconclusive measured cases divided by applicable measured cases;
- unsupported coverage = unsupported measured cases divided by all measured cases.

Metrics are also grouped by detector and parser tier. The report retains raw
case outcomes so aggregate improvements cannot hide a repository regression.
Equivalent or invalid mutations are adjudication states and are excluded from
recall, following the same principle used by mutation-testing systems for
invalid or equivalent mutants.

## Research Basis

- NIST AI RMF MEASURE 2.1 calls for test sets, metrics, tools, and evaluation
  details to be documented so measurement is repeatable.
- Grouped evaluation keeps related repositories out of both tuning and
  validation sets, avoiding the leakage that inflates generalization estimates.
- Semgrep's rule methodology uses positive/negative examples, multiple real
  repositories, and user feedback metrics to tune precision and recall.
- Mutation testing distinguishes detected, undetected, invalid, and equivalent
  mutants; excluded cases remain visible instead of becoming perfect scores.

## Success Criteria

- **SC-001**: The committed synthetic corpus covers JavaScript, TypeScript,
  Python, a fallback language, monorepo scoping, generated content, and sparse
  documentation with at least one defect/control pair for each category.
- **SC-002**: At least five public repositories at pinned commits complete in a
  disposable run with no source-tree residue and with reviewed scoped labels.
- **SC-003**: Re-running unchanged local fixtures produces byte-identical core
  results; only the separated observation block may vary.
- **SC-004**: A seeded false positive, false negative, unsupported case,
  duplicate ID, split leak, unsafe path, floating revision, and failed mutation
  precondition are each rejected or classified correctly.
- **SC-005**: The first reviewed baseline publishes actual metrics and confidence
  limits without a zero-false-positive or exhaustive-correctness claim.
- **SC-006**: A feedback reproduction can travel from preview to a test-only
  contribution without exposing its originating repository.

## Non-Goals

- Treating warning count or DocGuard score as detector accuracy.
- Downloading external repositories during ordinary tests or package install.
- Executing third-party build, test, hook, or package scripts.
- Automatically publishing issues, pull requests, fixtures, or private evidence.
- Setting precision/recall targets before a reviewed baseline exists.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `f84c187626be0e1b6ab56ec7002c9c168ac290d6` — Reviewed precision corpus, feedback contribution workflow, four-version regression matrix, package composition, dependency audit, and external baseline passed; traceability and changed-evidence invalidation were verified. Evidence: `benchmarks/fixtures/generated-security-control/src/generated-client/config.js`, `benchmarks/fixtures/go-todo-control/app.go`, `benchmarks/fixtures/js-security-control/src/config.js`, `benchmarks/fixtures/monorepo-security-control/packages/auth/src/config.ts`, `benchmarks/fixtures/python-security-control/app.py`, `benchmarks/fixtures/python-unsupported/app.py`, `benchmarks/fixtures/ts-security-control/src/config.ts`, `benchmarks/lib/compare.mjs`, `benchmarks/lib/manifest.mjs`, `benchmarks/lib/metrics.mjs`, `benchmarks/lib/runner.mjs`, `benchmarks/run.mjs`, `cli/commands/feedback.mjs`, `cli/feedback-fixture.mjs`, `cli/validators/security.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/CI-RECIPES.md`, `docs-canonical/REQUIREMENTS.md`, `docs-canonical/SECURITY.md`, `docs-canonical/TEST-SPEC.md`, `tests/benchmark-manifest.test.mjs`, `tests/benchmark-metrics.test.mjs`, `tests/benchmark-runner.test.mjs`, `tests/feedback-contributions.test.mjs`, `tests/feedback-fixture.test.mjs`, `tests/field-context-precision.test.mjs`. Accepted deviations: none. Successor: none.
- `8f8518524516fcdf77a69386258a49ff4c12c92f` — Reviewed feedback regression generation now normalizes structured finding locations through one shared identity function; lifecycle maintenance evidence and focused regression tests passed. Evidence: `benchmarks/fixtures/generated-security-control/src/generated-client/config.js`, `benchmarks/fixtures/go-todo-control/app.go`, `benchmarks/fixtures/js-security-control/src/config.js`, `benchmarks/fixtures/monorepo-security-control/packages/auth/src/config.ts`, `benchmarks/fixtures/python-security-control/app.py`, `benchmarks/fixtures/python-unsupported/app.py`, `benchmarks/fixtures/ts-security-control/src/config.ts`, `benchmarks/lib/compare.mjs`, `benchmarks/lib/manifest.mjs`, `benchmarks/lib/metrics.mjs`, `benchmarks/lib/runner.mjs`, `benchmarks/run.mjs`, `cli/commands/feedback.mjs`, `cli/feedback-fixture.mjs`, `cli/validators/security.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/CI-RECIPES.md`, `docs-canonical/REQUIREMENTS.md`, `docs-canonical/SECURITY.md`, `docs-canonical/TEST-SPEC.md`, `tests/benchmark-manifest.test.mjs`, `tests/benchmark-metrics.test.mjs`, `tests/benchmark-runner.test.mjs`, `tests/feedback-contributions.test.mjs`, `tests/feedback-fixture.test.mjs`, `tests/field-context-precision.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
