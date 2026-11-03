# Implementation Plan: Agent Memory Stays True to the Code, Is Fed Verified Facts, and Is Consolidated Without Guessing

**Branch**: `claude/docguard-aws-comparison-077b3f` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 to FR-003 | `cli/scanners/aidlc.mjs`: `findAidlcSpaces`, `memoryLayerFiles`, `codekbFiles`, `diaryFiles`, `backtickRefs` (fence-, comment- and URL-aware), `ENV_TOKEN`. `cli/validators/aidlc.mjs` gains MEM001 (rule layers: paths and env vars) and MEM002 (CodeKB paths). Env vars are checked with one walk over code and `.env*` files, run only when a rule names one. |
| FR-004 | New `cli/commands/memory-aidlc.mjs` `exportAidlcMemory`. The digest is built from the `matched` lists of the four diffs `docguard memory` already computes. It is a dry run to stdout by default; `--write` goes through `safeWrite` to `aidlc/spaces/<space>/knowledge/docguard/canonical-memory.md`. It prints the `aidlc engine knowledge onboard` command and never runs it. |
| FR-005 | `consolidateAidlcMemory`: list entries of every intent's `memory.md`, normalized (marker, whitespace, case), grouped with every source location. Backticked path references are flagged stale when missing. Text and JSON output; it writes nothing. |
| FR-006 | `cli/docguard.mjs` flags (`--export`, `--consolidate`, `--space`) and help; codes; docs; CHANGELOG. |

## Research decisions

- **Feeding through knowledge, not memory.** AI-DLC forbids plugins from contributing memory, and its learning loop content-hashes persisted rules. Knowledge is team-owned input that AI-DLC indexes on request, so DocGuard writes one file there at the user's `--write` and leaves indexing to AI-DLC.
- **No semantic merge.** Grouping by normalized text is exact and explainable. Rewording rules belongs to a person or to AI-DLC's loop (Constitution V).

## Verification

`tests/memory-governance.test.mjs` (SC-001, SC-002), `npm test`, hermetic A/B (SC-003).
