# Tasks: MCP Project Confinement

**Spec**: `specs/041-mcp-project-confinement/spec.md`
**Plan**: `specs/041-mcp-project-confinement/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/mcp-project-confinement.test.mjs`: reproduce the report. A
  stdio server started in `parent/app` answers `docguard_read_section` for
  `parent/outside.md` with the file's text today; the test expects an
  `isError` result naming the served directory and none of the text
  (FR-001, FR-002, SC-001).
- [x] T002 Same file: `../`, `app/../..`, a symlink out, a sibling with the
  same prefix, and a missing outside path are all refused with one message;
  every project-scoped tool is refused, not only the doc tools (FR-001,
  FR-002, FR-003).
- [x] T003 Same file: no `projectDir`, a relative subdirectory, an absolute
  subdirectory, a symlink whose target is inside, and a differently cased
  spelling (on a case-insensitive filesystem) all run; a missing inside
  directory keeps "does not exist"; a file is "not a directory" (FR-004).
- [x] T004 Same file: `--root <parent>` allows the reproduction; a missing
  `--root` and a file `--root` exit 1; the startup line lists the roots
  (FR-005, SC-002).
- [x] T005 Same file: the HTTP transport refuses the reproduction by default
  (FR-003, SC-001); `tools/list` describes the boundary (FR-006);
  `isWithinRoot` with `path.posix` and `path.win32` (drive letters, UNC,
  case, prefix siblings).
- [x] T006 Same file: the docs named in FR-007 describe the boundary and
  `--root` (FR-007).

## Phase 2: Implementation

- [x] T007 `cli/commands/mcp.mjs`: `isWithinRoot`, `buildServedRoots`,
  confined `resolveTarget`, serving context through `dispatchMessage` for
  stdio and HTTP, schema description (FR-001–FR-006).
- [x] T008 `cli/docguard.mjs`: repeatable `--root <dir>` (FR-005).
- [x] T009 `tests/update-awareness.test.mjs`: its MCP call read a temp project
  outside the server's working directory; start the server with `--dir` on
  that project so the comparison still covers a real tool result (SC-003).

## Phase 3: Docs and verification

- [x] T010 `docs-canonical/SECURITY.md`, `docs/ai-integration.md`,
  `docs/commands.md`, `README.md`, `mcpb/manifest.template.json`,
  `smithery.yaml`, `CHANGELOG.md` (FR-007).
- [ ] T011 `testguard.claims.json`: claim
  MCP-PROJECTDIR-STAYS-INSIDE-SERVED-ROOTS, probed `--confirm 3`; gate;
  `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard`.
