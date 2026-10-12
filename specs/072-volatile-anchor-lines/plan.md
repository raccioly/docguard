# Implementation Plan: Volatile Lines in Requirement Anchors

**Branch**: `feat/volatile-anchor-lines` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

## Summary

One set of marked lines per file, computed once from the comments the tag reader already uses, is passed to every fingerprint function. Each function replaces what lies wholly on a marked line with a placeholder. A file with no `docguard:volatile` in its text takes a fast path that passes an empty set, so its fingerprints are byte-identical to before (FR-004).

| FR | Change |
|---|---|
| FR-001 | `cli/scanners/anchor-tags.mjs`: `volatileLines(comments)` returns the start lines of comments that contain the marker. Each resolver passes the comment list it already has (Babel comments, lexer comments, plain comments), the same sources `realComments` uses. The fast path skips the work when the text has no marker. |
| FR-002, FR-003 | `cli/scanners/fingerprint.mjs` `jsFingerprintV1(node, comments, volatile)`: the JSON replacer returns the placeholder for a node whose `loc` starts and ends on one marked line. `cli/scanners/pattern-lexer.mjs` `floorTokens`/`floorFingerprint(lexed, s, e, volatile)`: non-layout tokens wholly on a marked line become one placeholder per line; the opaque stream of a file with no lexer has its marked lines replaced in place. `cli/scanners/py-anchors.mjs`: the script's `ser()` returns the placeholder for a node with `lineno == end_lineno` on a marked line; each request carries `volatile`. `cli/scanners/ts-decls.mjs` `declarationTokens(node, nameNode, volatile)` and `ts-anchors-child.mjs`: the same for tree-sitter nodes. `cli/scanners/anchors.mjs` passes `volatile` to the python and tree-sitter batches. |
| FR-005 | The resolvers flag an anchor whose floor tokens are all placeholders (`allVolatile`); `cli/scanners/anchors.mjs` reports ANC011; `cli/commands/anchors.mjs` lists it as `info`; `cli/findings.mjs` catalogs it. The validator has no rule for it, so guard never reports it. |
| FR-006 | `action.yml` and `extensions/spec-kit-docguard/extension.yml` gain the marker on their version lines. `.github/scripts/sync-release-version.mjs` already rewrites only the value (both patterns stop at the closing quote); a test pins that the marker survives. The four links are re-accepted once with a reason naming this spec. |
| FR-007 | `docs/commands.md`, `docs-canonical/SECURITY.md`, `docs-canonical/ARCHITECTURE.md` (requirement anchors row), `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`; `npm run llms`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18; the python-ast tier's fixed script (Python ≥ 3.8).
**Primary Dependencies**: none new.
**Testing**: `node:test`. `tests/volatile-anchor-lines.test.mjs` covers every tier (tree-sitter through the fake runtime fixture of spec 070) and the release-cut path; `tests/release-version-sync.test.mjs` gains the marker case.

## Research decisions

- **A placeholder for the whole node, not only literals.** "Literal values only" would be the narrowest rule, but a file with no lexer has no notion of a literal, and Helm's `version: 1.2.3` is an unquoted plain scalar. "What lies wholly on the marked line" is one rule every tier can apply, and it still keeps any construct that crosses the line fully fingerprinted. Rejected: per-language literal detection (five definitions of "value" and a gap in every one).
- **The placeholder hides what changed, never that the marker was added.** Replacing the marked line's nodes changes the fingerprint the moment the marker appears, so a reviewed link turns suspect and the marker is reviewed like any other change (FR-003). Rejected: excluding marked lines from the fingerprint without a placeholder (adding a marker to a line holding only a literal would then change nothing at the floor tier but still hide the value; the placeholder makes the line's presence part of the hash).
- **One marked-line set per file, from the tag reader's comments.** If the exact and floor tiers each found markers their own way, a marker one tier sees and the other does not would make the two fingerprints disagree. The set is computed once and passed down; the python script and the tree-sitter child receive it in their request instead of re-reading comments.
- **Fast path on the marker text.** A file whose text does not contain `docguard:volatile` gets an empty set and runs exactly the code it ran before. That is what makes FR-004 provable rather than likely, and it costs one `includes` per file.
- **No algorithm version change.** `dg1` ships first in 0.45.0, and FR-004 holds for every unmarked file, so no released fingerprint changes. Rejected: `dg2` (a migration for a format no released version wrote).
- **Not in the release workflow.** The release patch's path allowlist and its no-code write job (spec 068) stay as they are. Rejected: re-accepting links in the release PR.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IV (validator isolation) | Scanners only; the validator gains no code path. |
| V (no LLM, no prose) | A literal marker; nothing is inferred. |
| IX (honest assurance) | A marker is a detected change, and an anchor it silences entirely is listed (ANC011). |
| X (spec-first) | Spec, plan and tasks precede code; tests fail first. |

Pass.

## Project Structure

```text
cli/scanners/anchor-tags.mjs          # FR-001, FR-002, FR-005: volatileLines, resolvers
cli/scanners/fingerprint.mjs          # FR-002: jsFingerprintV1
cli/scanners/pattern-lexer.mjs        # FR-002: floorTokens, floorFingerprint, opaque streams
cli/scanners/py-anchors.mjs           # FR-002: ser() placeholder, request.volatile
cli/scanners/ts-decls.mjs, ts-anchors-child.mjs   # FR-002: declarationTokens
cli/scanners/anchors.mjs              # FR-002, FR-005: batches, ANC011
cli/commands/anchors.mjs, cli/findings.mjs        # FR-005
action.yml, extensions/spec-kit-docguard/extension.yml, .docguard-anchor-lock.jsonl   # FR-006
tests/volatile-anchor-lines.test.mjs  # NEW
tests/release-version-sync.test.mjs   # FR-006
docs/commands.md, docs-canonical/{SECURITY,ARCHITECTURE,TEST-SPEC}.md, CHANGELOG.md   # FR-007
```
