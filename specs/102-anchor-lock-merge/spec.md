# Feature Specification: Anchor Lock Merges Cleanly

**Feature Branch**: `feat/102-anchor-lock-merge`

**Created**: 2026-11-13

**Status**: Draft

**Spec ID**: `docguard.anchor-lock-merge`

**Lineage**: Amends `docguard.requirement-anchors` (spec 070), which defined the anchor lock (FR-016 to FR-018, user story 2 scenario 8) and ANC009. An adopter that runs a strict gate on every commit reported that a union merge of the lock fails the gate; this spec changes how the lock is read and written, not what it records.

**Input**: "`docguard anchors accept --gitattributes` writes `merge=union` for the lock. When main and a branch both record a review of the same link, a union merge or rebase keeps both lines, and DocGuard refuses the duplicate (ANC009). Every session that merges or rebases with anchor changes fails its gate. The adopter removed the union line. Contributors of this repository take main's lock and re-run `anchors accept` for their own files on every merge."

## Problem

1. **A duplicate is a normal outcome of the merge the lock asks for.** The lock is JSON Lines so two branches that review different links merge without a conflict. Two branches that review the **same** link (the same file edited on both sides is enough: a file-scope link covers the whole file) each write one line for one key. `merge=union` keeps both. The reader then refuses the key (ANC009), even when the merged code matches one of the two reviews exactly.
2. **The refusal is a gate failure with a manual fix.** Reproduced on `main` at `9fea8e5`: two branches each ran `anchors accept --file src/pricing.mjs` after different edits; after `git merge` the lock holds two lines for `acme.billing#FR-001|src/pricing.mjs|*|file`, and `guard` reports only `ANC009 … on lines 2 and 3 with different content (usually a union merge of two reviews)`. No ANC001 appears, so the message does not say what changed or where to look.
3. **A writer silently deletes the other duplicated links.** `readAnchorLock` leaves a conflicted key out of `links`, and `anchors accept` and `anchors disposition` write back `links`. After a union merge with several duplicated keys, `accept --file X` leaves **no** line for every other duplicated key. A reviewed link that should be ANC001 becomes ANC004 (info), so a review is lost without a trace.
4. **There is no safe alternative.** A project that drops `merge=union` gets a git conflict with markers inside the lock, and DocGuard reads that as ANC005 with advice to restore the file from git (losing both reviews). The repository's own workaround is a hand-run: take main's lock, re-accept your own files.

### What the lock records (established on `main`)

- A line is one JSON object, keys sorted at every level (`stableLine`). The first line is the header `{"kind":"docguard-anchor-lock","schemaVersion":1}`.
- The **key** that identifies "the same link" is `requirement|file|anchor|scope` with each part percent-encoded (`|` and `%`). A disposition (a reasoned "this symbol implements no requirement") uses `disposition|file|anchor`.
- A link entry carries `code` (exact fingerprint), `floor` (pattern-tier fingerprint, comparable across machines), `req` (requirement fingerprint), `prev` (the three it replaced, or null), `state` (`reviewed` or `baselined`), `tier`, `revision` (full commit id or null), `date`, `reason`, `bulk`. A disposition carries `kind`, `reason`, `date`, `revision`, `bulk`.
- **There is no timestamp.** `date` is `YYYY-MM-DD` only, so "newest" means newest day, and two reviews on one day tie.
- Writes are canonical: header, then one line per key sorted by key. Every reader goes through `readAnchorLock`: the link status, the orphan report, `accept`, `accept --remove` and `disposition`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A union merge never fails the gate by itself (Priority: P1)

1. **Given** two branches that each accept the same link after different edits, `merge=union`, **When** they are merged (or rebased) and the merged content equals what one review recorded, **Then** `guard` reports no ANC finding.
2. **Given** the same merge where the merged content matches neither review, **Then** guard reports the normal ANC001 or ANC002 for that link, with its `anchors accept` command, and no ANC009.
3. **Given** a rebase instead of a merge, **Then** the same holds.

### User Story 2 - Any write leaves one line per link (Priority: P1)

1. **Given** a lock with duplicate lines for several keys, **When** `anchors accept` runs for one file, **Then** every other duplicated key keeps exactly one line, the one the reader would have chosen, and no key is lost.
2. **Given** the result, **When** `accept` runs again with nothing changed, **Then** the lock is byte-for-byte the same.

### User Story 3 - One command repairs a lock (Priority: P1)

1. **Given** a lock with duplicates, **When** `docguard anchors merge --check` runs, **Then** it exits 2 and names the count; `--write` rewrites the lock, prints how many lines it collapsed and lists each link that still needs review with its `anchors accept --file …` command.
2. **Given** a project without `merge=union` and a lock containing git conflict markers, **When** `anchors merge --write` runs, **Then** it keeps both sides, resolves them and rewrites the lock.

### User Story 4 - An older DocGuard reads what this one writes (Priority: P2)

1. **Given** a lock written by this version, **When** DocGuard 0.48.0 reads it, **Then** it reads without error and reports the same links.

## Requirements *(mandatory)*

