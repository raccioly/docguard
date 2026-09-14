# Tasks: Independent Precision Evidence Loop

**Status**: Active
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

- [ ] T012 Extend feedback intake with false-negative, unsupported-syntax, ambiguous, and policy-disagreement classifications.
- [ ] T013 Add fixture manifests with opposite controls and provenance-redaction attestations.
- [ ] T014 Add local deterministic fixture reduction with an explicit interestingness predicate.
- [ ] T015 Add duplicate identity and open-and-closed work search to preview without automatic submission.
- [ ] T016 Add test-only contribution templates and enforce reproduction, control, test, scope, and benchmark delta.

## Phase 4: Closeout

- [ ] T017 Update canonical architecture, test, security, CI, contribution, and validation documentation.
- [ ] T018 Run full regression, guard, package, supported-runtime, and external-corpus checks.
- [ ] T019 Complete the reviewed lifecycle transaction and keep this living benchmark specification current.
