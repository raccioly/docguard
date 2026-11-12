# Implementation Plan: One Agent-Instruction Document Role

**Branch**: `feat/094-agent-instruction-role` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002, FR-004, FR-006 | New `cli/shared-agent-instructions.mjs`: `agentInstructionDocs(projectDir, config)` → `{ docs, limitations }`. It is built on `listTrackedFiles`, `instructionKind`, `claudeImportsIn` and `isNonProductPath`, and is memoized per run on `(projectDir, config)`. Helpers: `rootAgentDocs()` (root, non-vendored paths), `isPointer()`, `vendoredMap()`. |
| FR-002 | Readers drop their literal lists and call `rootAgentDocs`: `reference-existence.mjs`, `diff-suspicion.mjs`, `scanners/doc-deps.mjs` (`candidateDocs`), `scanners/semantic-claims.mjs` (`claimSourceDocs`), `scanners/instruction-audit.mjs` (`INSTRUCTION_FILES`), `commands/impact.mjs` (`AGENT_FILES`). |
| FR-003, FR-005 | `validators/freshness.mjs` `collectDocs`: replaces the `agentFile` default with the role's non-pointer, non-vendored documents, and adds a pointer skip. |
| FR-007 | `validators/path-scoped-rules.mjs`: PSR005 from the role's vendored entries that carry hashes (sha256 of the tracked bytes). |
| FR-009 | `cli/findings.mjs`, `npm run docs:reference`, ARCHITECTURE, DATA-MODEL, CHANGELOG. |
| FR-010 | `benchmarks/fixtures/agent-instruction-control/` plus four `benchmarks/corpus.json` cases; `benchmarks/baseline.json` re-recorded. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (`node:crypto` for sha256)
**Testing**: `node:test`. `tests/agent-instruction-role.test.mjs` covers US1-US3. The existing suites for freshness, reference-existence, doc-deps, semantic-claims, instruction-audit, impact and path-scoped-rules run unchanged and act as the FR-008 controls.

## Project Structure

```text
cli/shared-agent-instructions.mjs          # new: the role
cli/validators/freshness.mjs               # role documents, pointer skips
cli/validators/path-scoped-rules.mjs       # PSR005
cli/validators/{reference-existence,diff-suspicion,canonical-sync}.mjs
cli/scanners/{doc-deps,semantic-claims,instruction-audit,doc-references}.mjs
cli/commands/{impact,diagnose,score-dora,hooks}.mjs
cli/findings.mjs, docs/reference/findings.md
benchmarks/corpus.json, benchmarks/baseline.json, benchmarks/fixtures/agent-instruction-{control,heldout}/
tests/agent-instruction-role.test.mjs
```

## Research decisions

- **Why build on `instructionKind`.** The harness formats were checked against vendor documentation for `docguard.path-scoped-rules`. A second catalog would drift from it. `GEMINI.md` is added in the role module only, so `rules --for` keeps its verified harness semantics.
- **Why tracked files.** Path-Scoped-Rules evaluates tracked files so that CI and a laptop agree. Freshness is git-based anyway.
- **Why six lines for a pointer.** TestGuard's pointer `CLAUDE.md` has three body lines; the pointer files measured in two private projects have two and one. DocGuard's substantive `CLAUDE.md` has more than fifteen. Six leaves room for a short note without admitting a real instruction file. This is a hand-set boundary, and the benchmark control pins it.
- **Why only manifest hashes for PSR005.** They are the only record of what was installed. DocGuard copies are compared against the running package by `upgrade` (`staleAgentAssets`), and a project pinning an older DocGuard in CI would see every copy as drifted.
- **Rejected:**
  - Widening `listCanonicalDocs` to agent files. That would move findings in every canonical reader.
  - A role in `DOC_ROLES`. Those roles are one path each. This role is a set with per-file attributes.

## Risks

- **New FRS002 and FRS003 on authored instruction files** in other projects. The A/B lists every one.
- **Readers that gain files** may emit new REF001, XRF, semantic-claim or instruction-audit results on CLAUDE, GEMINI and Copilot files. The A/B lists every one.

## Verification

1. `npm test`; `node cli/docguard.mjs guard`; `npm run budget -- --base <main worktree>`.
2. A/B per SC-002: `git archive` of main and of the branch as CLIs; a fresh `git clone --local` per project per CLI; `guard --format json`, run serially; findings diffed by code, location and message.
