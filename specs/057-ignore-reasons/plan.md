# Implementation Plan: Suppressions That Carry a Reason and an Expiry

**Branch**: `spec/057-ignore-reasons` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002, FR-003, FR-004 | `cli/shared-ignore.mjs`: `parseDocguardIgnore(text, { today })` returns one entry per pattern line (`pattern`, `reason`, `expires`, `state`, `line`). `loadDocguardIgnoreEntries` reads the file; `loadDocguardIgnore` keeps its signature and returns only the `active` patterns, so every existing caller (config merge, watch, doc-deps, instruction scopes, ownership, agent instructions) applies the same rule. |
| FR-005 | `cli/validators/suppressions.mjs` (new, key `suppressions`, display "Suppressions"): IGN001, IGN002, IGN003, registered in `cli/findings.mjs` with explain entries; registered in `cli/commands/guard.mjs`, `cli/commands/explain.mjs`, `schemas/docguard-config.schema.json` (`validators.suppressions`, `suppressions.requireReason`). |
| FR-006 | `cli/scanners/suppressions.mjs` (new): `collectSuppressions(projectDir, config, opts)`. Inline reasons come from `parseInlinePragma` in `cli/findings.mjs`, beside `suppressesCode`, so the code list is read the same way. Marker locations come from `listValidatorMarkers` in `cli/validator-markers.mjs` and a section-marker reader that applies the Structure validator's rule. |
| FR-007 | `cli/commands/ignore.mjs` (new): `docguard ignore [--format json|claimspec]`, wired in `cli/docguard.mjs` (help, `COMMAND_HELP`, dispatch, banner-free for `claimspec`). |
| FR-008 | `cli/writers/claimspec-ignore.mjs` (new): `toClaimspecIgnore(model)` → `{ document, report }`; `claimspecPathPattern(pattern)` decides and performs the exact rewrite. |
| FR-009 | `schemas/claimspec/v1/{ignore,common}.schema.json` (vendored byte-identical from raccioly/testguard `spec/schemas/` at `379fb6a`, v0.18.3); `cli/claimspec-schema.mjs` (new): a keyword-limited validator; conformance fixtures under `tests/fixtures/claimspec/`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new. claimspec's own validator uses Ajv; DocGuard does not take that dependency (Principle II), so it carries a validator for the keywords the `ignore` schema uses.
**Testing**: `node:test`. `tests/ignore-reasons.test.mjs` (new): parser and old-parser equivalence, expiry through `guard`, model inventory, command output, claimspec export validated against the vendored schema and the conformance fixtures.

## Research decisions

