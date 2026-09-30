# Implementation Plan: Honest Coverage for Fallback Languages

**Branch**: `fix/fallback-language-coverage` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/shared-source.mjs`:
  - `summarizeTiers` also returns `patternOnly` (the `fallback-language`
    count) and `fallbackLanguages` (display names, when items carry a `file`).
  - `tierApplicability` reports `partial` for `fallback-language`. The
    reason names the languages. The `regex-fallback`-only message is kept
    byte for byte (FR-001).
  - `grepEnvUsage`:
    - per-language env patterns (FR-003);
    - Spring config placeholders (FR-003);
    - `unscanned` counts per language for source files that have no env
      patterns (FR-004);
    - walks prune non-product directories by path (FR-006).
  - the env scan also reads a root-level Go module's `.go` files and a
    Gemfile project's `config/**/*.rb`; `resolveSourceRoots` is unchanged, so
    no other scanner widens (FR-005).
  - `LANGUAGE_NAMES` and `unanalysedLanguages()` are shared by the import
    graph and the env scan.
- `cli/shared-ignore.mjs`: `isNonProductPath` exempts package segments.
  `isNonProductDir(name, config, parentRel)` applies the same rule when given
  the parent path. The comment says what callers do (FR-006, FR-007).
- `cli/scanners/routes.mjs`:
  - Spring, Rails, Go and Rust routes carry `fallback-language`.
  - A non-enumerable `scan` records the tier over every file read, the files
    read, whether the cap truncated the scan, the detected frameworks and the
    routes dropped as non-product (FR-002, FR-007, FR-008, FR-009).
  - `findFiles` goes to depth 32 with a 20,000-file cap.
- `cli/validators/api-surface.mjs`:
  - uses the scan tier for coverage;
  - reports the empty scan of a detected framework, the truncated scan and
    the excluded non-product routes (FR-001, FR-007, FR-008, FR-009).
- `cli/validators/environment.mjs`:
  - `partial` for languages with no env patterns (FR-004);
  - ENV003 carries `fallback-language` when a variable it names was read from
    a pattern-only language (FR-002 applied to env findings).
- `cli/commands/diff.mjs`: an Environment Variables `limitation` line and
  JSON field (FR-004).
- `cli/scanners/import-graph.mjs`: `graph.unanalysedFiles` lists product
  source files in languages the graph does not read (FR-010).
- `cli/scanners/symbol-map.mjs`, `cli/scanners/module-diagram.mjs`: name
  those languages (FR-010).
- `cli/scanners/project-type.mjs`, `cli/scanners/inventory.mjs`: pass the
  parent path to `isNonProductDir` (FR-006).
- Docs (FR-011): README, `docs-canonical/ARCHITECTURE.md`,
  `docs-canonical/DATA-MODEL.md`, `schemas/docguard-config.schema.json`,
  `cli/commands/explain.mjs`, `cli/findings.mjs` (ENV003 help), CHANGELOG.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/fallback-language-coverage.test.mjs` builds
temporary Go, Spring (Maven layout) and Rails projects. It reproduces each
defect before the fix: `checked` coverage, `not-applicable` tiers, zero Go
env reads, zero Spring routes, the `com.example` exclusion, the depth-5 stop
and the "No import edges" text. It then asserts the fixed behaviour. Express
and Flask controls guard SC-002.

## Research decisions

- **End the `fallback-language` exemption rather than relabel it.**
  - Decision: `partial`, with a reason that differs from `regex-fallback`.
    For `regex-fallback`, a parser existed and was missing. For
    `fallback-language`, no parser exists.
  - Rationale: for a reader the consequence is the same. A route or env read
    in a form the patterns do not match is not seen. `checked` claimed
    otherwise, and the README already promised `partial`.
  - Rejected: a new applicability state. Consumers already understand
    `partial`, and `INCOMPLETE_COVERAGE_STATES` counts it.
- **Environment coverage keys on "no patterns", not on the tier.**
  - Env reads are matched by pattern in every language, JS and Python
    included. Marking Go partial and JS complete would be arbitrary.
  - The real gap is a language with no patterns at all, so that is what
    `partial` reports.
  - ENV003 still carries `fallback-language` when a variable it names came
    from a pattern-only language, so the finding channel stays accurate.
- **Patterns are gated by extension.** A Go pattern runs only on `.go` files,
  so one language's form cannot match inside another's file. The existing
  JS and Python patterns keep running on every scanned extension, as today,
  so their results are unchanged (SC-002).
- **Spring placeholders are read from config files only.** The files are
  `application*` and `bootstrap*` `.yml`, `.yaml` and `.properties`. Only
  upper-snake names are read, because `${server.port}` is a property
  reference, not an env var. YAML quoting is common, so the string/comment
  lexer is not used there. Comment lines are dropped instead.
- **Package segments, not a narrower examples list.**
  - Removing `example` from the non-product set would readmit every
    top-level `example/` directory.
  - Instead, a segment is exempt when it is structurally a package name:
    below `src/main/<jvm-language>/`, or directly after a reverse-domain root
    or Go `internal`.
  - `src/test/java/...` stays non-product through its `test` segment.
- **Depth 32 plus a file cap, not unbounded.**
  - `readdirSync` with `withFileTypes` does not follow symlinked
    directories, so the walk cannot loop.
  - Depth 32 still bounds a pathological tree, and the 20,000-file cap bounds
    reading. Hitting the cap is disclosed as `partial` rather than silently
    truncating.
- **The "confirm these are fixtures" note.**
  - The comment promised a note that no caller emitted.
  - The route surface is where it matters: an empty surface must say that
    routes were excluded as fixtures.
  - The env scan prunes those directories without reading them, so it
    cannot count them; the comment now says so.
- **Unanalysed languages are a caption, not `partial`.**
  - `partial` in the module graph means the result depends on the machine
    (a missing `python3`). A Go file is unread on every machine.
  - Treating it as `partial` would make `sync --write` refuse the section.
    This follows the existing rule for dynamic Python imports.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added; still no parser for pattern-only languages. |
| IV (no validator imports a validator) | New helpers live in `shared-source.mjs` and `shared-ignore.mjs`. |
| IX (honest assurance) | This is the principle the fix restores: no `checked` where facts were unseen; findings retained. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/shared-source.mjs            # tiers, env patterns, Go/Rails env layouts, language names
cli/shared-ignore.mjs            # package-segment exemption
cli/scanners/routes.mjs          # tiers, scan record, depth/cap
cli/scanners/import-graph.mjs    # unanalysedFiles
cli/scanners/symbol-map.mjs      # names unanalysed languages
cli/scanners/module-diagram.mjs  # names unanalysed languages
cli/scanners/project-type.mjs    # path-aware pruning
cli/scanners/inventory.mjs       # path-aware pruning
cli/validators/api-surface.mjs   # coverage from the scan record
cli/validators/environment.mjs   # unscanned-language coverage, ENV003 tier
cli/commands/diff.mjs            # env limitation
cli/commands/explain.mjs, cli/findings.mjs   # env help text
tests/fallback-language-coverage.test.mjs    # NEW
tests/parser-tier.test.mjs                   # fallback-language is now a gap
README.md, docs-canonical/ARCHITECTURE.md, docs-canonical/DATA-MODEL.md,
schemas/docguard-config.schema.json, CHANGELOG.md
testguard.claims.json            # FALLBACK-LANGUAGE-COVERAGE-IS-PARTIAL
```
