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

This is not a finding. Under spec 097 it is Freshness applying and examining nothing: an `empty` result with cause `needs-declaration`. Decided by the DocGuard coordinating session on 2026-11-12; it replaces the FRS008 code of an earlier draft.

**Acceptance Scenarios**:

1. **Given** a committed `GEMINI.md` with no marker and no recorded review, **Then** `agentInstructionDocsWithoutReviewPoint()` lists it with the exact command, `docguard review --accept GEMINI.md --reason "<what you checked>"`, and guard emits no finding for it.
2. **Given** a root `AGENTS.md` committed 2 days ago with no marker, **Then** it is still listed. A commit is not a review.

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
  - files under test, fixture and example paths (`isNonProductPath`): naming a test file says where tests go, and its growth is expected (found by the FR-012 replay);
  - other documents (`.md`, `.mdx`, `.rst`, `.adoc`, `.txt`), which are reviewed on their own (found by the FR-012 replay);
  - DocGuard's own state files (`.docguard*`) and claims/evidence JSON (`*.claims.json`, `*evidence*.json`);
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
- **FR-009**: Two parts:
  - `agentInstructionDocsWithoutReviewPoint(dir, config)` (`cli/scanners/recorded-review-signals.mjs`) MUST return every committed, authored, non-pointer agent-instruction document with no marker and no recorded review, each with a `howToConfigure` text naming the `review --accept` command. Spec 097's Freshness applicability calls it to report `empty` with cause `needs-declaration`. Uncommitted files stay FRS001's.
  - New code **FRS009**, a warning: a document whose marker date is later than its recorded review's `reviewedAt`, set by a commit that changed no other line of the document. It names that commit. FRS006 keeps measuring from the recorded review.
- **FR-010** (*open item, decided by spec 097*): `findingSeverity` MUST accept a role-scoped value, `{ "FRS006": { "agent-instruction": "high" } }`. The level applies to findings whose document is in that role; other findings of the code keep the default. This is the only new configuration shape. The JSON schema and DATA-MODEL document it.
- **FR-011**: When any agent-instruction document has FRS006 or FRS007, guard's human output MUST print one line before the validator list, whatever the severity, on the default output and with `--quiet`, and JSON MUST carry `staleInstructions: [{ doc, codes }]`.
- **FR-014**: New code **FRS010**, Freshness, severity `error`: the reviews file cannot be read (not JSON, an unsupported `schemaVersion`, or an unknown field outside `extensions`). It never reads as "no reviews". The reviews file's compatibility rule is part of its schema: a future field goes under `extensions` (top level, per document or per reference), which readers ignore.
- **FR-012**: A history-replay benchmark (`benchmarks/history-replay/`) MUST measure FRS006 and FRS007 precision.
  - **Method**: walk review points (marker commits) in the public repositories DocGuard and TestGuard, and in pinned public repositories with agent-instruction files. Evaluate at review + 2, 4 and 8 weeks.
  - **Labels**: a hit is labeled true when the referencing line, or a sentence naming that file or surface, was rewritten in the document within the next 8 weeks. Otherwise it is labeled false, unless a human label overrides it.
  - **Output**: precision with its Wilson interval per role and threshold, committed as the precision evidence for FRS006 and FRS007.
  - **Private projects**: results from local private projects are reported to the maintainer only, never committed.
- **FR-013**: `cli/findings.mjs` (FRS006 to FRS009), `docs/reference/findings.md`, DATA-MODEL (the reviews file and the `findingSeverity` form), ARCHITECTURE, the `review` command help and `CHANGELOG.md` MUST describe the change.

**Open item.** Default levels and exit behavior for FRS006, FRS007, FRS009 and FRS010 are decided by spec 097 (strict by default). There, a code gates by default only with at least 30 labeled findings and a 95% Wilson lower bound of 0.85. Until then they are warnings, and FR-010's per-project form may be superseded.

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

## Verification Notes

Verified 2026-11-12 on the branch head. Private projects are not named.

