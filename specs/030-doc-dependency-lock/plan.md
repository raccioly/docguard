# Implementation Plan: Doc Dependency Lock

**Branch**: `feat/doc-dependency-lock` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

A `covers` attribute on `docguard:section` markers declares what code a passage
describes. A new scanner resolves and fingerprints those dependencies, with AST
tiers where available and a content hash otherwise, and compares them against
`.docguard-doc-lock.json`. A new validator reports DLK001–DLK005. A new
`docguard review` command lists status, accepts reviews with a reason through a
file transaction, prunes orphans, and suggests declarations. The feature is
opt-in; without `covers`, output is unchanged.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (`@babel/parser` already optional via `js-ast.mjs`)
**Storage**: `.docguard-doc-lock.json` (tracked, reviewed state)
**Testing**: `node:test` fixtures; an A/B timing check under `docguard.non-regression-budgets`
**Performance Goals**: ≤5% guard wall time on this repository (FR-008)
**Constraints**: no network, no LLM, no history requirement

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| IV (validator isolation) | The validator imports only the scanner and shared modules. |
| V (DocGuard never writes prose) | The lock records reviewed state; the prose stays the agent's or human's. |
| VI (safe writes) | `commitFileTransaction` for every lock write. |
| VIII (local-first) | No network. |
| IX (honest assurance) | Tiers are reported; DLK findings escalate and never claim the prose is wrong. |

Pass.

## Project Structure

```text
cli/scanners/doc-deps.mjs            # NEW: parse covers, resolve, fingerprint (ast|python-ast|content|glob), load/compare lock
cli/validators/doc-dependency.mjs    # NEW: DLK001–DLK005
cli/commands/review.mjs              # NEW: list / --accept / --prune / --suggest
cli/writers/sections.mjs             # expose covers on parsed sections (no behaviour change)
cli/findings.mjs                     # DLK001–DLK005
cli/commands/guard.mjs               # register the validator
cli/docguard.mjs                     # command, help, flags
schemas/docguard-doc-lock.schema.json # NEW
docs-canonical/ARCHITECTURE.md, DATA-MODEL.md  # adopt covers (FR-009) and document (FR-010)
README.md, docs/commands.md, docs/configuration.md
extensions/spec-kit-docguard/commands/review.md  # list lock status (read-only)
tests/doc-dependency-lock.test.mjs   # NEW
testguard.claims.json                # DOC-LOCK-FLAGS-CHANGED-DEPENDENCIES
```

## Design notes

- A symbol is found by walking top-level declarations and named exports. The
  fingerprint covers that declaration's node only, so edits elsewhere in the
  file do not fire (SC-001's unrelated-symbol case).
- Parse caching is per run, keyed by path, and holds the file content and AST
  (FR-008).
- A glob is resolved with the existing ignore-aware `walkFiles` and sorted by
  POSIX path.
- The suggested diff command uses `git cat-file -e <rev>` to check that the
  revision resolves before offering it.
