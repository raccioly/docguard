# Implementation Plan: Fixes From Dogfooding, Round 2

**Branch**: `spec/061-dogfood-round-2` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | `cli/validators/docs-diff.mjs` exports `configuredTestPatterns` and `extractDocumentedTests`; DDF002 and `cli/commands/diff.mjs` both read documented tests through it, and `collectCodeTests` reads the same patterns. Pattern matching reuses `compileGlob` from `cli/shared-ignore.mjs`. |
| FR-002, FR-003 | `cli/shared-source.mjs` gains `detectCodeTechnologyEvidence`, which returns one `{ tech, file, signal, kind }` per technology. Manifests are read first; one walk then reads product source, scripts, CI workflows and compose files only for DynamoDB and Docker when no manifest named them. `detectCodeTechnologies` becomes its projection, so `generate` and `memory` stay in step with the check. |
| FR-004 | `validateDocsDiff` appends `(file: signal)` after a text-detected technology in DDF001's "in code but not documented" list. `diff` prints the source next to each detected technology and adds an `evidence` map to its JSON. |
| FR-006 | `TECH_PATTERNS` gains `TypeORM` and `Sequelize` after Drizzle; `TECH_DEPENDENCIES` maps `typeorm` and `sequelize`. |
| FR-005 | `cli/validators/security.mjs` `isPasswordLabel(key, value)` skips label values before the prose and blocking branches. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; reproductions in `tests/dogfood-round-2.test.mjs`. Existing `tests/docs-diff.test.mjs`, `tests/field-diff-precision.test.mjs`, `tests/security.test.mjs`, `tests/field-context-precision.test.mjs` and `tests/field-report-3.test.mjs` must keep passing.

## Research decisions

- **One definition of a documented test.** The docs side keeps the `.test.`/`.spec.` regex and adds a second pass over backticked tokens that match a configured pattern. Rejected: replacing the regex with "any backticked token that exists on disk", which would turn every file name in the TEST-SPEC into a test claim.
- **Basename matching for patterns.** A TEST-SPEC usually lists bare file names. A bare token is tested against the pattern's last segment (`tests/**/test_*.py` → `test_*.py`), the same leniency the existing doc matcher gives bare `.test.` names.
- **Text signals only where the string cannot mean anything else.** `DynamoDB_<8 digits>.` is the service's wire target prefix, and `docker run` in a script is a command. Rejected: matching the word "dynamodb" or "redis" anywhere, which fires on comments, error strings and docs-in-code. The regexes are written so their own source text does not match them, and DocGuard's own tests sit in non-product paths.
- **Scan only what a manifest did not already find.** When `package.json` names `@aws-sdk/client-dynamodb`, the source walk does not read files for DynamoDB. The walk stops reading once both technologies are found, so the extra cost is bounded by one pass that already ran for `.tf`.
- **Annotate only text-detected technologies in DDF001.** The baseline fingerprint covers the message. Adding a file name to manifest-detected technologies would resurrect every baselined DDF001 finding (spec 052). Text-detected technologies are new findings, so they carry their file from the start.
- **Skip password labels rather than lowering their confidence.** A low-confidence warning still costs every i18n project a pragma. A label value is classified, not guessed: it must be a known word for password (or a short phrase built around one, or the key's own words), start like copy (uppercase or a caseless script), and sit under a key that is not a constant name. `password: 'password'` and `DB_PASSWORD = 'Password'` stay blocking.
- **TypeORM and Sequelize are named; Mongoose is not.** Prisma and Drizzle are named because the ORM is a technology choice the architecture should state, and spec 056 makes TypeORM and Sequelize model sources of the same rank. Without a name their projects had no ORM signal at all, since the database behind them varies. Mongoose already yields MongoDB, the technology an architecture states; naming it as well would add a new "in code but not documented" warning to every Mongoose project whose doc already says MongoDB, for no new fact. Rejected: naming Mongoose for symmetry.
- **No suppression mechanism here.** #526 also asks for a reasoned suppression of document-level findings; spec 057 owns suppression reasons and expiry.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added; globbing reuses `compileGlob`. |
| IV (consistent filtering) | The new walk uses `walkFiles`, `shouldIgnore` and `isNonProductPath`. |
| IX (honest assurance) | Each text-detected technology names its file; real credentials still fire. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/validators/docs-diff.mjs          # FR-001, FR-004
cli/commands/diff.mjs                 # FR-001, FR-004
cli/shared-source.mjs                 # FR-002, FR-003, FR-006
cli/validators/security.mjs           # FR-005
cli/findings.mjs                      # DDF001, DDF002, SEC001 help text
tests/dogfood-round-2.test.mjs        # NEW
docs/configuration.md, docs/reference/findings.md (generated), docs-canonical/ARCHITECTURE.md
CHANGELOG.md
```
