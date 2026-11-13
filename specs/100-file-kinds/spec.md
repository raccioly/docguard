# Feature Specification: File Kinds, One Rule for Copied Files

**Feature Branch**: `feat/100-file-kinds`

**Created**: 2026-11-13

**Status**: Draft

**Spec ID**: `docguard.file-kinds`

**Lineage**: Generalizes `docguard.instruction-copies` (spec 099), which fixed one reported case, and replaces its unreleased classifier and override. Builds on `docguard.agent-instruction-role` (spec 094), `docguard.fallback-language-coverage` (spec 043, package segments), `docguard.coverage-followups` (spec 051, ignored directory entries) and `docguard.strict-by-default` (spec 097: a wrongly dropped file must stay visible, because strict mode fails on what it examines).

**Input**: The owner's direction after spec 099: do not patch one case. A repository holds many files that are not this project's own work, and DocGuard has no single answer to "is this file this project's own". It was asked for one scaffolder template and answered for one. The same question is answered, differently, in at least thirteen places.

## Problem

An audit of the code and a survey of 56 real repositories (identified here only by kind) found the following.

### The code answers the question thirteen ways

- At least 13 validators keep a private directory-name ignore set. `isNonProductPath` and `DEFAULT_DETECTION_IGNORE_DIRS` (`cli/shared-ignore.mjs`) are case-sensitive and know neither templates nor backups. `TEMPLATE_DIRS` (spec 099) is case-insensitive and used only by the instruction role. Nothing recognizes a backup file name or a nested Git checkout, and nothing compares content.
- **D1** The instruction-chain budget (`STR004`, `measureInstructionChains`) counts a template `AGENTS.md`. Spec 099 left the role and missed the budget.
- **D2** A fixture copy hides a real finding. The symbol set behind `REF001` walks the whole tree, so a fixture file that defines a removed function makes a stale reference vanish.
- **D3** With `docs-canonical/SECURITY.md` missing and `docs-canonical/archive/SECURITY.md` present, the unique-same-named-canonical rule adopts the archive copy: `STR001` says the document is missing while `STR003` checks the copy's sections.
- **D4** `detectCanonicalLayout` and the role hint propose `examples/x/docs/ARCHITECTURE.md` or `templates/app/docs/...` as this project's canonical document.
- **D5** `Templates/` is recognized and `Examples/` and `Fixtures/` are not.
- **D6** `docs-canonical/ARCHITECTURE copy.md` is read as a document (`XRF001` from it). TODO tracking flags files in `templates/`, `backup/`, `examples/`, `fixtures/` and in an untracked nested checkout (a folder holding a `.git` file).
- **D7** One defect repeated in `AGENTS.md`, `CLAUDE.md` and `.github/copilot-instructions.md` gives one finding per file; `GEMINI.md` is read inconsistently; contradictory hand-written mirrors give nothing.
- **D8** The TODO-tracking validator keeps a private ignore set and flags `out/` and `target/`, which `DEFAULT_IGNORE_DIRS` skips.
- **D9** `docguard llms` lists `ARCHITECTURE copy` and `ARCHITECTURE-old` as documents.

### What real repositories hold

