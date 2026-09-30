# Implementation Plan: Update Awareness Without Network Calls

**Branch**: `feat/update-awareness` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/release-age.mjs` (new):
  - `releaseAge({ now, env, pkgDir })` reads the running version from
    `package.json` and its release date from the `CHANGELOG.md` beside it,
    and returns `{ version, releasedOn, ageDays, show, reason }`.
  - `updateHintText(age, surface)` renders the one note for the `footer`,
    `mcp` and `pack` surfaces.
  - It makes no network call and has no side effects.
- `cli/commands/mcp.mjs`: the `initialize` result gains `instructions` only
  when the note is shown. The MCP InitializeResult defines `instructions` as
  guidance a client may add to the model's context.
- `cli/commands/guard.mjs`: the text renderer prints the note as its last
  line. The JSON, SARIF and JUnit paths never call it.
- `cli/commands/memory.mjs`: `--pack` adds a `## DocGuard version` section
  before the footer.
- The five `extensions/spec-kit-docguard/skills/docguard-*/SKILL.md` files get
  one identical paragraph.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`
- Pure-function tests with an injected clock and environment.
- Subprocess tests run a copied install directory (`cli/`, `package.json` and
  a `CHANGELOG.md` dated relative to the real clock, with no `.git`), so the
  CLI needs no test-only clock variable.

**Constraints**:
- No network call.
- Machine outputs are byte-identical.
- This repository (a source checkout) sees no change.

## Research decisions

- **Release date source.**
  - Decision: the shipped `CHANGELOG.md` heading for exactly the running
    version.
  - Rationale: release prep already writes it, and all 93 headings match
    `## [X.Y.Z] - YYYY-MM-DD`. It ships in the npm tarball, and MCPB and GHCR
    are built from `npm pack`.
  - Alternatives rejected:
    - a `releaseDate` field written into `package.json` or a generated file at
      publish time: a new release-workflow step and a second source of truth;
    - the package's install time or file mtime: not the release date, and
      reset by reinstalling.
- **Matching the heading.**
  - The version string is escaped before building the pattern.
  - Only a line-start `## [` heading counts, and lines inside fenced code
    blocks are skipped.
  - The date must be a real calendar date: it has to round-trip through
    `Date.UTC`.
- **Age.** Whole UTC days: `floor((now - releasedOnUTC) / 86400000)`. The note
  shows at `ageDays > 14`. A negative age is `clock-before-release`, with no
  note.
- **Source checkout.** `existsSync(join(pkgDir, '.git'))`. It is true for a
  clone (a `.git` directory) and for a linked worktree (a `.git` file), so
  this repository's tests, budgets and self-guard never see the note.
- **Suppression order**, first match wins:
  1. `opt-out` (`DOCGUARD_NO_UPDATE_HINT=1`);
  2. `source-checkout`;
  3. `missing-changelog`;
  4. `no-heading`;
  5. `bad-date`;
  6. `clock-before-release`;
  7. `fresh`.

  `ci` is applied by the guard footer only (the `CI` variable is set to any
  non-empty value other than `false` or `0`), because MCP and pack readers in
  CI are agents that benefit from the note.
- **Clock injection in subprocesses.**
  - Decision: none. Subprocess tests build an install directory whose
    CHANGELOG date is `today - 15` or `today - 14` days.
  - Rejected: a `DOCGUARD_NOW` variable, which would be production surface
    that exists only for tests.
- **Pack wording.** The pack states the release date and the threshold, never
  a day count, so a pack written on two days is identical (spec FR-003).

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| VIII (local-first) | No network call; the note points to `docguard upgrade`, which contacts npm only when the user runs it. `PRIVACY.md` gains the missing line for that fetch. |
| IX (honest assurance) | The note says a newer version *may* exist; it never claims one does. Missing or bad dates produce silence, not a guess. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/release-age.mjs                 # NEW: releaseAge, updateHintText, UPDATE_HINT_DAYS
cli/commands/mcp.mjs                # initialize.instructions
cli/commands/guard.mjs              # text footer
cli/commands/memory.mjs             # pack section
extensions/spec-kit-docguard/skills/docguard-*/SKILL.md   # one paragraph each
tests/update-awareness.test.mjs     # NEW
PRIVACY.md, README.md, docs/configuration.md, docs/ai-integration.md, CHANGELOG.md
docs-canonical/ARCHITECTURE.md, DATA-MODEL.md, ENVIRONMENT.md, SECURITY.md, TEST-SPEC.md
testguard.claims.json               # UPDATE-HINT-IS-LOCAL-AND-SILENT-WHEN-UNSURE
```

## Quickstart (validation)

1. `node --test tests/update-awareness.test.mjs`.
2. Build a copied install directory with its CHANGELOG dated 15 days ago, then:
   - run `node <dir>/cli/docguard.mjs guard --dir <project>`: the last line is
     the note;
   - add `--format json`: the output is identical to the same run with
     `DOCGUARD_NO_UPDATE_HINT=1`;
   - run the MCP `initialize` handshake: `instructions` is present.
3. In this repository, `npm run budget` and `docguard guard` are unchanged.
