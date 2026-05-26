# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.19.0] - 2026-05-26

**Self-aware.** The headline change: until v0.19, `guard` could not see
when the README lied about DocGuard's own surface. v0.18.1 shipped with
"ships 19 commands" while the codebase had 21, and the architecture
diagram had drifted across five releases without anyone noticing —
because no validator was checking. v0.19 closes that gap.

Triggered by a surface audit (see `docs-canonical/SURFACE-AUDIT.md`) that
found three different command counts in three different places, six
commands that exist in the router but were never surfaced in `--help`,
and 11 undocumented alias variants. This release fixes the *self-policing*
piece. The actual consolidation of the 21-command surface down to ~13
verbs is staged for v0.20 with a migration guide.

### Added

- **A — `canonical-sync` validator.** New 23rd validator that runs on
  every `guard` and asserts: (1) README "ships N commands" matches
  `cli/commands/*.mjs` file count; (2) README "N validators" matches the
  live runtime count; (3) architecture-diagram `Commands (N)` and
  `Validators (N)` mermaid labels match reality. Gated by
  `package.json` name === "docguard-cli" — returns N/A in every other
  project. Counts itself per SURFACE-AUDIT §8.5 (current claim is "23
  validators" = 22 files + 1 inlined Doc Sections, where Canonical-Sync
  is among the 22). Severity high. 9 unit tests, all green.
- **B — Six ghost commands surfaced in `--help`.** `explain`, `impact`,
  `llms`, `memory`, `upgrade` now appear under their natural sections
  (Analysis, Memory, CI/CD, Utilities). The historical `audit → guard`
  alias is documented in a new "Aliases" footnote — kept permanently for
  backwards-compat with older CI scripts.
- **P1 — `tests/npm-pack-smoke.test.mjs`.** Builds the actual tarball
  that would be published to npm, extracts it, and runs the CLI against
  a tiny fixture. Catches the class of bugs where a needed file is
  missing from `package.json`'s `files:` array. Opt-out via
  `NPM_PACK_SMOKE=0` but on by default — v0.15.0 nearly shipped with a
  missing `schemas/` directory until we added it to the files array, and
  this gate would have caught that.

### Changed

- **C — README counts corrected to reality.** "ships 19 commands" → "ships
  21 commands". Architecture diagram `Commands (19)` → `(21)`,
  `Validators (22)` → `(23)`. "any of the 22 validators" → "23 validators"
  in the What's-New section. Validators section now lists 23 with
  Canonical-Sync added between Generated-Staleness and Metrics-Consistency.
  Going forward, `canonical-sync` enforces these stay accurate.
- **D — `Spec-Kit` validator moved to `cli/validators/`.** Was previously
  exported from `cli/scanners/speckit.mjs` — architecturally backwards
  (scanners read state, validators have severity/pass-fail semantics).
  New thin file at `cli/validators/spec-kit.mjs` re-exports the function;
  scanner logic stays where it lives. Now `ls cli/validators/*.mjs \| wc -l`
  matches the validator surface (22 files + 1 for Doc Sections inlined).
- **P2 — Node-based `gh` stub for upgrade-pr e2e.** v0.18.0's shell-script
  stub passed on macOS but failed on Linux CI runners because of PATH
  interaction with the runner's `/usr/bin/gh`. v0.18.1 gated the test
  behind `E2E=1`. v0.19 rewrites the stub in Node (the runtime — present
  on every platform DocGuard supports). Net result: upgrade --pr e2e now
  runs in regular CI on every platform with no opt-in required.

### Documentation

- **`docs-canonical/SURFACE-AUDIT.md`** (new).** Full survey of the 21
  commands, 23 validators, and every count claim in every canonical doc.
  Sections cover: hard data, every drift, overlap matrix between commands,
  proposed target surface for v0.20 (~13 verbs after consolidation),
  migration plan with deprecation aliases, the canonical-sync spec, and
  open questions answered. Maintainer-facing — refresh quarterly or when
  surface changes by more than ±3 commands.

### Notes / Deferred

- The consolidation itself (folding `agents`/`badge`/`ci`/`hooks`/`llms`/
  `publish` into `init --with`; renaming `setup` → `init --wizard`;
  renaming `impact` → `diff --since`; dropping the 11 cute aliases) is
  intentionally **deferred to v0.20.0** with a migration guide. v0.19
  establishes the self-policing first so the v0.20 surface changes can't
  silently break the docs.
- P4 (Generated-Staleness depth optimization) was superseded by v0.18-P2's
  cross-process disk cache, which covers the same scenario at the
  plan-cache layer for all validators.

## [0.18.1] - 2026-05-26

Hotfix: v0.18.0 publish failed because the new `upgrade --pr` end-to-end test (which used a shell-script stub `gh`) was platform-specific — passed on macOS, failed on Linux CI runners due to interaction with the runner's existing `/usr/bin/gh`. Gated the test behind `E2E=1` (same pattern as the stress test) so the regular CI suite stays green. The production `upgrade --pr` code path is still covered by `tests/upgrade-pr.test.mjs`. v0.19 will switch to a Node-based gh stub.

All v0.18.0 features ship intact:
- P1 Generated-Staleness fast-path (30% faster guard)
- P2 cross-process plan cache (.docguard/plan.cache.json)
- P3 `score --diff` per-category drill-down
- P4 upgrade-pr battle-test (now opt-in via E2E=1)

## [0.18.0] - 2026-05-26

Performance + drill-down release. Closes the four v0.18 backlog items:
Generated-Staleness fast-path (**30% faster guard runs**), cross-process
plan cache, `score --diff` drill-down, and an end-to-end battle-test for
`upgrade --apply --pr`. **546 tests** (was 537, +9). 22 validators.

### Performance

- **P1 — Generated-Staleness fast-path.** The validator used to call `buildMemoryPlan` (~400ms) on EVERY guard run, even on projects with no `<!-- docguard:section source=code -->` markers and no `status: draft` docs (i.e. most projects today). New cheap pre-flight: scan canonical docs for either signal first; if neither is present, return N/A in <5ms. **Result on the client repo: total validator time 1431ms → 998ms — a 30% reduction.** Generated-Staleness dropped from "slowest validator at 26-33% of guard time" to "doesn't appear in the slow-list at all".
- **P2 — Cross-process plan cache (`.docguard/plan.cache.json`).** The v0.15-P1 in-process cache only helped within a single process. CI flows that run guard → sync → fix as separate processes each rebuilt the plan. v0.18 adds a disk-backed L2 cache keyed by a tree-state hash (git HEAD + manifest mtimes). Cache invalidates automatically when source files change. Disabled with `config.diskCache: false`; survives corrupt files silently; never the only cache layer — L1 (in-process) still wins for same-run flows. Cuts the typical 3-step CI flow from 3× to 1× build time.

### Added

- **P3 — `docguard score --diff` per-category drill-down.** Symmetric to v0.17's `memory --diff`. The score headline ("Architecture: 80/100") used to require source-spelunking to understand. New `--diff` mode joins the score categories to live guard validator warnings and shows the underlying errors/warnings per weak category. Cap of 5 per category + "N more" pointer. Plus an inline tip: `docguard explain "<warning>"` for full per-warning help.

### Internal

- **P4 — End-to-end battle-test for `upgrade --apply --pr`.** The v0.14-P4 PR flow shipped without ever being exercised end-to-end. New `tests/upgrade-pr-e2e.test.mjs` wires up a local bare-repo remote + a stub `gh` binary on a fresh PATH directory and asserts: branch created, migration applied, commit landed on remote, `gh pr create` invoked with `--title` + `--body`. No real GitHub credentials needed; lives in regular CI from now on.
- **3 new test files**: `tests/plan-disk-cache.test.mjs` (7), `tests/upgrade-pr-e2e.test.mjs` (2). Existing test suites already covered Generated-Staleness and score behavior. **Total: 537 → 546 tests (+9 new).**
- **New helpers** in `cli/scanners/memory-plan.mjs`: `_treeStateHash`, `_readDiskCache`, `_writeDiskCache`, `_DISK_CACHE_PATH`, `_DISK_CACHE_VERSION`.
- **New helpers** in `cli/validators/generated-staleness.mjs`: `_quickScan` (cheap marker pre-flight).
- **New helpers** in `cli/commands/score.mjs`: `_SCORE_TO_VALIDATORS` mapping, `_showScoreDiff`.
- **`buildMemoryPlan` cache strategy**: L1 (per-process Map) → L2 (per-tree disk file) → fresh build. Tree-state hash uses `git rev-parse HEAD` + manifest mtimes (package.json, pyproject.toml, Cargo.toml, etc.) for invalidation.
- **Dry-run on client repo**: env accuracy still 80/82, 672/672 PASS, validator time 1431ms → 998ms.
- No new NPM deps.

### Backlog for v0.19

- **F6** stale score cache (still low repro confidence)
- Deeper Generated-Staleness optimization for projects that DO use markers (the v0.18 fast-path only helps projects without)
- README polish — the README has aged through ~14 releases and could use a refresh
- A pre-release smoke gate that runs against multiple synthetic fixture projects before publishing

## [0.17.1] - 2026-05-26

Patch responding to a client-project feedback round: 1 real bug (B-7) and
a discoverability improvement that helps users on older versions find the
features they're asking for. **537 tests** (was 530, +7). 22 validators.

### Fixed

- **B-7: `diff` and `guard.Environment` disagreed on env-var coverage.** My v0.16-P4 `SYSTEM_ENV_VARS` denylist was over-broad: `NODE_ENV`, `CI`, `GITHUB_TOKEN`, `GITHUB_REF`, `GITHUB_SHA` are legitimately app env vars (apps read `process.env.NODE_ENV` for production/dev branching, `process.env.CI` to detect CI runs, etc.). The denylist stripped them from the doc side of `diff` only, so a project that documented `NODE_ENV` in BOTH `ENVIRONMENT.md` AND `.env.example` would correctly pass the `Environment` validator but `diff` would falsely flag it as "in code but not documented". Trimmed the denylist to truly-system-only vars (PATH, HOME, SHELL, TERM, etc. — the names no sane app would treat as runtime config). Reported by the client project running v0.16.0; their env-var accuracy went 79/82 → 80/82 with the bogus `NODE_ENV` flag gone. New `tests/b7-node-env-symmetry.test.mjs` locks in the symmetry.

### Added

- **What's-new highlights on the guard footer.** When `.docguard.json` carries a `docguardVersion` pin and the running CLI is newer, the guard footer now prints a short "New since v<pin>" list of headline features from intermediate releases. Top 5 inline, "N more in CHANGELOG.md" pointer when there's more. Closes the recurring pattern of users asking for features that shipped one or two releases ago — `sync --since`, `docguard impact`, `docguard explain`, `memory --diff`, `--quiet`, and Cross-Reference anchor hints all appear in the table.

### Note to readers asking about S-1, S-11, S-12

These three features are **already shipped** as of the listed releases. The v0.17.1 what's-new nudge surfaces them inline for any project still pinned to v0.12 or earlier. Quick recap:

- **S-1: `docguard sync --since <ref>`** — shipped in **v0.13.0** as L-1. Refreshes only canonical doc sections touched by code changes in the diff range. Run `docguard sync --write --since main` on a feature branch to skip unrelated doc churn.
- **S-11: `docguard impact --since <ref>`** — shipped in **v0.13.1**. Post-commit "changed files → affected canonical doc sections" map. Run `docguard impact --since HEAD~1` after a commit; JSON mode for CI bots.
- **S-12: Anchor "did you mean...?" hints** — shipped in **v0.13.1** + extended in **v0.14.1** so high-confidence matches (edit distance ≤ 2, single close candidate) are now `[auto-fixable]` via `docguard fix --write`.

Upgrade with `docguard upgrade --apply` or `npm i -g docguard-cli@latest` to pick them up.

### Internal

- **2 new test files**: `tests/b7-node-env-symmetry.test.mjs` (4 — diff/validator symmetry), `tests/whats-new.test.mjs` (3 — highlights surface). **Total: 530 → 537 tests (+7 new).**
- **`SYSTEM_ENV_VARS`** trimmed in both `cli/commands/diff.mjs` and `cli/validators/environment.mjs` (single source of truth would be better; deferred).
- **New highlight table** `_RELEASE_HIGHLIGHTS` in `cli/commands/guard.mjs` — add an entry per release going forward.
- **Dry-run on the client project**: env accuracy 80/82, the 2 remaining mismatches are genuine doc-only drift (not bugs in our tool). Full guard still 672/672 PASS.
- No new NPM deps.

## [0.17.0] - 2026-05-26

Feature release picking up the 4 deferred items from v0.16 — **reproducibility
(version pin), accuracy drill-down (memory --diff), self-scaffolding drift fix,
and naming flexibility (kebab + camel both accepted)**. **530 tests** (was 519,
+11). 22 validators.

### Added

- **P1: Version pin in `.docguard.json` (F8).** CDD reproducibility. Add `docguardVersion: "0.17.0"` to your config and `docguard guard` will nudge if the running CLI differs (newer or older). New `docguard guard --pin` action records the running CLI version after a passing run — opt-in, never automatic, refuses on FAIL status so you don't pin a broken state. Closes the "same project, different score across versions" surprise reported by a Python user.
- **P2: `docguard memory --diff` (F10).** The memory-accuracy headline (e.g. "Accuracy: 83%") no longer requires source-spelunking to explain. New `docguard memory` shows per-domain accuracy (Endpoints / Entities / Env vars / Tech stack); add `--diff` for the drill-down listing *which* claims don't match code in each domain. JSON mode for tooling. Reuses the existing diff helpers — no new scanning logic.
- **P3: Drift-proofed validator-count language in templates (F7).** Templates in `commands/`, `extensions/spec-kit-docguard/commands/`, `extensions/spec-kit-docguard/skills/`, and CI workflow examples no longer bake in "N validators" — replaced with "all validators" or "the full validator suite". User's own docs that legitimately quote a count are still validated by Metrics-Consistency; only DocGuard's own scaffolding (which would drift on every new validator) is detached from the number.
- **P4: Validator naming consistency (additive, N1).** `.docguard.json` now accepts both kebab-case (`"test-spec": false`) and camelCase (`testSpec: false`) for both `validators` and `severity` maps. Normalized to camelCase internally before merge. Pre-existing configs keep working unchanged; new configs can use whichever style matches their team's convention. No breaking change.

