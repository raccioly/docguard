# Implementation Plan: Authoring Contract

**Branch**: `claude/docguard-aws-comparison-077b3f` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

## Summary

`cli/authoring-contract.mjs` holds each canonical document's sections: required or recommended, a project-type condition, and one line on what to write. Every place that told authors what to write, or checked it, now reads the registry. A round-trip test feeds every piece of guidance and every template back through the validators and parsers.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18. **Dependencies**: none new. **Testing**: `tests/authoring-contract.test.mjs`.

## Design

- **Registry.** Keyed by default path, so consumers keep `remapDocPath` and doc roles work as before.
  - `requiredSectionMap(ptc)` reproduces STR003's list exactly, including the `needsDatabase` and `needsEnvVars` exemptions.
  - `authoringLines` and `skillSectionBlock` render the guidance.
  - `requiredSectionsSentence` renders explain's text.
- **Consumers.**
  - STR003 and the Doc Quality score read the required map. The score now follows the exemptions (US3).
  - explain renders its `docSections` text from the registry.
  - The `fix` prompts render their section bullets from it, and keep the per-document advice.
  - The Spec Kit skill and its `.agent/` mirror carry a marker block that `npm run docs:reference` refreshes. `--check` fails when either is stale.
- **STR007.** `profileSections(config)` reads `requiredSections` from a profile or `.docguard.json`; a bare file name means a canonical document. A missing heading is reported at `defaultLevel: 'info'`, and a reasoned N/A marker owns it. It is kept out of `passed` and `total`, so a project's counts don't move until it promotes the code.
- **What is not generated.** Templates and generated documents keep their prose and are tested against the registry. `doc-generators.mjs` writes arc42 headings, which `docHasSection` already accepts; the round trip proves it.

## Project Structure

- `cli/authoring-contract.mjs` (new)
- `cli/validators/structure.mjs`, `cli/commands/score.mjs`, `cli/commands/explain.mjs`, `cli/commands/fix.mjs`, `cli/findings.mjs`
- `tools/generate-docs-reference.mjs`, `extensions/spec-kit-docguard/skills/docguard-fix/SKILL.md`, `.agent/skills/docguard-fix/SKILL.md`
- `tests/authoring-contract.test.mjs` (new)
- `docs/reference/findings.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`

## Risks

- **Scores move for projects without a database or environment variables.** Doc Quality stops asking them for Entities or Environment Variables, so those scores can only rise. The hermetic A/B records `score` per project (SC-002).
