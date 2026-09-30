# Feature Specification: MCP Doc Tools

**Feature Branch**: `feat/mcp-doc-tools`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.mcp-doc-tools`

**Lineage**: #455 follow-up, from research into OpenHands, DeepWiki/Devin, Aider
and Cursor (ADOPT, size S). Extends `docguard.evidence-scoped-verification`
(FR-009, FR-012: the read-only MCP server) and exposes
`docguard.task-specific-agent-context` over MCP. Uses `covers` from
`docguard.doc-dependency-lock` and owners from `docguard.doc-ownership-map`
once they exist. Measured by `docguard.non-regression-budgets`.

**Input**: User description: "Give agents deterministic MCP tools shaped like
DeepWiki's `read_wiki_structure` and `read_wiki_contents`, but exact: which docs
cover a file, what a doc contains, one section at a time, and the task context
packet. No `ask` tool."

## Problem

DocGuard's MCP server (`cli/commands/mcp.mjs`) has seven tools. All of them
answer "is the project healthy?": `docguard_guard`, `docguard_score`,
`docguard_explain`, `docguard_verify_evidence`, `docguard_verify_claims`,
`docguard_report` and `docguard_diagnose`. None answers the question an agent
asks before editing a file: "which documentation describes this, and what does
it say?"

The answers already exist, but only on the command line and only as text:

- `trace --reverse <path>` lists canonical doc lines that name a file.
  `impact` has a second copy of the same matcher (`findReferences`) and also
  searches `AGENTS.md`, `CLAUDE.md` and `GEMINI.md`.
- `agent --task <text>` builds a bounded, deterministic context packet
  (`buildTaskContextPacket`), but an MCP client cannot request it.
- Headings and `docguard:section` markers are parsed in several places
  (`cli/writers/sections.mjs`, `extractHeadings` in
  `cli/validators/cross-reference.mjs`, `chunks` in
  `cli/scanners/task-context.mjs`), but no tool returns a document's outline.

So an agent reads whole documents to find one paragraph. Each full read of
`docs-canonical/ARCHITECTURE.md` (about 28 KiB) or `DATA-MODEL.md` (about
31 KiB) is paid on every turn.

DeepWiki's MCP server shows the shape that works: a structure call, then a
contents call. Its third tool, `ask_question`, answers with an LLM. DocGuard
makes no LLM calls (Constitution V and VIII), so it offers only the exact half.

The server's published listings have also drifted. `mcpb/manifest.template.json`
lists 6 tools, and `server.json` and `smithery.yaml` describe 5. The server
has 7.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find the docs for a file before editing it (Priority: P1)

An agent is about to change `cli/scanners/as-built.mjs`. It calls
`docguard_docs_for_path` with that path and gets every doc line that names the
file, the section each line sits in, the agent-instruction lines that name it,
and the requirement IDs the file declares with `@implements` or `@req`.

**Independent Test**: A fixture where one canonical doc names `src/a.mjs` by
path, another by backticked module name, `AGENTS.md` names it once, and
`src/a.mjs` carries `@implements acme.x#FR-001`. The tool returns exactly those
four facts, in a stable order.

**Acceptance Scenarios**:

1. **Given** a file named in two canonical docs, **When** the tool runs,
   **Then** each reference has the doc, line, match kind (`path`, `basename`
   or `module`), the enclosing heading, and the enclosing `docguard:section`
   id when there is one.
2. **Given** the same file, **Then** the matches equal what
   `trace --reverse --format json` reports for it. The two share one matcher.
3. **Given** a file that no longer exists but is still named in a doc,
   **Then** the tool returns the references with `exists: false`.
4. **Given** a project where `docguard.doc-dependency-lock` is not
   implemented, or no section declares `covers`, **Then** `covers` is an empty
   list with status `not-declared`. It is never omitted silently.

### User Story 2 - Read a doc's outline, then one section (Priority: P1)

The agent calls `docguard_doc_structure` for `docs-canonical/ARCHITECTURE.md`
and gets its headings with anchors, line ranges and byte sizes, plus its
`docguard:section` markers. It then calls `docguard_read_section` for the one
section it needs.

**Acceptance Scenarios**:

1. **Given** a doc, **When** `docguard_doc_structure` runs, **Then** it returns
   headings (level, text, anchor, start line, end line, bytes), section markers
   (id, source, pinned, covers), `docguard:fact` markers, the
   `docguard:last-reviewed` date, and whether the doc is generated.
2. **Given** a section marker id, **When** `docguard_read_section` runs,
   **Then** it returns that section's body and its line range.
3. **Given** a heading anchor instead of an id, **Then** it returns the lines
   from that heading to the next heading of the same or a higher level.
4. **Given** a heading text that matches two headings, **Then** the call fails
   and lists both candidates with their anchors and lines.
5. **Given** a section larger than the byte limit, **Then** the response is
   cut at a line boundary, marked `truncated`, and gives the `offset` to
   continue from.

### User Story 3 - Task context over MCP (Priority: P2)

An MCP client calls `docguard_task_context` with a task string and receives the
same packet `docguard agent --task <text> --format json` prints.

**Acceptance Scenarios**:

1. **Given** a task, **Then** the tool result equals the CLI packet for the
   same tree.
2. **Given** an empty task or one over 2000 characters, **Then** the tool
   returns an `isError` result with the selector's message.
3. **Given** weak relevance, **Then** the packet's status is `abstained`, as on
   the command line.

### User Story 4 - The listings match the server (Priority: P3)

