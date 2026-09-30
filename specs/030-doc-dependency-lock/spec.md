# Feature Specification: Doc Dependency Lock

**Feature Branch**: `feat/doc-dependency-lock`

**Created**: 2026-09-29

**Status**: Active

**Spec ID**: `docguard.doc-dependency-lock`

**Lineage**: #455 follow-up, from the maintainer's question: "a way to see
quickly that files changed, which docs reference them, and make sure docs are
always updated". Extends `docguard.document-lifecycle` (reviewed vs observed
state) and complements Freshness (FRS002), Diff-Suspicion (DSP001) and
`docguard diff --since`. Research compared line counts, file size, content
hashes, git blob IDs and AST symbol hashes. It also looked at DeepWiki,
OpenDeepWiki and Cursor's Merkle index; see [research.md](research.md).

**Input**: User description: "Spec the doc dependency lock: a doc section
declares the code it describes, DocGuard records what that code looked like
when the section was last reviewed, and flags the section when the code
changes."

## Problem

DocGuard can tell that a document is old, but not that the code a specific
passage describes has changed:

- **Freshness (FRS002)** counts every code commit in the repository. Ten
  unrelated commits flag a document about authentication, while a document
  whose one dependency changed yesterday stays quiet.
- **Diff-Suspicion, `diff --since` and the pre-commit nudge** infer links from
  text mentions and see one diff at a time. Once that commit lands the signal
  is gone, and nothing records that someone reviewed it.
- **Generated-staleness** covers only regenerable `source=code` sections. Human
  prose, where the architectural "why" lives, has no dependency tracking.

Nothing records "this section was last checked against this code when the code
looked like X". The maintainer's proposed signal, line counts or file size,
misses same-size edits (`30`→`90`, `>`→`>=`), fires on formatter reflow, and
cannot see a moved block. Storing counts or hashes in code comments is
self-referential, forces an edit to the comment on every change, conflicts on
parallel branches, and can be bumped without a review.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A section says what code it describes (Priority: P1)

A maintainer wraps a passage of `ARCHITECTURE.md` in a `source=human` section
marker with `covers="src/pricing.mjs#discount"` and accepts it
once. When the function body changes later, guard names the section, the
changed dependency, and the command that shows the change.

**Independent Test**: A fixture doc with one covered section, accepted, then
the covered function's body edited. Guard reports exactly one DLK001 for that
section and dependency. Reformatting the function or editing its comments
reports nothing.

**Acceptance Scenarios**:

1. **Given** a covered, accepted section, **When** the covered symbol's code
   changes semantically, **Then** DLK001 names the doc, section, dependency and
   a `git diff <reviewedRevision> -- <path>` command.
2. **Given** whitespace, formatting or comment-only edits to a covered JS/TS
   symbol, **Then** nothing is reported.
3. **Given** a covered symbol moved to another line in the same file, **Then**
   nothing is reported.
4. **Given** the covered symbol renamed or deleted, **Then** DLK002 reports a
   dependency that no longer exists.

### User Story 2 - Accepting a review is explicit and recorded (Priority: P1)

After reading the change and updating the prose (or deciding it still holds),
the maintainer runs `docguard review --accept ARCHITECTURE.md#pricing
--reason "..."`. The lock records the new hashes, the revision and the reason.

**Acceptance Scenarios**:

1. **Given** DLK001 on a section, **When** `review --accept <doc>#<id>` runs
   with a reason, **Then** the lock entry updates in one file transaction and
   DLK001 clears.
2. **Given** no `--reason`, **Then** nothing is written.
3. **Given** `sync`, `fix --write`, `generate` or any agent skill, **Then** the
   lock is never written.

### User Story 3 - See the whole picture before a release (Priority: P2)

`docguard review` (no flags) lists every covered section with its status:
current, changed, missing dependency, or never accepted.

1. **Given** a project with covered sections, **When** `review` runs, **Then**
   each section appears once with its status and its dependencies.
2. **Given** `--format json`, **Then** the same data is machine-readable.

### User Story 4 - Adoption without typing every path (Priority: P3)

`docguard review --suggest <doc>` proposes `covers` values from the paths and
symbols a section already mentions. It is marked low-confidence and never
writes.

### Edge Cases

- A `covers` entry pointing outside the project, at a symlink, or at an
  ignored path is refused, and the reason is printed.
- A glob (`cli/validators/**`) covers the set of matching files. Adding,
  removing or changing any of them changes the dependency.
- A JS/TS file that does not parse, or a symbol in a language without an AST
  tier, falls back to a content hash of the whole file, and the finding says
  which tier was used.
- A shallow CI clone or a squash-merged history cannot resolve
  `reviewedRevision`. The hash comparison still works; only the suggested diff
  command degrades to "view the file".
