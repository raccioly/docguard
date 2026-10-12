# Feature Specification: Doc References Match Whole File Names

**Feature Branch**: `fix/whole-token-doc-references`

**Created**: 2026-10-12

**Status**: Draft

**Spec ID**: `docguard.whole-token-doc-references`

**Lineage**: Refines the shared reference matcher of `docguard.mcp-doc-tools` (spec 032, FR-003), which `trace --reverse`, `impact` / `diff --since` and `docguard_docs_for_path` use. Uses the indirect walk relocated by `docguard.requirement-anchors` (spec 070, FR-031) without changing it. Same defect class as the whole-path rule of `docguard.removed-file-attribution` (spec 069, FR-003).

**Input**: `docguard impact --since <ref>` lists a doc as indirectly affected when it names a different file whose name ends with the changed file's name. In a fixture where `src/b.mjs` imports `src/a.mjs` and `docs-canonical/SECURITY.md` names only `src/hub.mjs`, changing `src/a.mjs` reports SECURITY.md with the chain `{ via: 'src/b.mjs', hops: 1 }`, because `b.mjs` is found inside `hub.mjs`.

## Problem

The matcher decides that a doc line names a file when the line contains the file's path or its basename anywhere, as a substring. A name inside a longer file name therefore counts:

- `b.mjs` inside `hub.mjs`, `test.mjs` inside `impact.test.mjs`, `foo.py` inside `test_foo.py`, `service.ts` inside `user-service.ts`;
- `config.js` inside `config.json`, `index.ts` inside `index.tsx`;
- `src/a.mjs` inside `othersrc/a.mjs`.

Every consumer of the matcher inherits the false reference. `trace --reverse src/b.mjs` and `docguard_docs_for_path` list SECURITY.md; `impact` lists it as directly affected when `src/b.mjs` changes, and as indirectly affected through `src/b.mjs` when anything it imports changes. An agent that follows these answers reads and edits documents that do not describe the file, and the indirect chain names a reason that is not true.

`impact`'s doc-to-doc blast radius has the same substring test of a changed document's name, so changing `SPEC.md` flags every document that mentions `TEST-SPEC.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A file is not named by a longer file name (Priority: P1)

**Independent Test**: The fixture from the input. Before the change all four answers below name SECURITY.md; after it, none does.

**Acceptance Scenarios**:

1. **Given** the fixture, **When** `src/a.mjs` changes, **Then** `impact --since` reports no indirect doc.
2. **Given** the fixture, **When** `src/b.mjs` changes, **Then** `impact --since` reports no directly affected doc.
3. **Given** the fixture, **Then** `trace --reverse src/b.mjs --format json` has no matches and `docguard_docs_for_path` for `src/b.mjs` has no references.
4. **Given** docs that name `config.json`, `index.tsx`, `impact.test.mjs`, `test_foo.py`, `user-service.ts` or `othersrc/a.mjs`, **Then** they are not references to `config.js`, `index.ts`, `test.mjs`, `foo.py`, `service.ts` or (by path) `src/a.mjs`.
5. **Given** a changed `SPEC.md` and a document that mentions only `TEST-SPEC.md`, **Then** the blast radius does not list that document.

### User Story 2 - Every way a doc really names a file still matches (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a doc line naming `src/b.mjs` as `src/b.mjs`, `./src/b.mjs`, `` `src/b.mjs` ``, `[b.mjs](src/b.mjs)`, `**b.mjs**`, `| b.mjs |`, `"b.mjs"`, `(b.mjs)`, `<b.mjs>`, `b.mjs:12`, `b.mjs#L3`, `b.mjs,`, `see b.mjs.` or `https://github.com/o/r/blob/main/src/b.mjs`, **Then** each is a reference, with the same kind it has today.
2. **Given** the existing pinned fixtures for the three match kinds (`path`, `basename`, backticked `module`), **Then** every consumer's output is unchanged.
3. **Given** a doc in a language written without spaces (`参见b.mjs文件`), **Then** the line is a reference.

