# Implementation Plan: Every Suppression Has an Owner and an End Date the Project Can Enforce

**Branch**: `claude/docguard-aws-comparison-077b3f` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | New `cli/waiver-metadata.mjs` holds the one parser for every kind: `splitWaiverMetadata(text)` → `{ reason, owner, expires, problem }`. It peels at most one `owner:` and one `expires:` whitespace-separated token from the end, in either order. A duplicate, a bad date or a bad owner sets `problem`. Owner forms: `@handle`, `team/name`, an email. `parseInlinePragma` (`cli/findings.mjs`) and the validator and section marker readers (`cli/validator-markers.mjs`, the structure validator's section-marker pass and `cli/scanners/suppressions.mjs`) call it on their reason text. |
| FR-004 (inline) | `suppressesCode` (behind `lineSuppresses`, the single choke point every validator uses) returns false for a pragma whose expiry is before today (UTC) or that has a `problem`. |
| FR-004 (markers) | `loadValidatorSuppressions` skips an expired or problematic validator marker, so the validator runs. The section-marker pass in the structure validator skips an expired section marker. |
| FR-002 | `parseDocguardIgnore` (`cli/shared-ignore.mjs`) reads `owner:` inside the `# reason` comment, beside the existing `expires:` handling. |
| FR-003 | New `normalizeIgnoreConfig(config, today)` in `cli/shared-ignore.mjs`. It turns object entries in `ignore`, `securityIgnore` and `todoIgnore` into pattern strings, drops expired ones, and keeps the metadata in a non-enumerable `config[IGNORE_META]` for the suppression model. It is idempotent, and called from `loadConfig` and at the top of `runGuardInternal`, so in-process callers that pass a raw config get the same result. The other 44 readers of those arrays keep receiving strings. |
| FR-005, FR-006, FR-004 (report) | `cli/validators/suppressions.mjs`: IGN001 for every expired suppression of any kind, from the model; IGN004 (`suppressions.requireOwner`); IGN005 (`suppressions.maxDays`). Baseline fingerprints are exempt. |
| FR-007 | `cli/scanners/suppressions.mjs` adds `owner` to every entry, and `expires` for pragmas, markers and config objects. `cli/commands/ignore.mjs` gets `--owner <owner>` filtering. |
| FR-008 | Each parser returns its prior output for any text without a trailing well-formed `owner:` or `expires:` token. A golden test pins every existing form. |
| FR-009 | Config schema (object entries; `suppressions.requireOwner`, `suppressions.maxDays`), `cli/findings.mjs` (IGN004, IGN005, wording of IGN001 and IGN003), `npm run docs:reference`, `docs/configuration.md`, `CHANGELOG.md`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `tests/accountable-suppressions.test.mjs`. It covers:
- each kind with metadata, live and expired;
- policies;
- unreadable metadata;
- golden pins for every 0.45.2 form;
- `ignore --owner`.

The existing suites (`ignore-reasons`, `docguardignore`, `validator-markers`, `section-na-markers`, `fix-suppression`, `security`, `todo-tracking`) run unchanged.
**Constraints**: a form without new tokens behaves exactly as before (SC-002).

## Research decisions

- **One parser.** Spec 057 parses `expires:` only for `.docguardignore`. Five readers parse reasons today. A shared splitter keeps the token rule the same everywhere, which is what lets the spec promise one syntax.
- **Expiry at the choke points, not in validators.** `suppressesCode` is used by every validator that honors pragmas. `loadValidatorSuppressions` and the section-marker pass are the only marker readers. Changing three functions changes every consumer at once.
- **Normalizing config objects to strings.** The arrays have 44 readers. Changing them all would be a large diff with a large regression surface. Normalizing once keeps them unchanged, and the metadata travels beside the arrays for the model.
- **Rejected:** a separate waiver file (AI-DLCOps' `waivers/` directory). DocGuard's suppressions already live next to what they suppress, and moving them would break every existing project.

## Project Structure

```text
cli/waiver-metadata.mjs                 FR-001 (new)
cli/findings.mjs                        FR-001, FR-004 (parseInlinePragma, suppressesCode), FR-009 (codes)
cli/validator-markers.mjs               FR-001, FR-004
cli/validators/structure.mjs            FR-004 (section markers)
cli/shared-ignore.mjs                   FR-002, FR-003
cli/config.mjs, cli/commands/guard.mjs  FR-003 (normalizeIgnoreConfig call sites)
cli/scanners/suppressions.mjs           FR-007
cli/validators/suppressions.mjs         FR-004, FR-005, FR-006
cli/commands/ignore.mjs, cli/docguard.mjs  FR-007
schemas/docguard-config.schema.json, docs/, CHANGELOG.md  FR-009
tests/accountable-suppressions.test.mjs
```

## Risks

- **Reason text that already ends in `owner:x`.** It would now be read as metadata. A grep over local projects during the A/B looks for any such pragma.
- **Clock.** Expiry uses UTC "today", like spec 057. Tests pass an explicit `today` where the API allows; CLI tests use dates far in the past or future.

## Verification

`npm test`, `guard`, `npm run budget`; hermetic A/B against the previous commit on every local project (SC-002).
