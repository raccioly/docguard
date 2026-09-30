# Tasks: Update Awareness Without Network Calls

**Spec**: `specs/038-update-awareness/spec.md`
**Plan**: `specs/038-update-awareness/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/update-awareness.test.mjs`:
  - `releaseAge` against install-directory fixtures with an injected clock and
    environment: 15 days shows the note, 14 does not;
  - every suppression reason (opt-out, source checkout, missing CHANGELOG, no
    heading, a heading inside a code fence, bad date, clock before release);
  - the note's wording on each surface: version, date, "may", `docguard upgrade`,
    and a day count on footer and MCP but not in the pack (FR-001–FR-003,
    FR-005, SC-001).
- [ ] T002 `tests/update-awareness.test.mjs`: a copied install directory dated
  15 days back:
  - guard text ends with the note, and `CI` silences it;
  - `guard --format json`, SARIF and JUnit are byte-identical with and without
    `DOCGUARD_NO_UPDATE_HINT` (timings aside);
  - MCP `initialize` carries `instructions` while `tools/list` and a tool call
    are unchanged;
  - `memory --pack --stdout` has the section.

  (FR-004, SC-002, SC-003)
- [ ] T003 `tests/update-awareness.test.mjs`: this repository, a source
  checkout, shows no note on any surface (SC-004); every shipped DocGuard skill
  carries the same paragraph (FR-006); `PRIVACY.md` names the registry fetch
  (FR-007).

## Phase 2: Implementation

- [ ] T004 `cli/release-age.mjs`: `releaseAge`, `updateHintText`, `UPDATE_HINT_DAYS` (FR-001–FR-003, FR-005).
- [ ] T005 `cli/commands/mcp.mjs`: `instructions` on `initialize` (FR-004).
- [ ] T006 `cli/commands/guard.mjs`: text footer, with `CI` suppression (FR-004, FR-005).
- [ ] T007 `cli/commands/memory.mjs`: `## DocGuard version` pack section (FR-004).
- [ ] T008 `extensions/spec-kit-docguard/skills/docguard-*/SKILL.md`: the paragraph (FR-006).

## Phase 3: Docs and verification

- [ ] T009 `PRIVACY.md` (FR-007); `README.md`, `docs/configuration.md`, `docs/ai-integration.md`, `CHANGELOG.md` (FR-008); `docs-canonical/ARCHITECTURE.md`, `DATA-MODEL.md`, `ENVIRONMENT.md`, `SECURITY.md`, `TEST-SPEC.md`.
- [ ] T010 `testguard.claims.json`: claim UPDATE-HINT-IS-LOCAL-AND-SILENT-WHEN-UNSURE, probed `--confirm 3`; gate; budgets unchanged; `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard`.
