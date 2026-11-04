# Feature Specification: A Release Is Compared With the Previous Release, Finding by Finding, Before It Ships

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-02

**Status**: Draft

**Spec ID**: `docguard.release-trend-gate`

**Lineage**: Ninth feature of the DocGuard × AI-DLC program (issue 607).
- It extends `docguard.non-regression-budgets` (spec 031), which compares a pull request with its base on one runner for wall time, self-guard errors, agent-facing bytes and package weight.
- It extends the precision benchmark gate (spec 007), which compares the corpus with the reviewed baseline.
- It automates the hermetic A/B that maintainers run by hand before a release (one fresh copy per CLI, serial, findings compared as a multiset).

**Input**: The AWS AI-DLC lite sample gates every release on a comparison with the *previous release*, not the previous commit. Its gate fails on a lower contract-test pass rate, new unit-test failures, or a quality score more than 0.02 below the last release. DocGuard compares a PR with its base, which catches one change at a time. The weekly scheduled release batches many changes, and nothing compares the candidate with what users run today. Each of these is reviewed today only by a maintainer, by hand:
- findings that disappear, which may be fixed false positives or lost recall;
- findings that appear, which may be new detection or new noise;
- exit codes that change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every finding change between releases is explained (Priority: P1)

As a maintainer cutting a release, I see every finding the candidate adds or removes compared with the last release. The release fails unless the changelog names each code whose findings changed.

**Independent Test**: Two CLI trees (the previous tag and the candidate) run over the frozen fixture corpus, where the candidate adds one PSR002 finding.

**Acceptance Scenarios**:

1. **Given** a candidate that adds a PSR002 finding and a changelog that never mentions PSR002, **Then** the gate fails and names the fixture, the code, the location and the message.
2. **Given** the changelog section being released names PSR002, **Then** the gate passes and lists the change as explained.
3. **Given** an exit code that changes on any fixture, **Then** the gate fails unless the changelog contains `Exit codes:` describing it.

### User Story 2 - The budgets compare with the previous release too (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a release run, **Then** `tools/budget.mjs ab` runs with the previous release's tree as base, and its usual thresholds apply.
2. **Given** a first release (no previous tag), **Then** the gate is skipped with a notice. It is not passed silently.

### User Story 3 - The precision benchmark compares with the released baseline (Priority: P2)

**Acceptance Scenarios**:

1. **Given** the candidate's benchmark run, **Then** it is compared with the baseline file as of the previous release tag. Any new false positive, new false negative or new supported-case abstention fails the gate, as spec 007 already defines against the committed baseline.

### Edge Cases

- **Nondeterministic findings** (timing, dates): the comparison uses the stable fingerprint (`docguard.baseline-stable-fingerprint`) without the advisory tail. A code listed in `release-gate.json` `volatileCodes`, with a reason, is compared by count only.
- **History-dependent validators**: fixtures are fresh `git init` copies with one commit, so history checks behave the same for both CLIs.
- **Runtime**: the corpus is the repository's committed tree (`git archive HEAD`), `benchmarks/fixtures/*` and `benchmarks/agent-context/fixtures/*`. No network.
- **Self-reference**: in the repository itself, DocGuard's own docs state the candidate's counts (MET001, CSY002, CSY004, SSY002), so the previous CLI disagrees with them by design. That entry's `ignoreCodes` names each one with its reason.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: New `tools/release-ab.mjs` MUST run two CLI trees over every corpus directory, one fresh git-initialized copy per CLI and directory, serially. It MUST record findings (stable fingerprint multiset), validator statuses, verdicts and exit codes. A validator counts as changed only when its status changes, or when both releases report a verdict and the verdicts differ. A release that adds the verdict field changes no answer.
- **FR-002**: It MUST fail when a code's findings changed and the changelog section being released does not mention that code, and when an exit code changed without an `Exit codes:` line in that section. It MUST print every change, explained or not.
- **FR-003**: The release workflow MUST run `release-ab`, `budget.mjs ab` and the benchmark comparison against the previous release tag before publishing, and MUST block the publish on failure. The release's CHANGELOG section is `budget.mjs`'s message file, so a `Budget-Exempt:` line there waives one metric with a reason, as a PR body does.
- **FR-004**: `release-gate.json` MUST list the corpus entries and `volatileCodes`, each with a reason. A corpus entry is a path, or `{ path, ignoreCodes }` for codes that directory cannot judge, each with a reason, and those are listed in the summary rather than hidden. The file MUST be validated by a test.
- **FR-005**: `docs-canonical/CI-RECIPES.md`, `TEST-SPEC.md`, `docs/contributing` (or CONTRIBUTING.md) and `CHANGELOG.md` MUST describe the gate and how to explain a change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each acceptance scenario has a test using two synthetic CLI trees.
- **SC-002**: Run locally between v0.45.2 and this program's head, the gate lists every finding change the program introduced, and each one is explained in the CHANGELOG.
- **SC-003**: The gate adds less than 5 minutes to the release job, as measured in CI.

## Verification Notes

Run locally on 2026-11-03, comparing v0.45.2 with this branch over 14 directories, took 30 s:
- The repository changed. 11 SPK013 and 3 SPK016 findings were added, and the `[Unreleased]` section names both codes. Two MET001 findings were removed, and both are listed as not judged, with their reason.
- The 13 fixtures changed in nothing.
- The gate passed (SC-002).

The first run listed every validator as changed, because v0.45.2 has no `verdict` field. That is why FR-001 compares the verdict only when both releases have one.

SC-003, measured in CI on the v0.46.0 release (2026-11-04):
- **First run** ([41866882356](https://github.com/raccioly/docguard/actions/runs/41866882356)): the gate job stopped the publish, as designed.
  - The trend step passed in 37 s, with every finding change named.
  - The budget step failed: `bytes:mcp:docguard_docs_for_path` was 612 bytes over, against 489 allowed. #608 had exempted it in its PR body, but the release reads the `[0.46.0]` section, which had no exemption. #613 carried the exemption into the release notes.
- **Passing run** ([41872260375](https://github.com/raccioly/docguard/actions/runs/41872260375)): the `release-gate` job took 5 min 10 s (16:55:00–17:00:10), including the budget and precision-benchmark steps.
  - It runs in parallel with the test matrix, and `create-release` waits for both.
  - The slowest test job, Node 24, finished at 17:01:43, and `create-release` started at 17:01:45. So the gate added nothing to the release's wall time, against the 5 minutes allowed.

## Assumptions

- Changelog sections follow Keep a Changelog. "The section being released" is `[Unreleased]` before the version cut, and `[<version>]` after it.
- A code name in the changelog is enough explanation for the gate. Whether the explanation is good is a reviewer's call.

## Out of Scope

- Comparing on private consumer projects (privacy). The manual A/B covers them before a feature merges.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `0460f3b80c6b025f4a68d62d67eeea74ade1db06` — SC-003 measured on the v0.46.0 release: 5m10s in parallel with the test matrix, no wall time added; the gate stopped the first publish on a missing exemption, as designed Evidence: `.github/workflows/release.yml`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/CI-RECIPES.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/TEST-SPEC.md`, `tests/program-verification.test.mjs`, `tests/release-trend-gate.test.mjs`, `tools/release-ab.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
