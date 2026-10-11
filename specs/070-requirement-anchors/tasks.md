# Tasks: Requirement Anchors and Suspect Links

**Spec**: `specs/070-requirement-anchors/spec.md`
**Plan**: `specs/070-requirement-anchors/plan.md`

**Inputs**:
[data-model.md](data-model.md) ·
[contracts/](contracts/) ·
[research.md](research.md) ·
[quickstart.md](quickstart.md)

**Delivery**: each user story lands as its own commits on the integration
branch `feat/requirement-anchors`, in plan.md's story sequence. One draft PR
to `main` runs CI on every push. All stories ship together in one release
(0.45.0), after T079. "PR n" below means story n's commit series.

Each story must also:
- run `npm test`, `docguard guard` and the `budget` job;
- update `CHANGELOG.md`;
- regenerate `llms.txt` and `llms-full.txt` (`npm run llms`) and the findings
  reference (`npm run docs:reference`) when codes or docs change;
- run `docguard specs --write`;
- add a TestGuard claim, probed with `--confirm 3 --serial` and gated;
- name `specs/070-requirement-anchors` in the PR body;
- when new docs or the MCP tool grow agent-facing bytes beyond +10%, declare
  `Budget-Exempt: agent-bytes — <reason>` in the PR body.

**Format**: `- [ ] T### [P?] [US#] description (FRs)`. `[P]` means the task
touches different files from the other open tasks in its phase.

## Phase 1: Setup

- [ ] T001 Create `tests/fixtures/anchors/` with a README describing every fixture project and its expected output files (quickstart.md)
- [ ] T002 [P] Add the `anchors` defaults to `cli/config.mjs`: `anchors.enabled=false`, `failOn` from `ANCHOR_FAIL_DEFAULT`, `orphanPaths=[]`, `import=[]`, `importMap={}`, `treeSitter=null`, `fanOutLimit=10`, `testguardEvidence=".testguard/evidence.json"`. Document each one in `docs/configuration.md` (FR-026, FR-028, FR-031, FR-034, FR-038, FR-009)
- [ ] T003 [P] Reserve ANC001–ANC010 in `cli/findings.mjs`, with titles, help text, validator `requirementAnchors`, and the severity and disposition table from spec FR-020

## Phase 2: Foundational (blocks all stories; ships in PR 1)

- [ ] T004 Write `tests/fingerprint-shared.test.mjs` first. It proves `doclock-v0` output is byte-identical to doc-deps 0.44.x for every dependency in this repository's `.docguard-doc-lock.json` and for a JS/Python/content/glob fixture set (FR-015)
- [ ] T005 Create `cli/scanners/fingerprint.mjs`: algorithm registry (`doclock-v0`, `v1`), `sha256`, the AST metadata strip, the `dg1:` format, and the directive allowlist from contracts/fingerprint.md (FR-010, FR-011, FR-015)
- [ ] T006 Refactor `cli/scanners/doc-deps.mjs` to call `fingerprint.mjs` with `doclock-v0`. Keep `fingerprint()`, `docLockStatus()` and `acceptedEntry()` signatures and outputs unchanged, so T004 passes (FR-015)
- [ ] T007 Create `cli/scanners/py-anchors.mjs`: one `python3` process per run, files on stdin, returning per file:
  - symbol spans (`lineno` to `end_lineno`, decorator start lines);
  - qualnames;
  - docstring ranges;
  - `tokenize` COMMENT tokens;
  - the `doclock-v0` `ast.dump` for requested symbols;
  - the v1 `_fields` serialization (omit `name`, the docstring `Expr`, empty defaults).

  Timeout and failure return `null`, with the reason (FR-007, FR-015, research P4)
- [ ] T008 Switch doc-deps Python fingerprints to the batched `py-anchors.mjs`, removing the per-symbol spawn at doc-deps.mjs:177-198. Add the interpreter-change disambiguation from research P8: re-fingerprint at `reviewedRevision` via `fileContentAtRev`; equal means unverifiable, not DLK001. Add a test in `tests/fingerprint-shared.test.mjs` with a stubbed interpreter-version change (FR-015)
- [ ] T009 Extend doc-deps symbol lookup to nested paths (`Outer.inner.deeper`) for JS and Python, still under `doclock-v0`, without changing existing results (FR-015)

## Phase 3: US1, a tag anchors to the code under it (P1, PR 1) 🎯 MVP

