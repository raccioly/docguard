# Implementation Plan: Lifecycle Evidence Gaps

**Branch**: `fix/lifecycle-evidence-gaps` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/scanners/requirement-evidence.mjs`: `.ya?ml` joins the implementation-source filter and
  the hash-comment set.
- `cli/scanners/spec-registry.mjs`: the projection lists untracked, non-ignored test files that
  carry `@req`/`@implements` (`git ls-files --others --exclude-standard`).
- `cli/validators/spec-registry.mjs`: emits `SPR006` from `taskCompletion.checked > 0` combined
  with empty `implementationEvidence`.
- `cli/commands/specs.mjs`: prints and returns `untrackedEvidence`.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test` with temporary Git repositories
**Project Type**: CLI

## Constitution Check

IX: every addition makes missing evidence visible. It never infers evidence. SPR006 is an
escalation, because only the reader knows whether the spec is truly unimplemented. Pass.

## Project Structure

```text
cli/scanners/requirement-evidence.mjs
cli/scanners/spec-registry.mjs
cli/validators/spec-registry.mjs
cli/commands/specs.mjs
cli/findings.mjs                          # SPR006
tests/lifecycle-evidence-gaps.test.mjs    # NEW
```
