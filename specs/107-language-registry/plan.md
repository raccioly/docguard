# Implementation Plan: One Language Registry

**Spec**: [spec.md](spec.md) (`docguard.language-registry`)

## Summary

`cli/shared-languages.mjs` gains `LANGUAGES` and the derived sets. Each consumer replaces its literal list:

| Consumer | Now |
|---|---|
| `shared-project-evidence`, `shared-drift`, `inventory`, `generate`, `docs-diff`, `reference-existence`, `traceability` | `codeExtensions()` |
| `reconciliation`, `requirement-evidence` (tests), `doc-ownership`, `scanners/aidlc`, `validators/aidlc` | code plus scripts and their formats |
| `verify`, `hooks`, `impact`, `score-dora`, `changelog`, `diff-suspicion`, `shared-sync-scope` | `codePathPattern()` |
| `freshness`, `init`, `watch`, `todo-tracking`, `speckit`, `security` | `CODE_EXTENSIONS` / `codeExtensions(extra)` |
| `trace`, `semantic-claims`, `instruction-audit`, `diff-suspicion` file names | `codeExtensionAlternation(extra)` |
| `anchors` | the lexer extensions, scripts and YAML |
| `pattern-lexer`, `shared-source` | `LEXER_BY_EXTENSION`, `LANGUAGE_NAMES`, comment families |

Exempt, with a reason: `shared-source` env scan, `schemas` ORM readers, `shared-trace-patterns` naming conventions, `docs-sync` readers. `api-surface` skips the Salesforce DX framework name.

## Decisions

1. **Shell is not code.** `.sh` is in nearly every repository; scanners that read it already add `SCRIPT_EXTENSIONS`.
2. **Group, not union, for parsers.** A reader-bound list stays local, so no validator claims a language it cannot read.
3. **SEC011 naming withdrawn.** The secret scan reads every registry language, so no named language is left unscanned.