**Goal**: precise anchors, with tier and confidence, warn-only, and no change
for non-adopters.

**Independent test**: the positions fixture gives the expected scope and tier
per tag, the string-literal tag is absent, and SC-002 and SC-008 hold.

### Tests first

- [ ] T010 [P] [US1] `tests/fixtures/anchors/positions/` (JS, TS, Python, Go, Rust, Java): one file per language, with tags in each of these positions:
  - header followed by imports;
  - header directly above a declaration (ambiguous);
  - above a declaration, with and without decorators or annotations;
  - inside a body above a statement;
  - above a route registration;
  - inside a string, template, regex and character literal;
  - with an explicit `{scope=…}`, valid and unresolvable;
  - with two IDs comma-joined.

  Plus `expected.json`, and an unbalanced-brace Go file (FR-001 to FR-005, FR-008)
- [ ] T011 [P] [US1] `tests/requirement-anchors.test.mjs`, the US1 block:
  - scope, tier and qualified path per `expected.json`;
  - the literal tags are absent;
  - ANC006 for ambiguous, unresolved and comma-list tags;
  - ANC007 for an unknown requirement;
  - unbalanced braces fall back to file scope;
  - `guard` without a lock is byte-identical to the base output (fixture snapshot), per SC-002 and FR-026.
- [ ] T012 [P] [US1] `tests/requirement-evidence-literals.test.mjs`: tags inside literals no longer count, and on this repository the evidence count differs from 0.44.2 only by the listed string-literal tags (`cli/commands/explain.mjs:137`), per SC-008, FR-005 and FR-006
- [ ] T013 [P] [US1] `tests/shared-requirements-block.test.mjs`: requirement `text` covers multi-line list items through the next declaration, heading, or list item at the same or shallower indent, and the registry projection is unchanged (FR-014)

### Implementation

- [ ] T014 [US1] Create `cli/scanners/pattern-lexer.mjs`:
  - a self-contained tokenizer, not an extension of `lexCLike`, which cannot represent comment records or raw, verbatim and interpolated strings (`route-lexing.mjs` stays untouched);
  - add `lexRust` (`r#"…"#`, `b""`, `c""`, lifetimes vs. character literals);
  - adapt `lexCSharp`, `lexPhp` and the Sinatra Ruby tokenizer through a common `{code, lits, comments}` shape;
  - symbol finder per family (declaration keywords, class-body depth for methods, `impl` blocks);
  - `matchPairs` self-check;
  - Go semicolon-insertion tokens;
  - floor token stream.

  (FR-007, FR-008, FR-013)
- [ ] T015 [US1] Create `cli/scanners/anchor-tags.mjs`:
  - tag grammar per contracts/tag-grammar.md (one ID per tag, scope block);
  - comment pass per tier: Babel `ast.comments`, `py-anchors` comments and docstrings, `pattern-lexer` comments;
  - the positional rules table, including a top-level variable declaration
    with any initializer → symbol, and any other top-level statement →
    statement under `<module>`;
  - anchors only from `@implements` and `@req` in non-test files;
  - the `file` tier for languages without a lexer;
  - qualified paths with signature or ordinal disambiguation;
  - link keys with `|` and `%` percent-encoded inside parts;
  - statement identity `<enclosing>>stmt:<REQ>#<n>` (research P3);
  - route identity via `expressRouteBindings` and the Python and Go route readers;
  - spans that include decorators and annotations.

  (FR-001 to FR-004, FR-008)
- [ ] T016 [US1] Rewire `cli/scanners/requirement-evidence.mjs` `implementationDeclarations` and `testDeclarations` to the `anchor-tags.mjs` comment pass. For files with no tier, add a string-aware fallback tokenizer for `"`, `'` and backtick (FR-005, FR-006)
- [ ] T017 [US1] Add a `block` field (the full requirement block) to `cli/shared-requirements.mjs` `collectRequirementIdsFromContent`, and keep `text` as the first line. Its consumers are the traceability TF-IDF hint (`cli/validators/traceability.mjs:342`) and preflight overlaps (`cli/scanners/spec-registry.mjs:821-827`), and both stay unchanged. Check that `.docguard-specs.json` regenerates byte-identically (FR-014)
- [ ] T018 [US1] Create `cli/scanners/anchor-cache.mjs`:
  - `.docguard/anchors.cache.json` keyed by sha256 of the working-tree bytes plus the algorithm and tier versions;
  - atomic temp-file-and-rename publish;
  - validate on read;
  - disabled when `CI` is set, with `--no-cache`, or when `git ls-files .docguard` is non-empty (that case reports ANC010).

  (FR-041)
