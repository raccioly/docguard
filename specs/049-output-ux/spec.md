# Feature Specification: Truthful, Machine-Clean Command Output

**Feature Branch**: `fix/output-ux`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.output-ux`

**Lineage**:
- Extends `docguard.read-only-commands` (spec 042): that spec made read-only
  commands write nothing; this one makes what they print true and parseable.
- Corrects user-facing behaviour of `docguard.compact-guard-response` (037),
  `docguard.doc-ownership-map` (034), `docguard.path-scoped-rules` (033),
  `docguard.mcp-doc-tools` (032), `docguard.doc-dependency-lock` (030) and
  `docguard.code-derived-diagrams` (035).
- Found by a whole-surface review on 2026-09-30. Every defect below was
  reproduced in a temporary project before this spec was written.

**Input**: Coordinator report: "Fix confirmed output/UX bugs: JSON stdout
pollution, NO_COLOR, the sync fix loop, `upgrade`'s two jobs, smart init and
guard exit codes, the shared `structure` key, doc ownership roots and ties,
agent-instruction lookups and Claude Code imports, and small defects."

## Problem

DocGuard tells people and agents what to do next. In several places it says
something false, or prints it where a program cannot read it:

- `guard --changed-only --format json` (and `sarif`, `junit`) writes a
  coloured `⚡ docguard guard --changed-only (…)` line on stdout before the
  payload, so every JSON consumer fails to parse it. `memory --pack --stdout`
  and `llms --stdout` print the banner into the piped artifact. `fix --doc
  <name> --format json` prints plain text.
- `NO_COLOR` is ignored and colour codes go into pipes and files.
- The sync fix loop goes round in circles. GST002 says `docguard sync --write`;
  on a document that is not marked `docguard:generated` that command writes
  nothing and prints "Documentation memory is up to date". The `--force`
  preview then suggests `sync --write` without `--force`. A section skipped
  because its graph is partial is also reported as "up to date". `sync --since
  <bad-ref>` says "git unavailable", runs a full sync and exits 0. "Prose to
  review" names sections that the document does not have.
- `docguard upgrade` checks npm for a newer release *and* migrates the config
  schema, and with `--apply` installs the release globally. Its help describes
  only the migration, and guard's footer suggests `upgrade --apply` to migrate
  the schema, which can also run `npm install -g`.
- Smart-mode `init` on an existing project writes no `.docguard.json`. Every
  later command says "run docguard init" and `guard` exits `3`, which the
  command reference does not list.
- Compact guard output gives the Structure and Doc Sections validators the
  same key, `structure`, so a consumer cannot tell their results apart.
- Doc ownership's default roots skip source files at the root of a source
  directory (`src/pricing.mjs`), so they are never reported as unowned.
  `trace --reverse` shows no owner for a tied file and does not say why.
  `trace --owners --suggest` omits those files and assigns paths to documents
  that do not exist.
- `docguard_docs_for_path` reads only the root `AGENTS.md`, `CLAUDE.md` and
  `GEMINI.md` for `agentInstructions`, and its items carry no text. `rules
  --for` ignores Claude Code `@path` imports, so a `CLAUDE.md` that imports
  `AGENTS.md` is counted at a few bytes, and a missing import is never
  reported.
- Small defects:
  - `review --prune` with nothing to prune prints `✓ CURRENT` and an empty name;
  - `review --suggest` without a document silently shows status;
  - an untracked file inside a `covers` glob changes the lock fingerprint;
  - `doc_structure` counts one byte too many for the last heading;
  - `init` records `projectType: "unknown"` for Go, Java and Ruby projects
    that `generate` recognises;
  - REF001 locates a nested document by its basename.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Machine output parses (Priority: P1)

A CI job or agent runs a command with `--format json` (or `sarif`, `junit`,
`--stdout`) and pipes stdout to a parser.

**Acceptance Scenarios**:

1. **Given** a git project with one changed file, **When** `guard
   --changed-only --format json` runs, **Then** stdout parses as JSON and the
   changed-only note, if any, is on stderr.
2. **Given** the same project, **When** each documented machine-output
   invocation runs, **Then** its stdout parses (JSON, SARIF) or starts with
   the XML declaration (JUnit).
3. **When** `memory --pack --stdout` or `llms --stdout` runs, **Then** stdout
   has no banner.
4. **When** `fix --doc architecture --format json` runs, **Then** stdout is a
   JSON object holding the prompt.

### User Story 2 - Colour follows the terminal (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `NO_COLOR=1`, **Then** no ANSI escape is printed.
2. **Given** stdout is a pipe and no `FORCE_COLOR`, **Then** no ANSI escape is
   printed.
3. **Given** `FORCE_COLOR=1` and a pipe, **Then** colour is printed.

### User Story 3 - The sync loop ends (Priority: P1)

A user follows GST002's advice, and every suggestion they are given works.

**Acceptance Scenarios**:

1. **Given** a stale code section in a document not marked
   `docguard:generated`, **Then** GST002 suggests `docguard sync --write
   --force`, and running it refreshes the section.
2. **Given** the same document, **When** `sync --write` runs without
   `--force`, **Then** it does not say "up to date"; it names the stale
   section that was skipped and the command that applies it.
3. **Given** a `--force` preview, **Then** the apply command it prints
   includes `--force`.
4. **Given** a partial graph and no `--allow-partial`, **Then** sync says the
   section was skipped and how to write it.
5. **Given** `--since nosuchref`, **Then** sync exits 1 and names the ref.
6. **Given** a document without the human sections the plan lists, **Then**
   "Prose to review" names only sections the document has, or the document
   itself.

### User Story 4 - Each command says what it does (Priority: P2)

**Acceptance Scenarios**:

1. `upgrade --help` describes the npm check, the schema migration, and that
   `--apply` installs the release globally.
2. The schema-behind note suggests `docguard upgrade --apply --schema-only`,
   which migrates the schema without contacting npm.
3. Smart-mode `init` writes `.docguard.json`; `guard` afterwards does not
   exit 3.
4. The command reference lists every exit code `guard` returns.

### User Story 5 - Results and ownership are unambiguous (Priority: P2)

**Acceptance Scenarios**:

1. Compact guard output has one result keyed `structure` and one keyed
   `docSections`.
2. A config with `validators.structure: false` still turns both off;
   `validators.docSections: false` turns off only Doc Sections.
3. `src/pricing.mjs` with no owner is reported unowned (OWN001) under default
   roots, and `--suggest` covers it.
4. `--suggest` assigns paths only to documents that exist.
5. `trace --reverse` on a tied file names the tied entries.

### User Story 6 - Agents see every instruction that applies (Priority: P2)

**Acceptance Scenarios**:

1. `docguard_docs_for_path` lists a mention of the file in a nested
   `src/api/AGENTS.md`, `.claude/rules/*.md`, `.cursor/rules/*.mdc` and
   `.github/instructions/*.instructions.md`, each with the line's text.
2. `rules --for` lists `AGENTS.md` imported by `CLAUDE.md` (`@AGENTS.md`),
   with its bytes in Claude Code's total; PSR003 counts them.
3. A `CLAUDE.md` importing a missing `@docs/X.md` gets PSR002.
4. Imports are followed at most 5 hops; a cycle terminates.

### Edge Cases

- `FORCE_COLOR=0` disables colour; an empty `NO_COLOR` does not.
- `sync --since` outside a git repository still reports "git unavailable" and
  falls back to a full sync, as documented.
- A `@` token inside inline code or a fenced block, an e-mail address, or a
  package name without a file extension (`@babel/parser`) is not an import.
- An ownership map with declared `roots` is checked exactly as declared.
- `review --suggest` followed by another flag is "no document".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: In every documented machine mode (`--format json|sarif|junit`
  and `--stdout`), stdout MUST hold only the artifact. Human notes go to
  stderr or are omitted. `fix --doc <name> --format json` MUST emit JSON.
- **FR-002**: Colour MUST be off when `NO_COLOR` is set and non-empty, or when
  stdout is not a TTY, unless `FORCE_COLOR` is set to a value other than `0`.
  `FORCE_COLOR=0` turns colour off.
- **FR-003**: `sync` MUST NOT report "up to date" when it skipped a stale
  section. It MUST list each skipped stale section and the exact command that
  writes it (with `--force` and `--allow-partial` as needed). Its dry-run
  apply command MUST carry the flags that produced the preview. GST002 MUST
  suggest `--force` for a document that is neither marked
  `docguard:generated` nor mapped.
- **FR-004**: `sync --since <ref>` with a ref git cannot resolve MUST exit 1
  and name the ref. "git unavailable" is reserved for a directory that is not
  a git repository.
- **FR-005**: "Prose to review" MUST name only human sections present in the
  document. When the document has none, it names the document.
- **FR-006**: `upgrade`'s help and messages MUST describe both jobs (npm
  release check, schema migration) and that `--apply` installs the release
  globally. `--schema-only` MUST migrate the schema without contacting npm,
  and the schema-behind note MUST suggest it.
- **FR-007**: Smart-mode `init` MUST write the `.docguard.json` it inferred
  when none exists. The command reference MUST list every `guard` exit code
  (0, 1, 2, 3).
- **FR-008**: Doc Sections MUST report under key `docSections`. A config's
  `validators.structure: false`, `severity.structure` and a `structure` N/A
  marker MUST keep applying to it unless the config sets `docSections`.
- **FR-009**: Default ownership roots MUST include source files directly in
  the parent directory of a detected module. `--suggest` MUST cover them and
  MUST assign paths only to existing documents. `trace --reverse` MUST name
  the entries of a tie (JSON `ownerReason`, `tie`).
- **FR-010**: `docguard_docs_for_path` MUST search every agent instruction
  file the path-scoped-rules scanner knows, plus the root `AGENTS.md`,
  `CLAUDE.md` and `GEMINI.md`, and each item MUST carry the line's `text`.
- **FR-011**: For Claude Code, DocGuard MUST follow `@path` imports in loaded
  instruction files, relative to the importing file, up to 5 hops.
  - `rules --for` lists imported files and counts their bytes.
  - PSR003 counts them.
  - A missing import is PSR002.
- **FR-012**: `review --prune` with nothing to prune MUST say so. `review
  --suggest` without a document MUST fail with exit 1 and a usage message.
- **FR-013**: A `covers` glob MUST fingerprint tracked files only (the
  working tree outside git), so an untracked new file does not change it.
- **FR-014**: `doc_structure` heading byte counts MUST sum to the file's size.
- **FR-015**: `init` MUST record the project type the ecosystem detector
  finds for Go, Java, Kotlin, Ruby, Rust, PHP, C# and Python projects that
  the package.json rules do not classify.
- **FR-016**: REF001's location MUST be the document's project-relative path.
- **FR-017**: Every code in the finding registry and the blocker registry
  MUST have an `explain` entry. The `specs require` failure text MUST name
  lines that make it pass.
- **FR-018**: `docs/commands.md`, `docs/configuration.md`,
  `docs-canonical/DATA-MODEL.md` and the CHANGELOG MUST describe the
  behaviour above (exit codes, `NO_COLOR`, `upgrade --schema-only`, the
  `docSections` key, import following, tracked-only glob fingerprints).

## Success Criteria *(mandatory)*

- **SC-001**: In a temporary git project, every documented machine-output
  invocation, with and without `--changed-only`, produces stdout that parses.
- **SC-002**: Each defect listed under Problem has a test that fails on the
  code before this change and passes after it.
- **SC-003**: A config written before this change (using `validators.structure`
  or `severity.structure`) produces the same pass/fail result and exit code.

## Assumptions

- `NO_COLOR` follows no-color.org: any non-empty value disables colour.
- Claude Code import rules are as its memory documentation states on
  2026-09-30: `@path` relative to the importing file, home and absolute paths
  allowed, not evaluated in code spans or blocks, at most 5 hops.
- A "documented machine-output invocation" is one whose help or
  `docs/commands.md` lists `--format json`, `sarif`, `junit` or `--stdout`.

## Out of Scope

- Generated-document consistency (spec 044), JS/TS and Python extraction
  (045, 046) and Spec Kit integration hints (048).
- Adding JSON output to commands that do not document it (`upgrade`,
  `watch`).
- Changing STR003's code or message.
