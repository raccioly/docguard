# Feature Specification: DocGuard's Generated Docs Pass DocGuard's Own Checks

**Feature Branch**: `fix/generated-docs-consistency`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.generated-docs-consistency`

**Lineage**:
- Corrects `docguard.language-repository-coverage`, which owns plain
  `generate` and its per-language surface.
- Corrects `docguard.as-built-specs`, whose `generate --spec` output fails
  SPK003.
- Builds on `docguard.code-derived-diagrams`, which owns the marked code
  sections that `generate --plan --write` scaffolds.
- Found by running `generate`, `guard` and `diff` on fresh Express, Next.js,
  FastAPI, Django and Go projects.

**Input**: Maintainer report (2026-09-30): on a fresh project, DocGuard's own
generated documents fail DocGuard's own checks. The first command a new user
runs after `generate` tells them to fix, or delete, what DocGuard just wrote.

## Problem

`docguard generate` (plain and `--plan --write`), `docguard init` and
`docguard generate --spec` write documents. `docguard guard` and
`docguard diff` then read them with different parsers and different scanners.
The two sides disagree:

- **Parsing.** `diff` reads entities only from `### Name` headings, while the
  plan writes an entity table. The API reference parser drops the path `/` and
  the methods `ALL` and `ANY`, which the generator writes. A removed route is
  reported as `DELETE /{}`, with its parameter name lost.
- **Structure.** The plan writes only marked sections under an H1, so STR003,
  ENV001 and ENV002 fire on every scaffolded document. Plain `generate` writes
  `## 1. Introduction & Goals` and `## Entity Summary`, which the section
  validator does not recognise as System Overview or Entities.
- **Own output reported as foreign.** TRC003 tells the user to delete the
  API-REFERENCE.md that `generate` just wrote. TRC002 calls a generated doc
  "unlinked" although it was derived from named source files. SPK003 fires on
  the as-built spec because it has no success criterion ID.
- **Own directories counted as code.** `docs-canonical/`,
  `docs-implementation/` and `specs/` appear in the plan's component map and
  in DCV003, so guard reports the component map stale (GST002) straight after
  `generate` writes it. DCV003 prints root-level directories with the project
  folder's name in front (`go-svc/internal/`). DCV001 reports the
  `.docguard-specs.json` that `generate --spec --write` created.
- **Template placeholders read as claims.** The init ARCHITECTURE template's
  `### Terraform` block and its comment mentioning a DynamoDB lock table make
  `diff` report Terraform and DynamoDB as documented but absent. The
  REQUIREMENTS template's example rows (`FR-001 | System MUST [capability]`)
  become eight TRC004 findings. ENV004 reads `.env.example` inside a template
  comment as a reference to a missing file.
- **Wrong generated content.** The API table's Handler column shows `res` or
  `async`. Every environment variable is marked Required even when the code
  supplies a default. SECURITY.md says "auth: not detected" for code that
  uses `jsonwebtoken`.
