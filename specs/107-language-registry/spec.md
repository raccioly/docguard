# Feature Specification: One Language Registry for Every Scanner

**Feature Branch**: `fix/language-registry`

**Created**: 2026-11-27

**Status**: Active

**Spec ID**: `docguard.language-registry`

**Lineage**: Amends `docguard.field-report-fixes` (spec 106): FR-003's Apex entry becomes one row of a registry of every language, and the SEC011 language naming of FR-004 is withdrawn because the secret scan now reads every registry language. Spec 106's text is not edited.

**Input**: "Finish the Apex class instead of leaving it as a follow-up. Move the per-scanner extension lists onto `cli/shared-languages.mjs` so that no scanner keeps a private language list. Test each scanner with an Apex fixture."

## Problem

Spec 106 added Apex to the five consumers the field report named. About thirty other places under `cli/` keep their own list of source extensions, each a different subset: todo tracking read no Kotlin, Swift or Apex; freshness read no C#; drift comments read no Scala. A language added in one place is missing in the next, and the next field report finds the next gap.

## User Scenarios & Testing

### User Story 1 - A language is added once (Priority: P1)

As a maintainer, I add a language to one registry entry and every scanner that asks "is this file code?" reads it.

**Independent Test**: `tests/language-registry.test.mjs` fails when a line under `cli/` names four or more registry languages without a reasoned exemption.

### User Story 2 - Apex is read everywhere code is read (Priority: P1)

**Independent Test**: one Salesforce DX fixture: a TODO in a `.cls` file is TDO002, a `// DRIFT:` comment is DRF002, an `@implements` tag is an anchor, and API-Surface does not apply.

### Edge Cases

- A list tied to a parser (env-read patterns, Spring routes, ORM schema readers, Docs-Sync's route and service readers, test-name conventions) stays where it is: adding a language there would claim a reader that does not exist. Each carries `LANGUAGE EXEMPTION (tests/language-registry.test.mjs): <reason>`.
- A list that decides a validator's `applies` and is not tied to a reader joins the registry; the validator then applies to projects in the new languages, as it does for the languages it already read.
- Salesforce DX names no route DocGuard reads, so it does not make API-Surface apply.

## Requirements

### Functional Requirements

- **FR-001**: `cli/shared-languages.mjs` holds one entry per language: id, display name, kind (`code`, `script`, `markup`), syntax-tree tier, comment family, pattern lexer, extensions. Every extension belongs to one language.
- **FR-002**: The registry derives `CODE_EXTENSIONS`, `SCRIPT_EXTENSIONS`, `codeExtensions(extra)`, `codePathPattern(extra)`, `codeExtensionAlternation(extra)`, `LEXER_BY_EXTENSION`, the comment-family sets and `LANGUAGE_NAMES`. The pattern lexer, `shared-source.mjs` (names and comment families) and every "is this file code?" scanner read them; a scanner adds only its non-language formats (`.yaml`, `.json`, `.vue`, `.md`).
- **FR-003**: A list tied to one parser stays local with a `LANGUAGE EXEMPTION` comment that gives the reason.
- **FR-004**: A test fails for any other line under `cli/` that names four or more registry languages.
- **FR-005**: Todo tracking, drift comments, anchors, SPK008 evidence and the secret scan read Apex; API-Surface does not apply to a Salesforce DX project for its framework name alone.
- **FR-006**: The CHANGELOG `[Unreleased]` section names each changed code and the exit-code effect.

## Success Criteria

- **SC-001**: The full suite passes by exit code.
- **SC-002**: A hermetic A/B against v0.50.0 on DocGuard and the local projects explains every difference by an FR.

## Verification Notes

- **SC-001**: `npm test` by exit code on the final commit of the pull request.
- **SC-002**: recorded below after the A/B.
