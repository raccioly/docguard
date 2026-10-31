# Implementation Plan: Counts, Untouched Claims, Diff Overlap and Router Auth Say Only What They Can Prove

**Branch**: `claude/regular-issue-pr-review-4c9b53` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002 | `cli/validators/metrics-consistency.mjs`: one `COUNT_START` lookbehind, `(?<![\w,.#/-])`, starts every count pattern (checks, validators, tests, declared collections), and each pattern takes `\d{1,3}(?:,\d{3})+` before `\d{2,}`. MET001 and MET002 quote `occurrences.text`. `cli/writers/mechanical.mjs` `applyReplaceCount` matches `String(found)` or `found.toLocaleString('en-US')` behind the same lookbehind and writes `actual` in the matched spelling. |
| FR-003 | Same validator: `NOT_A_CASE_COUNT`, a negative lookahead after `tests?\b` for the dimension nouns of FR-003. |
| FR-004 | `cli/scanners/speckit.mjs`: a new exported `unobservablePaths(projectDir, paths)`. It uses `gitIgnoredPaths` from `cli/shared-git.mjs` (the PSR002 helper), then `git ls-files -z -- :(literal)…` on the ignored candidates; a candidate with no tracked entry (itself, or below it for a directory) is unobservable. `detectUntouchedClaims` drops those paths and drops a task left with none. A `null` answer skips the feature. |
| FR-005 | `cli/validators/diff-suspicion.mjs`: `referenceKind` also returns every referencing line. New `headingLevels(lines)` (fence-aware) and `referenceContext(doc, refLines)` build the token set that `tokenOverlap` reads, replacing the whole-document tokens. |
| FR-006 | `cli/scanners/router-routes.mjs`, the non-mount `use()` branch: `unreadScope = !hasPath && args.length >= 2 && unreadablePath(args[0])`. With auth middleware in `args.slice(1)`, record `router-unresolved-path` instead of pushing a `'*'` use. |
| FR-008 | `cli/findings.mjs` help for MET001, MET003, SPK010 and DSP001; `npm run docs:reference`; `docs/reference/languages.md` (Koa row); `CHANGELOG.md` `[Unreleased]`. |
| SC-004 | `tests/anchor-cache.test.mjs` (from #599) passes `env: {}` where it needs the cache on and builds fixtures with `fixtureGit`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/consumer-report-precision.test.mjs` holds the reproductions and controls for FR-001 to FR-005 and FR-007. `tests/router-routes-unresolved.test.mjs` (from #595, rewritten) holds FR-006. `tests/anchor-cache.test.mjs` (from #599) holds SC-004. Existing metrics, SPK010, diff-suspicion and route suites run unchanged.
**Constraints**: no new dependency. Findings may only disappear, except FR-006, which moves an auth mark into `scan.unresolved`.

## Research decisions

- **What exists.** The tests pattern already had `(?<![\d,])` and the separator alternation (`docguard.dogfood-findings`). FR-001 and FR-002 generalize it into one lookbehind for every count instead of adding a second rule. `gitIgnoredPaths` already batches `check-ignore` and reports unknown statuses separately.
- **Why `--no-index` plus `ls-files`.** `check-ignore --no-index` answers for tracked files too, and a tracked file is observable whatever the ignore rules say. Asking `ls-files` only about the ignored candidates keeps the extra spawn to the rare case.
- **Why sections, not a line window.** The report asks for overlap "in the relevant section/reference context". A fixed window would split a paragraph or reach into the next section. Headings are the document's own boundaries. A table row is a record, so a reference made in a row reads only that row. The reporting project's TEST-SPEC is one 1,160-line `# TEST SPEC` section of bold-label paragraphs around the inventory, so section scope alone would not isolate the row; the first A/B pass showed that. For a prose reference, rows that name another file are dropped and field tables stay. Dropping every row hid a DATA-MODEL field table under the file's own section, which the A/B also caught.
- **Why no auth mark under an unreadable path.** Spec 064 FR-005 forbids guessing a path. Treating the call as path-less is a guess that the path is `/`, and it errs toward claiming protection. Recording the scope and marking nothing is the only statement the reader can prove.
- **Rejected:** a DSP001 stopword list (#598 rejects it); a file-count metric for #596 (not asked for, and it needs a dated-checkpoint scope rule); taking Jules #595 as written. That version records every `use(CONST, middleware)`, including `cors()` and `serve()`, which would turn every such project's API surface `partial`, and it still marks every route as auth.

## Project Structure

```text
cli/validators/metrics-consistency.mjs   FR-001 to FR-003
cli/writers/mechanical.mjs               FR-001 (replace-count)
cli/scanners/speckit.mjs                 FR-004
cli/validators/diff-suspicion.mjs        FR-005
cli/scanners/router-routes.mjs           FR-006
cli/findings.mjs, docs/reference/*.md    FR-008
tests/consumer-report-precision.test.mjs
tests/router-routes-unresolved.test.mjs
tests/anchor-cache.test.mjs
```

## Risks

- **A previously matched count is now skipped.** A count written right after `-`, `.`, `#` or `/` is no longer compared. Such text is a range, an identifier, a version or a path, and the A/B lists every finding that disappears.
- **DSP001 recall.** A doc that names a file in one section and describes its removed behavior in another loses the pairing. The two-signal rule already chose precision over recall. The A/B and a hand review of every disappearing DSP001 bound the loss.
- **SPK010 under load.** A spawn failure in `check-ignore` now silences SPK010 for that feature. This is the same fail-open direction PSR002 takes, and it is safe for a check that accuses a task.

## Verification

1. `npm test`; `node cli/docguard.mjs guard`; `npm run budget`.
2. Archive A/B (SC-002): `git archive` of `v0.45.1` and of the branch head as CLIs; one fresh archive copy of each project per CLI; `guard --format json` serially; findings diffed by code, location and message.
3. Clone A/B (SC-003): `git clone --local` copies pinned at their current HEAD, for this repository and the projects with Spec Kit tasks or canonical docs. Plus the reporting project at `619ac675…` for DSP001 (`HEAD~1..HEAD`) and at its current HEAD for MET003 and SPK010.