### Edge Cases

- A name at the start or end of a line is a whole token.
- A sentence period after a name ends the token (`see b.mjs.`); a period followed by a file-name character continues it (`b.mjs.bak` does not name `b.mjs`).
- A hyphen continues a file name on either side, so `user-service.ts` does not name `service.ts`. A prose compound written without backticks (`b.mjs-based`) is therefore not a reference either; backticks or a space restore it.
- A path segment boundary is an edge: `lib/src/a.mjs` still names `src/a.mjs` by path, as today. Matching stays a text heuristic; the declared owner and `covers` remain the exact signals.
- The backticked module form (`` `users` ``) is already delimited and is unchanged.
- `@doc` annotations, wikilinks and requirement IDs are not file-name matches and are unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A doc line MUST name a file by path or by basename only when that name appears as a whole token: the character before it is the start of the line or not a file-name character, and the character after it is the end of the line or not a file-name character, where a period counts as an edge only when no file-name character follows it. File-name characters are ASCII letters and digits, `_`, `-`, `.`, `$`, `+` and `@`. `/`, `\`, whitespace, punctuation and characters of other scripts are edges.
- **FR-002**: The match kinds, their order (path, then basename, then backticked module) and the backticked module rule MUST stay as they are.
- **FR-003**: Every consumer of the shared matcher MUST apply FR-001: `impact` / `diff --since` direct references (`affectedDocs`), indirect references (`indirectDocs`, the `via` of each chain), `impact --prs` conflict analysis, `trace --reverse`, and `docguard_docs_for_path` (`references` and `agentInstructions`). They MUST keep sharing one matcher (`docguard.mcp-doc-tools#FR-003`).
- **FR-004**: `impact`'s doc-to-doc blast radius MUST apply FR-001 to the changed document's basename. Wikilink matching is unchanged.
- **FR-005**: The reverse-import walk, its two-hop limit, hub suppression and requirement-anchor ripple MUST be unchanged.
- **FR-006**: The user documentation for `trace --reverse` and the architecture entry for the shared matcher MUST state that a name matches only as a whole token.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The User Story 1 cases fail before the change and pass after it; the User Story 2 cases pass before and after it.
- **SC-002**: On this repository, every tracked code file that a canonical document or instruction file names by its full path (in backticks, as a link target, or between spaces) is still a `path` reference; and comparing the old and new matchers over every tracked code file and every document the consumers read, the new references are a subset of the old ones and every removed reference is a name inside a longer file name.

## Assumptions

- File names that put a non-ASCII letter directly against the matched name (`résumé.mjs` against `é.mjs`) are rare enough that treating such letters as edges costs less than missing references in Chinese, Japanese or Thai prose, which does not separate words with spaces.

## Out of Scope

- Other text matchers with the same substring test: the post-commit nudge in `hooks`, the Docs-Sync route and service checks (DSY001, DSY002) and the path match in the diff-suspicion validator. They change guard findings or hook behaviour and are reviewed on their own.
- Making the text match exact. The declared owner (`docguard.doc-ownership-map`) and `covers` (`docguard.doc-dependency-lock`) are the exact signals.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `4f46e9f6571abbd257c8c781b87cf6aaec9e3b52` — Reviewed at 4f46e9f (shipped in #571): doc references match whole file names, not substrings. This repo 894 to 828 references, 0 added, 66 removed (all collisions); four local projects 1,514 to 1,513; ripple unchanged. TestGuard DOC-REFERENCES-WHOLE-TOKEN 6/6, MCP-DOC-TOOLS-EXACT-AND-BOUNDED 15/15. Deviations: none. Evidence: `cli/commands/impact.mjs`, `cli/scanners/doc-references.mjs`, `docs-canonical/ARCHITECTURE.md`, `tests/doc-reference-tokens.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