- [ ] T019 [US1] Create `cli/scanners/anchors.mjs` `computeLinks(projectDir, config, {cache})`:
  - pre-filter files by a `@(implements|req|covers)` text scan;
  - parse each file once (Python batched);
  - produce links `{key, requirement, file, anchor, scope, tier, confidence, span, exact, floor, reqFp}`;
  - resolve requirements as `resolveRequirementReferences` does;
  - compute requirement fingerprints.

  (FR-006, FR-007, FR-011, FR-014, FR-041)
- [ ] T020 [US1] Create `cli/validators/requirement-anchors.mjs`:
  - not applicable unless the lock exists or `anchors.enabled` is set (FR-026);
  - ANC006, ANC007 and ANC010 only in this PR;
  - every finding carries `parserTier` and confidence (Constitution IX).

  Register it in `cli/commands/guard.mjs`, including the changed-only list, and in `cli/config.mjs` validators (FR-020, FR-026)
- [ ] T021 [US1] Create `cli/commands/anchors.mjs` listing (`--spec`, `--state`, `--file`, `--format json`, `--no-cache`) per contracts/anchors-cli.md, with `activated` and `summary`. Wire it in `cli/docguard.mjs`: command table, help and flags (FR-021)
- [ ] T022 [P] [US1] Add a read-only `docguard_anchors` MCP tool in `cli/commands/mcp.mjs` (200-link bound) and `extensions/spec-kit-docguard/commands/anchors.md`; keep `extension.yml` valid (Constitution I, VII)
- [ ] T023 [P] [US1] Write golden fixtures `tests/fixtures/anchors/golden/{js,ts,py,go,rust,java}/` with `golden.json` (exact and floor per anchor), plus `tests/requirement-anchors-golden.test.mjs` covering SC-001's five non-semantic edits. This is the initial golden set; US10 completes it (FR-039, SC-001)
- [ ] T024 [US1] Documentation:
  - `docs-canonical/ARCHITECTURE.md` (the fingerprint module, the anchor pipeline, the tiers);
  - `docs-canonical/DATA-MODEL.md` (tag grammar, anchor and link shapes);
  - `docs-canonical/SECURITY.md` (the batched `python3` subprocess and its inputs);
  - `docs-canonical/TEST-SPEC.md` rows;
  - `README.md`, `docs/commands.md`.

  (FR-042)
- [ ] T025 [US1] Verify and close story 1:
  - add a `testguard.claims.json` claim `ANCHOR-SCOPE-RESOLVES-SYMBOLS`;
  - confirm every `.docguard-doc-lock.json` entry is still current, `guard` passes, and the `budget` job passes (SC-003);
  - list the literal-tag evidence differences in `CHANGELOG.md` (FR-026, SC-002);
  - update `CHANGELOG.md` and run `npm run llms` and `npm run docs:reference`;
  - run `docguard specs --write`;
  - commit and push to the draft PR, then merge `main` into the branch.

## Phase 4: US2, a reviewed link turns suspect (P1, PR 2)

**Goal**: the lock, accept, baseline, the state machine, ANC001–ANC005,
ANC008 and ANC009, and this repository's baseline.

**Independent test**: the billing fixture passes SC-001 and SC-004, and every
accept refusal path refuses.

### Tests first

- [ ] T026 [P] [US2] Billing fixture `tests/fixtures/anchors/billing/` (git-initialized in the test via the fixture-git helper from spec 066), with a script of edits: five non-semantic edits, one identifier edit, one requirement edit, one whitespace-only requirement edit, one tag deletion, and one tag citing a retired spec (FR-019)
- [ ] T027 [P] [US2] `tests/requirement-anchors-lock.test.mjs`:
  - header and line rules, any order, identical duplicates collapsing;
  - a differing duplicate gives ANC009 and reads as suspect;
  - a malformed line or unsupported version gives ANC005 with the line number;
  - deterministic re-serialization.

  (FR-016 to FR-018)