A maintainer reads `server.json`, `mcpb/manifest.template.json`,
`smithery.yaml`, `docs/ai-integration.md` and `docs/commands.md`. Each names
the same tools that `tools/list` returns.

### Edge Cases

- A `path`, `doc` or `projectDir`-relative argument that is absolute, contains
  `..`, a NUL byte or a backslash, or resolves through a symlink is refused as
  `unsafe-path`. Reads go through `createEvidenceReader`, which already
  enforces this.
- A `doc` that is not Markdown, or is ignored by `.docguardignore`, is refused.
- A doc with malformed or duplicate section markers: structure reports the
  issues from `inspectSections` and `read_section` by id refuses. Reading by
  heading still works.
- A very large doc: the structure lists at most 500 headings and says how many
  were omitted.
- A file named in hundreds of lines: references are capped (200) and sorted by
  doc, then line. The response reports the total.
- `docguard_read_section` with `maxBytes` above the hard cap uses the cap.
- An `.md` file in `specs/` is readable. It is project documentation.
- Tool calls stay read-only. No tool writes a cache file.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The MCP server MUST add four tools, each with
  `READONLY_ANNOTATIONS`: `docguard_docs_for_path`, `docguard_doc_structure`,
  `docguard_read_section` and `docguard_task_context`. The seven existing tools
  MUST keep their names, schemas and results.
- **FR-002**: `docguard_docs_for_path({ path })` MUST return:
  - `path` and `exists`;
  - `references`: each canonical doc line that names the file, with doc, line,
    the line's text (at most 240 characters), match kind, enclosing heading
    and anchor, and enclosing section id;
  - `agentInstructions`: lines in `AGENTS.md`, `CLAUDE.md` and `GEMINI.md`
    that name the file;
  - `requirements`: `@implements` and `@req` IDs declared in the file itself;
  - `docAnnotations`: docs the file names with an `@doc` header comment;
  - `covers`: sections whose `covers` attribute includes the file or a glob
    that matches it, with a status of `declared` or `not-declared`;
  - `owner`: the owning doc section from `docguard.doc-ownership-map`, or
    `null` with a reason when no ownership map is configured.
- **FR-003**: `trace --reverse`, `impact` and `docguard_docs_for_path` MUST use
  one reference matcher. `trace --reverse --format json` and
  `impact --format json` output MUST stay byte-identical on the existing test
  fixtures, apart from timestamps.
- **FR-004**: `docguard_doc_structure({ doc })` MUST return headings (level,
  text, anchor, start and end line, bytes), section markers (id, source,
  pinned, covers, lines), fact markers, marker issues, the last-reviewed date,
  the generated flag and the total bytes. Anchors MUST use the same
  `slugifyHeading` rule as the Cross-Reference validator.
- **FR-005**: `docguard_read_section({ doc, id | anchor | heading | line,
  context?, offset?, maxBytes? })` MUST resolve by section id first, then
  `line` (the lines around one reference, `context` lines each side, default 3,
  at most 50), then anchor, then exact heading text. An ambiguous match MUST fail with the candidates. The response
  MUST include the line range, the content, `truncated`, and `nextOffset` when
  truncated. The default limit MUST be 8 KiB and the hard cap 32 KiB.
- **FR-006**: `docguard_task_context({ task })` MUST return the
  `buildTaskContextPacket` result unchanged.
- **FR-007**: Every path argument MUST be project-relative and pass the
  `createEvidenceReader` checks: no absolute path, no `..`, no NUL or
  backslash, no symlink, no private segment, and inside the real project root.
  A refused path MUST be an `isError` result that names the reason.
- **FR-008**: Every new tool's response MUST be bounded. Lists MUST be capped
  and sorted deterministically, and each cap MUST be reported as
  `{ total, returned, truncated }`. Two calls on the same tree MUST return
  byte-identical results.
- **FR-009**: The server MUST NOT offer a tool that answers questions in
  natural language, calls a model, or reaches the network.
- **FR-010**: `server.json`, `mcpb/manifest.template.json`, `smithery.yaml`,
  `docs/ai-integration.md`, `docs/commands.md` and `README.md` MUST list the
  same tools `tools/list` returns. A test MUST compare them.
- **FR-011**: The non-regression budget file MUST include a fixed request for
  each new tool, so its response bytes are an agent-facing metric under
  `docguard.non-regression-budgets`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On this repository, finding and reading the doc section that
  describes `cli/scanners/as-built.mjs` through `docs_for_path` then
  `read_section` returns at most 25% of the bytes of reading every doc that
  names the file in full.
- **SC-002**: Every new tool's response on this repository, for the budget
  file's fixed inputs, is 32 KiB or less.
- **SC-003**: The fixture in User Story 1 returns exactly four facts, and
  repeated calls are byte-identical.
- **SC-004**: Twenty path-traversal and symlink inputs are all refused, and no
  file outside the fixture root is opened (checked with a sentinel file).
- **SC-005**: The listing test fails when any of the six listing files names a
  tool the server does not have, or omits one it has.

## Assumptions

- The optional `projectDir` argument keeps its current behavior. The server
  already runs as the user, on loopback, with the user's permissions.
- Doc discovery uses `listCanonicalDocs`, plus the root agent files and any
  Markdown file an agent names directly.
- Text match kinds (`path`, `basename`, `module`) are heuristics, as they are
  in `trace --reverse`. `covers` and ownership are the exact signals.
  Responses label which is which.

## Out of Scope

- An `ask` or search tool that ranks prose for a free-text question.
  `docguard_task_context` is the deterministic version of that.
- Write tools. The MCP server stays read-only.
- Embedding or vector indexes.