- **Different facts on each side.** Plain `generate` reads environment
  variables only from `.env.example`; `--plan` reads them only from code;
  `diff` and guard read both. The same split exists for routes (generate asks
  the scanner with the package.json framework name, guard with the ecosystem's),
  entities (Django models are invisible to the entity scanner but not to
  SCH002), tech stack and test files.
- **Backups and lost prose.** `generate --plan --write` over existing
  documents leaves `.bak` files in `docs-canonical/`, although it rewrites
  only DocGuard-owned code sections. A second run also replaces prose an
  agent already wrote in a `source=human` section with the original task
  placeholder, and overwrites `pinned` code sections that `sync` protects.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate, then guard, on a fresh project (Priority: P1)

A developer runs `docguard generate` on an existing codebase and then
`docguard guard` and `docguard diff`.

**Acceptance Scenarios**:

1. **Given** a fresh Express, Next.js, FastAPI, Django or Go project, **When**
   `generate` runs and then `guard --format json` and `diff --format json`,
   **Then** no finding is caused by a document DocGuard wrote.
2. **Given** the same projects, **When** `generate --plan --write` runs,
   **Then** the same holds for everything the plan writes.
3. **Given** a finding that remains, **Then** it describes the project (a real
   gap such as missing tests or no Spec Kit), not DocGuard's output.

### User Story 2 - Init, then guard (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a fresh project, **When** `init --skip-prompts` runs, **Then** no
   finding comes from template placeholder text or from DocGuard's own
   directories and files.
2. **Given** an initialized project, **When** `generate --plan --write` or
   `generate --spec <area> --write` runs, **Then** guard reports no finding
   caused by that output, and no `.bak` file is left next to a document whose
   human-written bytes were all preserved.

### User Story 3 - Re-running generate keeps what people wrote (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a scaffolded document where an agent replaced a section's AI task
   with prose, **When** `generate --plan --write` runs again, **Then** the
   prose is unchanged.
2. **Given** a code section marked `pinned="reason"`, **When** the plan runs
   again, **Then** that section is unchanged, as `sync` already guarantees.

### Edge Cases

- **Existing heading.** A document that already has `## Tech Stack` (the init
  template) gets the code section under that heading, not a second heading.
- **Root route and catch-all methods.** `GET /`, `ALL /x` and `ANY /x` are
  endpoints like any other; a heading `## GET requests` or a prose table cell
  that is not a method is not.
- **Entity table outside an entity section.** Only a table whose first header
  cell names an entity (`Entity`, `Model`, `Table`) contributes names, so a
  Field table's rows are not read as entities.
- **Variables with and without defaults.** A variable read once with a default
  and once without is Required.
- **Doc directory named like code.** `docs-canonical/` and
  `docs-implementation/` are DocGuard's; `specs/` is DocGuard's only when it
  holds Spec Kit feature directories, so a test directory named `specs` is
  still code.
- **Human-edited template.** Placeholder text inside HTML comments is ignored;
  the same words written as prose are still read.
- **Backup of a human file.** A write that would change bytes outside
  DocGuard-owned code sections keeps its `.bak`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The API reference parser MUST count the path `/` and the methods
  `ALL` and `ANY`, in tables and in `#### METHOD /path` headings. Parsed
  endpoints MUST keep the path as written, so API004 and API005 messages show
  `/users/:id`, not `/users/{}`. Matching still uses the normalized key.
- **FR-002**: `diff` MUST read entity names from `### Name` headings and from
  the first column of any table whose first header cell is Entity, Model or
  Table, including the plan's code-owned `entities` section.
- **FR-003**: Every document DocGuard generates MUST carry the headings the
  structure validators require (STR003, ENV001, ENV002):
  - `generate --plan --write` writes an H2 heading before each section it
    creates, or places the section under an existing heading that already
    satisfies the requirement;
  - plain `generate` uses headings the section validator recognises (System
    Overview via "Introduction and Goals", "Entities").
- **FR-004**: DocGuard MUST not report its own generated documents as foreign:
  - TRC003 does not fire on a document carrying `docguard:generated true`;
  - TRC002 counts a document as linked when it cites an existing,
    non-Markdown file or directory in the project, and every generated
    document cites the source files its facts came from;
  - the as-built spec has a success criterion with an ID (SPR007 reports
    no drift for the spec), so SPK003 passes.
- **FR-005**: DocGuard's own directories and files MUST not be treated as
  project code or undocumented configuration:
  - `docs-canonical/`, `docs-implementation/` and a Spec Kit `specs/`
    directory are excluded from the component map and from DCV003;
  - DCV003 names a directory at the project root as `name/`, without the
    project folder's name;
  - DCV001 does not report `.docguard-specs.json`;
  - guard run straight after `generate --plan --write` reports no GST002.
- **FR-006**: Template placeholder text MUST not be read as a claim:
  - `diff`'s tech-stack comparison uses the same reader as guard's DDF001
    (HTML comments and negations ignored);
  - ENV004 ignores `.env.example` mentioned only inside HTML comments;
  - the init ARCHITECTURE template keeps its per-tool IaC examples inside a
    comment, and the REQUIREMENTS template its example rows, so a fresh
    template claims no technology and defines no requirement ID.
- **FR-007**: Plain `generate` MUST write correct facts:
  - the Handler column shows the handler's function name, or `inline` for an
    anonymous handler, never a parameter or keyword;
  - an environment variable read with a default in code is Required "No" and
    shows the default;
  - SECURITY.md names the detected authentication library (for example
    `jsonwebtoken`, `PyJWT`), and the integrations scanner reports it.
- **FR-008**: Plain `generate`, `generate --plan` and `diff` MUST use one set
  of environment variables: the names in `.env.example`/`.env.template` plus
  the names read in code (including Go's `os.Getenv` and `os.LookupEnv`).
  Generated setup steps mention `.env.example` only when it exists, and the
  plan's environment table cites it when it does.
- **FR-009**: `generate --plan --write` MUST:
  - never replace an existing `source=human` section;
  - skip a `pinned` code section;
  - write without a `.bak` when every byte outside DocGuard-owned code
    section bodies is preserved;
  - keep the `.bak` otherwise.
- **FR-010**: Plain `generate` MUST read the same facts guard and `diff`
  check:
  - routes from the ecosystem-aware framework guard uses;
  - entities, including Django models (also for `--plan` and `diff`);
  - every technology DDF001 recognises from dependencies;
  - every test file DDF002 counts;
  - the source modules DCV003 checks.
- **FR-011**: Text DocGuard generates MUST pass its own prose checks; the
  generated SECURITY.md and ARCHITECTURE.md do not trip DQ007.
- **FR-012**: `docs/commands.md` (`generate`), `docs-canonical/ARCHITECTURE.md`
  and the CHANGELOG MUST describe the headings, the citation link, the
  backup rule and the single environment-variable source.

## Success Criteria *(mandatory)*

- **SC-001**: For five fresh projects (Express JS, Next.js TS, FastAPI, Django,
  Go), each of these flows ends with guard and `diff` reporting only findings
  from an allow-list of project-describing codes:
  - `generate`;
  - `generate --plan --write`;
  - `init --skip-prompts`;
  - `init` then `generate --plan --write`;
  - `init` then `generate --spec <area> --write`.

  The allow-list and the reason for each code are in the test. A `diff`
  mismatch counts as a finding. No `.bak` remains after any flow.
- **SC-002**: Each bug in the Problem section has a test that failed before
  the fix.
- **SC-003**: The full suite passes, and guard on this repository reports no
  new finding.

## Assumptions

- "Fresh project" means source code plus a `.gitignore`, committed to git, with
  no DocGuard files.
- Findings that describe the project remain correct and stay:
  - SPK001: Spec Kit not initialized;
  - TSP007: the test directory heuristic misses Django's `tests.py` and Go's
    `_test.go` — a detection gap, not output;
  - TRC004 on the as-built spec's candidates: no test references them yet;
  - after init, the requests to fill the blank templates (DCV003 for real
    source directories, ENV003, SCH002, DDF001/DDF002, TRC002);
  - after a plain `--plan --write` without `init`, the missing required files
    it does not create (STR001, STR002, TRC001).

## Out of Scope

- Django `include()` prefix composition (`/shop/` + `/products/`): generate
  and guard now agree on the same, still uncomposed, routes.
- TSP007's test-directory heuristic for Django and Go.
- Filling the plan's component-map responsibilities in place (a code-owned
  section): unchanged; `pinned` remains the way to keep hand edits.
- `sync`'s backup policy: unchanged.
