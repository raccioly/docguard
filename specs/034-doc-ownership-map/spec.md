# Feature Specification: Doc Ownership Map

**Feature Branch**: `feat/doc-ownership-map`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.doc-ownership-map`

**Lineage**: #455 follow-up, from research into OpenHands, DeepWiki/Devin, Aider
and Cursor (ADAPT, size M). Adapts Devin's `.devin/wiki.json` (pages with a
purpose and notes that steer generation) into a checked map from doc sections
to the source paths they own. Feeds `docguard.mcp-doc-tools` (the `owner`
field) and `docguard.doc-dependency-lock` (`review --suggest`). Sits beside
the built-in `TRACE_MAP` (`cli/shared-trace-patterns.mjs`) and the `@doc`
header annotation read by the Traceability validator.

**Input**: User description: "Let a project declare which doc section owns
which source paths, check that every source directory has an owner and no path
has two, and lint a committed `.devin/wiki.json`."

## Problem

DocGuard links docs to code in three ways today, and none of them says who is
responsible for a path:

- **`TRACE_MAP`** maps each canonical doc name to built-in source patterns
  ("Entry points", "Route handlers / modules"). The patterns are the same for
  every project. They say what kind of file a doc usually covers, not which
  files this project's doc covers.
- **`@doc <file>.md`** header comments (`scanDocAnnotations` in
  `cli/validators/traceability.mjs`) go from code to doc. They live in the
  first 4 KiB of each source file, so a directory of 40 files needs 40 edits.
- **Text mentions** (`trace --reverse`, `impact`) are heuristics. A file that
  no doc names is reported as "no canonical doc references this", which could
  mean it is undocumented or that its doc talks about the directory.

So these questions have no exact answer:

- Which doc section should I update when I change `cli/writers/`?
- Is there a source directory that no document is responsible for?
- Do two documents both claim to describe `cli/scanners/`? If so, they will
  drift apart.

Devin's wiki answers the first question with `.devin/wiki.json`: pages, each
with a title and a purpose, plus repository notes that steer an LLM writer.
Nothing checks that file. Devin documents its rules (checked 2026-09-30 at
docs.devin.ai/work-with-devin/deepwiki): `repo_notes` and `pages` are
required, `pages` needs at least one page with a unique non-empty title and a
purpose, at most 30 pages (80 on enterprise), at most 100 notes counting repo
and page notes together, at most 10,000 characters per note. Devin encourages
naming paths in notes but does not check them, so a note naming a deleted
path keeps steering the writer toward it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Declare owners and see unowned code (Priority: P1)

A maintainer adds an `ownership` block to `.docguard.json` that maps
`docs-canonical/ARCHITECTURE.md#component-map` to `cli/commands/**` and
`cli/docguard.mjs`, and `docs-canonical/TEST-SPEC.md` to `tests/**`. Guard
reports each source directory under the declared roots that no entry owns.

**Independent Test**: A fixture with three source directories and entries that
own two of them. Guard reports one OWN001 for the third, and nothing else from
this validator.

**Acceptance Scenarios**:

1. **Given** a source directory with tracked code files under an ownership
   root and no owning entry, **When** guard runs, **Then** OWN001 names the
   highest such directory once, not each child.
2. **Given** every source directory owned, **Then** no OWN001 is reported.
3. **Given** no `ownership` block, **Then** the validator is
   `not-applicable` and guard output is otherwise unchanged.

### User Story 2 - Two owners for one path are reported (Priority: P1)

1. **Given** `ARCHITECTURE.md#component-map` owns `cli/**` and
   `DATA-MODEL.md#registry` owns `cli/scanners/spec-registry.mjs`, **Then** no
   finding: the more specific entry owns that file.
2. **Given** two entries whose patterns are equally specific and match the
   same file, **Then** OWN002 names both entries and one example file.

### User Story 3 - Entries stay true (Priority: P1)

1. **Given** an entry whose paths match no tracked file, **Then** OWN003 names
   the entry and the patterns.
2. **Given** an entry whose doc does not exist, or whose section id or heading
   anchor is not in that doc, **Then** OWN004 names it.

### User Story 4 - The owner is the answer other tools give (Priority: P2)

1. **Given** an ownership map, **When** an agent calls
   `docguard_docs_for_path` for a file, **Then** `owner` names the owning
   section and its purpose.
2. **Given** `trace --reverse <path>`, **Then** the owner is printed first and
   labelled `declared`, above the text matches.
3. **Given** `review --suggest <doc>` from `docguard.doc-dependency-lock`,
   **Then** the owned paths of that doc's sections are offered as `covers`
   candidates, still labelled low-confidence and never written.

### User Story 5 - Start from what DocGuard already knows (Priority: P2)

`docguard trace --owners --suggest` prints an `ownership` block built from the
top-level source modules, `@doc` annotations and `TRACE_MAP` matches. The
`purpose` fields are left as placeholders for a person to fill in. Nothing is
written.

