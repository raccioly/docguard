# Feature Specification: Recorded Document Reviews and Per-Reference Staleness

**Feature Branch**: `feat/095-recorded-document-reviews`

**Created**: 2026-11-12

**Status**: Implemented

**Spec ID**: `docguard.recorded-document-reviews`

**Lineage**: Second of three specs for issue 628. It builds on the agent-instruction role of `docguard.agent-instruction-role`.
- It extends the doc dependency lock of `docguard.doc-dependency-lock` from sections that declare `covers=` to whole documents. A review records a fingerprint of every file the document references, with the fingerprint tiers that lock already uses.
- It is the document-level counterpart of `docguard.requirement-anchors` (a link is fingerprinted at acceptance and reported when the code changes).
- FRS002 (`docguard.calibrated-finding-channels`) stays the repository-wide signal. Ranking it is spec 096.

**Input**: Issue 628 and its Stage 1 investigation, with the orchestrator's decisions of 2026-11-12. TestGuard's `AGENTS.md`, reviewed 2026-09-22, did not describe its code for seven weeks:
- `AGENTS.md:35` describes `src/probe/probe.mjs` as a sequential pipeline. 74% of that file's lines were added after the review (+1066/−190 of 1432).
- The `corpus` package script and the top-level `corpus/` directory were added after the review and are not mentioned.
- Guard printed one FRS002, "repository-wide heuristic, not evidence".

The Stage 1 prototype measured precision. For documents with a review marker, file references only, at ≥50%: 2 true, 1 false, 2 unclear (n = 5). For unmarked documents: 0 true of 7. Advancing the marker by hand silenced both FRS002 and the prototype measure.

## Problem

- **A review records when, not what.** The `docguard:last-reviewed` marker is a date. Nothing records which files the reviewer compared the document with, so nothing can say what changed since. A marker advanced without reading resets every signal.
- **Churn share alone is a weak judge.** A referenced file that grew is not proof that the sentence naming it is wrong. The precision of n = 5 says so. The share must rank evidence and gate a threshold, not stand in for the review.
- **Omission is invisible.** A reference check sees what a document names. It cannot see a script or a directory that appeared after the review and that the document never mentions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A review records what was checked (Priority: P1)

**Independent Test**: TestGuard at d105043 (the 2026-09-22 review commit), `docguard review --accept AGENTS.md --reason "…"`.

**Acceptance Scenarios**:

1. **Given** that command, **Then** `.docguard-doc-reviews.json` records the following for `AGENTS.md`, and the command prints the count of references it recorded:
   - the review commit, the date and the reason;
   - a fingerprint per referenced file, one entry per file named in backticks, links or slash-paths that resolves to a tracked file;
   - the excluded references, each with the reason it was excluded.
2. **Given** a reason shorter than 8 characters, **Then** nothing is written and the command exits 1, the same contract as `review --accept <doc>#<id>`.
3. **Given** a document in no role and no canonical tier (a random `notes.md`), **Then** the command refuses and names the documents it accepts.
4. **Given** `review --accept AGENTS.md` run twice with no change, **Then** the second run writes nothing.

### User Story 2 - FRS006 names the file that changed since the review (Priority: P1)

**Independent Test**: TestGuard at f89ca46: with the legacy marker (no recorded review); after a recorded review at d105043; and after a fresh recorded review at f89ca46.

**Acceptance Scenarios**:

1. **Given** f89ca46 with only the 2026-09-22 marker, **Then** FRS006 reports `AGENTS.md:35`, `src/probe/probe.mjs`, its share (≥ 50%) and `+added/−deleted` since 2026-09-22, ranked first among that document's references.
2. **Given** a recorded review at d105043 and HEAD at f89ca46, **Then** FRS006 reports the same reference, and says the fingerprint changed since the recorded review.
3. **Given** a recorded review at f89ca46, **Then** there is no FRS006 for `AGENTS.md`.
4. **Given** that recorded review, then one commit that rewrites half of `src/probe/rank.mjs`, **Then** FRS006 reports `src/probe/rank.mjs` only.
5. **Given** a referenced file whose share is below 50%, **Then** it is not reported. With `--verbose` or in JSON, it is listed under the finding's evidence when another reference crossed the threshold.
6. **Given** a canonical (non-agent) document with a marker and a reference at ≥ 50%, **Then** there is no FRS006. Its FRS002 finding carries the same evidence (`staleness.references`) as information.
7. **Given** an unmarked agent-instruction document with no recorded review, **Then** there is no FRS006 (see US4).

### User Story 3 - FRS007 names surface added since the review that the document never mentions (Priority: P1)

**Acceptance Scenarios**:

1. **Given** TestGuard at f89ca46 with the 2026-09-22 marker, **Then** FRS007 for `AGENTS.md` names the package script `corpus` and the top-level directory `corpus/`, each added after the review.
2. **Given** a script added since the review that the document mentions (`npm run corpus`, or `` `corpus` `` in backticks), **Then** it is not reported.
3. **Given** a script or directory that existed at the review and is still not mentioned, **Then** it is not reported. FRS007 is about surface added since the review, not about completeness.
4. **Given** a pointer `CLAUDE.md` whose target is `AGENTS.md`, **Then** FRS007 is reported once, for `AGENTS.md`.