- [ ] T028 [P] [US2] `tests/requirement-anchors.test.mjs`, the US2 block, covering every acceptance scenario in spec US2:
  1. suspect on the code side;
  2. suspect on the requirement side, and the whitespace-only edit is silent;
  3. accept;
  4. SC-004 (A→B then C);
  5. `--bulk` required;
  6. reason too short;
  7. no other writer;
  8. union-merge simulation;
  9. lost and `--remove`;
  10. retired target.

  Also:
  - a TOCTOU refusal when a file changes between the fingerprint and the write;
  - `.gitattributes` is untouched without `--gitattributes`;
  - with `--gitattributes`, the line is added exactly once;
  - the listing note appears while the line is missing;
  - `--spec` and `--file` selection excludes lost and retired-target links.

### Implementation

- [ ] T029 [US2] Create `cli/scanners/anchor-lock.mjs`: read, validate, serialize and detect duplicates per contracts/anchor-lock.md. Write `schemas/docguard-anchor-lock.schema.json` with `reason` 10–500 characters, `state` ∈ {reviewed, baselined}, fingerprints matching `^dg1:sha256:[0-9a-f]{64}$`, `revision` as 40/64 hex or null, and `date` as `YYYY-MM-DD` (FR-016 to FR-018)
- [ ] T030 [US2] Add the state machine to `cli/scanners/anchors.mjs`, following the plan's table and the comparison order in contracts/fingerprint.md: exact, then floor, then the stored algorithm version, then unverifiable. Side attribution and retired-target come from the registry lifecycle (FR-011, FR-012, FR-019)
- [ ] T031 [US2] Add ANC001–ANC005, ANC008 and ANC009 to `cli/validators/requirement-anchors.mjs`. Code-side findings carry a `git diff` command when the revision resolves (`revisionResolves`) and otherwise an "open file" hint. ANC004 is emitted only when a lock exists (FR-020)
- [ ] T032 [US2] Implement `anchors accept` in `cli/commands/anchors.mjs`:
  - selection by `--link`, or by `--spec` or `--file`, which exclude lost and retired-target links;
  - `--bulk` when more than one link is selected; reason of 10–500 characters;
  - re-fingerprint and refuse on any byte change;
  - `prev` recorded;
  - one `commitFileTransaction` that writes the lock, with a validate hook that re-reads it;
  - with `--gitattributes`, the same transaction appends the `merge=union` line when absent. Without the flag, `.gitattributes` is never written (Constitution VI). The listing notes the missing line;
  - `--baseline`, which implies `--bulk` and writes `state: baselined`;
  - `--remove <key>`;
  - `--spec <id>` for requirement-side suspects.

  (FR-016, FR-017, FR-022 to FR-024)
- [ ] T033 [US2] Show the baselined share in listing JSON and text. Add the note that DocGuard authenticates no reviewer (FR-023, FR-025)
- [ ] T034 [P] [US2] Add a CODEOWNERS recipe for the lock to `docs-canonical/CI-RECIPES.md`. Document the lock format, states and findings in `docs-canonical/DATA-MODEL.md`. Document the commands in `docs/commands.md` and `README.md` (FR-025, FR-042)
- [ ] T035 [US2] Dogfood:
  - run `node cli/docguard.mjs anchors accept --baseline --bulk --gitattributes --reason "adopt requirement anchors (spec 070)"` on this repository;
  - commit `.docguard-anchor-lock.jsonl` and `.gitattributes`;
  - add `.github/CODEOWNERS` with `.docguard-anchor-lock.jsonl @raccioly`.

  (FR-043)
- [ ] T036 [US2] Verify and close story 2:
  - add the claim `ANCHOR-SUSPECT-ON-CHANGE`;
  - pass the budget (SC-003);
  - update `CHANGELOG.md`, run `npm run llms` and `npm run docs:reference`, run `specs --write`;
  - commit and push to the draft PR, then merge `main` into the branch.

## Phase 5: US3, fail only where the signal is proven (P1, PR 3)

**Goal**: replay evidence, `failOn`, and the SPC007 exemption.

**Independent test**: the replay evidence is committed, the fixture exit codes
follow the policy, and completion is not deadlocked.

### Tests first

- [ ] T037 [P] [US3] `tests/requirement-anchors-policy.test.mjs`:
  - with `failOn: reviewed-exact`, a reviewed symbol-scope exact-tier suspect exits 1;
  - the same change on baselined, file-scope and pattern-tier links exits 2;
  - ANC002 never errors;
  - `ANCHOR_FAIL_DEFAULT` matches the committed evidence (drift test).

  (FR-028)
