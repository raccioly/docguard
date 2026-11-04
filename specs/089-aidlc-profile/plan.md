# Implementation Plan: What AI-DLC Verified at Its Gates Stays True After the Workflow Ends

**Branch**: `claude/docguard-aws-comparison-077b3f` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | New `cli/scanners/aidlc.mjs` (read-only): `findAidlcRecords`, `readAidlcRecord`, `parseStageProgress`, `isPathTarget`, `safeWorkspacePath`. It finds every record under `aidlc/spaces/*/intents/*/` and `aidlc-docs/`. It skips `.aidlc-engine/` (gitignored engine state) and caps the walk at 2,000 files. |
| FR-002 to FR-007 | New `cli/validators/aidlc.mjs` (`aidlc`):<br>• AID001: an `OK`/`Deferred` target path that is missing.<br>• AID002: a `GAP`/`ORPHAN` row in a stage marked `[x]`.<br>• AID003: a manifest path that existed at the manifest's last commit (`git cat-file -e rev:path` through `runGit`) and is missing now. A path absent then is the unit's own deletion. An uncommitted manifest is unjudged and reported `partial`.<br>• AID004: an unreadable record, or a path that escapes the project.<br>Caps of 10 per code; the result carries `aidlc: { records, units, tables, manifests }`. |
| FR-006 | AID001 to AID004 at `defaultLevel: 'info'`; AID001 and AID003 in `ABSENCE_CLAIM_CODES`. |
| FR-008 | Registration (guard, config defaults, schema, explain); COMPARISONS AI-DLC section and corrected Kiro row; README validator table; ARCHITECTURE, TEST-SPEC, configuration, CHANGELOG. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18. **Dependencies**: none new. **Testing**: `tests/aidlc-profile.test.mjs`.

## Research decisions

- **Formats** come from AI-DLC 2.11.2's own stage definitions (`code-generation.md` examples for `traceability.json` and `source-manifest.json`) and the state template (`- [x] stage-slug — …`).
- **Why git decides AID003.** A manifest lists created, modified and deleted paths with no marker. Without history every legitimate deletion would be reported. With history, only a later removal is.
- **Read-only.** Writing AI-DLC files belongs to AI-DLC. The plugin (spec 090) contributes through AI-DLC's own seams.

## Project Structure

- `cli/scanners/aidlc.mjs`, `cli/validators/aidlc.mjs` (new)
- `cli/findings.mjs`, `cli/commands/guard.mjs`, `cli/config.mjs`, `cli/commands/explain.mjs`, `schemas/docguard-config.schema.json`
- `tests/aidlc-profile.test.mjs` (new)
- `COMPARISONS.md`, `README.md`, `docs/`, `docs-canonical/`, `CHANGELOG.md`

## Verification

`tests/aidlc-profile.test.mjs`, `npm test`, `guard`, hermetic A/B (SC-003); SC-002 with the plugin's end-to-end fixture (spec 090).
