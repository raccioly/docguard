# Feature Specification: Suppressions That Carry a Reason and an Expiry

**Feature Branch**: `spec/057-ignore-reasons`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.ignore-reasons`

**Lineage**: Extends `docguard.ignore-and-todo-parsing` (spec 019), which made `loadDocguardIgnore` the one `.docguardignore` parser. Implements the maintainer decision on raccioly/docguard#420: reason-bearing native suppressions first, then the claimspec `ignore` export, adopted only where reason, expiry and lifecycle meaning survive exactly. Follows websec-validator's shipped `.websec-ignore` grammar (`expires:YYYY-MM-DD # reason`) so the Guard tools read the same line the same way.

**Input**: "Implement reason-bearing native suppressions, then the honest claimspec `ignore` export." (raccioly/docguard#420)

## Problem

1. **No DocGuard suppression keeps its reason.** `loadDocguardIgnore` drops every `#` line, so a comment explaining a `.docguardignore` pattern exists nowhere after parsing. `config.ignore`, `securityIgnore` and `todoIgnore` are bare string arrays. Inline `docguard:ignore CODE — reason` pragmas are parsed for their codes only. A reviewer cannot ask DocGuard why something is suppressed.
2. **No suppression ends.** A path excluded "until the migration lands" stays excluded forever. Nothing reports that the stated condition has passed.
3. **A trailing comment silently breaks a pattern.** `#` is a comment only at the start of a line, so `fixtures/  # test data` is read as the pattern `fixtures/  # test data`, which matches nothing. The user sees no error; the files are simply not excluded.
4. **The ignore matcher mis-reads gitignore syntax.** Found while building the export: `globToRegex` passes `? [ ] ( ) + ^ $ | { } \` straight into a regular expression, so `foo?` matches `fo`, `a|b` excludes unrelated paths (176 of this repository's tracked files), and an unclosed `[` makes five validators fail with a regular-expression error. `**/fixtures/**` does not match a top-level `fixtures/x`, `a/**/b` does not match `a/b`, and a leading `/` matches nothing. The top-level `documentLifecycle` array that Document-Lifecycle honours is in neither the config schema nor the docs.
5. **The claimspec `ignore` export cannot be honest yet.** Its schema requires a `reason` of at least eight characters on every entry. With no reason held in-process, an honest writer emits `entries: []` for every project, which reads as "nothing is ignored" (#420).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A suppression says why and until when (Priority: P1)

1. **Given** `.docguardignore` line `legacy/  expires:2999-12-31  # removed with the v2 API`, **Then** `legacy/` is excluded from every validator, and DocGuard holds the reason and the expiry.
2. **Given** an entry whose expiry date has passed, **When** `guard` runs, **Then** the path is no longer excluded and guard reports IGN001 at `.docguardignore:<line>`.
3. **Given** an entry with `expires:2026-02-30` (not a calendar date), **Then** the entry excludes nothing and guard reports IGN003.
4. **Given** `"suppressions": { "requireReason": true }` and an entry with no `# reason`, **Then** guard reports IGN002; the entry still applies.

### User Story 2 - Existing ignore files keep working (Priority: P1)

1. **Given** any `.docguardignore` written before this change whose lines contain no whitespace followed by `#` and no trailing `expires:` token, **Then** the exclusion patterns DocGuard applies are exactly the ones it applied before.
2. **Given** a line `fixtures/  # test data`, **Then** `fixtures/` is excluded (previously the line matched nothing).

### User Story 3 - A reviewer sees the whole suppression policy (Priority: P2)

1. **Given** a project with `.docguardignore` entries, `.docguard.json` ignore arrays, inline `docguard:ignore` pragmas, validator and section N/A markers and a baseline, **When** `docguard ignore` runs, **Then** every one is listed with its scope, reason (or "no reason"), expiry, state and source location, and nothing is written.

### User Story 3b - An ignore pattern means what gitignore says it means (Priority: P1)

1. **Given** `securityIgnore: ["**/fixtures/**"]` and a secret in `fixtures/keys.js`, **Then** the secret scan skips it.
2. **Given** `notes?.md`, `[!ab].md`, `x(1).md`, `a|b` or `/build`, **Then** each matches what gitignore would (`a|b` and `x(1).md` literally; `/build` only at the root), and an unclosed `[` is a literal character instead of an error.
3. **Given** any pattern without those characters and without `**/`, **Then** it matches exactly the paths it matched before.

### User Story 4 - An auditor reads a claimspec `ignore` document that does not lie (Priority: P2)

1. **Given** `.docguardignore` entries with reasons, **When** `docguard ignore --format claimspec` runs, **Then** stdout is a claimspec v1 `ignore` document that validates against the vendored schema, holding one `path` entry per exportable line with its reason, and `expires` set to the first instant after the stated day.
2. **Given** entries without a reason, with a reason shorter than eight characters, with an unreadable expiry, or with a pattern gitignore syntax cannot express with the same scope, **Then** none is exported, each is listed on stderr with why, and stderr says the document is not the whole policy.
3. **Given** config arrays, inline pragmas, N/A markers or a baseline, **Then** none is exported and each is counted on stderr.

## Requirements *(mandatory)*

- **FR-001**: A `.docguardignore` pattern line MAY end with `# <reason>`, where `#` is preceded by whitespace, and MAY carry `expires:YYYY-MM-DD` as the last whitespace-separated token before that comment. A line whose first non-blank character is `#` stays a comment. A `#` not preceded by whitespace stays part of the pattern.
- **FR-002**: A `.docguardignore` line containing neither whitespace followed by `#` nor a trailing `expires:` token MUST produce exactly the pattern it produced before this change, so every such file applies the same exclusions.
- **FR-003**: An entry with an expiry applies through the end of that UTC day. From the next UTC day it MUST exclude nothing, in every command and validator that reads `.docguardignore`.
- **FR-004**: An entry whose `expires:` value is not a real calendar date, or a line with an expiry or reason and no pattern, MUST exclude nothing.
- **FR-005**: A Suppressions validator (`validators.suppressions`) MUST report IGN001 for each expired entry, IGN003 for each entry FR-004 disables, and, when `suppressions.requireReason` is `true`, IGN002 for each entry with no reason, each at `.docguardignore:<line>`. IGN002 does not disable the entry. The validator is not applicable when `.docguardignore` has no entries.
- **FR-006**: DocGuard MUST build one in-process model of every native suppression: `.docguardignore` entries, `.docguard.json` `ignore`, the validator-scoped arrays (`securityIgnore`, `todoIgnore`), inline `docguard:ignore` / `docguard:ignore-secret` pragmas with the reason written after the code list, `docguard:validator <key> n/a` and `docguard:section <id> n/a` markers, and `.docguard.baseline.json` fingerprints. Each entry records its kind, pattern or codes, scope, reason (or null), expiry (or null), state and source file with line or config key. No reason is ever synthesised.
- **FR-007**: `docguard ignore` MUST list that model (text, or `--format json` including the export report) and write nothing.
- **FR-008**: `docguard ignore --format claimspec` MUST write to stdout a claimspec v1 `ignore` document containing only `.docguardignore` entries that have a reason of 8 to 2000 characters, a readable or absent expiry, and a pattern whose DocGuard scope gitignore syntax states exactly (DocGuard matches a slash-containing pattern below any directory, so it is written with a `**/` prefix, and a trailing `/` is dropped; each rewrite is reported). Expired entries are exported with their `expires`. `expires` is the first instant after the stated day (`2026-12-31` → `2027-01-01T00:00:00Z`). Every other suppression is omitted and reported on stderr with why, together with whether the document is the complete policy.
- **FR-010**: The ignore matcher (`globToRegex`, behind `buildIgnoreFilter` and `shouldIgnore`, so `config.ignore`, `securityIgnore`, `todoIgnore`, `documentLifecycle` and `.docguardignore`) MUST read `?` as one non-`/` character, `[…]` as a gitignore bracket expression (`!`/`^` negation, ranges, never `/`; unclosed `[` literal), `\x` as a literal `x`, `**/` at the start or after `/` as zero or more directories, and a leading `/` as a root anchor. Every other regular-expression character MUST be literal; `{a,b}` is literal (never claimed). A pattern containing none of `? [ ] ( ) + ^ $ | { } \ §`, no leading `/` and no segment `**/` MUST match exactly the paths it matched before; a pattern with a segment `**/` and no such characters MUST only gain matches.
- **FR-011**: The claimspec export MUST export every reasoned entry whose pattern now reads the same in DocGuard and gitignore (FR-010), including `?`, bracket expressions, escapes, literal metacharacters, root-anchored and whole-segment `**` patterns, and MUST still refuse a leading `!`, a `**` inside a segment, an unclosed `[` and a POSIX class.
- **FR-012**: The top-level `documentLifecycle` pattern array MUST be declared in `schemas/docguard-config.schema.json` and documented in `docs/configuration.md`.
- **FR-009**: The claimspec `ignore` and `common` schemas MUST be vendored byte-identical with their source revision recorded, and checked by a dependency-free validator that supports exactly the keywords those schemas use from the `ignore` root and refuses any other. The writer validates every document before printing it and prints nothing (exit 1) if validation fails. The validator accepts claimspec's conformance example and rejects its two invalid `ignore` cases.

## Success Criteria *(mandatory)*

- **SC-001**: Each requirement above has a test that fails before the change and passes after, including the old-parser equivalence check over this repository's `.docguardignore`, an expired, an invalid and a reason-less entry run through `guard`, and a before/after matcher table over this repository's `.docguardignore`, the benchmark fixture's and a crafted corpus against every tracked file.
- **SC-002**: The full suite passes, `docguard guard` on this repository reports no new finding, and every claimspec document the tests emit validates against the vendored schema.

## Out of Scope

- **Reasons on `.docguard.json` arrays.** `ignore`, `securityIgnore` and `todoIgnore` stay string arrays; changing them to objects is a config schema change. They are listed without a reason and never exported. `suppressions.requireReason` covers `.docguardignore` only, where a reason can be written.
- **Exporting validator-scoped, code-scoped and marker suppressions.** claimspec's kinds are `path`, `claim`, `fault` and `fingerprint`. A `securityIgnore` pattern written as `path` would widen it to every tool; a `docguard:ignore SEC001` pragma is scoped to a code and a line; N/A markers are scoped to a validator or a section. None has an exact claimspec kind, so all are counted, not exported.
- **The baseline.** `.docguard.baseline.json` maps to claimspec `baseline`, which #420 defers until claimspec specifies the fingerprint preimage and the method/outcome token. Its fingerprints are listed and counted, not exported as `ignore` entries.
- **`by` and `at`.** `.docguardignore` records neither, so neither is written.
- **Enforcing reasons on inline pragmas.** `docguard ignore` shows which pragmas lack a reason; making a reason mandatory there is a separate decision.
