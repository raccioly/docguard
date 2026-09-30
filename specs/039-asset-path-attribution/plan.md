# Implementation Plan: Reviewed Asset Paths for Spec Reconciliation

**Branch**: `feat/asset-path-attribution` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/scanners/spec-registry.mjs`: `reviewed.scope` accepts `assetPaths`.
  - Validated like `sourcePaths` (safe repository-relative paths), plus a
    rejection of wildcards.
  - Kept sorted and unique, and serialized only when set, so existing
    registries are unchanged (FR-001, FR-004).
  - Exports `assetPathCovers(assetPath, file)`: a trailing `/` means a
    directory prefix; anything else must equal the file.
- `cli/scanners/reconciliation.mjs`: `directSpecLinks` also links a file that
  any spec's `assetPaths` covers (FR-002).
- `cli/validators/spec-registry.mjs`: `SPR009` for an asset path that covers
  no tracked file (`listTrackedFiles`, with a walk fallback outside git)
  (FR-003). The code is registered in `cli/findings.mjs`.
- `.docguard-specs.json`: `docguard.symbol-map` lists its seven frozen assets
  (FR-005).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. A git fixture shows:
- an unannotated file under an asset path is linked;
- a file outside it stays unsupported;
- the reconciliation plan and completion blockers match.

The repository-level SC-001 check runs the real 017 maintenance plan.

## Research decisions

- **Directory prefixes and exact files, no globs.**
  - Decision: `dir/` or `path/to/file`.
  - Rationale: a reviewer must be able to read the list and know what it
    claims; a glob widens silently as files are added.
  - Rejected: `*` and `**` patterns.
- **The field's home.**
  - Decision: `reviewed.scope`, next to `canonicalDocs` and `sourcePaths`.
    It is reviewed intent, not observed evidence: `specs --write` never
    derives or rewrites it.
- **SPR009 as a warning.** An unmatched path grants nothing, because it
  covers no file. Reporting it stops the list rotting into a false record.
  It is an `act` finding: remove or fix the path.
- **Tracked files.** `listTrackedFiles` (spec 033). Outside git, the
  directory walk is used, as spec 034 does.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | Attribution is explicit and reviewed; nothing is inferred; stale entries are reported (SPR009). Unlisted files keep today's unsupported classification. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/spec-registry.mjs      # assetPaths validation, assetPathCovers
cli/scanners/reconciliation.mjs     # link covered files
cli/validators/spec-registry.mjs    # SPR009
cli/findings.mjs                    # SPR009 registry entry
schemas/docguard-specs.schema.json  # assetPaths
.docguard-specs.json                # symbol-map assets
tests/asset-path-attribution.test.mjs   # NEW
docs-canonical/DATA-MODEL.md, docs/commands.md, CHANGELOG.md
testguard.claims.json               # ASSET-PATHS-ATTRIBUTE-EXACTLY
```