### User Story 4 - An agent-instruction document with no review record says what to run (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a `GEMINI.md` with no marker and no recorded review, **Then** FRS008 says it has no review record and gives the exact command: `docguard review --accept GEMINI.md --reason "<what you checked>"`. It is a warning (orchestrator decision 2: complete by default; both conditions are facts).
2. **Given** a root `AGENTS.md` committed 2 days ago with no marker, **Then** FRS008 is still reported. A commit is not a review.

### User Story 5 - A marker advanced without a recorded review is visible (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a recorded review at 2026-09-22 and a later commit that changes only the marker line to 2026-11-12, **Then** FRS009 reports it as a warning. FRS006 keeps measuring from the recorded review.
2. **Given** a document with a legacy marker and no recorded review, **Then** the marker is honored as the review point and FRS009 does not fire.

### User Story 6 - Agents are told when they are served stale instructions (Priority: P2)

**Acceptance Scenarios**:

1. **Given** an agent-instruction document with FRS006 or FRS007, **Then** guard's human output prints one line at the top, before the validator list, whatever the severity: "Agents are being served stale instructions: AGENTS.md (FRS006, FRS007)". JSON carries `staleInstructions[]`.

### Edge Cases

- **A referenced file deleted after the review**: PSR002 or REF reports it. FRS006 does not.
- **A referenced file renamed**: `git diff --numstat -M` follows the rename. The fingerprint check reports it as changed, naming both paths.
- **A shallow clone where the review commit is missing**: FRS006 cannot measure. The validator reports partial coverage naming the document and is never silent. The fingerprint comparison still works, because it needs no history.
- **The doc-reviews file is malformed**: every recorded review is unusable. The run reports FRS010, an error that fails the build, and falls back to markers.
- **Several references on one line**: each is measured. The finding lists them in share order.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `docguard review --accept <doc> --reason <text>`, for a document in the agent-instruction role, a canonical document, `README.md` or `CONTRIBUTING.md`, MUST write a document-review entry to `.docguard-doc-reviews.json`. The entry holds:
  - `reviewedAt` (YYYY-MM-DD) and `reviewedRevision` (HEAD), plus `reason` (8-500 characters);
  - `references`: a map of referenced path to `{ tier, fingerprint }`. The tiers are the doc lock's: `content`, `ast` or `python-ast` for `path#symbol`;
  - `excluded`: a map of path to reason.

  Writes go through `commitFileTransaction`. A rerun with an identical entry writes nothing.

  The existing `review --accept <doc>#<id>` (section reviews in `.docguard-doc-lock.json`) is unchanged. A document-level accept on a document that also has covered sections records both.
- **FR-002**: The reviews file MUST be separate from `.docguard-doc-lock.json`, with its own `schemaVersion: 1`. The doc lock rejects unknown top-level fields. A new key in that lock would make every older DocGuard that a CI pins reject the whole lock and lose Doc-Dependency.
- **FR-003**: References MUST be extracted with the rules the Stage 1 prototype measured:
  - backticked spans, Markdown link targets, and slash-paths that resolve to a tracked file, relative to the document's directory and then the project root;
  - fenced code blocks included, because a command block in an instruction file is instruction;
  - one entry per path, keeping the first line that names it.
