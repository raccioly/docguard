# Implementation Plan: Path-Scoped Agent Rules

**Branch**: `feat/path-scoped-rules` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

- A new scanner, `cli/scanners/instruction-scopes.mjs`, discovers instruction
  files per harness, reads their frontmatter with a small built-in reader, and
  returns `{ file, harness, scope: always|directory|globs|unknown, globs,
  bytes, local, issues }`. Nested `AGENTS.md` discovery reuses
  `measureInstructionChains` (`cli/scanners/agent-instructions.mjs`), which
  gains a nested `CLAUDE.md` variant for Claude Code.
- `resolveInstructionsFor(path, scopes)` in the same scanner answers
  `rules --for` and feeds PSR003. It matches with `compileGlob`
  (`cli/shared-ignore.mjs`).
- Pointer checks reuse the instruction audit. `pathCandidates`,
  `safePointerPath` and `basenameIndex` in `cli/scanners/instruction-audit.mjs`
  become exports. A new `extractInstructionPointers(file, content)` reads every
  line outside fences, including table rows and Markdown links, which
  `extractInstructionRules` skips on purpose.
- A new validator, `cli/validators/path-scoped-rules.mjs`, emits
  PSR001–PSR004. It imports only the scanners and `cli/findings.mjs`.
- A new command, `cli/commands/rules.mjs`, implements `rules --for`.
- The tracked-file list comes from `git ls-files -z` (argv array, no shell),
  added to `cli/shared-git.mjs` as `listTrackedFiles`. Without git it falls
  back to `walkFiles` with the ignore filters and reports `partial`.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (no YAML library; see FR-001)
**Storage**: none
**Testing**: `node:test` fixtures with one rule file per harness
**Performance Goals**: ≤3% guard wall time on this repository (SC-003)
**Constraints**: no network; bounded file count; PSR003 work bounded by
distinct rule sets, not by file count

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | A frontmatter subset reader instead of a YAML package. Unsupported input is reported (PSR004). |
| IV (validator isolation) | The validator imports scanners and shared modules only. The command composes them. |
| V (no prose) | Findings and a resolver listing. No instruction file is edited. |
| VI (safe writes) | Not applicable: nothing is written. |
| VIII (local-first) | Harness formats are verified once by a maintainer and recorded; nothing is fetched at run time. |
| IX (honest assurance) | `unknown` scope and `partial` coverage are reported, never folded into "matches nothing" or a pass. |

Pass.

## Project Structure

```text
cli/scanners/instruction-scopes.mjs      # NEW: discovery, frontmatter subset reader, scopes, resolver
cli/scanners/agent-instructions.mjs      # expose nested CLAUDE.md chains alongside AGENTS.md
cli/scanners/instruction-audit.mjs       # export pointer helpers; extractInstructionPointers
cli/shared-git.mjs                       # listTrackedFiles (git ls-files -z)
cli/validators/path-scoped-rules.mjs     # NEW: PSR001–PSR004
cli/findings.mjs                         # PSR001–PSR004
cli/commands/guard.mjs                   # register the validator
cli/commands/rules.mjs                   # NEW: rules --for
cli/docguard.mjs                         # command, help, --for, --harness
cli/config.mjs, schemas/docguard-config.schema.json   # validators.pathScopedRules
.docguard.json                           # surfaceSync commands list if `rules` is excluded there
README.md, docs/commands.md, docs/configuration.md, docs/ai-integration.md
docs-canonical/ARCHITECTURE.md           # component map row
tests/path-scoped-rules.test.mjs         # NEW
tests/fixtures/path-scoped-rules/        # NEW: five-harness fixture
testguard.claims.json                    # PATH-SCOPED-RULES-REPORT-DEAD-SCOPES
```

## Design notes

- PSR003 groups tracked files by the sorted list of rule files that apply to
  them. Each group is one candidate. The finding names the first path in the
  group, in path order, so output is stable.
- Load order in `rules --for` follows each harness: root to leaf for
  directory files, then path-scoped files in path order. The order is a
  display choice; the byte total does not depend on it.
- README's validator and command counts change. Canonical-Sync (CSY001,
  CSY002) will fail until they are updated, which is intended.
