# Implementation Plan: Validator Fuzz Harness

**Branch**: `claude/docguard-aws-comparison-077b3f` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

## Summary

`tools/fuzz.mjs` is a seeded, dependency-free fuzzer. It runs DocGuard's text parsers on generated documents and on pathological inputs, checking three properties: no throw, determinism, and time linear in the input. A test runs a fixed budget on every `npm test`, and a maintainer can run a deep fuzz that shrinks and saves what it finds.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18. **Dependencies**: none new. **Testing**: `tests/validator-fuzz.test.mjs`.

## Design

- **Generator.** mulberry32 drives a grammar of lines: headings, requirement items and tables, tasks with `[USn]` and ID ranges, fences, HTML and DocGuard markers, status lines, AI-DLC stage lines and `[Answer]:` tags, API table rows. Structured blocks are spliced in, then mutations: duplicate, delete, truncate, repeat, reverse, indent. Line endings vary among LF, CRLF and CR, with an occasional BOM.
- **Properties.** Calling a parser twice must give equal JSON (Maps and Sets serialized). The time budget is `250 + length / 100` ms. Declared shapes are checked: arrays for ID lists, strings for text.
- **Shrinking.** Line deletion in halving chunks, kept while the same failure kind persists.
- **Pathological set.** Long runs of the characters the parsers branch on, at 20 KB, plus repeated structures at about 200 KB.

## Project Structure

- `tools/fuzz.mjs` (new)
- `tests/validator-fuzz.test.mjs` (new), `tests/fixtures/fuzz/` (replayed when present)
- `cli/shared-html-comments.mjs` (fix: `openerOutsideCode`)
- `docs-canonical/TEST-SPEC.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `package.json` (`fuzz` script)

## Risks

- **Suite time.** The fixed budget runs in about 1 s.
- **Flaky timing on slow runners.** The budget is 250 ms plus a linear allowance, so a slow runner is many times inside it. Only super-linear behavior crosses it.
