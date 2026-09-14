# Implementation Plan: Independent Precision Evidence Loop

**Status**: Implemented — living benchmark
**Spec**: `specs/007-precision-evidence-loop/spec.md`

## Summary

Build one strict manifest and result contract, prove it with synthetic fixtures,
then execute a pinned public-repository corpus. Reuse that evidence shape for
feedback contributions so field disputes become benchmark regressions without
copying private source.

## Technical Context

- Runtime: Node.js 18+ ES modules and built-ins.
- Standard path: repository-only scripts under `benchmarks/`; no public CLI yet.
- Network: optional external materialization only; ordinary tests remain local.
- Safety: HTTPS Git sources, full commit SHAs, argv subprocesses, safe relative
  paths, no project-code execution, bounded output, disposable roots.
- Output: deterministic core result plus separate runtime observations.

## Project Structure

```text
benchmarks/
├── corpus.json
├── fixtures/
├── run.mjs
└── baseline.json
schemas/docguard-benchmark.schema.json
cli/commands/feedback.mjs
tests/benchmark-*.test.mjs
tests/feedback-contributions.test.mjs
```

## Phase 1 — Contract and local runner

Define `schemas/docguard-benchmark.schema.json` and a strict reader. Add a runner
that materializes synthetic fixtures, applies exact mutations, invokes the local
DocGuard entry point, normalizes findings, validates expected/forbidden identity,
and emits core results. Reject unknown fields and split leakage before scanning.

## Phase 2 — Metrics and regression comparison

Aggregate TP, FP, FN, null-safe precision/recall, false positives per repository,
abstention, unsupported coverage, and cold/warm timings by detector and parser
tier. Commit the first reviewed baseline only after the corpus is independently
labelled. Compare raw case outcomes as well as aggregates.

## Phase 3 — External corpus

Add at least five public HTTPS Git sources pinned to full commits across the
required repository shapes. Materialize into one temporary root, never invoke
project package scripts, and clean the root by default. Scope labels to reviewed
detector codes so unrelated observations remain visible without becoming
post-hoc labels.

## Phase 4 — Feedback contribution loop

Extend local feedback records with the shared fixture manifest taxonomy. Add a
deterministic duplicate identity and local reducer driven by an explicit command
predicate. Preview only synthetic bounded payloads and searches open and closed
work; submission stays opt-in. Supply a test-only contribution template.

## Verification

Run schema/manifest unit tests, mutation and cleanup integration tests, benchmark
twice for deterministic core output, full tests, `docguard guard`, package dry
run, and the external corpus. Review every label without consulting candidate
output first; record disputed cases as ambiguous rather than forcing consensus.