- **FR-001**: `readAnchorLock` MUST keep every distinct line of a key. Byte-identical lines (after key sorting) are one entry. It MUST report the keys that had several distinct lines and how many lines were collapsed. A duplicate MUST NOT, by itself, be an error or a finding.
- **FR-002**: When a link key has several distinct lines, the entry that stands for it MUST be chosen as follows, using the link as it is now (`compareEntry`: the exact fingerprints at the same tier, the floor when the tier changed):
  - lines whose recorded fingerprints match the current content of both sides of the link are the valid reviews; the others are superseded and produce no finding;
  - if more than one distinct line matches, the one with the newest `date` stands, and among equal dates the last in file order;
  - if none matches, the link is suspect exactly as one stale entry would be: the newest `date` (then the last in file order) stands and the normal ANC001 or ANC002 is reported with that entry's revision and its `anchors accept` command.
  A key with no current link (a lost link, a disposition) is resolved by the newest `date`, then the last in file order.
- **FR-003**: Every writer of the lock (`anchors accept`, `accept --remove`, `anchors disposition`, `anchors merge --write`) MUST write the full resolved set: one line per key, the header, entries sorted by key. No writer MAY drop a key it did not mean to change. `accept` MUST take the prior entry (the `prev` it records) from the resolved entry.
- **FR-004**: `docguard anchors merge --check` MUST exit 2 when the lock file is not byte-for-byte what a write would produce, and 0 otherwise. `docguard anchors merge --write` MUST rewrite the lock when it is not, in one transaction, and MUST be a no-op on a normalized lock. Both print how many lines were collapsed, how many conflict markers were removed, and each link that still needs review with `docguard anchors accept --file <file> --reason "<what you checked>"`. `--format json` prints the same. Neither flag, or both, is a usage error (exit 1). A project with no lock gets a message and exit 0.
- **FR-005**: `anchors merge` MUST accept a lock containing git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`, and the `|||||||` base section of a diff3 style): it keeps both sides, drops the base section and the marker lines, and resolves as in FR-002. Guard and `anchors` MUST keep reading a lock with markers as ANC005, and its suggestion MUST name `docguard anchors merge --write`. Conflicts in code files are resolved first.
- **FR-006**: ANC009 MUST no longer be reported: every duplicate is resolved by FR-002, and a malformed line or a bad header is already ANC005. The code stays in the registry, marked "no longer reported since 0.49.0", so `explain ANC009`, `findingSeverity` configuration and inline pragmas that name it keep loading.
- **FR-007**: When the lock holds collapsed duplicate lines, `anchors` and guard notes MUST say so with the fix (the next `accept`, or `docguard anchors merge --write`). A note never changes an exit code.
- **FR-008**: The lock format MUST NOT change: no new field, same header and schema version. A lock without duplicates, which every write produces, MUST be read by 0.48.0 without error and with the same links.
- **FR-009**: The note that tells a project to add `merge=union` stays, and `--gitattributes` still adds it. Documentation MUST explain: with union, merges never conflict and DocGuard resolves duplicates; without it, resolve a conflict with `docguard anchors merge --write`. `AGENTS.md` and `CONTRIBUTING.md` MUST no longer tell contributors to restore main's lock and re-accept.
- **FR-010**: `anchors merge --write` is the second `anchors` subcommand that writes the lock. Guard, `specs`, `sync`, `fix`, every MCP tool and every skill still never write it (spec 070 FR-022).

## Success Criteria *(mandatory)*

- **SC-001**: The reproduction (two branches accept one link after different edits, merged and rebased under `merge=union`) reports no ANC finding when the merge matches one review, and ANC001 (not ANC009) when it matches neither.
- **SC-002**: A second `accept` and a second `anchors merge --write` leave the lock byte-for-byte unchanged.
- **SC-003**: For random interleavings of two valid locks' lines, the resolved result is the same except where FR-002 lets file order decide.
- **SC-004**: On this repository's own history, a merge of two branches that both ran `anchors accept` on one file needs no manual step.
- **SC-005**: A lock written by this version is read by 0.48.0 without error.

## Edge Cases

- Two lines for one key identical except key order or whitespace: one entry (they canonicalize to one line).
- Duplicates whose fingerprints use an algorithm this version does not compute: they compare as unverifiable; a line that matches wins, otherwise the newest stands and the link reads as unverifiable (ANC010) as one entry would.
- A moved link (the FR-030 carry-over) is decided after the duplicates of its old key are resolved.
- Conflict markers inside a diff3 lock: the base section's lines are not kept, so a review removed on one side is not resurrected from the base. A line removed on one side only (a `--remove`) is still kept if the other side has it; run `anchors accept --remove` again.
- An empty file, a missing header, a malformed line and an unsupported version stay ANC005.
- A marker line inside a JSON string cannot occur (a JSON line never starts with `<<<<<<<`).
- A lock above 64 MB stays ANC005.

## Out of Scope

- A git merge driver: it needs per-clone configuration; union needs none.
- A timestamp field: the format is unchanged (FR-008). Same-day reviews tie and file order decides, which changes which reviewer and reason are kept, never whether a link needs review.
- Resolving conflicts in source files or specs.
- Authenticating who reviewed (spec 070 FR-025 stands: CODEOWNERS).