- **FR-004**: These references MUST be excluded and recorded with a reason:
  - directories;
  - files in the role that are vendored (`docguard.agent-instruction-role` FR-006);
  - `CHANGELOG*`, `*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `go.sum`;
  - files marked `linguist-generated` in `.gitattributes`, or carrying a `generated by` header;
  - JSON files under fixture, test, claims and evidence paths (`isNonProductPath`, and names matching `*.claims.json`, `*evidence*.json`);
  - files under 20 lines.

  The benchmark (FR-012) measures the exclusion list by reporting how many true and false findings each exclusion removes.
- **FR-005**: For each reference, the base MUST be the later of two points: the document's review point, and the commit that last changed the referencing line (`git blame` of the document at HEAD).
  - The review point is the recorded review's revision when one exists. Otherwise it is the last commit on or before the end of the `docguard:last-reviewed` day.
  - The share is the added lines of `git diff --numstat -M <base> HEAD -- <path>` divided by the file's current line count, or 100% when the file did not exist at the base.
  - The diffs are grouped by base, one call per distinct base.
- **FR-006**: New code **FRS006**, Freshness, for documents in the agent-instruction role only, non-pointer and non-vendored, with a recorded review or a marker. It fires when at least one non-excluded reference has a share of at least `freshness.referenceShare` (default 0.5).
  - With a recorded review, a reference also counts only if its fingerprint differs from the recorded one. A reference added to the document after the review has no fingerprint and is measured by share alone.
  - The message names the document line, the file, the share, `+added/−deleted` and the review date, for up to three references in share order, and how many more crossed the threshold.
  - Severity `warn`, disposition `escalate`, confidence `high`.
  - A project makes it fail through the role-scoped `findingSeverity` form (FR-010).
- **FR-007**: For a canonical document with a marker or a recorded review, Freshness MUST compute the same evidence and attach it to that document's FRS002 or FRS003 finding as `staleness: { references: [...], reviewPoint }`. It MUST NOT emit FRS006 for it. No other finding changes.
- **FR-008**: New code **FRS007**, Freshness, for the same documents as FRS006. It fires when the document, with its pointers' text added, mentions neither of the following, though they were added after the review point:
  - package scripts (keys of `scripts` in a root `package.json`, minus `pre`/`post` hooks of an existing script);
  - top-level tracked directories (not dot-directories).

  A script is mentioned as `npm|pnpm|yarn|bun run <name>`, `npm <name>` for lifecycle names, or `` `<name>` ``. A directory is mentioned as a whole token, with or without a trailing slash. Severity `warn`, disposition `escalate`, confidence `high`.
- **FR-009**: New codes, both warnings by default (orchestrator decision 2; whether they fail the build is decided by the separate defaults audit):
  - **FRS008**: an agent-instruction document (non-pointer, non-vendored) with no marker and no recorded review. Its suggestion is the exact `docguard review --accept <path> --reason "<what you checked>"` command.
  - **FRS009**: a document whose marker date is later than its recorded review's `reviewedAt`, set by a commit that changed no other line of the document. It names that commit. FRS006 keeps measuring from the recorded review.
- **FR-010**: `findingSeverity` MUST accept a role-scoped value, `{ "FRS006": { "agent-instruction": "high" } }`. The level applies to findings whose document is in that role; other findings of the code keep the default. This is the only new configuration shape. The JSON schema and DATA-MODEL document it.
- **FR-011**: When any agent-instruction document has FRS006 or FRS007, guard's human output MUST print one line before the validator list, whatever the severity, on the default output and with `--quiet`, and JSON MUST carry `staleInstructions: [{ doc, codes }]`.
- **FR-014**: New code **FRS010**, Freshness, severity `error`: the reviews file cannot be read (not JSON, an unsupported `schemaVersion`, or an unknown field outside `extensions`). It never reads as "no reviews". The reviews file's compatibility rule is part of its schema: a future field goes under `extensions` (top level, per document or per reference), which readers ignore.
- **FR-012**: A history-replay benchmark (`benchmarks/history-replay/`) MUST measure FRS006 and FRS007 precision.
  - **Method**: walk review points (marker commits) in the public repositories DocGuard and TestGuard, and in pinned public repositories with agent-instruction files. Evaluate at review + 2, 4 and 8 weeks.
  - **Labels**: a hit is labeled true when the referencing line, or a sentence naming that file or surface, was rewritten in the document within the next 8 weeks. Otherwise it is labeled false, unless a human label overrides it.
  - **Output**: precision with its Wilson interval per role and threshold, committed as the precision evidence for FRS006 and FRS007.
  - **Private projects**: results from local private projects are reported to the maintainer only, never committed.
- **FR-013**: `cli/findings.mjs` (FRS006 to FRS009), `docs/reference/findings.md`, DATA-MODEL (the reviews file and the `findingSeverity` form), ARCHITECTURE, the `review` command help and `CHANGELOG.md` MUST describe the change.

## Success Criteria *(mandatory)*

- **SC-001**: Each US1-US6 acceptance scenario has a test that fails on the base and passes after.
- **SC-002**: On TestGuard at f89ca46, guard names `AGENTS.md:35`, `src/probe/probe.mjs` and the share (FRS006), and `corpus` (FRS007).
  - On a copy reviewed with `review --accept AGENTS.md` at f89ca46, neither fires.
  - After one referenced file is changed in that copy, FRS006 fires for that file only.
  - All three are shown in the pull request with the commands and output.
- **SC-003**: The history-replay benchmark reports FRS006 precision at the 0.5 threshold for the agent-instruction role, with n and the Wilson interval, in the pull request.
- **SC-004**: An A/B on the local projects changes only findings FR-006 to FR-011 and FR-014 explain, each reviewed by hand. Guard wall time on DocGuard stays within the budget job's ×1.15.

## Assumptions

- **TestGuard's merged rewrite** of `AGENTS.md` (testguard#294) will move its marker. SC-002 uses f89ca46, which still carries the 2026-09-22 marker.
- **Numstat versus blame**: numstat's added-line share ranks references the same as blame's surviving-line share on the Stage 1 sample (74/70, 47/48, 32/33, 27/28, 26/26, 22/23, 21/22, 9/10). Numstat is about 100× cheaper.

## Out of Scope

- **Emitting FRS006 for canonical documents.** It is widened only per role, and only with benchmark support (orchestrator decision 1).
- **Quantities in instruction documents** (issue 629).
- **Ranking and capping FRS002, the empty-validator list, and `agent --task` annotations** (spec 096).
