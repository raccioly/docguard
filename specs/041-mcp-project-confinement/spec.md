# Feature Specification: MCP Project Confinement

**Feature Branch**: `fix/mcp-project-confinement`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.mcp-project-confinement`

**Lineage**:
- Extends `docguard.mcp-doc-tools`, whose four navigation tools return
  document text rather than findings.
- Narrows the per-call `projectDir` argument that
  `docguard.evidence-scoped-verification` (FR-009, FR-012) gave every
  project-scoped MCP tool.
- Found in a security review of the MCP server on 2026-09-30.

**Input**: Confirmed issue: "`docguard mcp` accepts any existing directory as a
tool call's `projectDir`. The doc tools return text, so a caller can read
Markdown anywhere the server's account can read."

## Problem

`docguard mcp` serves one project: the directory it was started in, or
`--dir`. Every project-scoped tool also takes an optional `projectDir`, and
the server accepts any existing directory for it.

Before spec 032 that exposed findings about other directories. The four
navigation tools (`docguard_docs_for_path`, `docguard_doc_structure`,
`docguard_read_section`, `docguard_task_context`) return document text. So
this call, sent to a server started in `/work/app`, returns a file that is not
part of the served project:

```json
{"name": "docguard_read_section",
 "arguments": {"doc": "outside.md", "projectDir": "/work", "line": 1}}
```

The reader's refusals (`..`, symlinks, `.env*`, `.local`) apply inside
whichever `projectDir` the caller picked, so they do not stop this. Over the
HTTP transport the caller is a network client, and an API key does not scope
what it can read. Over stdio the caller is an agent that may be following
instructions it found in a document.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A tool call cannot leave the served project (Priority: P1)

An operator starts `docguard mcp` in a project. A client asks a tool to read
from another directory. The server refuses and reads nothing.

**Acceptance Scenarios**:

1. **Given** a server started in `parent/app`, **When** a client calls
   `docguard_read_section` with `projectDir` `parent`, **Then** the result is
   an `isError` result naming the served directory and contains none of the
   document's text.
2. **Given** the same server, **When** `projectDir` is `../` or
   `app/../..`, **Then** the call is refused the same way.
3. **Given** a symbolic link inside the served directory whose target is
   outside, **When** a client passes the link as `projectDir`, **Then** the
   call is refused.
4. **Given** a served directory `/x/app`, **When** `projectDir` is
   `/x/app-other` (same prefix, different directory), **Then** the call is
   refused.
5. **Given** a path outside the served directory that does not exist,
   **Then** the refusal is the same as for one that does.
6. **Given** the HTTP transport with its defaults, **Then** scenarios 1–5
   hold for HTTP clients too.

### User Story 2 - Calls inside the project keep working (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a call with no `projectDir`, **Then** it serves the served
   directory, as today.
2. **Given** `projectDir` naming a subdirectory (a package in a monorepo),
   absolute or relative, **Then** the call runs against that subdirectory.
3. **Given** a relative `projectDir`, **Then** it is resolved against the
   served directory.
4. **Given** a symbolic link inside the served directory whose target is also
   inside, **Then** the call runs.
5. **Given** a case-insensitive filesystem and a `projectDir` spelled with
   different letter case, **Then** the call runs.

### User Story 3 - An operator can serve several projects on purpose (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a server started with `--root <dir>`, **When** a call names a
   directory inside `<dir>`, **Then** the call runs.
2. **Given** `--root` naming a path that does not exist or is not a
   directory, **Then** the server does not start: it exits 1 with a message
   on stderr.
3. **Given** any start, **Then** the startup line on stderr names every
   directory the server serves.

### Edge Cases

- **The served directory itself is behind a symlink** (macOS `/tmp` →
  `/private/tmp`): both spellings are accepted, because both resolve inside.
- **Windows paths**: another drive letter or a UNC path is outside; letter case
  of the drive and directories does not matter.
- **A POSIX server given `C:\x` or `..\x`**: those are ordinary file names on
  POSIX; they resolve inside the served directory and fail as a missing
  directory.
- **`projectDir` names a file**: refused as not a directory.
- **`docguard_explain`** takes no `projectDir` and is unaffected.
- **A symlink swapped after the check**: the tool runs against the resolved
  real path, not the caller's spelling. Someone who can rewrite directories
  inside the served tree is out of scope.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The MCP server MUST serve a fixed set of root directories: the
  directory it was started for (`--dir`, else its working directory) and each
  `--root <dir>`. A tool call's `projectDir` MUST be resolved (relative paths
  against the served directory, symbolic links followed, letter case as the
  filesystem stores it) and accepted only when the result is one of those
  roots or inside one.
- **FR-002**: A `projectDir` outside every root MUST produce an `isError`
  tool result that names the roots and says how to widen them, before any
  project file is read. The result MUST be the same whether or not the
  outside path exists.
- **FR-003**: The boundary MUST apply to every tool that takes `projectDir`,
  over both stdio and HTTP. The HTTP transport's default is the same
  confinement.
- **FR-004**: A call without `projectDir`, or with one inside a root, MUST
  run as it does today. A missing directory inside a root keeps today's
  "does not exist" error; a file is refused as not a directory.
- **FR-005**: `docguard mcp` MUST accept `--root <dir>`, repeatable. A root
  that does not exist or is not a directory MUST stop the server at startup
  (exit 1, message on stderr). The startup line MUST list every served root.
- **FR-006**: The `projectDir` description in `tools/list` MUST say that it
  has to be inside the directories the server serves and that relative paths
  resolve against the served directory.
- **FR-007**: `docs-canonical/SECURITY.md`, `docs/ai-integration.md`,
  `docs/commands.md`, the README's MCP flag row, the MCPB manifest and
  `smithery.yaml` descriptions, and the CHANGELOG MUST describe the boundary
  and `--root`.

## Success Criteria *(mandatory)*

- **SC-001**: The reported reproduction (`docguard_read_section` on a
  Markdown file in the parent of the served directory) returns an `isError`
  result without the file's text over stdio and over HTTP. The same call
  against the code before this change returns the text (the test reproduces
  the bug).
- **SC-002**: With `--root <parent>`, the same call returns the text.
- **SC-003**: A project gives the same answer however a call names it: no
  `projectDir`, `.`, its absolute or real path, a path through `..` that
  lands on it, or (on a case-insensitive filesystem) another letter case.
  Every existing MCP test passes; a test changes only where it relied on
  reading outside the served directory, and then it starts the server on its
  fixture instead.

## Assumptions

- The operator chooses what to serve when starting the process. MCP clients
  do not choose.
- Files inside the served roots are readable by the operator's intent;
  per-file rules inside a root stay with the existing safe reader.
- The server's account permissions stay the outer limit; this boundary is an
  inner one.

## Out of Scope

- An `--allow-any-project` switch (rejected: `--root /` says the same thing
  and names what is exposed).
- Per-client or per-key roots on the HTTP transport (an API key is still not
  an authorization boundary between projects).
- Changing which files the doc tools may read inside a root.
- The MCP `roots` capability negotiated by clients (rejected: it lets the
  client, the party being confined, choose the boundary).

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `d17dee0a5924795582cae3b0fcd97bfdbad93c76` — Reviewed at d17dee0 on main: all 11 tasks are checked and were delivered by #497; the full suite (2909 tests) passes and guard reports 0 errors at this revision. Evidence: `cli/commands/mcp.mjs`, `cli/docguard.mjs`, `docs-canonical/SECURITY.md`, `tests/mcp-project-confinement.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
