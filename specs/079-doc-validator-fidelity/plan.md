# Implementation Plan: Document Validators Agree With Each Other and Do Not Score a Blank Template

**Branch**: `fix/validator-heading-brace-negation-scaffold` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | `cli/validators/environment.mjs`: `hasHeading(regex)` becomes `docHasSection(content, '## Setup Steps') \|\| docHasSection(content, '## Prerequisites')` for ENV001 and `docHasSection(content, '## Environment Variables')` for ENV002. Both import from `cli/shared.mjs`, the module STR003 uses. |
| FR-002 | `cli/validators/docs-diff.mjs`: a new exported `expandBraces(token)` (single level, product of groups, cap 64, literal on any malformed input). `extractDocumentedTests` expands each backticked token before the test-file rules, so `diffTests` and `diff` receive expanded paths. |
| FR-003, FR-004 | `cli/validators/docs-diff.mjs`: `mentionsCurrentTechnology` evaluates negation against the clause prefix, not the slice since the previous technology. A new `negatedByList(prefix)` finds the nearest negator whose coordinated list reaches the mention; a new `removalBefore` / `removalAfter` pair carries the verbs of FR-004. `replaced X with Y` is handled by cutting the clause at `with`/`by` for the replaced technology only. |
| FR-005 | `cli/validators/docs-diff.mjs`: `withoutChangeRecords(markdown)` drops the sections of FR-005 before `mentionsCurrentTechnology` runs. |
| FR-006 | `cli/shared-scaffold.mjs` (new): `scaffoldLines(markdown)` normalizes authored lines; `isUneditedScaffold(content, templateContent)` compares them; `templateFor(docPath)` maps a canonical doc to `templates/<NAME>.md.template`. Comments are removed with `visibleMarkdown` from `cli/shared-html-comments.mjs`. |
| FR-007 | `cli/findings.mjs`: STR006 (`docSections`, warn, help). `cli/validators/structure.mjs`: `validateDocSections` reports it for each unedited scaffold among the documents it checks, after STR003. `tests/generated-docs-e2e.test.mjs`: STR006 joins `FILL_THE_TEMPLATE` only. |
| FR-008 | `cli/commands/score.mjs`: `calcDocQualityScore` adds all of a scaffold's checks to `total` and none to `found`, with the failure `unedited scaffold`. |
| FR-009 | `cli/scanners/agent-readability.mjs`: the marker-presence filter excludes `isUneditedScaffold` documents. |
| FR-010 | No code. A test pins that a scaffold yields no DQ finding. |
| FR-012 | `cli/validators/doc-quality.mjs`: `countSyllables` tests `Object.hasOwn(exceptions, word)`; `countSyllables` is exported for the unit test, and a guard `Number.isInteger` assertion is pinned in the test, not at runtime. |
| FR-011 | `cli/findings.mjs` help, `cli/commands/explain.mjs` (`docSections`, `environment`, `docsDiff`), `npm run docs:reference`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`, `npm run llms`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. One file per area, named for the spec: `tests/doc-validator-fidelity.test.mjs` (units for `expandBraces`, `mentionsCurrentTechnology` through `diffTechStack`, `isUneditedScaffold`, and fixtures for every acceptance scenario), plus the extended allow-lists of `tests/generated-docs-e2e.test.mjs`. Existing `tests/environment.test.mjs`, `tests/docs-diff.test.mjs`, `tests/structure.test.mjs` and `tests/score-assurance.test.mjs` run unchanged.
**Constraints**: guard wall time within the CI budget (spec 031); no new dependency; findings only ever removed for FR-001 to FR-005, only added (STR006) for FR-006 to FR-009.

## Research decisions

- **What exists.**
  - STR003 uses `docHasSection` (`cli/shared.mjs`), which normalizes headings (strip `#`, arc42 numbers, punctuation, case) and accepts `SECTION_SYNONYMS`. ENV001 and ENV002 use private anchored case-sensitive regexes.
  - `extractDocumentedTests` (docs-diff) has two paths: a `.test|.spec` backtick regex and, with configured patterns, a glob match for every backticked token.
  - `mentionsCurrentTechnology` splits sentences and clauses, builds the mention list from `TECH_PATTERNS`, and inspects `before` (text since the previous mention) and `after` (text up to the next one).
  - `calcDocQualityScore` hardcodes five documents and their sections; a missing document is skipped without touching `total`.
  - The marker check is a regex over `last-reviewed|section|generated`.
  - `generate --plan --write` writes sections marked `<!-- docguard:generated true -->`; it leaves `@your-github-username` and the unchosen status in the header.