- **SC-001**: `tests/recorded-document-reviews.test.mjs` (16 cases) and `tests/history-replay.test.mjs` (3) pass. They fail on the base, where the modules do not exist and the codes are unknown.
- **SC-002, TestGuard at f89ca46** (`node cli/docguard.mjs guard` in a clone):
  1. **Legacy marker 2026-09-22:**
     - `⚠ Agents are being served stale instructions: AGENTS.md (FRS006, FRS007)`
     - `[FRS006] AGENTS.md names 1 file(s) most of whose lines were added since its 2026-09-22 review: L35 src/probe/probe.mjs 74% (+1066/−190)`
     - `[FRS007] AGENTS.md never mentions package script(s) \`corpus\` or top-level directory \`corpus/\`, added since its 2026-09-22 review`
  2. **After `review --accept AGENTS.md` at f89ca46**, committed: no FRS006 and no FRS007. Recorded: 15 referenced files fingerprinted, 9 excluded.
  3. **Then a commit that adds 401 lines to `src/probe/rank.mjs`:** `[FRS006] AGENTS.md names 1 file(s) … since its 2026-11-12 review (recorded; fingerprint changed): L34 src/probe/rank.mjs 63% (+401/−0)`. That file only.
  4. **Before the FR-004 exclusions were extended**, step 1 also named `src/init/templates/SKILL.md` (57%). It is a document, now excluded.
- **SC-003, history replay** (`benchmarks/history-replay/run.mjs`): 519 review points in 16 repositories, 2 public and 14 private. Labels are a proxy: a hit is true when the document later rewrote the line naming the file. The proxy undercounts, because the failure #628 describes is a stale line that nobody fixes.
  - **Agent-instruction role:** too few labeled hits to measure. Before the exclusion fix there were 2 labeled hits at ≥0.5, both false: a test file named as "where tests go", and another document. Both are now excluded. After the fix, no labeled agent-instruction hit remains at ≥0.5. TestGuard's `probe.mjs` hit is in the data but unlabeled, because its 8-week window is still open.
  - **Canonical role, at 0.5:** proxy precision 2/11 at +14 days (Wilson 0.05–0.48) and 1/5 at +56 days (0.04–0.62). That is evidence against widening FRS006 to canonical documents.
  - **FRS007:** 1/3 true at +28 and +56 days.
  - **Committed results:** `benchmarks/history-replay/results-public.json` holds the public repositories only.
