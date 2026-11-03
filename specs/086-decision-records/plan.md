# Implementation Plan: Decisions Are Recorded Completely and Their Supersession Chain Holds

**Branch**: `claude/docguard-aws-comparison-077b3f` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 to FR-007 | New `cli/validators/decision-records.mjs`.<br>• `parseAdrFile`: `## ADR-NNN` sections, or one file per decision. A single-file decision counts only in an ADR home or under an `adr-NNN` name, so dated decision logs are skipped.<br>• `normalizeStatus`: strips emoji and emphasis, then maps synonyms.<br>• Structured supersession links only: a line-opening `Supersedes`/`Superseded by`, a status line, or MADR keys. Prose mentions and "partially superseded" are not links.<br>• Index rows; unanswered Spec Kit clarifications (wrapped questions joined, `A (…):` answers counted) and blank `[Answer]:` tags under `aidlc/`, `aidlc-docs/`, `docs/` and `specs/`. |
| FR-008 | DEC001 to DEC006 in `cli/findings.mjs` with `defaultLevel: 'info'`. DEC002 added to `ABSENCE_CLAIM_CODES`. The validator returns not-applicable with nothing to read. |
| FR-009 | Registration in `cli/commands/guard.mjs`, `cli/config.mjs` defaults, the config schema, `cli/commands/explain.mjs`; docs and CHANGELOG. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18. **Dependencies**: none new. **Testing**: `tests/decision-records.test.mjs`.

## Research decisions

- **Precision first.** On the 45 local projects, a first pass produced 107 findings. Each one was reviewed by hand. Three parser fixes followed:
  - wrapped clarifications, and `A (recommended, approved):` answers;
  - decision logs named by date;
  - `### Status (ADR-001)` headings, plus prose "supersedes the ADR-015 posture".

  Those fixes brought the total to 5. That leaves:
  - 3 DEC001: two ADRs with no status section, and one non-standard "Partially superseded" status;
  - 1 DEC003: one-way supersession;
  - 1 DEC006: a clarification written without an answer.

  All 5 are genuine.
- **Advisory by default**, per spec 083, so `docguard policy` decides when a project promotes them.

## Verification

`npm test`, `guard`, `npm run budget`, hermetic A/B (SC-002).
