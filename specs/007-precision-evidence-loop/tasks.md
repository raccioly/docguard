# Tasks: Independent Precision Evidence Loop

**Status**: Verified — living benchmark maintenance continues
**Spec**: `specs/007-precision-evidence-loop/spec.md`

## Phase 1: Contract and runner

- [x] T001 Define the strict benchmark and feedback fixture JSON schemas.
- [x] T002 Implement safe manifest loading, immutable IDs, split-leak checks, and exact mutation preconditions.
- [x] T003 Implement disposable synthetic materialization and local guard invocation without project-code execution.
- [x] T004 Normalize scoped finding identities and reject unlabelled in-scope output.
- [x] T005 Separate deterministic core results from runtime observations and environment metadata.

## Phase 2: Corpus and metrics

- [x] T006 Add defect/control pairs for JavaScript, TypeScript, Python, fallback, monorepo, generated, and sparse-doc categories.
- [x] T007 Implement per-case, repository, detector, parser-tier, and aggregate metrics with null denominators.
- [x] T008 Implement baseline comparison that catches new FP/FN and increased unsupported or abstained supported cases.
- [x] T009 Prove byte-stable core results across repeated unchanged runs.
- [x] T010 Run and independently adjudicate at least five pinned public repositories in disposable checkouts.
- [x] T011 Commit the reviewed baseline, confidence limits, and actual runtime observations.

## Phase 3: Contribution loop

- [x] T012 Extend feedback intake with false-negative, unsupported-syntax, ambiguous, and policy-disagreement classifications.
- [x] T013 Add fixture manifests with opposite controls and provenance-redaction attestations.
- [x] T014 Add local deterministic fixture reduction with an explicit interestingness predicate.
- [x] T015 Add duplicate identity and open-and-closed work search to preview without automatic submission.
- [x] T016 Add test-only contribution templates and enforce reproduction, control, test, scope, and benchmark delta.

## Phase 4: Closeout

- [x] T017 Update canonical architecture, test, security, CI, contribution, and validation documentation.
- [x] T018 Run full regression, guard, package, supported-runtime, and external-corpus checks.
- [x] T019 Complete the reviewed lifecycle transaction and keep this living benchmark specification current.

## Phase 5: Provenance envelope

- [x] T020 Publish the baseline envelope schema; derive `measures` and `caveat` from cases; recompute metrics on load and fail closed on drift.
- [x] T021 Make the comparator selection-aware so the network-free run passes on CI, and run it there.
- [x] T022 Replace the "calibrated" wording in PHILOSOPHY, README, CONTRIBUTING, and the diagnose command with what is measured.

## Phase 6: Evidence at finding time

- [x] T023 Derive per-code evidence by finding identity; refuse to let an unmeasured code inherit a validator's measurement.
- [x] T024 Ship the evidence as a generated module (the corpus stays out of the package) and fail the suite on drift.
- [x] T025 Surface it in the guard result, the guard summary, and `explain <CODE>`, leaving the finding shape untouched.
- [x] T026 Re-run the full external corpus on the current release so the shipped evidence is not measured on a stale build.
