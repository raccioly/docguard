# Tasks: Every Check Ends in a Verdict, and an Observation It Could Not Make Is Never a Pass or a Finding

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Tests come first. Every reproduction must fail on 0.45.2 before its fix lands (SC-001).

## Phase 1 — Failing tests first

- [x] T001 [US1] `tests/verdict-contract.test.mjs`: a `stubGit(mode)` helper writes a `git` script into a temp directory. The script fails the named subcommands (`check-ignore`, `ls-files`, or the first call only) and execs the absolute path of the real git for everything else. CLI runs are spawned with that directory first on `PATH`.
- [x] T002 [US1] Same file: the PSR002 reproduction. The fixture has an instruction file pointing at an ignored path and at a missing path. With a failing `check-ignore` it expects 0 PSR002, verdict `inconclusive`, applicability `partial`, and one gap naming `git check-ignore` with a count of 2. A working-git control expects exactly the missing-path PSR002 (FR-006).
- [x] T003 [US1] Same file: `ls-files` failing. Path-Scoped-Rules is `partial` with a gap and still checks every instruction file. `docsForPath` falls back to the working tree (FR-007).
- [x] T003a [US1] Same file: `git grep` failing. A doc naming a removed symbol yields no REF001, and Reference-Existence is `inconclusive` with a gap; the working-git control reports the REF001 (FR-006).
- [x] T004 [US1] Same file: `runGit` with an injected spawn that fails once with `EAGAIN` then succeeds records no gap; one that fails twice records one; `ENOBUFS` is not retried (FR-009).
- [x] T005 [US2] Same file: a six-verdict fixture. A clean structure gives `pass`; a broken doc gives `fail`; Drift with no `// DRIFT:` comments gives `empty`; API-Surface with no API reference gives `inconclusive`; a validator that throws gives `blocked` (proved in-process through `runGuardInternal` with a stubbed validator module, and at writer level with a synthetic result); a declared-N/A marker gives `skipped`. Assert `verdict` and `applicability.class` for each (FR-001 to FR-003, FR-010).
- [x] T006 [US3] Same file: `--fail-on-inconclusive` exits 4 on the fixture (exit 2 is mapped to success by the GitHub Action, so the gate needs its own code) and names the inconclusive validators. The same run without the flag keeps 0.45.2's exit code. A fixture whose only non-pass verdicts are `empty` and `skipped` exits 0 with the flag (FR-011).
- [x] T007 [US4] Same file: the six-verdict fixture in `--format json`, compact JSON (`guard --compact --format json`), `--format sarif`, `--format junit` and human output. Each verdict is asserted in each format, 30 assertions in all (FR-012 to FR-015, SC-002).
- [x] T008 Same file: `GIT_CALL_SITES` inventory test. Scan `cli/validators/**` and `cli/scanners/**` for calls to the `shared-git.mjs` helpers that can return no answer, and require the inventory to match exactly (FR-008, SC-003).
- [x] T009 Same file: a crashing validator leaves the observation stack empty after the run (plan Risks).
- [x] T009a [US1] Same file: with a baseline that freezes a PSR002 and a failing `check-ignore`, the run carries `baselineStaleUncertain` and `--update-baseline` refuses to write (spec Edge Cases, baseline).
- [x] T010 Run the new file on 0.45.2 code and record which cases fail. T002, T003 and T005 to T008 must fail there; every working-git control must pass.

## Phase 2 — Implementation

- [x] T011 [US1] `cli/observations.mjs`: `openObservations`, `recordGap`, `closeObservations`, and a stack of lists.
- [x] T012 [US1] `cli/shared-git.mjs`: the `runGit` wrapper (retry on transient codes; gap on spawn error, timeout or signal; documented-status checks for `check-ignore` and `ls-files`; per-directory cached readability). Route every helper through it without changing any return value.
- [x] T013 [US1] `cli/validators/path-scoped-rules.mjs`: withhold unresolved pointers when `gitIgnoredPaths` returns `null` and add the counted limitation. `cli/shared-git.mjs` `symbolExistsAtRev` returns `null` for no answer; `cli/validators/reference-existence.mjs` withholds and counts unknown presence.
- [x] T014 [US1] `cli/scanners/doc-references.mjs`: working-tree fallback for a `null` tracked list. Audit the `doc-deps`, `doc-ownership` and `anchors` consumers and record each one's handling in `GIT_CALL_SITES`.
- [x] T015 [US2] `cli/validator-coverage.mjs`: `APPLICABILITY_CLASS`, `deriveVerdict`, `summarizeVerdicts`; gaps turn `checked`/`no-matches` into `partial`; `class` added to every applicability.
- [x] T016 [US2] `cli/commands/guard.mjs`: `try`/`finally` observation brackets around every validator, including the two post-loop ones; `result.observations`; `result.verdict` after baseline and coverage; `verdicts` on the returned data.
- [x] T016a [US1] `cli/commands/guard.mjs`: `baselineStaleUncertain` while gaps stand, the stale line not offering a re-freeze, and `--update-baseline` refusing a run with gaps.
- [x] T017 [US3] `cli/docguard.mjs` flag parsing and help; `exitFor` in guard; `cli/commands/ci.mjs`; `action.yml` input `fail-on-inconclusive` and its help.
- [x] T018 [US4] `cli/shared-guard-json.mjs` compact projection; `cli/writers/sarif.mjs` invocation notifications; `cli/writers/junit.mjs` verdict branches; the verdict summary line and reasons in guard's human output.

## Phase 3 — Docs and generated files (FR-017)

- [x] T019 `docs-canonical/DATA-MODEL.md` (validator result: `verdict`, `applicability.class`, `observations`; run: `verdicts`), `ARCHITECTURE.md` (Observation ledger row), `TEST-SPEC.md` (verdict-contract rows), each citing spec 081.
- [x] T020 `docs/reference/` regenerated (`npm run docs:reference`) plus the CLI and output-format pages; `extensions/spec-kit-docguard/commands/guard.md`; `CHANGELOG.md` `[Unreleased]` Added and Fixed entries; `npm run llms`.
- [x] T021 SC-006: run `guard --fail-on-inconclusive` on this repository. Resolve each inconclusive validator with a true, reasoned N/A declaration or a fixed input.
- [x] T022 `docguard specs --write`; rebuild the anchor lock from main and accept each touched anchored file (`anchors accept --file … --bulk`).

## Phase 4 — Proof

- [x] T023 `npm test`, `guard`, `npm run budget`.
- [x] T024 SC-004: hermetic A/B, 0.45.2 against the branch head, on this repository and every local project; one fresh `git archive` copy per CLI, run serially. Record the counts in Verification Notes.
- [x] T025 SC-005: fault-injection run with the stub git on the same copies. Record any finding added (expect none) and any affected validator left at `pass` (expect none).

## Verification record (2026-11-03)

- **T010**: on v0.45.2, 21 of the 24 tests fail. The working-git PSR002 control also fails there, because it asserts the new `verdict` and applicability fields. The control's finding count matches on both releases.
- **T021**: `guard --fail-on-inconclusive` on this repository exits 2, guard's warning code, not 4, so no validator is inconclusive.
- **T024, T025**: the hermetic A/B and the fault-injection run were recorded in the session that built the spec. The final branch A/B against v0.45.2 is in spec 082's Verification Notes.