### User Story 6 - A committed Devin wiki file is linted (Priority: P3)

1. **Given** a `.devin/wiki.json` with more than 30 pages (or
   `devinWiki.maxPages`, up to 80 on enterprise), more than 100 notes in
   total, a note longer than 10,000 characters, a missing required key, no
   pages, or a repeated title, **Then** OWN005 names the rule and the count.
2. **Given** a note or page purpose that names a repository path that does not
   exist, **Then** OWN006 names the page or note and the path.
3. **Given** no `.devin/wiki.json`, **Then** nothing is reported.

### Edge Cases

- An unreadable `ownership` block or `.devin/wiki.json` is one OWN007 error.
  It never counts as "everything owned".
- Specificity is decided by the pattern's literal directory prefix: an exact
  file path beats any glob, and a longer literal prefix beats a shorter one.
  Anything else that overlaps is equally specific (OWN002).
- Generated, vendored and ignored directories are never "unowned".
  `.docguardignore` and `config.ignore` apply. Under the default roots,
  `isNonProductPath` (tests, fixtures, examples) applies too; a declared root
  is checked as declared, so `roots: ["tests"]` asks for tests to be owned.
- A root that does not exist is OWN003 for the root.
- A path pattern that leaves the project (`..`, absolute) is refused as
  OWN007.
- A Markdown directory (`docs/`) is not a source directory.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `.docguard.json` MUST accept an optional `ownership` block:
  `roots` (directories whose source must be owned; default: the top-level
  source modules the memory plan finds) and `entries`, each with `doc`,
  optional `section` (a section id or heading anchor), `purpose`, and `paths`
  (files, directories or globs). The config schema MUST describe it.
- **FR-002**: DocGuard MUST resolve each tracked source file to at most one
  owner, deterministically. An exact file path beats any glob; a longer
  literal directory prefix beats a shorter one; any other overlap is a tie
  (OWN002) and the file has no single owner.
- **FR-003**: A Doc-Ownership validator MUST report:
  - **OWN001** (warn, escalate): an unowned source directory under a root,
    reported at its highest unowned directory;
  - **OWN002** (warn, escalate): two entries equally specific for one file;
  - **OWN003** (warn, act): an entry pattern or root that matches no tracked
    file; low confidence when other patterns of the same entry still match;
  - **OWN004** (warn, act): an entry whose doc or section does not exist;
  - **OWN005** (warn, act): `.devin/wiki.json` breaking a documented rule
    (a limit, a required key, a repeated title);
  - **OWN006** (warn, act): a path named in `.devin/wiki.json` that is not in
    the repository. This is DocGuard's rule, not Devin's;
  - **OWN007** (error): an unreadable ownership block or wiki file, or an
    unsafe path pattern.
- **FR-004**: The resolver MUST be a scanner that other features call.
  `docguard_docs_for_path`, `trace --reverse` and `review --suggest` MUST use
  it when an ownership block exists.
- **FR-005**: `trace --owners` MUST list each entry with its matched file
  count and each unowned directory. `--format json` MUST give the same data.
  `trace --owners --suggest` MUST print a proposed block and MUST NOT write.
- **FR-006**: The wiki limits and field names MUST be verified against
  Devin's current documentation and kept in one constant with the date
  checked (`DEVIN_WIKI`, 2026-09-30). The page cap MUST be configurable
  (`devinWiki.maxPages`), because a repository cannot tell its plan. Note
  length is counted in code points: the docs do not say, and this reports
  only what is certainly over.
- **FR-007**: A project without an `ownership` block and without
  `.devin/wiki.json` MUST produce the same guard findings as before, apart
  from the validator list.
- **FR-008**: This repository MUST adopt the map for `cli/`, `extensions/`,
  `tools/`, `benchmarks/` and `tests/`, with zero OWN001 and OWN002.
- **FR-009**: README, `docs/configuration.md`, `docs/commands.md`,
  ARCHITECTURE and DATA-MODEL MUST document the block, the codes and
  `trace --owners`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the fixture, each OWN code fires exactly where seeded.
- **SC-002**: On this repository, after adoption, every tracked source file
  under the declared roots resolves to exactly one owner.
- **SC-003**: Guard's wall time on this repository grows by 3% or less
  (median of 5 A/B runs).
- **SC-004**: Resolving the owner of one file, as `docguard_docs_for_path`
  does, takes under 50 ms on this repository after the first call.

## Assumptions

- Ownership is declared by people. DocGuard proposes a draft but never writes
  the block, because `purpose` is prose.
- `TRACE_MAP` stays the Traceability validator's default. Letting an ownership
  map replace it is a later decision.
- Section-level ownership is enough. Paragraph-level links are what `covers`
  in `docguard.doc-dependency-lock` is for.

## Out of Scope

- Generating `.devin/wiki.json` from the ownership map.
- Changing Traceability (TRC) findings to use owners.
- Code owners for review routing (`CODEOWNERS`). This map is doc
  responsibility, not approval rights.