- **Rejected: a case-insensitive flag on the ENV regexes.** It fixes the report and leaves two matchers that can drift. FR-001 removes the second matcher. The cost is that ENV002 also accepts `## Configuration` and `## Environment` (synonyms), so findings only disappear. A/B counts them.
- **Rejected: a verb list for "this clause is negated".** A word list guesses. FR-003 anchors on a negator and requires the words between it and the technology to be a short coordinated list with no verb of a closed set, which is checkable on the clause text.
- **Rejected: detect a scaffold by placeholder heuristics** (`<!--` only bodies, `@your-github-username`, a `|` in the status). `generate --plan --write` leaves the owner and status in place, so spec 044 SC-001 forbids a finding on them, and a heuristic misses REQUIREMENTS-style example rows. Comparing authored lines with the shipped template is exact, handles every template, and fails in the safe direction: a document that drifted from its template is treated as edited.
- **Rejected: per-section emptiness in the score.** It would lower scores of partly written documents; the report is about a document with nothing in it. Recorded in Out of Scope.
- **Rejected: a docQuality fix inside the DQ validators.** They emit findings, and zero sentences emit none; the defect is in `score.mjs`.
- **Order of checks for FR-006.** Strip comments, then drop headings, blank and separator lines, the `Metadata` table, empty-cell rows, ISO dates and the placeholder owner; then compare normalized lines with the same transformation of the template. The comparison is a subset test: a document that deleted template lines is still a scaffold.
- **Baselines.** DDF001/DDF002 messages list names; when part of a list clears, the message changes and its baseline fingerprint changes with it. A finding that does not change stays byte-identical.

## Project Structure

```text
cli/validators/environment.mjs                # FR-001: docHasSection for ENV001/ENV002
cli/validators/docs-diff.mjs                  # FR-002 expandBraces; FR-003–FR-005 negation, withoutChangeRecords
cli/shared-scaffold.mjs                       # NEW FR-006: isUneditedScaffold, scaffoldLines, scaffoldEvidence
cli/validators/structure.mjs                  # FR-007: STR006
cli/commands/score.mjs                        # FR-008: calcDocQualityScore
cli/scanners/agent-readability.mjs            # FR-009: marker-presence
cli/validators/doc-quality.mjs                # FR-012: Object.hasOwn in countSyllables
tests/doc-validator-fidelity.test.mjs         # NEW: FR-001–FR-012
tests/generated-docs-e2e.test.mjs             # FR-007: STR006 allow-lists
cli/findings.mjs, cli/commands/explain.mjs, docs/reference/findings.md,
docs-canonical/ARCHITECTURE.md, docs-canonical/TEST-SPEC.md,
CHANGELOG.md, llms*.txt                       # FR-011
```

## Risks

| Risk | Mitigation |
|---|---|
| A real document is classed as a scaffold | Subset test against its own template; any added prose line makes it edited. A/B on every local project; zero STR006 expected on documents with content. |
| `generate --plan --write` output classed as a scaffold | `docguard:generated` marker exemption plus SC-001 e2e for five stacks. |
| Negation widens and hides a real drift | FR-003 requires a negator and a short verb-free list; clause breaks end scope. A/B hand review of every removed DDF001. |
| Brace expansion explodes | Cap 64, no nesting. |
| Template changes later strand an old scaffold | Only hides STR006; a test pins that every shipped template is a scaffold of itself. |
| Anchor lock and TestGuard claims | Accept anchors only for touched files; re-check each claim `find` string in the four edited files matches once. |

## Verification

`npm test`; `node cli/docguard.mjs guard` on this repository; `npm run docs:reference`, `npm run llms` drift tests; `npm run budget -- --base <base-worktree>`; TestGuard gate; hermetic A/B (fresh `git archive` per CLI, no concurrent load) on this repository and the local projects; hand review of at least 20 changed findings.