- [ ] T038 [P] [US3] `tests/requirement-anchors-complete.test.mjs`: `specs complete --id X` succeeds while X's own links are suspect, and lists them with accept commands. Another spec's anchor errors still block SPC007 (FR-029, SC-006)

### Implementation

- [ ] T039 [US3] Create `tools/anchor-churn-replay.mjs`:
  - walk first-parent history, reading blobs via `git show` with no checkout;
  - baseline in memory at the start revision;
  - compute states per commit;
  - classify each flag with the `git diff -w` span rule (research P6);
  - write `specs/070-requirement-anchors/evidence/churn-replay.json` and regenerate the `ANCHOR_FAIL_DEFAULT` constant in `cli/scanners/anchors.mjs`.

  (FR-027)
- [ ] T040 [US3] Run the replay over at least the last 100 first-parent commits of this repository and commit the evidence. Record the outcome and the resulting default in `spec.md` under a "Measured outcome" note in the Assumptions section (FR-027, FR-028, SC-005)
- [ ] T041 [US3] Implement `failOn` in `cli/validators/requirement-anchors.mjs`. Severity becomes error only under FR-028's conditions (FR-028)
- [ ] T042 [US3] Add the SPC007 exemption in `cli/commands/specs.mjs` `planSpecCompletion`: drop the completing spec's own ANC findings from the error count and print them (FR-029)
- [ ] T043 [US3] Document the policy, the replay and its evidence in `docs-canonical/CI-RECIPES.md` and `docs/configuration.md`. Close story 3 with the claim `ANCHOR-FAIL-POLICY-SCOPED`, `CHANGELOG.md` and `specs --write`

## Phase 6: US4, moving or renaming keeps the review (P2, PR 4)

- [ ] T044 [P] [US4] Rename fixture `tests/fixtures/anchors/rename/` and `tests/requirement-anchors-rename.test.mjs`:
  - rename plus move with an unchanged body gives moved, 0 suspect and 0 lost;
  - duplicate identical bodies give lost;
  - the only implementation deleted gives exactly 1 lost.

  (FR-030, SC-009)
- [ ] T045 [US4] Add carry-over to `cli/scanners/anchors.mjs`. A reviewed entry with no resolving anchor becomes moved only when exactly one unreviewed link has the same requirement and the same v1 exact fingerprint. The lock is never written; the next accept rewrites the key. Add the info note to the validator (FR-030)
- [ ] T046 [US4] Docs (`docs-canonical/DATA-MODEL.md` transitions). Close story 4 with the claim `ANCHOR-MOVE-CARRIES-REVIEW`, `CHANGELOG.md` and `specs --write`

## Phase 7: US5, see what else a change may affect (P2, PR 5)

- [ ] T047 [P] [US5] `tests/impact-walk-relocation.test.mjs` pins today's `diff --since` indirect output on a fixture before the move (FR-031)
- [ ] T048 [P] [US5] Ripple fixture `tests/fixtures/anchors/ripple/` (`a.mjs` exports `f` and `g`, `b.mjs` imports `f`, `c.mjs` imports `g`, a hub importer) and `tests/requirement-anchors-ripple.test.mjs` (FR-031)
- [ ] T049 [US5] Move `reverseImportAncestors` and the hub rule from `cli/commands/impact.mjs` to `cli/scanners/import-graph.mjs`, have `impact.mjs` import them, and keep T047 passing (Constitution IV)
- [ ] T050 [US5] Record imported names per edge in `cli/scanners/import-graph.mjs` (named, default, namespace plus `ns.<name>` usage) without changing existing graph consumers (FR-031)
- [ ] T051 [US5] Add ripple to `cli/scanners/anchors.mjs` and the listing:
  - depth 2;
  - name-filtered;
  - fan-out above `anchors.fanOutLimit` collapses into one summary;
  - info only;
  - "unavailable" for languages without a graph.

  (FR-031)
- [ ] T052 [US5] Docs. Close story 5 with the claim `ANCHOR-RIPPLE-NAME-FILTERED`, `CHANGELOG.md` and `specs --write`

## Phase 8: US6, tests linked to a changed requirement (P3, PR 6)

**Depends on** the TestGuard companion spec merging in `raccioly/testguard`
(structured `source.ref`).