- Template forms (a scaffolder's files written into other repositories) in about 6 of 56; fixture or example mini-projects in about 8.
- The largest class is **mirrors**: 15 repositories hold the same skill file two or three times under agent folders and an extension folder (about 230 identical groups), and the copies drift (one installed skill exists in 24 versions).
- Four repositories keep the same basename in `docs-canonical/` and `docs-implementation/` on purpose (intent against as-built). That is never a duplicate.
- Two keep `docs-canonical/<DOC>.md.bak`. No repository had a case-variant duplicate.
- Placeholders such as `{{name}}` also appear in ordinary specs, so content is not a signal for "template".
- Folder names that really hold copies: `templates`, `template`, `scaffold`, `starter-kit`, `fixtures`, `__fixtures__`, `examples`, `samples`, `corpus`, `golden`, `vendor`, `vendored`, `dist`, `generated`, `archive`, `backup`, `legacy`.

## Design

One module, one closed vocabulary, one override, one place where nothing is dropped silently. The rule errs toward `own`: classifying a file as a copy removes it from checks, so a file the vocabulary does not recognize stays the project's own.

### Kinds

`fileKind(path, config, opts)` returns `{ kind, segment, reason }`. The kinds are a closed list: `own`, `template`, `fixture`, `test`, `vendored`, `generated`, `backup`, `nested-checkout`.

| Kind | Directory names (whole path segment, case-insensitive) |
|---|---|
| `template` | `templates` `template` `_templates` `__templates__` `scaffold` `scaffolds` `boilerplate` `boilerplates` `starter-kit` `starter-kits` `skeleton` `skeletons` |
| `fixture` | `fixtures` `__fixtures__` `test-fixtures` `testfixtures` `testdata` `__mocks__` `mocks` `examples` `example` `sample` `samples` `corpus` `golden` |
| `test` | `test` `tests` `__tests__` `test-helpers` `spec` `specs` (the project's own tests: not copies, but detection never reads them as product code) |
| `vendored` | `node_modules` `vendor` `vendored` `third_party` `.venv` `__pycache__` |
| `generated` | `dist` `build` `out` `coverage` `target` `obj` `_build` `generated` |

`demo`, `seed`, `baseline`, `content`, `public`, `assets` and `legacy` are not directory kinds: they hold real product too often. `__fixtures__` and `__mocks__` are already in `DEFAULT_DETECTION_IGNORE_DIRS`, so the additions are `corpus` and `golden` only, and those two are instruction-copy words: a product package can carry either name (`nltk.corpus`), so detection (`isNonProductPath`, `DEFAULT_DETECTION_IGNORE_DIRS`) never skips them. `vendored` and `generated` keep the meaning of `DEFAULT_IGNORE_DIRS` and add `vendored`, `third_party` and `generated`. Stage 1 answers `vendored` and `generated` from directory names only; `isGeneratedPath`'s file-name rules join in Stage 2.

Rules for the directory vocabulary:

- A segment counts only **before the first segment that starts with `.`**. Harness folders (`.claude/`, `.cursor/`, `.agents/`) hold files the harness loads, whatever their subfolders are called.
- A package segment never counts (`isPackageSegment`, matched case-insensitively): `src/main/java/com/example` and `com/Example` are product code.
- When several segments of a path qualify, the kind is chosen in the order `template`, `fixture`, `test`, `vendored`, `generated` (a file under `tests/fixtures/` is a fixture), and `segment` is the first segment of that kind. (Spec 099 made a template outrank a test folder; this keeps it.)
- A `spec` or `specs` segment whose next segment is a Spec Kit feature directory (`specs/012-name/`, `isFeatureSpecDirectory`) is the project's own documents: `own`, not `test`, unless `opts.featureSpecs` is `'test'`. `isNonProductPath` and the instruction role pass `'test'`, so detection and spec 094 behave as before.
- `opts.kinds` restricts the answer to the listed kinds (a caller that asks only about `fixture` is not answered `template`). `opts.harnessFolders: 'all'` turns the dot-segment cutoff off; only `isNonProductPath` uses it, to keep `.agent/skills/x/tests/y.js` non-product as it is today.

### The folder that holds the file

`opts.describesFolder` is true for a file that describes its own folder: agent-instruction files and `README*`. Then the holding folder does not count: `templates/AGENTS.md` governs `templates/`, as `packages/templates/AGENTS.md` governs a package. For every other file every ancestor counts: `fixtures/old.js` is a fixture.

**Decision recorded here (it departs from the plain reading of the design):** spec 094 drops `tests/AGENTS.md` from the instruction role, and spec 099 explicitly kept that. The role therefore uses two rules, unchanged in effect: a template ancestor with `describesFolder: true`, and a fixture ancestor anywhere in the path (`isNonProductPath`, the spec 094 rule). PSR006 and the chain budget use `describesFolder: true` for both kinds. So `tests/AGENTS.md` stays out of the role, is not a PSR006 copy and is measured by the chain budget as a nested file; `tests/app/AGENTS.md` is out of the role, is a PSR006 copy and is not in the budget.

### Backups and nested checkouts

- `backup` applies to **documents only** (Markdown and other prose formats), never to code. By file name: `*.bak`, `*.orig`, `*.backup`, `*~` after a document name, `<name> copy.md`, `<name> (N).md`, `<name>-old.md`, `<name>.old.md`. By directory: inside a documentation directory (`docs`, `docs-canonical`, `docs-implementation`, `documentation`, `doc`), an ancestor segment `archive`, `archived`, `backup`, `backups`, `old` or `deprecated`.
- `nested-checkout`: a non-root directory that contains a `.git` file or directory. It needs the project root, so it is answered only when `opts.root` is given; the vocabulary and backup rules are pure functions of the path. The check is cached per directory.

### Override and exclusion

- `fileKinds.own` (array of globs) forces `own`. It replaces spec 099's unreleased `agentInstructions.governing`, which is removed (it never shipped).
- `.docguardignore` and `ignore` still win and remain the way to exclude a file.
- Same basename is never by itself a duplicate.

### Nothing is dropped silently

Guard JSON carries `files.kinds`: the count of tracked files per kind, and up to 20 paths per non-`own` kind that were left out of a document or instruction role. Text output prints one line when any role file was left out as a copy. A wrongly classified governing file stays visible and the line names the override.

## Stages

One pull request each.

- **Stage 1 (this change).** This spec in full; `cli/shared-file-kind.mjs`; spec 099 moved onto it; `fileKinds.own`; case-insensitivity (D5); the chain budget (D1); `files.kinds`; the guard test with an allowlist that lists every validator not yet migrated.
- **Stage 2.** Every validator and command asks `fileKind`; D2, D3, D4, D6, D8 and D9 are fixed; nested checkouts are never walked; a new warning for a backup-named document inside a documentation directory; the allowlist ends empty.
- **Stage 3.** Mirrors. Identical content (same hash) across instruction files or skill copies is evaluated once and reported once, naming every path (D7). A drift warning when files that are the same skill or command at the same relative path under different agent roots differ, or when two root instruction files are near-identical but not identical. Files that are simply different documents are not drift. `GEMINI.md` is handled like the others.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One answer to "is this file the project's own" (Priority: P1)

1. **Given** a path under `Templates/`, `TEMPLATES/`, `Examples/` or `Fixtures/` (any case), **When** `fileKind` runs, **Then** it returns `template` or `fixture` with the segment as written.
2. **Given** a path nothing in the vocabulary recognizes, **Then** it is `own`.
3. **Given** `src/main/java/com/Example/AGENTS.md` or `.claude/skills/templates/SKILL.md`, **Then** it is `own`.
4. **Given** `fileKinds.own` naming a path, **Then** it is `own` even below `examples/`.

### User Story 2 - Template and fixture instruction copies leave the role and the budget (Priority: P1)

1. **Given** a reviewed root `AGENTS.md`, a reviewed `templates/app/files/AGENTS.md` and a new root package script, **Then** `FRS007` names the root file only (spec 099, unchanged).
2. **Given** a 20 KB root `AGENTS.md` and a 20 KB `templates/app/files/AGENTS.md`, **Then** `STR004` does not count the template (D1); with a 20 KB `packages/api/AGENTS.md` it still does.
3. **Given** `Examples/x/AGENTS.md` and `Fixtures/f/AGENTS.md`, **Then** they leave the role exactly as `examples/` and `fixtures/` do (D5).
4. **Given** `templates/AGENTS.md` beside `templates/app/files/AGENTS.md`, **Then** the first governs `templates/` and stays in the role and in the budget; the second is a copy.

### User Story 3 - A copy that shares a governing file's name is reported (Priority: P1)

PSR006 keeps spec 099's meaning: high confidence for a `template` copy, low for a `fixture` copy; no finding for a monorepo package, `templates/AGENTS.md`, a lone template or an ignored copy.

### User Story 4 - A dropped file stays visible (Priority: P1)

1. **Given** a project with a template instruction copy, **When** `guard --format json` runs, **Then** `files.kinds.excluded.template` lists it and `files.kinds.counts` has a `template` count.
2. **Given** the same project, **Then** the text output has one line naming the number of files left out and `fileKinds.own`.
3. **Given** `fileKinds.own` naming the file, **Then** the line is gone and the file is in the role.

### User Story 5 - A mirror is one finding (Priority: P2, Stage 3)

Given the same defect in `AGENTS.md`, `CLAUDE.md` and `.github/copilot-instructions.md` with identical content, **Then** one finding names all three paths; given two root files that differ slightly, **Then** a drift warning.

### User Story 6 - No validator keeps its own list (Priority: P1)

1. **Given** a file under `cli/` that defines a directory-name ignore set or walks the tree without the shared classifier, **When** the guard test runs, **Then** it fails unless the file is in the allowlist with a reason.
2. **Given** an allowlist entry that no longer matches, **Then** the test fails too (Stage 2 ends with an empty list).

## Edge Cases

- **Same basename on purpose.** `docs-canonical/X.md` and `docs-implementation/X.md`, per-package READMEs and CHANGELOGs are `own`.
- **`templates/AGENTS.md`.** Governs `templates/`: `own` with `describesFolder`.
- **Harness dot-folders.** A template or fixture segment after `.claude/` or `.cursor/` does not count.
- **Package segments.** `src/main/java/com/example/...` and Go `internal/example` are product code, in any case.
- **A root file is never a copy.** No directory vocabulary applies to a file with no ancestor.
- **Symlinks.** A symlinked file is classified by the path it is listed under; `fileKind` follows no links and does not read the file.
- **A real product package named `examples`** (a workspace member that publishes to a registry) is rescued by `fileKinds.own: ["examples/**"]`, and nothing else has to change.
- **Case-only differences.** `Templates` and `templates` classify alike, and so does `TEMPLATES`.
- **`tests/AGENTS.md`.** Out of the role (spec 094), not a PSR006 copy, in the budget: see the decision above.
- **Spec Kit `specs/`.** `spec` and `specs` are test directories because detection scanners treat them as test data (RSpec-style trees), but `specs/012-thing/` holds this project's own documents: `fileKind` answers `own` for it by default (`specs/100-file-kinds/spec.md`, `Specs/012-thing/tasks.md`), and `spec/models/user_spec.rb` stays `test`. Detection keeps its older answer through `featureSpecs: 'test'`.
- **`corpus` and `golden`.** Instruction-copy words only; routes, Security and the other detection callers still read them as product, because `corpus` can be a real package.
- **A documentation directory named `archive`.** `docs-canonical/archive/SECURITY.md` is a `backup` document; an `archive/` directory outside a documentation directory is not.
- **Source named like a backup.** `src/old.js` and `cli/copy.mjs` are code: `backup` never applies to code.

## Requirements *(mandatory)*

### Functional Requirements

Stage 1:

- **FR-001**: `cli/shared-file-kind.mjs` MUST export `fileKind(path, config, opts)` returning `{ kind, segment, reason }` with `kind` one of `own`, `template`, `fixture`, `test`, `vendored`, `generated`, `backup`, `nested-checkout`, and the vocabulary above. A path nothing recognizes is `own`. The function reads no file contents.
- **FR-002**: Directory vocabulary MUST match whole path segments case-insensitively, only before the first segment starting with `.` (unless `opts.harnessFolders` is `'all'`), and never for a package segment, which `isPackageSegment` MUST also judge case-insensitively.
- **FR-003**: With `opts.describesFolder` the holding folder MUST NOT count; without it every ancestor counts. A root file (no ancestor) is always `own`.
- **FR-004**: `fileKinds.own` (array of globs) MUST force `own`. `agentInstructions.governing` MUST be removed from code, schema, documents and tests. `.docguardignore` and `ignore` MUST still exclude a file first.
- **FR-005**: `backup` MUST apply only to documents, by the file-name and documentation-directory rules above; `nested-checkout` MUST be answered only when `opts.root` is given and MUST be cached per directory.
- **FR-006**: `isNonProductPath`, `isNonProductDir` and `DEFAULT_DETECTION_IGNORE_DIRS` MUST become callers or views of the shared vocabulary, keeping their current meaning except case-insensitivity: they mean `fixture` or `test` (`corpus` and `golden` excluded) and a Spec Kit feature directory still counts. `instructionCopyOf` and `TEMPLATE_DIRS` MUST be removed.
- **FR-007**: The agent-instruction role MUST drop a non-root file that is a template, fixture or test copy (`describesFolder: true`) or below a fixture or test directory anywhere in its path (spec 094), unless `fileKinds.own` names it. Every reader of the role follows.
- **FR-008**: PSR006 MUST keep spec 099's meaning on top of `fileKind`: a `template` copy is high confidence, a `fixture` or `test` copy low, both with `describesFolder: true`; the suggestion names `fileKinds.own`.
- **FR-009**: The instruction-chain budget MUST NOT count a file that is a copy by FR-008's rule (`describesFolder: true`, template or fixture) and MUST honor `fileKinds.own`. A governing nested file is still counted.
- **FR-010**: Guard JSON MUST carry `files.kinds` with `counts` per kind over tracked files and `excluded`, up to 20 paths per non-`own` kind, for files left out of a document or instruction role; text output MUST print one line when any role file was left out. The field is absent on the `--changed-only` lite path.
- **FR-011**: A test MUST fail when a file under `cli/` defines a private directory-name ignore set or walks the tree without the shared classifier and is not in an allowlist that carries a reason per entry. The allowlist is exact in both directions: an entry that no longer matches fails.

Stage 2:

- **FR-012**: Every validator and command that decides whether a file is the project's own MUST ask `fileKind`; D2, D3, D4, D6, D8 and D9 MUST be fixed; a `nested-checkout` MUST never be walked; the allowlist MUST be empty.
- **FR-013**: A documentation directory holding a backup-named document MUST get a warning.

Stage 3:

- **FR-014**: Instruction files and skill copies with identical content MUST be evaluated once and reported once, naming every path.
- **FR-015**: Same-skill copies at the same relative path under different agent roots that differ MUST get a drift warning, and so must two root instruction files that are near-identical but not identical. Different documents MUST NOT.

## Success Criteria *(mandatory)*

- **SC-001**: Each Stage 1 defect (D1, D5) and each Stage 1 behavior has a test that fails before the change.
- **SC-002**: With the CLI at `origin/main` and at this branch on DocGuard and eight other real repositories, the only differences are the expected ones: instruction copies leaving the role, PSR006, `STR004` from D1, case fixes, and `corpus` and `golden`.
- **SC-003**: `npm test`, `node cli/docguard.mjs guard` and the benchmark comparison pass.

## Out of Scope

- Translations (`README.pt-BR.md`) are not copies.
- Path-based baseline fingerprints: moving a file between kinds changes a finding's location; the baseline migration is a separate design.
- Classification by content (placeholders, hashes) in Stage 1 and Stage 2. Stage 3 uses a hash only to group identical mirrors.
- Directory kinds for `demo`, `seed`, `baseline`, `content`, `public`, `assets`, `legacy`.