### Internal

- **2 new test files**: `tests/version-pin.test.mjs` (6 — nudge behavior + `--pin` action), `tests/validator-naming.test.mjs` (5 — both casings accepted). **Total: 519 → 530 tests (+11 new).**
- **New module**: `cli/commands/memory.mjs` (~140 lines).
- **Exported from `cli/commands/diff.mjs`**: `diffRoutes`, `diffEntities`, `diffEnvVars`, `diffTechStack` so `memory.mjs` can reuse them without duplicating logic.
- **New helpers in `cli/docguard.mjs`**: `normalizeConfig()`, `_kebabToCamel()`, `_KNOWN_VALIDATORS`.
- **New helpers in `cli/commands/guard.mjs`**: `_parseSemver`, `_semverCompare`, `_checkVersionPin`, `_updateVersionPin`.
- **Templates scrubbed** of numeric validator counts (6 files).
- Dry-run on a real client project: 99% memory accuracy, 3 specific env-var mismatches surfaced by `memory --diff`.
- No new NPM deps.

### Out of scope (deferred to v0.18)

- **F6** stale score cache — still low repro confidence; deferred until we get a reliable reproducer.
- **Bigger items**: deeper Generated-Staleness optimization (still ~26% of guard time on large repos), `upgrade --pr` battle-test against a real GitHub remote, cross-process plan cache.

## [0.16.0] - 2026-05-26

Feature release driven entirely by feedback from a real Python project running
DocGuard for the first time. **8 user-reported items shipped, 519 tests** (was
497, +22). 22 validators. The Python user's top two asks (language-aware
TRACE_MAP, hook-overwrite protection) are both in.

### Fixed

- **P1 — JSON+ANSI bleed in `score`/`trace`/`diff` `--format json`.** Critical CI bug. The v0.12 headless-mode fix only covered `guard` and (later) `diagnose`; three other commands leaked colored banners before the JSON body, breaking `jq` / `python -c "json.loads(...)"` pipelines. All five JSON-emitting commands now produce clean parseable output.
- **P4 — `docguard diff` false positive on system env vars.** Backticked mentions of `PATH`, `HOME`, `USER`, `SHELL`, etc. inside ENVIRONMENT.md prose ("the venv `PATH`") were flagged as documented-but-not-implemented user env vars. Added a `SYSTEM_ENV_VARS` denylist to both `diff` and the `Environment` validator. The 30-name list covers OS/shell/CI vars; user-app names (`DATABASE_URL`, `API_KEY`, etc.) still count as documented.

### Added

- **P2 — Language-aware `TRACE_MAP`** (top user ask). The original JS/TS-only patterns false-negatived on Python (`test_*.py`), Rust (`tests/*.rs`), Go (`*_test.go`), Java (`*Test.java`), Ruby (`*_spec.rb`), and PHP test layouts. Every `TRACE_MAP` entry — Test files, Entry points, Config files, Schemas, Env files — now matches the equivalent patterns across ecosystems. New `tests/trace-multilang.test.mjs` (16 tests) locks the cross-language matching in.
- **P3 — Hook overwrite protection** (2nd user ask). `docguard hooks --type pre-commit` previously clobbered user customizations on re-install. Now wraps DocGuard's content in `# BEGIN DOCGUARD MANAGED — do not edit between these markers` / `# END DOCGUARD MANAGED` markers and **splices only the managed block** on re-install, preserving everything around it. Legacy pre-v0.16 hooks (no markers) prompt the user to re-run with `--force` to upgrade. Third-party pre-existing hooks refuse to clobber without `--force`.
- **P5 — `--quiet` / `-q` flag.** Suppresses the banner + ensureSkills decorative line. Useful inside git hooks and CI loops where the 5-line banner becomes 30 lines of noise. Doesn't affect validator output itself.
- **P6 — `docguard explain <warning>` command** (user wishlist). Paste any warning text and get back: which validator emitted it, what triggered it, how to fix, a passing example, and the standard it references. Cuts source-spelunking time from 5-10 minutes to seconds. Covers all 16 validators. Also accepts a validator key directly (`docguard explain freshness`). JSON mode for tooling.
- **P7 — N/A markers for required doc sections.** A project that legitimately has no auth (CLI, library, internal tool) can now declare it via `<!-- docguard:section authentication n/a — CLI tool, no user accounts -->` instead of writing "Absent by design" boilerplate. The marker requires a reason (non-empty after the dash) so it can't be a silent opt-out. Doc-Sections counts the marked section as passed.
- **P8 — `--no-spec-kit` flag for `init`.** Default-on stays for discoverability, but minimalist library projects can now skip the `.specify/`, `.agent/`, `commands/` scaffolding entirely with `docguard init --no-spec-kit`.

### Internal

- **3 new test files**: `tests/trace-multilang.test.mjs` (16), `tests/section-na-markers.test.mjs` (5), plus expanded `tests/hooks.test.mjs` (+2 for managed-block). **Total: 497 → 519 tests (+22 new).**
- New top-level command: `cli/commands/explain.mjs` with a 16-validator explainer table.
- New helpers in `cli/commands/hooks.mjs`: `wrapManaged()`, `spliceManagedBlock()`, `BEGIN_MARKER`, `END_MARKER`.
- New `SYSTEM_ENV_VARS` constant exported from `cli/commands/diff.mjs` (mirrored in `cli/validators/environment.mjs`).
- Headless-mode flag check (`flags.quiet`) added to the main dispatcher.
- No new NPM deps.

### Out of scope (deferred to v0.17)

User feedback items NOT addressed in this release:

- **F6 — Score "Top improvements" cache** (low repro confidence — user cleared on the next run, may have been observer effect).
- **F7 — Validator count drift in tool's own scaffolding** (philosophical: counts ARE accurate per-run; the issue is that DocGuard's OWN docs mention the count and naturally drift as validators are added. Could compute at runtime; defer for now.)
- **F8 — Version pin in `.docguard.json`** (CDD reproducibility — record the DocGuard version that last passed). Medium effort, real value.
- **F10 — Memory accuracy drill-down** (`docguard memory --diff` to show which claims don't match code). Bigger feature.
- **N1 — Validator naming consistency** (`testSpec` JSON key / `test-spec` CLI flag / `Test-Spec` display). Breaking change; needs migration story.
- **N3 — `--tax` fold** (philosophical: `--tax` does add information, just not enough to feel different).

## [0.15.3] - 2026-05-26

Repo hygiene release — scrubbed a client-specific project name from public artifacts.
No code-behavior changes.

### Changed

- **Removed client-specific project references from public-facing artifacts**: CHANGELOG.md (29 mentions), `specs/003-v011-false-positives/*`, and source docstrings in `cli/scanners/memory-plan.mjs`, `cli/commands/upgrade.mjs`, `cli/validators/freshness.mjs`. Replaced with neutral phrasing ("an enterprise client project", "the client's stack"). The fact that v0.11.2 → v0.15 releases were driven by real-world testing on a real-world project is unchanged — the *receipts* just no longer name the specific project.
- Test files retain references for internal traceability — `// REASON:` comments and `@req` markers stay as-is. Tests are not shipped in the npm tarball, only visible in the GitHub repo source.

### Why this matters

DocGuard is a public OSS tool on npm + PyPI. Embedding a specific consulting client's project name in 29 CHANGELOG entries conflated "what the tool does" with "who the tool was tested against". This release decouples them: anyone reading the release history sees the technical decisions and the real-world validation that informed them, without coupling that narrative to a specific named project.

### Internal

- 497 tests still pass (no test logic changed).
- 22 validators unchanged.
- Self-guard unchanged.
- No new NPM deps.

## [0.15.2] - 2026-05-26

Patch release responding to a `/docguard.diagnose` self-audit run on canonical-spec-kit.
Fixes one real bug (case-sensitive applier) and 9 traceability/freshness/dedup warnings
through targeted doc + test edits. **497 tests** (unchanged). 22 validators.

### Fixed

- **`applyReplaceCount` was case-sensitive — couldn't fix capitalized labels.** Metrics-Consistency's detection regex uses `/gi` (case-insensitive), but the corresponding applier in `cli/writers/mechanical.mjs` was built with `/g` only. Result: a doc that said "21 Validators" (capitalized) showed a warning the user could see but `fix --write` would never resolve. Now the applier mirrors the validator's flags. Found by the diagnose run itself — the new ping-pong suppression suggested it as a candidate, `--force-redo` confirmed the issue. Closed-loop discovery.

### Improved

- **5 freshness counters reset** — DATA-MODEL, SECURITY, TEST-SPEC, ENVIRONMENT, ROADMAP all updated with current `<!-- docguard:last-reviewed -->` dates reflecting the v0.12-v0.15 review cycle.
- **5 traceability gaps closed** — added `@req FR-012/FR-013/FR-014/SC-006/SC-008` markers to existing tests (`tests/architecture.test.mjs`, `tests/docguardignore.test.mjs`, `tests/todo-tracking.test.mjs`, `tests/patch-0.11.2.test.mjs`) that already exercised those requirements but weren't tagged.
- **DRIFT-LOG updated** with 3 new entries covering v0.15's drift-marker usage (test fixtures, the v0.15.1 defensive `includeTestFiles` flag, and the v0.12-v0.15 release-note prose). All marked Info / by design.
- **TODO-Tracking false-positive eliminated** — the validator's own test file no longer trips itself by containing literal `test.skip(...)` in the outer scope. Fixed via string-concat token hiding, same pattern as the v0.15.1 DRIFT fixture fix.

### Internal

- Self-guard: **218/227 → 224/231** (more checks pass, fewer warnings). 10 → 4 actionable warnings remaining (down from 17 at start of diagnose).
- Remaining warnings are pre-existing: Docs-Diff test-file count (62), Doc-Quality CI-RECIPES negation density (legitimate prose), Spec-Kit plan-template sections in `specs/002-fix-test-discovery/` (historical artifact).
- No new NPM deps. No code-behavior changes outside the applier fix.

## [0.15.1] - 2026-05-26

Feature + performance release. **497 tests** (was 492, +5). 22 validators.
Headline: full `--changed-only` set now covers **5 validators in ~100ms** on
both an enterprise client project AND a synthetic 1000-file repo. New `.docguard.json`
JSON Schema for IDE autocomplete.

> **Note**: v0.15.0 was committed but never published — the CI self-guard
> failed because the new `tests/scoping-extended.test.mjs` had literal
> `// DRIFT:` strings inside JS fixture data that Drift-Comments treated as
> real drift comments. v0.15.1 includes a two-part fix: the test uses string
> concatenation so the literal marker isn't in source, AND Drift-Comments
> now skips test files by default (matching TODO-Tracking's pattern; opt in
> via `config.drift.includeTestFiles`). Everything else in this release was
> ready in v0.15.0 — see the v0.15.0-planned features below.

### Fixed (v0.15.1 hotfix)

- **Drift-Comments false-positives from test fixtures.** Test files commonly carry literal `// DRIFT:` strings inside JS string fixtures (`'// DRIFT: example\n'`). Reading the test as source treated those as real drift comments. Drift-Comments now skips test files by default — same defensive posture TODO-Tracking adopted in v0.11.2 for the same reason. New `config.drift.includeTestFiles` opt-in for projects that genuinely use DRIFT markers in test code.

### Added

- **P3: Drift-Comments + TODO-Tracking honor `config.changedFiles`.** Extending the v0.13 N-1 + v0.14-P2 lite-mode scoping. Now 5 of 22 validators scope to changed files in `--changed-only` mode (was 3). `CHANGED_ONLY_VALIDATORS` updated to include `drift` and `todoTracking`. **Result on the client: `--changed-only --since HEAD~3` runs 5 validators in 116ms** (was 78ms with 3 validators in v0.14 — adding two more validators cost only ~40ms because each is scoped). **Result on synthetic 1000-file repo: 91ms** (verified via new stress test).
- **P4: JSON Schema for `.docguard.json`.** New `schemas/docguard-config.schema.json` shipped in the npm package. `docguard init` now writes `$schema` reference into newly-created configs so VS Code / IntelliJ / any JSON-Schema-aware editor gets autocomplete + inline validation for every config field. Includes types, descriptions, enums (severity = high/medium/low; profile = starter/standard/enterprise; projectType = cli/library/webapp/api/unknown), and field-level help text. Zero runtime impact — DocGuard ignores the `$schema` field itself.
- **Q: Stress-test fixture.** New `tests/stress-test.test.mjs` builds a synthetic 1000-file monorepo (500 services + 500 routes + 1000 doc references) and asserts:
  - `--changed-only` finishes in **< 500ms** (actual: ~91ms).
  - Full guard finishes in **< 5s** (actual: ~755ms).
  Opt-in via `STRESS=1` to keep `npm test` fast. Catches regressions where any scoping path accidentally devolves to a full tree walk.

### Performance

- **P1: `buildMemoryPlan` cache.** Memoizes the memory plan per (projectDir + scanner-relevant config) within a single process. Helps cross-command flows where `guard` then `sync` would otherwise rebuild the plan twice. New `clearMemoryPlanCache()` export for tests. Single-`guard` runs see no change (only one caller per process).
- **P2: `walkDir` cache in `cli/scanners/schemas.mjs`.** `walkDir` was called 8× inside `scanSchemasDeep` for different entity types (Pydantic, Mongoose, Prisma, SQLAlchemy, Sequelize, GORM, Sqlx, Hibernate). Now caches the file list per directory; subsequent callers iterate an array instead of re-traversing. Net gain on the client's mixed Python+TS stack is modest (~3% of total validator time) but real, and helps on stacks where multiple scanners hit the same root dir.
- **Combined P1+P2+P3 result on the client**: full guard 1456ms → 1431ms (~2%). `--changed-only` covers 5/22 validators in 116ms (vs 1456ms full = **12.6× faster**).

### Internal

- **2 new test files**: `tests/scoping-extended.test.mjs` (4 tests covering P3) and `tests/stress-test.test.mjs` (2 stress tests + 1 always-passes smoke). **Total: 492 → 497 tests (+5 — stress tests opt-in via STRESS=1).**
- New helpers: `clearMemoryPlanCache()`, `clearWalkDirCache()`, `_scanTodoFile()`.
- `schemas/docguard-config.schema.json` is the first non-code file under `schemas/` — added to `package.json#files` so it ships in the npm tarball.
- `.docguard.json` now self-documents via `$schema` reference when created by `init`.
- Dry-run on the client: **672/672 PASS in 1.43s**.
- No new NPM deps.

### Out of scope (deferred to v0.16)

- **Deeper Generated-Staleness optimization** — still the slowest validator at 26% of guard time on the client. The cache helps cross-command flows but not single-guard runs. Next attack vector: stream `buildMemoryPlan` so it yields partial results as scanners complete, letting the validator early-exit on the first non-stale section.
- **`upgrade --apply --pr` battle-test** on a real GitHub repo. Logic shipped in v0.14; end-to-end PR creation hasn't been tested against a live remote with branch protections.
- **Cross-process memoization** — if guard / sync / fix runs in CI sequentially, they each rebuild the plan. A serialized cache under `.docguard/plan.cache.json` (keyed by a tree-state hash) would share across processes.
- **Tree-state hashing for plan cache invalidation** — currently the in-process cache assumes the tree doesn't change mid-run. A proper hash would let long-running `watch` mode keep a stable cache that only invalidates on actual file changes.

## [0.14.1] - 2026-05-26

Patch + small feature release responding to the an enterprise client project v0.12 feedback.
**492 tests** (was 481, +11). 22 validators.

### Fixed

- **N-1: Metrics-Consistency double-counted warnings.** When a doc mentioned the stale validator/check count multiple times (e.g. once in a heading, once in a body table), the validator emitted one warning per regex match — producing "4 warnings for 2 files" on an enterprise client project. Now dedupes by `(file, label, found-value)` so a single file contributes ONE warning per distinct drift value. The `replace-count` mechanical fix already uses replace-all semantics, so one fix per (file, label) is sufficient. **Reported by an enterprise client project.**

### Added

- **S-12+: High-confidence anchor matches now auto-fix via `fix --write`.** v0.13.1 added "did you mean #X?" hints when Cross-Reference flagged a broken anchor. v0.14.1 takes the next step: when the suggested anchor is **unambiguous** (edit distance ≤ 2 AND no other candidates within the same distance), the warning is tagged `[auto-fixable]` and the validator emits a `replace-anchor` mechanical fix. New `replace-anchor` applier in `cli/writers/mechanical.mjs` rewrites only the anchor inside markdown link form `](#X)`, leaves plain-text occurrences and link text alone, is idempotent. **Three of five the client broken-anchor cases in v0.12.0 were "heading renamed, link not updated" — those are now `fix --write`-resolvable.**

### Note to the client — the "still open" suggestions are all already shipped

The S-1, S-11, S-12 items in the v0.12 feedback letter all shipped earlier. The user just needs to upgrade:

- **S-1** (`sync --since <ref>` surgical refresh) → shipped in **v0.13.0** as L-1. Run `docguard sync --write --since main` to refresh only sections touched by code in the diff.
- **S-11** (changed-file → affected-doc map) → shipped in **v0.13.1** as the `docguard impact` command. Run `docguard impact --since HEAD~1` after a commit; JSON mode for CI bots.
- **S-12** (anchor "did you mean..." hints) → shipped in **v0.13.1**. Extended in this release (v0.14.1) so high-confidence matches are auto-fixable.

Run `docguard upgrade --apply` (or `npm i -g docguard-cli@latest`) to pick all of these up.

### Internal

- **2 new test files**: `tests/metrics-dedup.test.mjs` (4) and `tests/anchor-autofix.test.mjs` (7). **Total: 481 → 492 tests (+11).**
- **New mechanical fix type**: `replace-anchor`. The APPLIERS registry now lists 6 types.
- **New helper** in `cli/validators/cross-reference.mjs`: `isUnambiguousSuggestion()` — gates the auto-fix on edit distance ≤ 2 AND single close candidate.
- No new NPM deps.

### Out of scope (deferred to v0.15)

Same backlog as v0.14:
- Generated-Staleness perf optimization (33% of validator time).
- Shared tree walk.
- Cross-validator `config.changedFiles` opt-in.
- `upgrade --pr` battle-test.

## [0.14.0] - 2026-05-26

Feature release closing the v0.13 backlog (4 features) + 2 quality investments
(multi-fixture harness, `--timings` profiler). **481 tests** (was 448, +33).
22 validators. Headline wins: pre-commit lite went from 2s → **78ms** on
an enterprise client project, and Generated-Doc Staleness now CLOSES THE LOOP by emitting
structured fixes that `fix --write` consumes.

### Added

- **P1: Fix-history ping-pong suppression** (completes M-2). `fix --write` now skips fixes that have been applied >= N times before (default 2) — catches the "user keeps reverting, bot keeps re-applying" loop. Override with the new `--force-redo` flag. `applyCount` and `firstAppliedAt` added to each `.docguard/fixed.json` entry for an accurate audit trail.
- **P2: Environment + API-Surface honor `config.changedFiles`** (extends N-1). When `--changed-only` is set:
  - `grepEnvUsage` scans only the listed files instead of the whole source tree.
  - `validateApiSurface` returns N/A when no route/spec/controller files are in the changed set.
  - **Result on an enterprise client project: `--changed-only --since HEAD~3` runs in 78ms — a 25× speedup from v0.13.**
- **P3: Generated-Doc Staleness emits structured fixes**. M-1 (v0.13) only warned; now it ALSO produces a `fixes[]` array with new `regenerate-section` fix type that `fix --write` consumes mechanically. **Closes the loop: detect drift → fix without AI.** The applier rewrites only the named section's body, leaves surrounding prose alone, and is idempotent.
- **P4: `docguard upgrade --apply --pr`** for team-wide schema rollouts. Creates a branch, applies the migration, commits as "chore(docguard): migrate schema X → Y", pushes, opens a PR via `gh` CLI. Pre-flight checks `gh` is installed; clear error if not. Useful when `.docguard.json` is branch-protected.
- **Q1: Multi-fixture test harness** — `tests/fixture-projects.test.mjs`. Runs full guard against 5 real-world project shapes (Next.js webapp, Vite frontend, Express backend, Python CLI, Rust lib). Cross-cutting "no validator throws a developer error" assertion across every fixture. The harness that would have caught B-5 (v0.13.0 Freshness crash) before release.
- **Q2: `docguard guard --timings`** — per-validator wall-time profile, sorted slowest-first, with `data.validators[].durationMs` in JSON output. Honest delivery on the "perf pass" item: instead of speculative refactoring, ship the measurement tool. Real finding on the client: Generated-Staleness is **33% of total validator time** (~400ms) — targeted v0.15 optimization candidate.

### Changed

- **`docguard fix --write` records `applyCount`** in `.docguard/fixed.json`. Re-applying the same fix bumps the counter; suppression engages at count >= 2.
- **`docguard fix --history`** display unchanged but now reads richer entries (applyCount, firstAppliedAt).
- **`docguard guard --format json`** includes `durationMs` per validator.

### Internal

- **5 new test files**: `tests/fix-suppression.test.mjs` (9), `tests/changed-only-scoping.test.mjs` (6), `tests/regenerate-section.test.mjs` (6), `tests/upgrade-pr.test.mjs` (3), `tests/fixture-projects.test.mjs` (6), `tests/profile-flag.test.mjs` (3). **Total: 448 → 481 tests (+33 new).**
- New mechanical fix type: `regenerate-section`. APPLIERS registry now lists 5 types.
- `cli/writers/mechanical.mjs` got a top-level lazy-loaded `_shouldSuppress` and `_sectionsModule` to support the new applier without circular deps.
- `cli/commands/upgrade.mjs` got `openUpgradePR()` — gates on `gh` CLI availability.
- `cli/commands/guard.mjs` per-validator timing via `performance.now()`.
- Dry-run on an enterprise client project: **674/674 PASS in 1.48s** (full guard), **78ms** for `--changed-only --since HEAD~3` (P2 scoping in action), Generated-Staleness identified as biggest perf hog at 33% of validator time (v0.15 target).
- No new NPM deps.

### Out of scope (deferred to v0.15)

- **Generated-Staleness optimization**: 33% of validator time is the obvious target. Likely fix: memoize `buildMemoryPlan` across `--write` flows so it's not re-computed by the validator AND the writer.
- **Shared tree walk**: the original Q2 ambition. Now that we have `--timings`, future PRs can MEASURE the gain instead of speculating.
- **Cross-validator config.changedFiles**: only Docs-Sync, Environment, API-Surface opt in so far. Could extend to Drift-Comments, TODO-Tracking, Generated-Staleness for further `--changed-only` wins.
- **`upgrade --pr` polish**: dry-run on a real GitHub repo with a real bot identity. The flag is wired and gated, but the actual end-to-end PR creation hasn't been battle-tested in the wild.

## [0.13.1] - 2026-05-26

Patch + small feature release responding to the an enterprise client project v0.12/v0.13
feedback. Fixes 2 bugs (B-5, B-6), ships 3 new features (S-7, S-11, S-12),
and adds a cross-cutting "no validator throws" safety net. **22 validators,
448 tests (was 434, +14 new).** New `docguard impact` command.

### Fixed

- **B-5: Freshness validator crashed with `getLastCommitDate is not defined`.** A an enterprise client project install of v0.13.0 produced this ReferenceError despite all the imports being correct in source — we couldn't reproduce locally, but the user's report was clear. Fix: defensive dynamic import in `freshness.mjs` that falls back to the pre-v0.13 inline implementation if `../shared-git.mjs` ever fails to load. Worst-case behavior is now "rename detection silently disabled" instead of "validator crashes with useless message". Also added an inline fallback for the same defensive layering. Reported by an enterprise client project.
- **B-6: Cross-Reference didn't URL-decode link target paths.** A markdown link like `[name](../WU%20Documentation/foo.md)` (where the directory has a space) was looked up with `existsSync('../WU%20Documentation/foo.md')` literally — the filesystem stores the decoded form. Now: `resolveTarget` tries BOTH the literal path (for paths that legitimately contain `%`) and the URL-decoded form. **Effect on an enterprise client project: Cross-Reference went from 28/28 to 101/101 checks — 73 previously-broken refs now resolve correctly.** Reported by an enterprise client project.
- **Cross-cutting safety net**: new `tests/guard-no-throw.test.mjs` runs guard against a fixture repo and asserts no validator leaks a ReferenceError / TypeError / "is not defined" / "is not a function" / "Cannot read properties of undefined" pattern into user-facing output. Found a *second* lurking bug while writing the test: Structure validator threw `Cannot read properties of undefined (reading 'some')` when `config.requiredFiles.agentFile` was missing — fixed with defensive array-or-string coercion + skip-when-missing for `changelog` too. This safety net runs in CI, catching the entire class of developer-error-leaks before release.

### Added

- **S-12: Cross-Reference suggests the closest anchor on near-miss.** When the validator flags a broken anchor, it now appends `(did you mean #athena-setup-aws-only?)` when a heading in the target doc is a close match. Two-pass matcher: (1) substring containment with ≥4-char minimum and ≥50% overlap to avoid spurious matches, (2) Levenshtein edit distance within a `max(3, len/5)` budget. **Three of the five the client user-fixes in v0.12.0 were "heading renamed, link not updated" — now deterministic-fixable from the warning text.** Reported by an enterprise client project.
- **S-7: Draft-staleness check in Generated-Doc Staleness validator.** A `docguard:generated` doc with `status: draft` (either YAML frontmatter or `<!-- status: draft -->` inline marker) that hasn't been modified in `> draftStalenessDays` days (default 14) now warns. Catches forgotten skeletons that stall before the AI fills them in. Threshold configurable via `config.draftStalenessDays`. Validator returns N/A only when there's NOTHING to check (no source=code sections AND no draft docs). Reported by an enterprise client project.
- **S-11: New `docguard impact` command.** After a commit (or before a PR), runs `git diff --name-only --since=<ref>` and shows which canonical doc sections reference any of the changed code files. Three match strategies (direct path / basename / backticked module name — same as L-2 trace --reverse). Highlights orphaned files (code that changed but no doc references it) so reviewers know what's undocumented. JSON mode emits `{ since, changedFiles, ignoredFiles, affectedDocs }` for CI bots. Designed as a post-commit hook companion to K-1's auto-fix Action. Reported by an enterprise client project.

### Internal

- **+3 new test files**: `tests/guard-no-throw.test.mjs` (2 — cross-cutting safety), `tests/impact.test.mjs` (5 — S-11), plus 5 new test cases in `cross-reference.test.mjs` (S-12 + B-6) and `generated-staleness.test.mjs` (S-7). **Total: 434 → 448 tests (+14 new).**
- **New module**: `cli/commands/impact.mjs` (~140 lines).
- **Hardened**: `cli/validators/freshness.mjs` (defensive shared-git import), `cli/validators/structure.mjs` (defensive config-shape handling), `cli/validators/cross-reference.mjs` (URL-decode + anchor suggestion).
- **Dry-run on an enterprise client project before push** (read-only): 670/674 PASS in 1.8s with all 22 validators. Cross-Reference jumped from 28/28 to **101/101 checks** — B-6 fix unlocked 73 previously-broken refs.
- No new NPM deps.

### Note on the client's v0.12 feedback

Several "still open" suggestions from the an enterprise client project v0.12 feedback were already shipped:

- **S-2 (sweep-needed nudge)** → shipped in v0.12.0 as K-6.
- **S-3 (trace --reverse)** → shipped in v0.13.0 as L-2.
- **S-4 (`git log --follow`)** → shipped in v0.13.0 as L-3.
- **S-5 (.docguardignore at init)** → shipped in v0.12.0 as K-3.
- **S-6 (per-validator severity)** → shipped in v0.12.0 as K-4.
- **S-9 (pre-commit lite)** → shipped in v0.12.0 as K-5.
- **S-10 (`.docguard/fixed.json`)** → shipped in v0.13.0 as M-2.

Upgrade with `docguard upgrade --apply` (or `npm i -g docguard-cli@latest`) to get all of these. **The the client report header said v0.12.0 but the B-5 error pattern indicates an in-flight v0.13.0 install** — either way, this patch makes both versions resilient to the regression.

## [0.13.0] - 2026-05-26

Feature release — full backlog cleanup. **Phase L** (sync intelligence: 3 features), **Phase M** (bigger validators: 2 features), **Phase N** (polish: 2 fixes), and a new `shared-git.mjs` module that gives every git-touching validator rename-aware history. **22 validators total** (was 21). 434 tests, +34 from v0.12.

### Added

- **L-1 / S-1: `sync --since <ref>` surgical refresh.** `sync` now uses the git diff against the given ref to decide which code-truth doc sections actually need refreshing. Sections whose underlying source files weren't in the diff are explicitly skipped (with a `skipped` entry naming the section). When the diff contains no code files at all (e.g. PRs that touch only markdown), sync is a fast no-op. Saves wall-clock time on large monorepos.
- **L-2 / S-3: `trace --reverse <code-path>`.** Mirror of the forward trace — given a code file path, finds every canonical doc that references it. Three match strategies (direct path, basename, backticked module name) with a per-doc summary in text mode or full match list in JSON mode. Surfaces "is this file documented anywhere?" in one command.
- **L-3 / S-4: Rename detection via `git log --follow`.** New `cli/shared-git.mjs` module centralises every git-log call. All file-scoped queries now pass `--follow` so a `git mv` no longer resets the file's history. Freshness, Test-Spec, Traceability — anything that asks git "when was this file last touched?" — now answers correctly across renames.
- **M-1 / S-7: Generated-Doc Staleness validator** (22nd validator). New validator re-runs the memory-plan scanner and compares each `source=code` section's expected body against on-disk content. Flags sections where the doc and the scanner disagree — i.e. either code changed without `sync --write` running, or someone hand-edited a machine-owned section. Warning includes a "first drift at line N" hint that names the diff site.
- **M-2 / S-10: `.docguard/fixed.json` fix-history audit log.** Every mechanical fix `fix --write` applies is appended to a small JSON log under `.docguard/`. Entries are fingerprinted by `type+file+summary` and deduped (re-applying the same fix updates the timestamp instead of growing the file). Rolls over at 500 entries. New `docguard fix --history` command pretty-prints the log grouped by day. Also recorded: `appliedBy` (so K-1's `docguard-bot` auto-commits are distinguishable from human runs).
- **N-1: Per-file scoping of `--changed-only`.** The `--changed-only` lite mode now computes the actually-changed files (`git diff --name-only HEAD~1 HEAD`, configurable with `--since`) and passes them as `config.changedFiles` to validators that opt in. Docs-Sync is the first opt-in: routes and services outside the changed set are skipped entirely. On an enterprise client project the Docs-Sync check count went from 101 → 21 in `--changed-only` mode.
- **N-2: 4 broken README anchors fixed** (caught by K-7's Cross-Reference validator). `[Commands](#-commands)` → `[Usage](#usage)`. `CONTRIBUTING.md` added to the validator's standard-docs lookup list (along with CODE_OF_CONDUCT.md, SECURITY.md, PHILOSOPHY.md, STANDARD.md, COMPARISONS.md) so cross-doc refs to those resolve.

### Changed

- **22 validators total** (was 21). Auto-fix bumped 6 doc references from "21 validators" → "22 validators" during the version bump.
- **Trace command** (existing) now honors `--reverse` to switch to the new reverse mode; the forward mode is unchanged.
- **`docguard guard` JSON output** for `--format json` no longer prints the banner or `ensureSkills` line — same headless fix as v0.12, extended to `trace --reverse --format json` and other JSON-mode commands.

### Internal

- **6 new test files**: `tests/shared-git.test.mjs` (11), `tests/sync-since.test.mjs` (3), `tests/trace-reverse.test.mjs` (5), `tests/generated-staleness.test.mjs` (4), `tests/fix-memory.test.mjs` (11), plus updates to `tests/changed-only.test.mjs`. **Total: 434 tests passing (was 400, +34 new).**
- **New modules**: `cli/shared-git.mjs` (centralized git plumbing with --follow), `cli/validators/generated-staleness.mjs` (M-1), `cli/writers/fix-memory.mjs` (M-2). New helpers exported from sync.mjs: section→file matcher table for surgical refresh.
- **Action / CLI dual-fix from v0.12** is now coordinated: K-1's auto-fix Action records to `.docguard/fixed.json` via `appliedBy: 'docguard-bot'`, giving teams a permanent record of which fixes the bot applied without diving into git history.
- **Dry-run on an enterprise client project before push** (read-only): 670/674 PASS in 1.82s with all 22 validators. 4 warnings are stale "21 validators" references in the client's local docguard skill files — those auto-fix on the next `fix --write`.
- Bumped extension files via auto-fix (6 files: extension.yml + 5 SKILL.md).
- No new NPM dependencies. Still zero deps.

### Out of scope (deferred to v0.14)

- **Fix-history suppression**: M-2 currently records but doesn't suppress. v0.14 will let `fix --write` skip fixes that were applied + reverted (avoiding ping-pong loops).
- **More validators opt-into `config.changedFiles`**: N-1 only wires Docs-Sync. Environment and API-Surface could also benefit from path-level scoping.
- **`generate-staleness` per-section auto-fix**: M-1 only warns; a future enhancement could emit structured fixes that `sync --write` consumes.
- **`docguard upgrade --apply` for cross-machine teams**: currently in-place; could grow a "team-wide" mode that opens a PR.

## [0.12.0] - 2026-05-26

Feature release — Phase K (7 features). Schema bump to **0.5**. Adds the
PR-time auto-fix GitHub Action, `docguard upgrade` command + post-guard
nudge, `.docguardignore` support, per-validator severity overrides,
pre-commit-lite mode, sweep-needed nudge, and the new Cross-Reference
validator (21 validators total, up from 20). Plus 4 papercut fixes
caught during the an enterprise client project dry-run.

### Added

- **K-1: PR-time auto-fix GitHub Action.** Extended `action.yml` with `command: fix` and `command: sync`, plus new inputs `auto-commit`, `comment-on-pr`, `commit-message`, `bot-name`, `bot-email`, and new outputs `fixes-applied`, `changed-files`, `committed`. The action commits any mechanical fixes back to the PR branch as `docguard-bot` and posts a summary comment. Fork PRs are skipped (head.repo != repository). Two ready-to-copy workflow templates ship under `extensions/spec-kit-docguard/templates/github-workflows/`: `docguard-guard.yml` (mandatory CI gate) and `docguard-autofix.yml` (PR auto-fix). Full recipe matrix in the new `docs-canonical/CI-RECIPES.md`.
- **K-2: `docguard upgrade` command + post-guard schema-behind nudge.** New `docguard upgrade` checks installed CLI vs latest npm version (3-second-timeout fetch, fails open if offline) and project schema vs `CURRENT_SCHEMA_VERSION`. Flags: `--check-only` (exit 1 if behind, for CI), `--apply` (runs `npm i -g docguard-cli@latest` and migrates `.docguard.json`). `docguard guard` now appends a yellow `↑` nudge when the project's schema is behind. Aliased as `docguard update`.
- **K-3: `.docguardignore` template at init (S-5).** New gitignore-style file (`one pattern per line, # comments`) merged into `config.ignore` at config-load time so every validator honors it. `docguard init` drops a starter `.docguardignore` covering common build outputs, generated code, and lock files. Loader (`loadDocguardIgnore`) + merger (`mergeIgnoreFile`) live in `cli/shared-ignore.mjs` — missing/unreadable file is a no-op.
- **K-4: Per-validator severity overrides in `.docguard.json` (S-6).** New `severity` map: `{ severity: { todoTracking: "high", freshness: "low" } }`. `'high'` promotes that validator's warnings to fail-CI status (exit 1). `'low'` demotes them to info (no exit-code effect). `'medium'` (default) keeps existing exit-2 behavior. Display is unchanged — severity only affects CI. New `data.effectiveErrors` and `data.effectiveWarnings` fields in the JSON output reflect the severity-aware counts. The CLI prints a one-line note when overrides shifted the exit code.
- **K-5: Pre-commit lite mode (S-9).** `docguard guard --changed-only` runs only the 3 fastest, highest-signal validators: Docs-Sync + Environment + API-Surface. Designed to complete in under 2 seconds for husky/lefthook pre-commit hooks. Validator list exported as `CHANGED_ONLY_VALIDATORS` for tooling. Recipe 5 in CI-RECIPES documents the integration.
- **K-6: Sweep-needed nudge from Freshness counters (S-2).** When 2+ canonical docs are stale (10+ commits since last update), the guard footer now emits a single `↻` line recommending `docguard sync --write` to refresh all code-truth sections in one pass. Aggregates individual freshness warnings into one actionable recommendation. Suppressed in `--format json` mode.
- **K-7: Cross-Reference validator (S-8) — 21st validator.** New `Cross-Reference` validator scans canonical docs for cross-references (markdown links like `[text](./OTHER.md#section)` and intra-doc anchors `#anchor`) and warns when they don't resolve. Extracts headings and computes GFM-compatible slugs. Skips external URLs (http/https/mailto), code-fenced examples, inline backtick code, and non-markdown link targets. URL-decodes anchors before comparison so `%EF%B8%8F`-encoded variation selectors resolve. Caught **14 broken refs in our own README** during the dry-run (4 remain after slugifier fixes — those are real bugs for a future doc cleanup PR).
- **Antigravity / Kiro / Windsurf / GEMINI signal aliases (also in v0.11.2).** `cli/ensure-skills.mjs` detects these agent ecosystems via additional signal files. Doc-only mention here for visibility — code shipped in v0.11.2.

### Changed

- **Schema bumped from 0.4 → 0.5.** Migration is purely additive: `severity: {}` field appears on existing configs. Run `docguard upgrade --apply` to migrate (or hand-edit). The post-guard nudge fires until you do.
- **`docguard init` writes schema version `0.5`** with an empty `severity: {}` block and now also creates `.docguardignore`.
- **`docguard guard` JSON output** includes new fields: `effectiveErrors`, `effectiveWarnings`, and per-validator `severity`.

### Fixed

- **Docs-Coverage Check 5 silent-fail** (also in v0.11.2) — recommended README sections no longer bump `total` without emitting a message. Now a true bonus: present = +1, missing = no-op.
- **Papercut #1 — `upgrade` missed pre-0.4 schemas.** A `.docguard.json` that exists but has no `version` field (the 2024-era format used by `an enterprise client project`, with `project` instead of `projectName`) was silently treated as "no config". Now: `readProjectSchemaVersion` returns the sentinel `'0.0'` for pre-0.4 schemas, and the migration registry has a `0.0 → 0.4` recipe that renames `project → projectName` while stamping the version. The user-facing label is friendlier too ("pre-0.4 (no version field)" instead of "Schema 0.0").
- **Papercut #2 — `--format json` was unparseable.** The banner and `ensureSkills` install message wrote to stdout BEFORE the JSON body, so `JSON.parse` failed on every consumer. New `jsonMode` + `headless` detection in `main()` skips both for `--format json`, `--write`, `--check-only`, and `--changed-only`. Affects every Action recipe using `format: json` (Score-on-PR was broken).
- **Papercut #3 — auto-fix Action counted CLI side effects as "fixes".** `ensureSkills` writes to `.agent/`, `.specify/`, `commands/` on first run; the Action's `git status --porcelain` diff was treating those as mechanical fixes and committing them. Two-part fix: (1) the new headless-mode skips `ensureSkills` so the side effects don't appear, and (2) the Action's bash filter excludes `.agent/`, `.specify/`, `commands/`, `.docguard/`, `.wolf/`, `.claude/` from the changed-files detection as belt-and-suspenders.
- **Papercut #4 — slugifier didn't match GitHub's GFM.** The Cross-Reference validator's first iteration false-positived on every emoji-prefixed heading (`## ⚡ Quick Start` → GitHub produces `#-quick-start` with a leading dash, but my code produced `#quick-start`). Also collapsed `--` to `-` which GitHub keeps. Three bugs fixed; tests now lock in GFM compatibility for emoji-prefixed headings and stripped-punctuation cases.

### Internal

- 6 new test files: `tests/upgrade.test.mjs` (12 tests), `tests/docguardignore.test.mjs` (11 tests), `tests/severity.test.mjs` (9 tests), `tests/changed-only.test.mjs` (4 tests), `tests/sweep-nudge.test.mjs` (3 tests), `tests/cross-reference.test.mjs` (22 tests). **Total: 400 tests passing (was 339, +61 new).**
- Cross-Reference validator added (21 total validators, up from 20). Metrics-Consistency picked up the new count and `fix --write` auto-bumped 8 doc references from "20 validators" → "21 validators" in one pass — eating our own dogfood.
- Dry-run on `an enterprise client project` (read-only) before push surfaced the 4 papercuts above. All fixed in this release.
- New modules: `cli/commands/upgrade.mjs`, `loadDocguardIgnore` + `mergeIgnoreFile` exports in `cli/shared-ignore.mjs`, `CURRENT_SCHEMA_VERSION` + `SEVERITY_LEVELS` + `resolveSeverity` + `compareVersions` + `parseVersion` exports in `cli/shared.mjs`, `CHANGED_ONLY_VALIDATORS` + `liteValidatorsConfig` in `cli/commands/guard.mjs`.
- New docs: `docs-canonical/CI-RECIPES.md` (5 recipes + permissions cheatsheet + full action inputs/outputs reference).
- `action.yml` grew from 166 → 323 lines (+157) with the auto-commit/comment flow.
- No new NPM runtime dependencies. Still zero deps. Node 18+ for built-in `fetch` (used by `upgrade` to check the npm registry).

### Out of scope (deferred to v0.13)

- **Phase L (sync intelligence)**: S-1 `sync --since` surgical refresh (currently only reports diff as context), S-2 sweep-needed nudge from freshness counters, S-3 `trace --reverse` (code → doc-section map), S-4 rename detection via `git log --follow`.
- **Phase M (bigger validators)**: S-7 generated-doc-in-draft staleness validator, S-8 cross-reference validator (broken `§X` anchors), S-10 `.docguard/fixed.json` memory of past fixes.
- **K-5 enhancement**: scope each lite-mode validator to changed files only (currently the 3 validators run against the whole repo — fast enough but not optimal). Tracked for v0.13.

## [0.11.2] - 2026-05-25

Patch release addressing the four bugs (B-1..B-4) reported from the v0.11.1 audit of `an enterprise client project` (score 98/100, 572/575 passed, 1 warning), plus Antigravity/Kiro/Windsurf agent-routing aliases and a Docs-Coverage silent-fail fix that the new B-4 nudge itself exposed.

### Fixed
- **B-1: Vite intrinsics no longer reported as user env vars.** `grepEnvUsage` in `cli/shared-source.mjs` now skips `DEV`, `PROD`, `MODE`, `BASE_URL`, and `SSR` on `import.meta.env.*` — these are injected by Vite at build time, not user-configured. Real user vars like `VITE_API_URL` are still captured. (Reported by an enterprise client project v0.11.1 audit.)
- **B-2: `docguard diff` Data Entities now uses real exported names, not file basenames.** Previously the entity diff walked filenames and reported the stem (e.g. `models.py` → "models"), missing all the actual classes inside. Now uses `scanSchemasDeep` — the same code-side scanner the rest of DocGuard uses — which extracts real Pydantic/Dataclass/Mongoose/Prisma/Zod/Sequelize/Sqlx/SQLAlchemy/JPA entity names. (Reported by an enterprise client project v0.11.1 audit.)
- **B-3: Literal `` `VITE_` `` prefix in prose no longer captured as an env var name.** Tightened the env-var name regex across `shared-source.mjs`, `validators/environment.mjs`, and `commands/diff.mjs` from `[A-Z][A-Z0-9_]*` to `[A-Z][A-Z0-9_]*[A-Z0-9]` (must end with letter/digit, not underscore). Documentation like ``All vars start with `VITE_` (Vite convention)`` no longer triggers a "missing `VITE_`" warning. (Reported by an enterprise client project v0.11.1 audit.)
- **B-4 nudge surfaced: Docs-Coverage Check 5 (`checkReadmeSections`) silent-fail fixed.** The "recommended sections" loop bumped `total` without emitting a message when missing — exactly the anti-pattern B-4 flags. Recommended sections are now a true bonus: present = +1 to both passed/total, missing = no-op. Restores honest scoring on the README checker. (Found by the B-4 nudge running on the an enterprise client project fixture.)

### Added
- **B-4: `--show-failing` flag and validator-bug nudge.** `docguard guard --show-failing` shows warnings/errors for every non-passing validator even if the overall status would have suppressed them. New nudge fires when a validator has `passed < total` but emits no warning or error messages — points at a likely silent-fail validator bug for the user to file an issue. (Reported by an enterprise client project v0.11.1 audit.)
- **Antigravity / Kiro / Windsurf / GEMINI agent signals.** `cli/ensure-skills.mjs` now detects these agent ecosystems via additional signal files (`.agents`, `.antigravity`, `ANTIGRAVITY.md`, `.kiro`, `.windsurf`, `GEMINI.md`) so the right skills are installed for each. Antigravity was already wired via `.agents → agy`; this expands the alias surface so neither side-by-side IDEs nor Spec Kit's `.agents` convention break detection.

### Internal
- New test file: `tests/patch-0.11.2.test.mjs` with regression coverage for B-1 (Vite intrinsics skip), B-2 (Pydantic class names, not file basename), and B-3 (literal `VITE_` not captured). **Total: 339 tests passing (was 336, +3 new).**
- No new NPM dependencies. Zero schema or config-file changes. Bumped `pyproject.toml` from `0.11.0 → 0.11.2` to re-sync the PyPI publish (the previous patch released to npm but skipped PyPI version bump).

### Out of scope (deferred to v0.12)
- S-1 (`sync --since` surgical refresh), S-2 (sweep-needed nudge from freshness counters), S-3 (`trace --reverse` code→doc map), S-4 (rename detection via `git log --follow`), S-5 (`.docguardignore` template at init), S-6 (per-validator severity in `.docguard.json`), S-7 (generated-doc-in-draft staleness validator), S-8 (cross-reference validator for broken `§X` anchors), S-9 (pre-commit lite on changed files only), S-10 (`.docguard/fixed.json` memory of past fixes).

Credit: feedback from running v0.11.1 on the `an enterprise client project` enterprise monorepo (audit score 98/100, 572/575 passed).

## [0.11.1] - 2026-05-25

Patch release addressing false positives surfaced by the v0.11.0 audit of the `an enterprise client project` enterprise monorepo, generalized into a multi-tool IaC detector, plus several DocGuard self-audit improvements. Spec: `specs/003-v011-false-positives/`.

### Fixed
- **Docs-Sync no longer misclassifies frontend API clients as backend routes.** Dropped the ambiguous bare `'api'` from the route-directory convention list. `src/api/client.ts` (frontend axios) and similar are no longer scanned as Express/Next.js routes (FP-1). For Next.js App Router (`src/app/api`, `app/api`), only files matching the strict `route.{ts,tsx,js,jsx,mjs}` filename convention are counted — helper files in the same tree are skipped (FR-001, FR-002).
- **Test files are no longer flagged as undocumented services or routes.** The docs-sync route and service loops now skip paths under `__tests__/` and filenames matching `*.{test,spec}.{ts,tsx,js,jsx,mjs,py,java,go}` (FP-2, FR-003, FR-004). Eliminates ~7 spurious warnings per monorepo with co-located tests.
- **Build outputs no longer flagged as undocumented source.** Added `cdk.out`, `out`, `.nuxt`, `.claude` to the docs-coverage `IGNORE_DIRS` set (FP-3, FR-005).
- **`config.ignore` is now honored by Docs-Coverage's source-directory scan** (FP-3, FR-006 / IR-5). Closes a long-standing inconsistency where other validators respected the user's ignore but the source-dir scan did not. Patterns like `**/cdk.out/**` now match the directory itself as well as files inside it.
- **Worktree copies no longer double-counted.** `globMatch` in `cli/shared-ignore.mjs` now rejects paths under `.claude/worktrees/`, `.git/worktrees/`, and `.jj/` at any depth — same treatment as `node_modules` (FP-4, FR-007). Affects every Claude-Code project using parallel-agent worktrees.
- **Check 1 (config files) no longer flags build-cache dotdirs as undocumented configs.** Now skips directories — `.nuxt`, `.claude`, etc. are excluded by `IGNORE_DIRS` for the source-dir scan instead.
- **Check 1 (config files) now honors `config.ignore` too.** Originally fixed only for the source-directory scan; a follow-up audit reproduced the same FP-3 class with `.local` in `ignore` still being flagged. Both Docs-Coverage scans now call `shouldIgnore(entry, config) || shouldIgnore(entry + '/', config)`. Closes FR-015 (audit-confirmed gap).
- **Test-Spec validator parses multi-path Journey rows correctly.** Previously a Journey cell like `` `path/a.test.ts`, `path/b.test.ts` `` was stripped of all backticks then `existsSync()`d as one string — a 100% false-positive rate on multi-path rows. Now: split on commas outside backticks, strip backticks per segment, evaluate each independently. Row passes if ANY referenced file has evidence. Glob entries (`foo_*.test.ts`) are expanded; `(N suites)` / `(N tests)` annotations are accepted as the author's explicit coverage claim. Closes FP-6 and FR-016.
- **TODO-Tracking validator no longer false-positives on its own keyword list.** Previously the regex matched `TEMP(?!late|orar)` inside its own source. Two-part fix: (1) match restricted to text following a comment marker (`//`, `#`, `/*`, `<!--`, block `*`), (2) the validator skips its own source file (`cli/validators/todo-tracking.mjs`) since the docstring legitimately names the keywords.
- **TODO-Tracking validator no longer false-positives on test fixture strings.** Test files commonly contain `// TODO:` inside template literals (`writeFileSync(..., '// TODO:')`) that single-line heuristics can't distinguish from real comments. Test files are now skipped by default; opt back in with `config.todoTracking.includeTestFiles = true`.
- **Traceability validator's own fixtures no longer leak as orphan refs.** `tests/traceability.test.mjs` previously contained literal `REQ-001`/`REQ-002`/`REQ-003` strings that the validator scanned and reported as orphaned test references. Fixtures now build the IDs from parts so the validator's pattern doesn't match.

### Added
- **Multi-tool IaC detector + consolidated documentation reminder.** New `cli/scanners/iac.mjs` identifies projects shipping any of: **AWS CDK** (`cdk.json`), **Terraform** (`*.tf` files), **Pulumi** (`Pulumi.yaml`), **AWS SAM** (`template.yaml` with `AWS::Serverless::`), and **Serverless Framework** (`serverless.yml`). When an IaC project's ARCHITECTURE.md has no Infrastructure heading, DocGuard emits ONE actionable warning per detected tool naming the marker file location and the expected source layout — instead of multiple generic per-directory warnings (FR-009, FR-010, FR-011). The generic per-dir warnings inside IaC packages (`bin/`, `lib/`, `modules/`, `stacks/`, `constructs/`, `handlers/`, etc.) are suppressed in favor of these consolidated messages. The legacy `cli/scanners/cdk.mjs` is preserved as a thin re-export for backward compatibility.
- **`## Infrastructure (IaC)` section in `templates/ARCHITECTURE.md.template`.** New projects initialized via `docguard init` start with placeholder tables for AWS CDK, Terraform, and Pulumi/SAM/Serverless layouts plus a Deployment Pipeline subsection (FR-012). Explicitly skippable for non-IaC projects via a header comment.
- **`DEFAULT_IGNORE_DIRS`** exported from `cli/shared-ignore.mjs` — canonical shared ignore set covering build outputs (`dist`, `build`, `out`, `cdk.out`, `target`, `.gradle`), VCS internals (`.git`, `.jj`, `.hg`, `.svn`), package caches (`node_modules`, `vendor`, `.venv`, `__pycache__`), and framework synth outputs (`.next`, `.nuxt`, `.turbo`, `.vercel`, `.cache`, `.svelte-kit`) (FR-008). Added `target` (Rust/Java), `.gradle`, and `.svelte-kit` per the updated an enterprise client project audit. Available for any future validator to import; existing per-validator `IGNORE_DIRS` sets are left in place (deferred migration).

### Changed
- **DocGuard package version bumped to 0.11.1** across `package.json` and all `extensions/spec-kit-docguard/` files (extension.yml + 5 SKILL.md files were referencing stale `v0.9.9`/`v0.10.0`).
- **`docs-canonical/ARCHITECTURE.md`** updated to add `cli/writers/` and `cli/shared-*.mjs` to the Component Map and Layer Boundaries — closes a real doc gap surfaced by dogfooding (the writers/ directory has shipped for several releases without being documented).
- **`specs/003-v011-false-positives/plan.md`** restructured to match the spec-kit `plan-template.md` shape (added Summary, Technical Context, Constitution Check, Project Structure sections). `tasks.md` rewritten with the spec-kit phased T### convention.

### Internal
- New test files: `tests/cdk-detection.test.mjs` (CDK + multi-tool IaC detector tests + `globMatch` worktree rejection + `DEFAULT_IGNORE_DIRS` shape). Existing test suites extended with regression cases for FP-1..FP-5, TODO-tracking false-positive guards, and IaC-tool detection across Terraform/Pulumi/SAM/Serverless. New tests are annotated with `// @req FR-NNN` / `// @req SC-NNN` comments for traceability. **Total: 329 tests passing (was 306, +23 new).**
- **DocGuard self-audit improvements**: ran `docguard guard` on the repo as part of this release. Warnings dropped from **57 → 15** across the session by fixing real drift (stale extension versions, missing `cli/writers/` mention, traceability gaps) and reducing self-referential false positives (TODO validator scanning its own keyword list).
- **Round 2 fixes after a second audit report**: FP-3 part B (`checkConfigFiles` honoring `config.ignore`), FP-6 (Test-Spec multi-path Journey row parsing with glob and `(N suites)` annotation support), additional `DEFAULT_IGNORE_DIRS` entries for Rust/Java/SvelteKit. **Total tests passing: 336** (was 306).
- No new NPM dependencies. Zero schema or config-file changes.

### Out of scope (deferred to v0.12)
- Feature requests IR-1..IR-4, IR-6..IR-8 (per-validator severity, `--diff-only`, draft-staleness warning, `sync --section`, `.docguardignore` template at init, extended Next.js detection, `routesGlob`/`servicesGlob` overrides). IR-5 (honor ignore in source-dir scan) shipped as part of this release alongside FP-3.
- Migrating all 17 modules that define their own `IGNORE_DIRS` constant to import `DEFAULT_IGNORE_DIRS` — mechanical, large diff, tracked separately.
- Multi-line string-literal detection in TODO-Tracking — current heuristic still false-positives on `// TODO:` inside multi-line template literals. Workaround: keep test files out of TODO scanning (now default) or use `config.todoIgnore` globs.

Credit: feedback from running v0.11.0 on the `an enterprise client project` enterprise monorepo (audit score 98/100, 40 warnings).

## [0.11.0] - 2026-05-22

This release reshapes DocGuard from a documentation linter into an **AI-readable, always-current project memory builder** — for any language project, not just JS/web. The four-mode lifecycle (`generate → guard → sync → fix`) is now coherent end-to-end.

### Added — AI-powered Generate
- **`docguard generate --plan`** — the "killer feature" from the v2 vision, now real. Scans any project (JS/TS, Python, Rust, Go, Java/Kotlin, Ruby, PHP, C#; polyglot/monorepo-aware) and emits a **structured agent task manifest** + writes the code-truth skeleton inside `<!-- docguard:section -->` markers. The AI agent writes the prose grounded in scanned facts; human writing is preserved.
- **`--plan --format json`** machine-readable manifest for agent consumption.
- **`--plan --write`** scaffolds the skeleton docs (code sections filled, prose sections as agent-task placeholders).
- Language-aware doc set: a Rust CLI gets ARCHITECTURE; a webapp gets ARCHITECTURE + API-REFERENCE + SCREENS + FEATURES + INTEGRATIONS + ENVIRONMENT + docs-implementation/{KNOWN-GOTCHAS,CURRENT-STATE,RUNBOOKS}.

### Added — Always-up-to-date Sync
- **`docguard sync`** — refreshes `source=code` doc sections in place when code changes. Mechanical, idempotent, **preserves human prose**. Flags the prose sections to review when their adjacent code changed.
- `--since <ref>` adds git-diff context. `--write` applies; default is a dry-run preview. `--force` overrides the `docguard:generated` marker gate.

### Added — Section-addressable docs
- **`cli/writers/sections.mjs`** — marker format `<!-- docguard:section id=X source=code|human -->`. `parseSections` / `replaceSection` / `upsertSection` for surgical regen that never clobbers human prose. The keystone the rest of the program builds on.

### Added — Language-agnostic project intelligence
- **`cli/scanners/project-type.mjs`** detects every ecosystem from manifests: `package.json`, `pyproject.toml`/`requirements.txt`/`setup.py`/`Pipfile`, `Cargo.toml`, `go.mod`, `pom.xml`/`build.gradle`, `Gemfile`, `composer.json`, `*.csproj`. Polyglot-aware: returns each ecosystem's language, framework, kind, deps, entry points.
- **Multi-language route scanners** in `routes.mjs`: Spring Boot (Java/Kotlin, class-level base + verb annotations), Rails (verb DSL + `resources` 7-action expansion), Go (Gin/Echo/Chi/Fiber/mux), Rust (Axum, Actix, Rocket).
- **Multi-language schema/model scanners** in `schemas.mjs`: Python (SQLAlchemy + relationships + Pydantic/SQLModel), Rust Diesel `table!`, Go structs with `json`/`gorm`/`db` tags, Java/Kotlin JPA `@Entity`, Rails ActiveRecord `create_table` migrations.

### Added — Deep frontend capture
- **`cli/scanners/frontend.mjs`** captures the UI surface: screens/routes (React Router, Next App + Pages with wrapper-unwrapping), components, **state stores** (Zustand/Redux Toolkit/Jotai/MobX), **custom hooks** (incl. `export { X as useY }` aliases), **React Contexts**, **API-client→endpoint mapping** (axios/fetch/custom client), and **i18n keys** (used vs. defined in locale files, with missing-keys reported as drift).

### Added — External integrations
- **`cli/scanners/integrations.mjs`** — 30+ SDK registry covering Cloud (AWS, GCP, Azure, Cloudflare), Databases, Payments (Stripe/Braintree), Auth (Auth0/Clerk/NextAuth/Cognito), AI (OpenAI/Anthropic/LangChain), Messaging (Twilio/SendGrid/Slack/MessageBird), Observability (Sentry/Datadog/OpenTelemetry), Search, Queues, Storage. Surfaces as `INTEGRATIONS.md` in the memory plan.

### Added — Mechanical fix registry
- **`cli/writers/mechanical.mjs`** generalizes `docguard fix --write` into a deterministic, no-LLM applier covering: `remove-endpoint` (API-Surface), `replace-count` (Metrics-Consistency stale "N validators"), `replace-version` (Metadata-Sync stale refs — only in actionable contexts, never prose), `insert-changelog-unreleased`.
- Validators emit structured `fixes[]` arrays surfaced through `guard --format json`, `diagnose --format json`, and applied by `fix --write` / `diagnose --auto`. The 9 previously detect-only validators now have real `FIX_INSTRUCTIONS` routes (no more generic "Manual review needed").

### Added — Spec Kit extension parity
- New extension commands: `extensions/spec-kit-docguard/commands/fix.md`, `commands/sync.md`. `generate.md` updated to document `--plan`.
- New skill: `extensions/spec-kit-docguard/skills/docguard-sync/SKILL.md` — teaches the agent the refresh-and-review-prose loop. Extension README modernized to the memory-first vocabulary.

### Changed
- **PHILOSOPHY.md rewritten** from v1 governance-first ("not machine-generated") to the v2 memory-first reality (generate + guard + sync, bidirectional, language-agnostic). Honest about what the tool actually does.
- **`docguard score`** displays **`Memory: Completeness X% · Accuracy Y%`** derived from the existing category scores; `--format json` adds `memory.{completeness, accuracy}` and per-category `axis` field. No weight changes.
- CLI `--help` reframed around the memory lifecycle (audit/generate/guard/sync).

### Fixed
- Tightened a self-inflicted false positive (a literal `TODO` in a generate.mjs placeholder string was tripping DocGuard's own TODO-Tracking validator).
- Fixed several scanner bugs caught by new tests: React Router wrapper-component unwrapping (`<RequireAuth><XPage/>`), Next.js base-path double-append, Go single-line struct regex, Spring Boot `@RequestMapping` class-level vs method-level disambiguation, locale-dir deduplication.

### Infrastructure
- CI: bumped `actions/checkout` and `actions/setup-node` to `@v5` across all four workflows (ahead of the June 2026 Node 24 default).

### Tests
- **Tests: 175 → 285 (+110)**. New test files: `api-doc`, `api-surface`, `shared-source`, `guard-classify`, `monorepo-scanning`, `sections`, `frontend`, `frontend-deep`, `i18n`, `project-type`, `memory-plan`, `integrations`, `routes-multilang`, `schemas-multilang`, `mechanical`, `api-write`, `multi-spec`, `sync`. All green.

## [0.10.0] - 2026-05-22

### Added
- **API-Surface validator** (`cli/validators/api-surface.mjs`) — compares endpoints documented in `docs-canonical/API-REFERENCE.md` against the project's real API surface (OpenAPI spec, monorepo-aware code route scan). Flags documented-but-deleted endpoints (HIGH/error when confirmed by a spec; warning on heuristic code-scan) and present-but-undocumented endpoints (warning). Brings the validator count to **20**.
- **`N/A` result state** in `guard` — a validator that finds nothing to check now renders a neutral `➖ [N/A]` with a reason instead of a misleading green ✅. "Nothing to check" is no longer indistinguishable from "checked and clean". Exposed via `classifyResult()`; surfaced in text, `--format json`, `diagnose`, and `ci`.
- **`cli/shared-source.mjs`** — monorepo-aware source resolution honoring `config.sourceRoot`, npm `workspaces`, and `pnpm-workspace.yaml`: `resolveSourceRoots()`, `collectPackageJsons()`, `detectDocker()`, `grepEnvUsage()`.
- **`cli/scanners/api-doc.mjs`** — robust API-REFERENCE.md parser (headings + table rows) with path normalization (`:id ≡ {id}`, strips backticks/pipes/trailing slashes) and exact-match endpoint comparison.
- **`docguard fix --doc api-reference`** — generates an AI prompt to reconcile API-REFERENCE.md with the real API surface.
- **39 new tests** (api-doc, api-surface, shared-source, monorepo-scanning, guard-classify). Total: **214**.

### Changed
- **Monorepo awareness across validators** — `schema-sync`, `docs-coverage`, `docs-sync`, `test-spec`, `metadata-sync`, and test-file discovery now honor `config.sourceRoot`/workspaces instead of hardcoded root-relative paths. Previously these silently passed on monorepos whose code lives under e.g. `backend/src`.
- **Environment validator now checks code truth** — compares documented env vars against actual `process.env` / `import.meta.env` usage (`.env.example` counts as documentation), replacing the prior section-heading-presence heuristic.
- **Test-Spec verifies files, not glyphs** — a Source-to-Test/Journey row passes only if the referenced test file actually exists; the author-typed ✅ is no longer trusted as proof of coverage.
- **Changelog validator** now implements the documented staged-change check: warns when staged code files exist but `CHANGELOG.md` is not staged (git-aware; N/A otherwise).
- **`Drift` validator renamed to `Drift-Comments`** to clarify it checks `// DRIFT:` comment ↔ DRIFT-LOG.md bookkeeping, not doc/code drift. Config key (`drift`) is unchanged.
- **Doc Sections** uses anchored heading matching instead of substring (no longer satisfied by a table-of-contents link or code block).

### Fixed
- **`guard` no longer reports a confident green ✅ for checks that validated nothing** — removed hand-rolled `passed=1/total=1` auto-passes in `drift`, `architecture`, `test-spec`, and `security` (empty scan).
- **Eliminated false positives** that previously masked real drift: tech-stack/env-var "documented but not found" on monorepos, parser-garbage "data entities" (`table`, `index`, `foreign`), the greedy route regex emitting `/api/` + stray backticks, and the test-file path/basename and glob-pattern mismatches ("N documented but not found"). Documented endpoints/tests that genuinely no longer exist are now reported as real drift.
- **Security scan** anchored to a scanned-file count — an empty scan now warns ("no source files were scanned") instead of reporting a false "no secrets" pass.

## [0.9.11] - 2026-03-18

### Added
- **`globMatch()` in `shared-ignore.mjs`** — Purpose-built positive file matching with hardcoded `node_modules` exclusion at any depth. Distinct from `buildIgnoreFilter()` (which is for ignore/skip filtering).
- **6 new tests** — `globMatch` node_modules rejection (2), valid path matching (1), multi-pattern (1), CI detection (1), function load (1). Total tests: 46.

### Fixed
- **Docs-Diff no longer scans `node_modules` for test files** — `getTestFilesFromPatterns()` now uses `globMatch()` instead of repurposing `buildIgnoreFilter()`. The `**` glob no longer matches through `node_modules/` directories.
- **CI detection supports enterprise systems** — `calcTestingScore()` now recognizes `buildspec.yml`, `amplify.yml`, `Jenkinsfile`, `.circleci/config.yml`, `.gitlab-ci.yml`, `.travis.yml`, and `turbo.json` with a `"test"` task.
- **Multi-pattern test resolution works correctly** — `testPatterns` array resolves files from all patterns with proper deduplication via Set.

## [0.9.10] - 2026-03-18

### Added — Unified Ignore System & Scorer Alignment
- **`cli/shared-ignore.mjs`** — New shared ignore utility with `buildIgnoreFilter()` and `shouldIgnore()`. All validators now share consistent glob matching for `config.ignore`, `securityIgnore`, and `todoIgnore`.
- **`testPatterns` config** — New array field in `.docguard.json` for multiple test location patterns. Backward-compatible: `testPattern` (string) auto-normalizes to `testPatterns` (array).
- **7 new tests** — Shared ignore utility (4 unit tests), securityIgnore integration (1), placeholder exclusions (1), testPatterns config (1). Total tests: 40.

### Fixed
- **`securityIgnore` globs now functional** — Security validator reads and applies `securityIgnore` patterns from `.docguard.json`. Previously, all ignore config was silently discarded. (Bug #1)
- **`todoIgnore` globs now functional** — TODO-tracking validator reads and applies `todoIgnore` patterns. (Bug #2)
- **Docs-Diff no longer scans `node_modules`** — Test file discovery uses `testPatterns` config and shared ignore filter instead of unchecked recursive walk. (Bug #3)
- **Testing score reflects co-located tests** — `calcTestingScore()` now detects `__tests__/` under `backend/`, `server/`, `packages/` in addition to `src/`. Also checks `testPatterns` config. (Bug #4 & #5)
- **Security score aligns with guard** — `calcSecurityScore()` now runs `validateSecurity()` inline and deducts points for findings. 100% security score is no longer possible when guard reports secret detections. (Bug #6)
- **Placeholder/example values not flagged** — Security scanner skips AWS example keys (`AKIAIOSFODNN7EXAMPLE`), HTML `placeholder=` attributes, OpenAPI `example:` blocks, and `password123` test fixtures. (Bug #7)
- **ROADMAP.md matching improved** — TODO-tracking now matches full text + file location context instead of a 30-char substring. (Bug #8)
- **Architecture respects `ignore` array** — Architecture validator filters files through `config.ignore` before building import graph. (Bug #9)

### Changed
- **Constitution v1.0.0 → v1.1.0** — Principle IV updated: validators MAY import shared utility modules for infrastructure (file walking, ignore filtering). Commands MAY compose validator results.
- **Security scoring weights** — Redistributed from 30/20/20/15/15 to 25/15/15/10/10/25 (25 pts now from actual secret scanning).
- **Testing suggestion** — Context-aware: suggests `testPatterns` config instead of "Add tests/ directory" when co-located tests exist.
- **`findColocatedTests()`** — Source roots expanded: `backend/`, `server/` added alongside `src/`, `app/`, `lib/`, `packages/`, `modules/`.

## [0.9.9] - 2026-03-17

### Added — Extension-First Architecture & Spec-Kit Integration Gate

#### Spec-Kit Integration Gate
- **`ensureSpecKit()`** — Runs on every command. Auto-initializes spec-kit when `specify` CLI is available. Shows a prominent yellow-box reminder every time when spec-kit is not installed (persistent, no dismiss).
- **`detectAIAgent(projectDir)`** — Maps 12 filesystem signals to spec-kit `--ai` flag values: `.cursor/` → `cursor-agent`, `.claude/` or `CLAUDE.md` → `claude`, `.gemini/` → `gemini`, `.agents/` → `agy` (Antigravity), `.github/copilot-instructions.md` → `copilot`, `.windsurf/` → `windsurf`, `.codex/` → `codex`, `.roo/` → `roo`, `.amp/` → `amp`, `.kiro/` → `kiro-cli`, `.tabnine/` → `tabnine`. Falls back to `--ai generic` when no agent detected.
- **Strong init push** — `docguard init` now shows a prominent red-bordered box when spec-kit is missing, listing exactly what users miss: 9 AI skills, constitution, SDD workflow, agent detection. Provides both `uv` and `pip` install commands.
- **Guard footer reminder** — `docguard guard` shows a 1-line spec-kit install nudge after results when not initialized.
- **Skill auto-update** — `ensureSkills()` now compares installed SKILL.md `docguard:version` against package version. Automatically overwrites stale skills on DocGuard update.

#### LLM-First Output
- **`detectAgentMode(projectDir)`** — Returns `'llm'` or `'cli'` based on filesystem signals and `.specify/init-options.json`. All adaptive commands check this.
- **`diagnose.mjs`** — All `FIX_INSTRUCTIONS` now include `llmCommand` fields (e.g., `/docguard.fix --doc architecture`). Issue collection propagates `llmCommand` to output. Remediation plan, verification checklist, and debate prompts all adapt to agent mode.
- **`guard.mjs`** — "Next step" hint now shows `/docguard.diagnose` in LLM mode.
- **`init.mjs`** — Next steps show skill commands (`/docguard.guard`, `/docguard.fix`) in LLM mode, CLI commands (`docguard diagnose`) in CLI mode.
- **`setup.mjs`** — Next steps adapt to agent mode.

#### Spec-Kit Skill Chaining
- **`docguard-guard` SKILL.md** — Now chains to `/speckit.specify`, `/speckit.plan`, `/speckit.clarify`, and checks `constitution.md`.
- **`docguard-review` SKILL.md** — Offers spec-kit skills for specification-level issues.
- **`extension.yml`** — Declares `framework: spec-kit` and `specify` as optional tool.

### Fixed
- **`npx docguard guard`** → `npx docguard-cli guard` — The npm package name is `docguard-cli`, not `docguard`. Fixed in `hooks.mjs`, `setup.mjs`, `fix.mjs`, `docguard.mjs` (pre-existing bug).
- **Hardcoded `--ai agy`** → Dynamic `detectAIAgent()` — `init.mjs` and `setup.mjs` no longer hardcode Antigravity as the agent.
- **`llmCommand` never propagated** — `collectIssues()` in `diagnose.mjs` was not copying `llmCommand` from `FIX_INSTRUCTIONS` to issue objects, so LLM-first fix hints silently fell back to CLI commands.
- **Debate prompt not LLM-aware** — `outputDebatePrompt()` now receives `agentMode` and adapts verification commands.
- **Basic-tier checklist hardcoded** — Verification checklist for basic-tier agents now adapts to LLM/CLI mode.
- **Stale "Zero dependencies" doc comments** — Updated 6 files to "Zero NPM runtime dependencies" matching the constitution.
- **Platform-aware `--script`** — `specify init` now uses `--script ps` on Windows, `--script sh` on Unix.

### Changed
- **Constitution** — Principle II amended from "Zero Dependencies" to "Zero NPM Runtime Dependencies" (spec-kit is a framework convention, not a code dependency).
- **SKILL.md metadata** — All 4 skills updated from `0.9.5`/`0.9.8` to `0.9.9`. Added `docguard:version` comment for auto-update mechanism.
- **`ensure-skills.mjs`** — Full rewrite: 6 exports (`ensureSkills`, `ensureSpecKit`, `detectAgentMode`, `detectAIAgent`, `getDetectedAgent`, `isSpecKitAvailable`, `isSpecKitInitialized`).
- **22 files changed**, +567/−203 lines.

## [0.9.6] - 2026-03-14

### Added — Enterprise AI Skills Architecture

#### AI Skills (Spec Kit Extension)
- **4 enterprise-grade SKILL.md files** modeled after spec-kit's AI behavior protocol pattern:
  - `docguard-guard` (155 lines) — 6-step execution with severity triage matrix, structured reporting
  - `docguard-fix` (195 lines) — 7-step research workflow with per-document codebase research, 3-iteration validation loops
  - `docguard-review` (170 lines) — Read-only semantic cross-document analysis with 6 analysis passes
  - `docguard-score` (165 lines) — CDD maturity assessment with ROI-based improvement roadmap
- Skills differ from commands: commands tell agents **what to run**, skills tell agents **how to think, validate, and iterate**

#### Bash Orchestration Scripts
- `common.sh` — Shared utilities (root detection, CLI detection, JSON helpers)
- `docguard-check-docs.sh` — Discover project docs, return JSON inventory with metadata
- `docguard-suggest-fix.sh` — Run guard, parse results, output prioritized fixes as JSON
- `docguard-init-doc.sh` — Initialize canonical doc with metadata header and template

#### Workflow Chaining & Hooks
- All 10 commands upgraded with YAML `handoffs` for workflow chaining (guard → fix → review → score)
- 3 spec-kit workflow hooks: `after_implement` (mandatory guard), `before_tasks` (optional review), `after_tasks` (optional score)
- `extensions.yml` template for spec-kit hook registration

#### Extension Structure
- `extension.yml` updated with `skills`, `scripts`, and `hooks` sections
- Extension README rewritten with complete skills, scripts, hooks, and workflow documentation
- `extensions/` directory now included in npm package (`package.json` files array)

## [0.9.5] - 2026-03-14

### Added — Spec Kit Alignment (Mega Release)

#### Spec Kit Scanner Rewrite
- **Correct file paths**: Now checks `.specify/specs/NNN-feature/spec.md` (v3+ standard) with fallback to legacy `specs/*/spec.md`
- **Constitution detection**: Checks `.specify/memory/constitution.md` (v3+) with fallback to root `constitution.md`
- **Spec quality validation**: Validates mandatory sections (User Scenarios, Requirements, Success Criteria), FR-IDs, SC-IDs per spec-kit spec-template.md
- **Plan quality validation**: Checks for Summary, Technical Context, Project Structure sections
- **Tasks quality validation**: Verifies phased breakdown (Phase 1, 2+) and T-xxx task IDs
- **Informational warning**: Spec-Kit validator now suggests `specify init` when no spec-kit artifacts found (was silent `0/0`)

#### Traceability Enhancement
- **SC-xxx** (Success Criteria) added to requirement ID patterns — aligns with spec-kit SC-001 format
- **T-xxx** (Task IDs) added — recognizes spec-kit T001, T002 task identifiers
- Scans `.specify/specs/` path in addition to legacy `specs/`

#### Slash Commands (Spec Kit Extension)
- New `commands/` directory with 4 AI agent slash commands: `/docguard.guard`, `/docguard.review`, `/docguard.fix`, `/docguard.score`
- Shipped as part of npm package — available via `specify extension add docguard`
- Works with Claude Code, Copilot, Cursor, Gemini, Antigravity, and more

#### REQUIREMENTS.md Template
- New `REQUIREMENTS.md.template` aligned with spec-kit FR-xxx, SC-xxx, Given/When/Then standards
- Added to `docguard init` template catalog (defaultYes: true)

#### Python Support (PyPI)
- `pyproject.toml` and `docguard_cli/wrapper.py` for `pip install docguard-cli`
- Thin Python wrapper delegates to `npx docguard-cli` — requires Node.js 18+
- Python developers can now use `docguard guard`, `docguard score`, etc.

### Fixed
- `speckit.mjs` writeFileSync → safeWrite (backup safety, same as v0.9.4 pattern)

## [0.9.4] - 2026-03-13

### Fixed — Critical: Generate File Safety (Data Loss Prevention)
- **`diagnose --auto` no longer passes `--force` to `generate`**: This was the root cause of silent doc overwriting. `diagnose --auto` now only creates missing files, never overwrites existing ones.
- **`.bak` backup on `--force`**: When `generate --force` is explicitly used, all existing files are backed up as `.bak` before being overwritten. Content is never permanently lost.
- **`--force` warning banner**: Shows how many existing files will be overwritten before proceeding.
- **`safeWrite()` helper**: All 9 write operations in generate now go through a single safety wrapper.

## [0.9.3] - 2026-03-13

### Changed — Prose-Only Extraction Engine (Breaking improvement)
- **`extractProse()` replaces `stripMarkdown()`**: Instead of stripping markdown and measuring residue (where table cells became "146-word sentences"), the new engine identifies and extracts only actual prose paragraphs. Reference docs (mostly tables/code) with <50 words of prose skip readability scoring entirely.
- **Technical vocabulary normalization**: 80+ tech terms (DynamoDB, WebSocket, middleware, TypeScript, etc.) are treated as simple 2-syllable words for Flesch scoring. Known terms don't penalize readability.
- **Markdown-aware sentence detection**: File paths (`src/auth.ts`), version numbers (`v0.9.2`), URLs, and abbreviations (`e.g.`, `i.e.`) no longer cause false sentence splits.
- **Relaxed thresholds for technical docs**: Flesch 30→15, grade 16→18, sentence length 25→30, passive voice 20→25%, negation 15→20%.
- **Impact**: Doc-Quality scores improved from 81% (13/16) to 95% (38/40) on DocGuard itself. API reference docs that scored 0/100 now skip gracefully or score fairly.

## [0.9.2] - 2026-03-13

### Fixed
- **Flesch readability false positives**: Improved `stripMarkdown()` to remove mermaid diagrams, HTML tags, definition-style lines, and lines with >60% special characters. Docs with tables no longer score 0/100.
- **Flesch threshold**: Lowered from 30→20 for technical documentation — developer docs inherently score lower than prose.
- **NUL file on macOS**: `findUnderstandingCli()` used Windows `2>NUL` redirect which created a stray `NUL` file on Mac/Linux. Now uses platform-specific `which`/`where`.
- **Unused import**: Removed `mkdirSync` from `diagnose.mjs` (was imported but never used).

### Verified
- `diagnose` is read-only by default — file creation only happens with explicit `--auto` flag.
- `metrics-consistency` properly reads `.docguardignore` patterns.

## [0.9.1] - 2026-03-13

### Fixed
- **Test detection**: `calcTestingScore` now detects co-located tests in `src/`, `app/`, `lib/`, `packages/`, `modules/` — not just top-level `tests/` directories. Projects using `src/**/__tests__/` or `src/**/*.test.*` patterns now score correctly.
- **Test-spec fallback**: Validator fallback check now scans for co-located test files and checks vitest/jest config presence.
- **Vitest config support**: Score calculation now reads `vitest.config.ts`/`jest.config.ts` include patterns to detect custom test directories.

## [0.9.0] - 2026-03-13

### Added
- **Doc Quality Validator** — 8 deterministic writing quality metrics (passive voice, readability, atomicity, sentence length, negation/conditional load). Inspired by IEEE 830/ISO 29148.
- **Understanding Integration** — Optional deep scan via the [Understanding](https://github.com/Testimonial/understanding) CLI for full 31-metric doc quality analysis. Runs automatically when `understanding` CLI is installed, providing actionable insights alongside DocGuard's native 8 metrics. Credit: Testimonial/understanding project.
- **Spec Kit Integration** — Auto-detects [Spec Kit](https://github.com/github/spec-kit) projects (`.specify/`, `specs/`, `constitution.md`, `memory/`), maps Spec Kit artifacts to CDD canonical docs, and supports `docguard generate --from-speckit` for one-command conversion. Validates spec.md requirement IDs trace to tests. Credit: GitHub Spec Kit framework.
- **Requirement Traceability (V-Model)** — scans docs for requirement IDs (REQ-001, FR-001, US-001, etc.) and validates they trace to test files. Opt-in by convention: just add IDs and DocGuard auto-enforces. Inspired by [spec-kit-v-model](https://github.com/leocamello/spec-kit-v-model) and IEEE 1016.
- **TODO/FIXME Tracking** — detects untracked code annotations and skipped tests without explanation. Inspired by [spec-kit-cleanup](https://github.com/dsrednicki/spec-kit-cleanup).
- **Schema Sync Validator** — detects database models from 7 ORM frameworks (Prisma, Drizzle, TypeORM, Sequelize, Knex, Django, Rails) and validates they're documented in DATA-MODEL.md.
- **`docguard llms` command** — generates `llms.txt` from canonical docs following the [llms.txt standard](https://llmstxt.org/) (Jeremy Howard, Answer.AI, 2024).
- **ALCOA+ Compliance Scoring** — maps existing validators to the 9 FDA data integrity attributes (Attributable, Legible, Contemporaneous, Original, Accurate, Complete, Consistent, Enduring, Available). Always shown in `docguard score` output with per-attribute evidence, gaps, and fix recommendations.
- **`enterprise-ai` profile** — EU AI Act Annex IV compliance profile with stricter freshness (14-day threshold), required DATA-MODEL.md, and Risk Assessment section in SECURITY.md.
- **OpenAPI cross-check** — if route files and an OpenAPI spec exist, validates routes have matching paths in the spec. Warns to re-run spec generator if out of sync.

### Changed
- Validator count: 14 → 18 validators, 108 → 130+ automated checks
- `docguard score` now always shows ALCOA+ compliance breakdown

## [0.8.2] - 2026-03-13

### Added
- **Docs-Coverage Validator** — detects undocumented code features: config files on disk, code-referenced configs (resolve/existsSync calls), source dirs not in ARCHITECTURE.md, README section completeness per Standard README spec.
- **Metadata-Sync Validator** — cross-checks package.json version against extension.yml and markdown file references; context-aware matching (URLs, install commands, YAML only).
- **Metrics-Consistency Validator** — catches stale hardcoded numbers in docs ("92 checks" when actual is 114); requires 2+ digit numbers and negative lookbehind for ratio patterns.
- **`.docguardignore` support** — per-project file exclusions (like `.gitignore`), parsed by `loadIgnorePatterns()` in `shared.mjs`, integrated with Metrics-Consistency and Metadata-Sync validators.

### Fixed
- **Co-located test detection** — `generate` now recursively scans `src/**/__tests__/` and `*.test.*`/`*.spec.*` files; reads `vitest.config.ts`/`jest.config.ts` for custom patterns.
- **Test files as source files** — test files are now filtered out of all source lists (services, routes, models, components, middlewares) before mapping.
- **Diagnose suggest-only** — `diagnose` no longer auto-creates files by default; pass `--auto` to enable auto-fix. Shows actionable suggestions when not in auto mode.
- **Diagnose score cap** — target score in AI prompt now capped at 100 (was showing 105/100).

### Changed
- **Guard checks** — increased from 86 to 114 with 5 new validators (docs-coverage, metadata-sync, metrics-consistency, docs-diff, freshness).
- **Validators** — increased from 9 to 14.

## [0.8.0] - 2026-03-13

### Added
- **Docs-Diff Validator** — New validator checks for entity/route/field drift between code and canonical docs. Integrated into `guard` and `diagnose` runs.
- **File Existence Checks** — `test-spec` validator now verifies that source files and test files referenced in the Source-to-Test Map actually exist on disk (catches stale references).
- **Dynamic Score Suggestions** — Score output now shows specific, AI-actionable suggestions per doc (e.g., "TEST-SPEC.md: missing section: ## Coverage Rules → Run `docguard fix --doc test-spec`") instead of generic advice.
- **Recommended Test Patterns** — TEST-SPEC.md template now includes guidance on config-awareness tests, regression guards, edge cases.
- **Mermaid Diagram** — ARCHITECTURE.md now includes a visual architecture diagram.

### Fixed
- **Scoring: Config-Awareness** — `calcEnvironmentScore` and `calcSecurityScore` now respect `needsEnvExample: false` — CLI projects no longer penalized for missing `.env.example`.
- **Scoring: node:test Recognition** — `calcTestingScore` now checks `.docguard.json` `testFramework` and `package.json` scripts for `node --test`, giving full marks for built-in test runners.
- **Scoring: Fake Bonus Removed** — Removed `docguard:version` metadata bonus from `calcDocQualityScore` — it was inflating scores by awarding points for a non-existent feature.
- **Circular Dependencies** — Extracted `c` (colors) and `PROFILES` into new `cli/shared.mjs`, breaking 14 circular import cycles between `docguard.mjs` and all command files.
- **CI Workflow** — Fixed failing CI by removing deleted `audit` command steps, adding `--force` to interactive `init`, and adding `diagnose` step.

### Changed
- **`audit` command** — Now an alias for `guard` (old `audit.mjs` deleted).
- **Architecture + Security validators** — Enabled by default in `.docguard.json`.
- **Guard checks** — Increased from 52 to 86 with all validators enabled.
- **Test suite** — 30 → 33 tests, including config-awareness and regression guards.

## [0.7.3] - 2026-03-13

### Added
- **Spec-Kit Extension** — DocGuard is now available as a GitHub Spec Kit community extension. 6 commands registered (`guard`, `diagnose`, `score`, `trace`, `generate`, `init`) with `after_tasks` hook for automatic validation. Located in `extensions/spec-kit-docguard/`.

## [0.7.2] - 2026-03-13

### Added
- **Config-aware traceability** — `guard`, `diagnose`, and `trace` now respect `.docguard.json` `requiredFiles.canonical`. Excluded docs are skipped entirely.
- **Orphan detection** — Warns when files exist in `docs-canonical/` but are excluded from config, with actionable cleanup instructions: "Delete them or add to .docguard.json".

### Fixed
- Trace no longer hardcodes all 6 docs — only evaluates what the user's config requires.

## [0.7.1] - 2026-03-13

### Added
- **Traceability Validator** — New `validateTraceability` runs automatically in `guard` and `diagnose`. Checks that each canonical doc (ARCHITECTURE, DATA-MODEL, TEST-SPEC, SECURITY, ENVIRONMENT) has matching source code artifacts. Reports PARTIAL/UNLINKED/MISSING coverage.
- **DocGuard in Generated Tech Stacks** — `docguard generate` now always includes DocGuard in the Documentation Tools table of generated ARCHITECTURE.md.

### Fixed
- **Guard warnings resolved** — TEST-SPEC.md `watch.mjs` partial coverage justified with ISO 29119 §7.2; DRIFT-LOG.md populated with template-string entries.
- **Test file regex** — `.test.mjs` and `.spec.mjs` files now match in traceability and trace commands.
- **51 guard checks** (was 46) — all passing on DocGuard itself.

## [0.7.0] - 2026-03-13

### Added
- **Quality Labels in Guard** — Each validator now displays `[HIGH]`, `[MEDIUM]`, or `[LOW]` quality labels for actionable triage. Inspired by CJE quality stratification (Lopez et al., TRACE, IEEE TMLCN 2026).
- **Standards Citations in Generated Docs** — All 6 generated canonical docs now include a standards reference footer citing the governing industry standard (arc42/C4, ISO 29119, OWASP ASVS, OpenAPI 3.1, 12-Factor App). Inspired by RAG-grounded standards alignment (Lopez et al., AITPG, IEEE TSE 2026).
- **`docguard trace` Command** — New requirements traceability matrix generator. Maps canonical docs ↔ source code ↔ tests with TRACED/PARTIAL/UNLINKED/MISSING coverage signals. Supports `--format json`.
- **`docguard score --signals` Flag** — Multi-signal quality breakdown showing per-signal contribution bars with quality labels. Inspired by CJE composite scoring.
- **`docguard diagnose --debate` Flag** — Multi-perspective AI prompts using three-agent Advocate/Challenger/Synthesizer pattern. Inspired by AITPG multi-agent role specialization and TRACE adversarial debate.
- **Agent-Aware Prompt Complexity** — `diagnose` auto-detects AI agent tier from AGENTS.md and adjusts prompt verbosity (concise for advanced models, step-by-step for smaller models). Inspired by CJE equalizer effect (Lopez et al., TRACE 2026).
- **Research & Academic Credits** — Added full IEEE-style citations for AITPG and TRACE papers, ORCID, and concept attribution table to CONTRIBUTING.md. Added research credits to README.md and academic foundations to PHILOSOPHY.md.

### Changed
- **15 commands total**: added `trace` (alias: `traceability`)
- **Version bump**: 0.6.0 → 0.7.0

## [0.6.0] - 2026-03-13

### Added
- **Doc Tool Detection** — `generate` now detects 8 existing doc tools (OpenAPI, TypeDoc, JSDoc, Storybook, Docusaurus, Mintlify, Redocly, Swagger). Built-in YAML parser for OpenAPI specs (zero deps). Leverages existing tools instead of replacing them.
- **Deep Route Scanning** — Parses actual route definitions from source code across 6 frameworks: Next.js (App Router + Pages Router), Express, Fastify, Hono, Django, FastAPI. OpenAPI-first: uses spec if available, falls back to code scanning.
- **Deep Schema Scanning** — Parses schema definitions from 4 ORMs: Prisma (fields, types, relations, enums), Drizzle, Zod, Mongoose. Generates mermaid ER diagrams automatically.
- **`API-REFERENCE.md` Generator** — New canonical doc generated from deep route scanning. Groups endpoints by resource, shows auth status, handler names, and per-endpoint parameter/response tables.
- **`docguard publish --platform mintlify`** — Scaffolds Mintlify v2 docs from canonical documentation. Generates `docs.json`, `introduction.mdx`, `quickstart.mdx`, and maps all canonical docs to `.mdx` pages with proper frontmatter.
- **AGENTS.md Standard Compliance** — Enhanced AGENTS.md template with Permissions & Guardrails section, Monorepo Support, Safety Rules, and `agents.md` standard tags.
- **Scanner Modules** — New `cli/scanners/` directory with `doc-tools.mjs`, `routes.mjs`, `schemas.mjs`.

### Changed
- **ARCHITECTURE.md** — Now arc42-aligned (all 12 sections: §1-§12) with C4 Model mermaid diagrams (Level 1 Context, Level 2 Container), Runtime View sequence diagrams, Deployment View, and Glossary.
- **DATA-MODEL.md** — Enhanced with field-level detail from ORM parsing (types, required, PK/UK, defaults), relationship tables, enum sections, and auto-generated mermaid ER diagrams.
- **Dynamic Version** — Banner and `--version` now read from `package.json` (no more stale hardcoded version strings).
- **Version bump**: 0.5.2 → 0.6.0
- **14 commands total**: added `publish` (alias: `pub`)

## [0.5.0] - 2026-03-13

### Added
- **`docguard diagnose`** — The AI orchestrator. Chains guard→fix in one command. Runs all validators, maps every failure to an AI-actionable fix prompt, and outputs a complete remediation plan. Three output modes: `text` (default), `json` (for automation), `prompt` (AI-ready). Alias: `dx`.
- **`guard --format json`** — Structured JSON output for CI/CD and AI agents. Includes profile, validator results, and timestamps.
- **Compliance Profiles** — Three presets (`starter`, `standard`, `enterprise`) that adjust required docs and validators. Set via `--profile` flag on init or `"profile"` in `.docguard.json`.
- **`score --tax`** — Documentation tax estimate: tracks doc count, code churn, and outputs estimated weekly maintenance time with LOW/MEDIUM/HIGH rating.
- **`init --profile starter`** — Minimal CDD setup (just ARCHITECTURE.md + CHANGELOG) for side projects.
- **GitHub Actions CI template** — Ships in `templates/ci/github-actions.yml`, ready-to-use workflow.
- **`watch --auto-fix`** — When guard finds issues, auto-outputs AI fix prompts.
- **Init auto-populate** — After creating skeletons, outputs `docguard diagnose` prompt instead of manual instructions.
- **Guard → Diagnose hint** — Guard output now prompts `Run docguard diagnose` when issues exist.

### Changed
- **Guard refactored**: `runGuardInternal()` extracted for reuse by diagnose, CI, and watch (no subprocess needed).
- **CI rewritten**: Uses `runGuardInternal` directly instead of spawning subprocess. Includes profile and validator data in JSON.
- **Watch rewritten**: Uses `runGuardInternal` (no process.exit killing the watcher). Proper debounced re-runs.
- **Version bump**: 0.4.0 → 0.5.0
- **13 commands total**: audit, init, guard, score, diagnose, diff, agents, generate, hooks, badge, ci, fix, watch
- **30 tests** across 17 suites (up from 24/14)

## [0.4.0] - 2026-03-12

### Added
- **`docguard badge`** — Generate shields.io CDD score badges for README (score, type, guarded-by)
- **`docguard ci`** — Single command for CI/CD pipelines (guard + score, JSON output, exit codes)
- `.npmignore` for clean npm publish
- `--threshold <n>` flag for minimum CI score enforcement
- `--fail-on-warning` flag for strict CI mode
- npm publish dry-run in CI workflow on tag push

### Changed
- Score command refactored with `runScoreInternal` for reuse by badge/ci
- CI workflow now runs actual test suite + dogfoods DocGuard on itself
- 10 total commands (audit, init, guard, score, diff, agents, generate, hooks, badge, ci)

## [0.3.0] - 2026-03-12

### Added
- **`docguard hooks`** — Install pre-commit (guard), pre-push (score enforcement), and commit-msg (conventional commits) git hooks
- **GitHub Action** (`action.yml`) — Reusable marketplace action with score thresholds, PR comments, and fail-on-warning support
- **Import analysis** in architecture validator — Builds full import graph, detects circular dependencies (DFS), auto-parses layer boundaries from ARCHITECTURE.md
- **Project type intelligence** — Auto-detect cli/library/webapp/api from package.json
- `.docguard.json` with `projectTypeConfig` (needsE2E, needsEnvVars, etc.)
- 15 real tests covering all commands (node:test)

### Changed
- Architecture validator now auto-detects layer violations from ARCHITECTURE.md (no config needed)
- Validators respect projectTypeConfig — no false positives for CLI tools

### Fixed
- Environment validator no longer warns about .env.example for CLI tools
- Test-spec validator no longer warns about E2E journeys for CLI tools

## [0.2.0] - 2026-03-12

### Added
- **`docguard score`** — Weighted CDD maturity score (0-100) with bar charts, grades A+ through F
- **`docguard diff`** — Compares canonical docs against actual code (routes, entities, env vars)
- **`docguard agents`** — Auto-generates agent-specific config files for Cursor, Copilot, Cline, Windsurf, Claude Code, Gemini
- **`docguard generate`** — Reverse-engineer canonical docs from existing codebase (15+ frameworks, 8+ databases, 6 ORMs)
- **Freshness validator** — Uses git commit history to detect stale documentation
- **Full document type registry** — All 16 CDD document types with required/optional flags and descriptions
- 8 new templates: KNOWN-GOTCHAS, TROUBLESHOOTING, RUNBOOKS, VENDOR-BUGS, CURRENT-STATE, ADR, DEPLOYMENT, ROADMAP

### Fixed
- Diff command false positives — entity extraction no longer picks up table headers

## [0.1.0] - 2026-03-12

### Added
- Initial release of DocGuard CLI
- `docguard audit` — Scan project, report documentation status
- `docguard init` — Initialize CDD docs from professional templates
- `docguard guard` — Validate project against canonical documentation
- 9 validators: structure, doc-sections, docs-sync, drift, changelog, test-spec, environment, security, architecture
- 8 core templates with docguard metadata headers
- Stack-specific configs: Next.js, Fastify, Python, generic
- Zero dependencies — pure Node.js
- GitHub CI workflow (Node 18/20/22 matrix)
- MIT license

### Fixed
- Added missing tests for the `watch` CLI command to verify it runs and reacts properly.