- **SC-004, A/B** of main against the branch, 28 local projects, guard JSON, serial:
  - **Exit codes:** none changed.
  - **FRS006:** 2 findings, TestGuard and its pinned copy; both true.
  - **FRS007:** 5 findings in 4 projects. True: TestGuard's `corpus`. Lean true: one project's nine new scripts. Unclear: DocGuard's own `fuzz` dev script, reported in AGENTS.md and CLAUDE.md.
  - **FRS008:** 60 findings in 22 projects. Root AGENTS.md 18, CLAUDE.md 6, GEMINI.md 1, authored skills 18, rules 10 (7 of them OpenWolf's generated rule), nested instruction files 6, Copilot instructions 1.
  - **FRS009, FRS010, PSR005:** 0.
- **Follow-up from the A/B and self-guard:** DocGuard's own CLAUDE.md said "Follow `AGENTS.md`" but drew its own FRS007. A file that names another instruction file now inherits that file's mentions (FR-008). DocGuard's AGENTS.md now mentions `npm run fuzz`.
- **Budget:** `npm run budget` passed guard time (66,455 → 65,395 ms on DocGuard, machine under load), self errors (0) and package size. It failed `bytes:mcp:docguard_read_section` (+391 bytes, the DATA-MODEL `finding-channels` section). The section was shortened: +129 bytes, measured directly through MCP.
- **Suite:** 4,398 tests, 4,396 pass, 1 skipped. The one failure was the fuzz test's 5-second wall-clock limit at load average about 100. Run alone, it took 1.3 s and 1.4 s on this branch against 1.5 s and 1.9 s on main.

### Update 2026-11-12, after spec 094 merged and spec 097 took over defaults

- **FRS008 removed.** "No review record" is reported by spec 097 as Freshness `empty` with cause `needs-declaration`, through `agentInstructionDocsWithoutReviewPoint()`. The 60 FRS008 warnings in 22 projects measured above no longer ship as findings.
- **PSR005** names line endings when CRLF is the only difference: a Windows checkout with `core.autocrlf` (coordinator review of #633).
- **Replay labels.** `labels-public.json` adds reviewed labels for the public hits. These are overrides set by the implementing session; a maintainer should confirm them.
  - Agent-instruction role at 0.5: FRS006 n = 1 (1 true).
  - FRS007 at +56 days: n = 5 (3 true).
- **Path to 30.** Spec 097 gates a code with at least 30 labeled findings and a Wilson lower bound of 0.85.
  - The 16 repositories hold about 47 marker review points on agent-instruction files, and they produced 1 FRS006 hit at ≥0.5. That is a hit rate near 2%.
  - At that rate, 30 labeled FRS006 hits need about 1,400 agent-instruction review points with an observed 8-week window.
  - This history does not exist yet. It needs either recorded reviews accumulating in adopters, or a wider replay source (for example, public repositories with long `AGENTS.md` histories, taking each content edit as a review point). The second is a change of method that needs the coordinating session's decision.
- **Gates on the merged branch:** `npm test` exit 0 (4,401 tests, 4,400 pass, 1 skipped). `npm run budget -- --base <origin/main worktree>` exit 0 (guard on DocGuard 30,909 → 27,066 ms, no new errors). The fuzz test alone took 538 ms.

### Update 2026-11-12, for spec 097 Stage B

- **`agentInstructionReviewStatus(dir, config)`** returns, for each reviewed agent-instruction document, `{ path, suspect, reviewPoint: { date, revision, source }, threshold, references, complete }`. A review is suspect by the FRS006 rule. FRS006 is built on the same `statusFor` evaluation, so the two cannot disagree; a test asserts they report the same references and revision. Stage B uses it to treat a suspect review as no longer covering its document.
- **Replay labels** gained an unconfirmed form, `{ label, confirmed: false, by }`. Unconfirmed overrides are counted in `summary[].unconfirmed`, never in `n` or precision; a plain boolean still means a confirmed label. Every label in `labels-public.json` is unconfirmed.
- **The path to 30 does not go through history.** Spec 097 Stage B gates on the suspect review, a re-review request, not on FRS006's precision (coordinating session's decision). The labeled set is not being widened.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `d531756de886c5f89d64125a22a8fb07bb9aafe9` — Verified recorded reviews, FRS006/FRS007/FRS010, the reviews file schema and the recorded TestGuard reproduction, replay and A/B against the shipped ARCHITECTURE and DATA-MODEL text (spec 095). Evidence: `cli/commands/review.mjs`, `cli/scanners/doc-reviews.mjs`, `cli/scanners/recorded-review-signals.mjs`, `cli/scanners/reference-staleness.mjs`, `cli/validators/freshness.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `tests/history-replay.test.mjs`, `tests/program-verification.test.mjs`, `tests/recorded-document-reviews.test.mjs`, `tests/review-accept-many.test.mjs`. Accepted deviations: none. Successor: none. Blobs: `cli/commands/review.mjs`=`e3155e6d915bd44f964bc63ece9488dc2e35a249`, `cli/scanners/doc-reviews.mjs`=`1b28cce90ee2c683ba8896f90786ac4c7ef9c9a9`, `cli/scanners/recorded-review-signals.mjs`=`ff4879b5b5e814b3ed06b52cd51fadca21928105`, `cli/scanners/reference-staleness.mjs`=`5193cc94c7fe0f3ca88acd3323adc47f966796ee`, `cli/validators/freshness.mjs`=`37c768ce699c12ff61bc799a3c136bff35f9e727`, `docs-canonical/ARCHITECTURE.md`=`f3860b5d2c0de06da36eec0695c5b127039d52b4`, `docs-canonical/DATA-MODEL.md`=`536919770b97c233d68a92494ee154b4dafedfe2`, `tests/history-replay.test.mjs`=`0fa9ae262edaa44ed7db163e4b05990573a3a411`, `tests/program-verification.test.mjs`=`9d469f964d8b5646bce82e396b052e5dc53ad369`, `tests/recorded-document-reviews.test.mjs`=`e30cb1fb7beed1c7ff6e62bd99a2867a806083e0`, `tests/review-accept-many.test.mjs`=`c520802bf67ccb27ae3f096d0bd23326db9e5db5`.
<!-- docguard:implementation-outcomes:end -->
