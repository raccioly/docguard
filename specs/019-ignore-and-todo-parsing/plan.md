# Implementation Plan: Ignore and TODO Parsing Correctness

**Branch**: `fix/ignore-and-todo-parsing` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/shared.mjs` `loadIgnorePatterns(projectDir)` becomes
  `buildIgnoreFilter(loadDocguardIgnore(projectDir))`, the single implementation.
- `cli/validators/todo-tracking.mjs` gets two pattern tiers: a strict tier for HACK, XXX, TEMP
  and WORKAROUND (separator or author required), and a relaxed tier for TODO and FIXME, where
  whitespace plus text also counts. A shared extractor strips `(author)` and the separator.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; `npm run benchmark` for SC-002
**Project Type**: CLI

## Constitution Check

IV: shared.mjs delegates to shared-ignore.mjs; no validator imports another. IX: precision is
protected by keeping ambiguous keywords strict, and the benchmark comparison guards it. Pass.

## Project Structure

```text
cli/shared.mjs
cli/validators/todo-tracking.mjs
tests/todo-tracking.test.mjs          # PR #453 cases + precision negatives
tests/ignore-parser-parity.test.mjs   # NEW
```