- [ ] T053 [US6] In `raccioly/testguard`, run the Spec Kit pipeline for the companion spec: the claim `source.ref` for `kind: "spec"` accepts and validates `<specId>#<REQ>`, documented in the claims schema and the conformance tests, then open its own PR (cross-repo dependency)
- [ ] T054 [P] [US6] TestGuard fixture `tests/fixtures/anchors/testchain/` with three evidence variants (matching, stale fingerprint, unstructured) and `tests/requirement-anchors-testchain.test.mjs` per contracts/testguard-evidence.md (FR-032, FR-033)
- [ ] T055 [US6] Add the adapter `testguard-evidence` to `cli/evidence/adapters.mjs`:
  - safePath rules;
  - input-hash staleness;
  - `head` resolution;
  - structured-reference matching;
  - all four conditions;
  - never executes anything.

  (FR-033)
- [ ] T056 [US6] Add the test-chain view to `cli/scanners/anchors.mjs` and the listing's `tests[]` (FR-032)
- [ ] T057 [US6] Docs. Close story 6 with the claim `ANCHOR-TESTCHAIN-NEEDS-REVERIFY`, `CHANGELOG.md` and `specs --write`

## Phase 9: US7, inventory of code without a requirement (P3, PR 7)

- [ ] T058 [P] [US7] Orphan fixture `tests/fixtures/anchors/orphans/` and `tests/requirement-anchors-orphans.test.mjs`:
  - three exported functions, one of them tagged, so 2 orphans;
  - one disposition, so 1 left;
  - `score --format json` granularity.

  (FR-034 to FR-036)
- [ ] T059 [US7] Implement `anchors --orphans` in `cli/scanners/anchors.mjs` and `cli/commands/anchors.mjs`. Candidates come from `moduleSymbols`, `py-anchors` and the pattern symbol finder, under current specs' `scope.sourcePaths` or `anchors.orphanPaths`, in deterministic order (FR-034)
- [ ] T060 [US7] Implement `anchors disposition` with a lock entry `disposition|<file>|<anchor>`, `kind` ∈ {derived, dead, infrastructure} and a reason of 10–500 characters, through `commitFileTransaction` (FR-035)
- [ ] T061 [US7] Show anchor granularity (by scope and tier) as info in `cli/commands/score.mjs` and `cli/commands/trace.mjs` (FR-036)
- [ ] T062 [US7] Docs. Close story 7 with the claim `ANCHOR-ORPHANS-DETERMINISTIC`, `CHANGELOG.md` and `specs --write`

## Phase 10: US8, export the trace matrix (P3, PR 8)

- [ ] T063 [P] [US8] Matrix fixture and `tests/trace-matrix.test.mjs`:
  - CSV header exactly as in contracts/trace-matrix.md;
  - 5 rows;
  - formula-injection prefix;
  - ReqIF well-formed, with each requirement and link exactly once;
  - byte-identical across two runs.

  (FR-037, SC-010)
- [ ] T064 [US8] Create `cli/writers/trace-matrix.mjs` with the CSV (RFC 4180) and ReqIF 1.2 serializers. Build the XML by string assembly, escape it, and use ids `_` + the first 16 hex digits of sha1 of the key (FR-037, research P9)
- [ ] T065 [US8] Add `trace --matrix --format csv|reqif [--output]` to `cli/commands/trace.mjs` and `cli/docguard.mjs`. Write through `safeWrite` (FR-037)
- [ ] T066 [US8] Docs. Close story 8 with the claim `TRACE-MATRIX-COMPLETE`, `CHANGELOG.md` and `specs --write`

## Phase 11: US9, StrictDoc and OpenFastTrace importers (P3, PR 9)

- [ ] T067 [P] [US9] Importer fixture and `tests/requirement-anchors-import.test.mjs`:
  - ignored when not configured;
  - 2 mapped anchors;
  - an unmapped ID gives ANC007;
  - mixed native and foreign tags give ANC006;
  - an OFT revision mismatch gives ANC001 with `cause: "oft-outdated"`.

  (FR-038)
- [ ] T068 [US9] Add the StrictDoc and OFT recognizers and the `anchors.importMap` resolution to `cli/scanners/anchor-tags.mjs`, read-only (FR-038)
- [ ] T069 [US9] Docs (`docs/configuration.md` import mapping). Close story 9 with the claim `ANCHOR-IMPORTERS-READ-ONLY`, `CHANGELOG.md` and `specs --write`

