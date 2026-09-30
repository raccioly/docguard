# Tasks: Update Awareness Without Network Calls

**Status**: Complete. SC-001–SC-004 hold: 16 tests, including subprocess runs of a copied install dated 14 and 15 days back; claim UPDATE-HINT-IS-LOCAL-AND-SILENT-WHEN-UNSURE 12/12 faults killed.
**Spec**: `specs/038-update-awareness/spec.md`
**Plan**: `specs/038-update-awareness/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/update-awareness.test.mjs`:
  - `releaseAge` against install-directory fixtures with an injected clock and
    environment: 15 days shows the note, 14 does not;
  - every suppression reason (opt-out, source checkout, missing CHANGELOG, no
    heading, a heading inside a code fence, bad date, clock before release);
  - the note's wording on each surface: version, date, "may", `docguard upgrade`,
    and a day count on footer and MCP but not in the pack (FR-001–FR-003,
    FR-005, SC-001).
- [x] T002 `tests/update-awareness.test.mjs`: a copied install directory dated
  15 days back:
  - guard text ends with the note, and `CI` silences it;
  - `guard --format json`, SARIF and JUnit are byte-identical with and without
    `DOCGUARD_NO_UPDATE_HINT` (timings aside);
  - MCP `initialize` carries `instructions` while `tools/list` and a tool call
    are unchanged;
  - `memory --pack --stdout` has the section.

  (FR-004, SC-002, SC-003)
- [x] T003 `tests/update-awareness.test.mjs`: this repository, a source
  checkout, shows no note on any surface (SC-004); every shipped DocGuard skill
  carries the same paragraph (FR-006); `PRIVACY.md` names the registry fetch
  (FR-007).

## Phase 2: Implementation

- [x] T004 `cli/release-age.mjs`: `releaseAge`, `updateHintText`, `UPDATE_HINT_DAYS` (FR-001–FR-003, FR-005).
- [x] T005 `cli/commands/mcp.mjs`: `instructions` on `initialize` (FR-004).
- [x] T006 `cli/commands/guard.mjs`: text footer, with `CI` suppression (FR-004, FR-005).
- [x] T007 `cli/commands/memory.mjs`: `## DocGuard version` pack section (FR-004).
- [x] T008 `extensions/spec-kit-docguard/skills/docguard-*/SKILL.md`: the paragraph (FR-006).

## Phase 3: Docs and verification

- [x] T009 `PRIVACY.md` (FR-007); `README.md`, `docs/configuration.md`, `docs/ai-integration.md`, `CHANGELOG.md` (FR-008); `docs-canonical/ARCHITECTURE.md`, `DATA-MODEL.md`, `ENVIRONMENT.md`, `SECURITY.md`, `TEST-SPEC.md`.
- [x] T010 `testguard.claims.json`: claim UPDATE-HINT-IS-LOCAL-AND-SILENT-WHEN-UNSURE, probed `--confirm 3`; gate; budgets unchanged; `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard`.