- **One grammar: websec's trailing form, `pattern  expires:YYYY-MM-DD  # reason`.** The reason sits on the line it explains, so there is no rule for which pattern a comment belongs to. websec-validator already ships this line shape, so one line means the same thing in both tools. Rejected: `# reason:` / `# expires:` comment lines above a pattern. They are fully backward compatible (comments are dropped today) but ambiguous: existing files put one free-form comment above several patterns, and a directive block would need rules for blank lines and following patterns that nobody can see from the file. Rejected: `# reason: …; expires: …` inside the comment. It hides the lifetime in prose, and websec puts the expiry outside the comment.
- **`#` starts a trailing comment only after whitespace.** Gitignore has no trailing comments, so `#` inside a pattern (`C#/`, `notes#1`) keeps today's meaning. The two parsers spec 019 unified are one function now (`loadDocguardIgnore`, used by `loadIgnorePatterns` and every scanner), so the grammar changes in one place. A line that changes meaning contains whitespace then `#`, or ends in an `expires:` token; before this change such a line was a pattern containing that literal text, which matches no ordinary path. The equivalence test runs the old parser and the new one over this repository's `.docguardignore` and the existing fixtures.
- **Expired entries stop excluding, and say so.** claimspec: "after this instant the entry no longer applies"; GATE-SEMANTICS: "an expired entry excuses nothing and is reported as expired". websec keeps an acknowledgement active through its stated day. DocGuard does the same in UTC, so its last active day and the exported instant (`next day T00:00:00Z`) agree exactly. Rejected: keep applying and only warn. The expiry would then change nothing, and the report would be the only consequence.
- **An unreadable expiry excludes nothing (IGN003).** The author meant the entry to end; DocGuard cannot tell when. Failing closed shows the files the entry would have hidden, and websec treats a malformed expiry the same way. Rejected: treat as no expiry, which turns a time-limited exclusion into a permanent one.
- **`suppressions.requireReason` reports and does not disable.** Default off: thousands of existing lines carry no reason. When on, IGN002 is a warning a team can raise to `high` with `findingSeverity`. Disabling reason-less entries would change what every validator scans because of a style setting. The key lives under `suppressions`, not `ignore`, because `ignore` is already the pattern array.
- **A Suppressions validator owns IGN.** No existing validator reads `.docguardignore` as its subject; putting IGN in Structure would mix ignore-file hygiene into required-file checks, and Principle IV keeps parsing in the shared module the validator imports. Not in the `--changed-only` set: expiry depends on the date, not on which files changed.
- **A dedicated `docguard ignore` command, not `guard --format claimspec-ignore`.** `guard`'s formats (json, sarif, junit) render one guard run's findings. The ignore document describes policy, needs none of the 30+ validators, and must not take guard's exit code. The same command lists the whole model for a reviewer, which is where the omitted suppressions are shown.
- **Path patterns are exported only when gitignore states the same scope.** DocGuard's matcher (`globToRegex`) matches a pattern at a path-segment boundary at any depth, while gitignore anchors a pattern that contains a slash. So `src/legacy/**` is exported as `**/src/legacy/**`, and a trailing `/` (which DocGuard strips, matching files too) is dropped. A pattern is omitted, with the reason, when the two syntaxes disagree on it: a leading `!` or `/`, `**` anywhere but a final `/**` segment (DocGuard's `**/x` misses a root-level `x`; its `a/**/b` misses `a/b`), or one of `? [ ] ( ) + ^ $ | { } \`, which DocGuard passes to a regular expression. Rejected: export verbatim. It would understate DocGuard's scope to the auditor.
- **Expired entries are exported with `expires`.** The schema has the field so a consumer can warn; dropping the entry would hide a lapsed exclusion. This matches websec's writer.
- **A reason outside 8–2000 characters is omitted, not padded or truncated.** Truncation changes the reason; padding invents one. Length is counted in code points, as JSON Schema counts it.
- **Vendor schemas, not claimspec's validator.** `spec/lib/validate.mjs` imports Ajv. DocGuard copies the two schema files byte-identical and validates them with a walker that supports `type`, `required`, `properties`, `additionalProperties`, `items`, `const`, `enum`, `minLength`, `maxLength`, `pattern` and `$ref` across the two `urn:claimspec:v1:*` ids, and throws on any other keyword it meets. If a future copy of the schema uses a keyword it does not know, validation fails loudly instead of passing.
- **The model never invents a reason.** A config array entry, a pragma written without text after its codes and a baseline fingerprint have `reason: null`.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added; the schema validator is in-repo. |
| IV (validator isolation) | `suppressions.mjs` imports only shared parsing (`shared-ignore.mjs`) and the findings registry. |
| VI (safe writes) | `docguard ignore` writes nothing; the claimspec document goes to stdout. |
| IX (honest assurance) | Every omitted suppression is counted with its reason, the document's completeness is stated, and no field is filled to conform. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/shared-ignore.mjs                    # FR-001–FR-004 parser, active-pattern loader
cli/findings.mjs                         # IGN001–IGN003; parseInlinePragma (FR-006)
cli/validator-markers.mjs                # listValidatorMarkers (FR-006)
cli/scanners/suppressions.mjs            # NEW: the suppression model (FR-006)
cli/validators/suppressions.mjs          # NEW: IGN findings (FR-005)
cli/commands/guard.mjs                   # register the validator
cli/commands/explain.mjs                 # explain entry and display name
cli/commands/ignore.mjs                  # NEW: docguard ignore (FR-007, FR-008)
cli/docguard.mjs                         # help, dispatch, banner-free claimspec
cli/writers/claimspec-ignore.mjs         # NEW: the export (FR-008)
cli/claimspec-schema.mjs                 # NEW: vendored-schema validator (FR-009)
schemas/claimspec/v1/ignore.schema.json  # NEW: vendored
schemas/claimspec/v1/common.schema.json  # NEW: vendored
schemas/docguard-config.schema.json      # validators.suppressions, suppressions.requireReason
tests/ignore-reasons.test.mjs            # NEW
tests/fixtures/claimspec/                # NEW: claimspec conformance copies
tests/read-only-commands.test.mjs        # `ignore` writes nothing
docs/configuration.md, docs/commands.md, docs/guides/troubleshooting.md, docs/reference/findings.md
docs-canonical/ARCHITECTURE.md, docs-canonical/DATA-MODEL.md, docs-canonical/SECURITY.md, README.md
CHANGELOG.md
```