- A section removed from a doc leaves a stale lock entry (DLK004), cleared by
  `review --prune`.
- Two sections covering the same dependency are independent entries.
- A lock that fails to parse, or has an unsupported `schemaVersion`, is one
  error finding. It never counts as "all current".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A `docguard:section` marker MUST accept a `covers` attribute: a
  comma-separated list of `path`, `path#symbol` or glob entries, each relative
  to the project root. `source=human` sections MUST remain unwritable by
  `sync`.
- **FR-002**: DocGuard MUST fingerprint each dependency deterministically:
  - a JS/TS symbol by a hash of its normalized AST, ignoring positions,
    comments and formatting;
  - a Python symbol by a hash of `ast.dump` of its definition, when Python is
    available;
  - any other file, or any dependency whose parse fails, by a sha256 of its
    bytes;
  - a glob by a hash of the sorted `(path, fingerprint)` list.

  Each fingerprint MUST record its tier.
- **FR-003**: `.docguard-doc-lock.json` MUST store, per `doc#sectionId`: each
  dependency with its fingerprint and tier, the reviewed revision, the review
  date and the reason. It MUST be serialized deterministically (sorted keys,
  trailing newline) and validated against a published schema.
- **FR-004**: A Doc-Dependency validator MUST report:
  - **DLK001** (escalate): a locked fingerprint differs from the current one;
  - **DLK002** (warn): a dependency no longer resolves;
  - **DLK003** (warn): a covered section has no lock entry;
  - **DLK004** (warn): a lock entry has no section;
  - **DLK005** (error): the lock is unreadable.

  Each finding MUST name the doc, section and dependency, and DLK001 MUST
  include a command that shows the change.
- **FR-005**: `docguard review` MUST list section status. `review --accept
  <doc>#<id>|<doc>` MUST require `--reason`, write through
  `commitFileTransaction`, and record the current HEAD revision.
  `review --prune` MUST remove only DLK004 entries. No other command may write
  the lock.
- **FR-006**: `review --suggest <doc>` MUST propose `covers` values from
  existing path and symbol mentions, labelled low-confidence, and MUST NOT
  write.
- **FR-007**: The feature MUST be opt-in. A project with no `covers` attribute
  MUST produce byte-identical guard output and exit status, and no lock file.
- **FR-008**: The validator MUST fingerprint only declared dependencies, parse
  each file at most once per run, and add no more than 5% to guard's wall time
  on this repository once its own docs declare their dependencies (measured by
  the non-regression budget in `docguard.non-regression-budgets`).
- **FR-009**: This repository MUST adopt it for prose sections that describe
  specific modules: ARCHITECTURE's requirement-identity section, and DATA-MODEL's
  finding-channels and spec-registry sections. Table rows cannot carry a
  section marker, so the module map itself is not covered.
- **FR-010**: README, `docs/commands.md`, `docs/configuration.md`,
  ARCHITECTURE and DATA-MODEL MUST document the marker, the lock, the findings
  and the `review` command.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the fixture, a semantic edit of a covered symbol yields
  exactly one DLK001. Five non-semantic edits (whitespace, comments,
  reformatting, a line move, and an unrelated symbol in the same file) yield
  zero.
- **SC-002**: A project without `covers` attributes produces byte-identical
  `guard --format json` output before and after this feature, apart from the
  validator list and timings.
- **SC-003**: Guard's wall time on this repository grows by 5% or less
  (median of 5 A/B runs on one machine).
- **SC-004**: The sizing model is falsified. For each same-size semantic edit
  in the fixture, the line count and byte size are unchanged while DLK001
  fires.

## Out of Scope

- Inferring `covers` automatically at guard time. Inference is low-confidence;
  it stays in `review --suggest`, which does not write.
- Replacing FRS002. It remains the fallback for documents that declare nothing.
- Vector or embedding indexes (see [research.md](research.md)).

## Assumptions

- Section markers are the declaration surface. The maintainer asked for
  something visible and reviewable next to the prose, not metadata inside
  code.
- Fingerprints need no git history. The revision is stored only to show the
  change.
- A DLK finding is a review signal, never a hard failure. DLK005 is the one
  exception: a broken lock means nothing can be trusted.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `dfa1385749b66184c93bf65f5dde127192037711` — Reviewed at dfa1385 on main: all 10 tasks are checked and were delivered by #474, #477; the full suite (2368 tests) passes and guard reports 0 errors at this revision. Deviations from the plan are recorded in the task notes. Evidence: `cli/commands/review.mjs`, `cli/scanners/doc-deps.mjs`, `cli/validators/doc-dependency.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `tests/doc-dependency-lock.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
