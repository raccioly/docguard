# Implementation Plan: Truthful, Machine-Clean Command Output

**Branch**: `fix/output-ux` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/shared.mjs`: the `c` palette is decided once at load by
  `colorEnabled(env, stream)` (FR-002). Every command already prints through
  `c`, so no call site changes.
- `cli/docguard.mjs`: `--stdout` joins the headless set (no banner). Help for
  `upgrade` describes both jobs and `--schema-only`; `review --suggest` with no
  document parses as a usage error (FR-001, FR-006, FR-012).
- `cli/commands/guard.mjs`: the `--changed-only` note goes to stderr in
  machine formats. Doc Sections reports as `docSections`, with `structure`
  as its fallback for the enable switch, severity and N/A markers (FR-001,
  FR-008).
- `cli/commands/fix.mjs`: `--doc` builds its prompt as a string and emits
  `{ doc, action, prompt }` in JSON mode (FR-001).
- `cli/commands/sync.mjs`: compute drift for every document, then skip
  writing where `--force`/`--allow-partial` are missing, and say so with the
  exact command. Verify `--since` with `git rev-parse`. Review only existing
  human sections (FR-003–FR-005).
- `cli/validators/generated-staleness.mjs`: GST002's command includes
  `--force` when the document is neither generated nor mapped (FR-003).
- `cli/commands/upgrade.mjs`: `--schema-only`; the schema note suggests it
  (FR-006).
- `cli/commands/init.mjs`: one `buildInitConfig` used by the skeleton and the
  smart path; smart init writes it when absent (FR-007).
- `cli/config.mjs`: `autoDetectProjectType` falls back to
  `detectProjectProfile` for non-JavaScript ecosystems (FR-015).
- `cli/scanners/doc-ownership.mjs`, `cli/commands/trace.mjs`: loose-file
  roots, existing-doc suggestions, tie reporting (FR-009).
- `cli/scanners/instruction-scopes.mjs`: `claudeImports()` resolves `@path`
  imports (5 hops); `applicableFor('claude')` appends imported files.
  `cli/validators/path-scoped-rules.mjs`: PSR002 for missing imports; PSR003
  counts imported bytes through `applicableFor` (FR-011).
- `cli/scanners/doc-references.mjs`: `agentInstructions` searches every
  instruction file and carries `text`; `doc_structure` byte count (FR-010,
  FR-014).
- `cli/commands/review.mjs`, `cli/scanners/doc-deps.mjs`,
  `cli/validators/reference-existence.mjs`: FR-012, FR-013, FR-016.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/output-ux.test.mjs` builds temporary git
projects per scenario, runs the CLI as a subprocess and asserts on stdout,
stderr, exit codes and files. Colour is tested with a pseudo-TTY-free
approach: `colorEnabled()` is a pure function of env and `isTTY`, and one
subprocess test checks a pipe with and without `FORCE_COLOR`.

## Research decisions

- **Colour decided once, at load.** Decision: `c` keeps its shape; its values
  are empty strings when colour is off. Rationale: every command already prints through it, so call sites
  stay unchanged. Stdout's TTY
  state decides, because the artifacts that colour corrupts are on stdout.
  Rejected: a `--no-color` flag (NO_COLOR is the convention).
- **Changed-only note.** Decision: stderr in machine formats, stdout in text.
  Rejected: dropping it (it explains why fewer validators ran).
- **Sync computes drift before deciding to skip.** Decision: a document not
  marked generated is still compared, so sync can say which sections are
  stale and that `--force` writes them. Rejected: GST002 alone changing its
  advice (the loop also starts from `sync` itself).
- **`--since` bad ref.** `git rev-parse --verify --quiet <ref>^{commit}`; a
  non-repository keeps the documented "git unavailable" fallback.
- **`upgrade --schema-only`.** Decision: a flag that skips the npm fetch and
  the global install. Rejected: rewording the note only (the suggested command
  would still install software as a side effect of a schema fix).
- **`docSections` key with a `structure` fallback.** Decision: the result key
  changes; the switches inherit. Rejected: renaming STR003 or moving it to a
  new code (its contract is unchanged; only the result key collided).
- **Ownership loose files.** Decision: a file directly in the parent of a
  detected module (e.g. `src/` for `src/api`) belongs to that parent as a
  root, but only files directly there. Rejected: making `src` a root (its
  modules would then be double-counted).
- **Imports.** A token `@path` at line start or after whitespace, outside
  code, whose path ends in a file extension. Relative to the importing file;
  `~` and absolute paths are outside the project and skipped. Depth 5, cycle
  safe. Rejected: following extension-less tokens (`@babel/parser` is a
  package name in prose).
- **Tracked-only glob fingerprints.** `listTrackedFiles` (spec 033), walk
  outside git, as spec 034 does for ownership.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| VIII (deterministic core) | `--schema-only` makes the schema fix offline; nothing else adds network use. |
| IX (honest assurance) | Every changed message states what happened (skipped, tied, not found) instead of a success claim. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/shared.mjs, cli/docguard.mjs
cli/commands/{guard,fix,sync,upgrade,init,trace,review,rules}.mjs
cli/config.mjs
cli/scanners/{doc-ownership,instruction-scopes,doc-references,doc-deps}.mjs
cli/validators/{generated-staleness,path-scoped-rules,reference-existence,structure}.mjs
cli/findings.mjs                     # STR003 → docSections validator key
tests/output-ux.test.mjs             # NEW
tests/sync-since.test.mjs            # bad ref now exits 1
docs/commands.md, docs/configuration.md, docs-canonical/DATA-MODEL.md, CHANGELOG.md
testguard.claims.json                # OUTPUT-UX-TRUTHFUL
```