## Phase 12: US10, provably deterministic fingerprints (P3, PR 10)

- [ ] T070 [P] [US10] Complete the golden set for Kotlin, C#, PHP, Ruby, Swift, C and C++. Add python-ast golden values per CI interpreter minor version, and make the test skip, with a message, any key the local interpreter lacks (FR-039)
- [ ] T071 [P] [US10] Create `tools/anchor-oracle/{package.json,package-lock.json,run.mjs,VETTING.md}`:
  - first, check every candidate package (`web-tree-sitter` and each grammar) against Constitution II: `npm view <pkg> --json` for the official registry, maintainers and first-publish date, and api.npmjs.org weekly downloads for more than 10k. Record the evidence in `VETTING.md`, and drop any grammar that fails, so its language is "no oracle";
  - exact pinned versions;
  - a lockfile with integrity hashes;
  - span comparison against `pattern-lexer`;
  - a per-language agreement report.

  (FR-040, Constitution II)
- [ ] T072 [US10] Add an `anchor-oracle` job to `.github/workflows/ci.yml` with `permissions: contents: read`. It runs `npm ci --ignore-scripts` in `tools/anchor-oracle`, uses SHA-pinned actions, and fails only when disagreement exceeds 1% for a high-confidence language. C and C++ are reported, never failed (FR-040, SC-007)
- [ ] T073 [US10] Add the user-side tree-sitter tier:
  - `schemas/docguard-anchor-treesitter.manifest.json` with the pinned sha256 of each runtime and grammar file;
  - in `cli/scanners/anchor-tags.mjs`, read the config `anchors.treeSitter.artifacts`, verify the hashes, copy the bytes to `.docguard/ts/<hash>/` and import that copy;
  - never use project module resolution;
  - a mismatch gives ANC010 and falls back.

  (FR-009, research P7)
- [ ] T074 [US10] Add a test `tests/requirement-anchors-treesitter.test.mjs`. The tier is unavailable with a wrong hash and with a missing file, and is never auto-detected. Use a fake artifact, with no network (FR-009)
- [ ] T075 [US10] Docs (`docs-canonical/SECURITY.md` tree-sitter loading, `docs-canonical/TEST-SPEC.md`). Close story 10 with the claim `ANCHOR-FINGERPRINT-GOLDEN`, `CHANGELOG.md` and `specs --write`

## Phase 13: Polish and completion

- [ ] T076 Move every tag in this repository that sits inside a function body or above an unrelated statement (the 15 statement-level tags plus the before-import blocks) to an explicit `{scope=…}`. Accept the moved links with a reason (FR-043)
- [ ] T077 Run `docguard reconcile --since <base> --format json` and `docguard specs complete --id docguard.requirement-anchors --write --reason "…"` once all PRs have merged
- [ ] T078 Run `/speckit-analyze` for cross-artifact consistency before PR 1 opens, and again before T077
- [ ] T079 Before any release that contains spec 070, complete every item of the release gate in `checklists/remediation.md`, and record its results for the exact commit being released. These include the A/B runs against the base release on this repository and on the Guard-family repositories. Keep the finding table there current as each PR merges (C1–C2, H1–H2, M1–M5, L1–L5)

## Dependencies and order

- Setup T001–T003, then Foundational T004–T009, then US1.
- US1 → US2 → US3. These form the MVP chain; each needs the previous.
- US4 and US5 depend on US2. They can run in parallel.
- US6 depends on US2 and the TestGuard companion (T053).
- US7 depends on US1 and US2 (dispositions are lock entries).
- US8 depends on US2, and on US6 for test columns. Without US6 the test
  columns are empty.
- US9 depends on US1.
- US10 depends on US1. The golden set grows with every story.

## Parallel examples

- **PR 1**: T010, T011, T012 and T013 (fixtures and tests) in parallel. Then
  T014 and T018, and the foundational T007, in parallel.
- **PR 2**: T026, T027 and T028 in parallel. T034 (docs) runs alongside
  T029–T033.
- **After PR 2**: start US4 and US5 together, and the TestGuard companion
  (T053) as early as PR 1.

## Implementation strategy

- **MVP**: PRs 1–3 (US1–US3). After them, anchors are precise, reviewed state
  is durable, suspects are visible, and failure is evidence-gated.
- **Each later PR** is independently releasable and opt-in. Projects without a
  lock see no change at any point.
