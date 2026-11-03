# Feature Specification: Every Check Ends in a Verdict, and an Observation It Could Not Make Is Never a Pass or a Finding

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-02

**Status**: Draft

**Spec ID**: `docguard.verdict-contract`

**Lineage**: First feature of the DocGuard × AI-DLC program (issue 607).
- It keeps the decision of `docguard.calibrated-finding-channels` FR-020: `no-matches` is complete coverage, not a gap. A check that found nothing to judge gets its own verdict, `empty`, and never counts as inconclusive.
- It keeps the closed applicability set of `docguard.evidence-scoped-verification` and the per-validator coverage states that `cli/validator-coverage.mjs` reports (`checked`, `partial`, `disabled`, `not-applicable`, `missing-prerequisite`, `unsupported`, `no-matches`, `error`).
- It extends `docguard.unreadable-git-metadata`. That spec covers git being unreadable for the whole run (FR-001 to FR-003). This one covers a single git call failing while git is otherwise readable.
- It applies Constitution IX (Honest Assurance) and the "silent when unknowable" rule of `docguard.calibrated-finding-channels` (FR-021) to helper failures.
- It keeps every `status`, finding and exit code that `docguard.output-ux` and `docguard.compact-guard-response` define.

**Input**: Two observations, one from the field and one from a study of another tool.

1. On 2026-10-12, a guard A/B run on a loaded machine reported 7 PSR002 findings that did not exist. `git check-ignore` failed to spawn, `gitIgnoredPaths()` returned null, and PSR002 then reported every pointer it had not resolved, at high confidence. A quiet rerun reported none of them.
2. A code read while writing this spec found the same shape in `symbolExistsAtRev()`. It returns `false` for any failure, including a `git grep` that could not spawn, so REF001 could report a documented symbol as removed from the code because one grep failed.
3. AWS's AI-DLC sensor contract gives every check one of four results (PASS, FAIL, INCONCLUSIVE, BLOCKED) plus a separate applicability axis. Only a proven NOT_APPLICABLE may bypass a gate, and a check that could not run holds the gate. DocGuard has the applicability axis but no verdict, so a consumer cannot tell "checked and clean" from "nothing to check" from "could not decide".

## Problem

DocGuard reports a validator's `status` (`pass`, `warn`, `fail`, `na`, `skipped`) and, since spec 008, its applicability. Three gaps remain.

- **A helper's failure is read as an answer.** Shared git helpers return `null` when a call fails. Each caller decides what `null` means, and the callers disagree.
  - PSR002 treats a null ignore set as "nothing is ignored" and reports every unresolved pointer.
  - `docsForPath` in `doc-references` (used by `trace`, `impact`, hooks and MCP) treats a null tracked-file list as an empty repository and checks fewer files without saying so.
  - REF001 reads a failed `git grep` as "symbol absent at HEAD".
  - Neither case leaves a trace in the result, so the run looks complete.
- **"Nothing to check" and "could not check" share one status.** A validator that matched no inputs and a validator whose inputs could not be read both render `na`. A consumer gating on DocGuard cannot require "this check actually ran" without parsing reason strings.
- **A crash is labeled a failure.** A validator that throws gets `status: 'fail'` with an `error` applicability. That holds the gate, which is correct, but an agent cannot tell "the docs are wrong" from "DocGuard broke" without parsing the reason.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A failed git call never becomes a finding (Priority: P1)

As a maintainer running guard on a loaded CI runner, I never see a finding that exists only because a git call failed to spawn.

**Why this priority**: False findings at high confidence undo trust in every other finding. This is the observed defect.

**Independent Test**: The PSR002 fixture from the 2026-10-12 incident: an instruction file with pointers to an ignored path and a missing path. Guard runs with a `git` on PATH that fails `check-ignore` and answers every other subcommand.

**Acceptance Scenarios**:

1. **Given** a `git` whose `check-ignore` fails, **When** guard runs, **Then** there is no PSR002 for any pointer whose ignore status was unknown. The Path-Scoped-Rules result has verdict `inconclusive`, applicability `partial`, and an observation gap that names `git check-ignore` and the number of pointers it could not classify.
2. **Given** the same project with a working `git`, **Then** PSR002 reports the missing pointer and not the ignored one, exactly as today.
3. **Given** a `git` whose `ls-files` fails, **When** guard runs, **Then** Path-Scoped-Rules reads the working tree, its result is `partial` with the gap recorded, and no instruction file drops out. `docsForPath` falls back to the working tree the same way.
4. **Given** a `git` whose `grep` fails, **When** Reference-Existence runs on a doc that names a symbol, **Then** there is no REF001 for that symbol, and the result is `inconclusive` with the gap recorded.

### User Story 2 - Every validator result ends in one closed verdict (Priority: P1)

As an agent or CI job consuming `guard --format json`, I read one field to learn whether each check passed, failed, found nothing to judge, could not decide, could not run, or was deliberately skipped.

**Why this priority**: It is the machine contract every later feature uses: the enforcement ladder (spec 083), the AI-DLC sensor (spec 090), and the release trend gate (spec 087).

**Independent Test**: A fixture project that produces each verdict once. Read `guard --format json` and compare each validator's `verdict` and `applicability.class` with a table.

**Acceptance Scenarios**:

1. **Given** a validator that checked inputs and found nothing, **Then** its verdict is `pass` and its applicability class is `applicable`.
2. **Given** a validator with at least one finding, **Then** its verdict is `fail`, whatever its applicability. A real finding outranks a partial view.
3. **Given** a validator that matched no inputs (`no-matches`), for example Drift on a codebase with no `// DRIFT:` comments, **Then** its verdict is `empty` and its class is `unknown`. It is neither a pass nor a gap.
4. **Given** a validator that lacks its document (`missing-prerequisite`) or does not support the project's stack (`unsupported`), and produced no findings, **Then** its verdict is `inconclusive` and its class is `unknown`.
5. **Given** a validator with an observation gap and no findings, **Then** its verdict is `inconclusive` and its applicability is `partial`.
6. **Given** a validator that throws, **Then** its verdict is `blocked`. Its `status` stays `fail` and the exit code is unchanged.
7. **Given** a validator disabled in config (`validators.x: false`) or declared N/A in-repo (`docguard:validator x n/a`), **Then** its verdict is `skipped` and its class is `not-applicable`. This is the only way to reach `skipped`.

### User Story 3 - A team can require that every check actually ran (Priority: P2)

As a team lead, I can make CI fail when any check could not decide, so an unreadable input or an unsupported stack is never mistaken for clean docs.

**Why this priority**: It turns the verdict into a gate. Without it, the verdict is only visible, not enforceable.

**Independent Test**: The fixture from US2 with `guard --fail-on-inconclusive`.

**Acceptance Scenarios**:

1. **Given** any validator with verdict `inconclusive` (or `blocked`) and no error, **When** guard runs with `--fail-on-inconclusive`, **Then** it exits 4 and names each such validator and its reason.
2. **Given** the same project, **When** guard runs without the flag, **Then** the exit code is what 0.45.2 produces.
3. **Given** a clean project whose only non-pass verdicts are `empty` and `skipped`, **When** guard runs with `--fail-on-inconclusive`, **Then** it exits 0.

### User Story 4 - Every output format carries the verdict (Priority: P2)

As an engineer reading SARIF in GitHub code scanning, JUnit in Jenkins, or the MCP guard tool, I see blocked and inconclusive checks as such, not as passes.

**Independent Test**: The US2 fixture in each output format.

**Acceptance Scenarios**:

1. **Given** a blocked validator, **Then** SARIF records a tool execution notification at level `error` and `executionSuccessful: false`, and JUnit records an `<error>` test case.
2. **Given** an inconclusive validator, **Then** SARIF records a `warning` notification with the reason, and JUnit records `<skipped message="…">`.
3. **Given** the MCP guard tool in its compact and full forms, **Then** each validator carries its verdict, and the compact form states each gap reason once.
4. **Given** the human output, **Then** the summary line counts the verdicts, and every inconclusive or blocked validator shows its reason.

### Edge Cases

- **git absent or unreadable for the whole run.** `docguard.unreadable-git-metadata` already reports `missing-prerequisite`. No per-call gap is recorded on top, so one cause is not reported twice.
- **A transient spawn error.** `EAGAIN`, `EMFILE`, `ENFILE` or `ETIMEDOUT` on a git spawn is retried once. A gap is recorded only if the retry also fails.
- **Partial view with real findings.** The findings stay and the verdict is `fail`. The gap still appears in applicability so the reader knows the list may be incomplete.
- **A gap in a helper shared by several validators.** Each validator that consumed the failed call records the gap. A gap is attributed to the validator during whose run it occurred.
- **Post-loop validators** (Canonical-Sync, Metrics-Consistency) get verdicts by the same rules. A crash in them is `blocked`.
- **Parent and child validator keys** (`structure` / `docSections`). Each keeps its own verdict, and the parent's skip or N/A marker applies to the child as it does today.
- **`--compact`** keeps the projection rule: a verdict is a fact stated once per validator, never recomputed.
- **Baseline and suppressions.** A withheld finding never existed, so it is neither baselined nor suppressed. Baseline fingerprints are content hashes and cannot be traced to a validator, so while any gap stands, a baselined fingerprint that went unseen is not reported as safe to drop (`baselineStaleUncertain`), and `--update-baseline` refuses to write a baseline that would lose withheld findings.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every validator result in a guard run MUST carry `verdict`, one of `pass`, `fail`, `empty`, `inconclusive`, `blocked` or `skipped`. It is derived only from the result's own findings (after baseline suppression), applicability and observation gaps, in this order of precedence:
  1. A thrown error (applicability `error`) is `blocked`.
  2. A disabled or declared-N/A check is `skipped`.
  3. Any remaining finding is `fail`.
  4. An observation gap, or an applicability of `partial`, `missing-prerequisite` or `unsupported`, is `inconclusive`. Together with `error` these are the incomplete-coverage states of `docguard.calibrated-finding-channels` FR-020; gaps are added.
  5. An applicability of `no-matches` is `empty`.
  6. Otherwise the result is `pass`.

  The verdict describes the check, not the gate. A finding that the enforcement config lowers to `info` still makes the verdict `fail`, and the exit code still follows enforcement.
- **FR-002**: Every validator result's `applicability` MUST carry `class`, one of `applicable`, `not-applicable` or `unknown`. `checked` and `partial` map to `applicable`; `disabled` and `not-applicable` map to `not-applicable`; `no-matches`, `missing-prerequisite`, `unsupported` and `error` map to `unknown`. `status`, `reason` and the existing state names MUST be unchanged.
- **FR-003**: Only a result whose class is `not-applicable` MAY have verdict `skipped`. A check MUST NOT reach `skipped` by finding no inputs.
- **FR-004**: The guard run MUST keep a per-run observation ledger. A shared helper that fails to observe something while git is readable MUST record a gap in it, naming the operation, the cause (git's first error line or the spawn error code) and the scope affected (a count, or the paths when there are few). This covers a git subprocess that cannot spawn, exits outside its documented codes, or times out. A helper's documented "no answer" for a legitimate state (not a repository, a ref that does not exist) is not a gap.
- **FR-005**: Each validator's result MUST include the gaps recorded during its run. A validator with at least one gap MUST report applicability `partial` (unless a more specific state applies) with a reason that names the gap.
- **FR-006**: A validator MUST NOT report a finding whose truth depends on an observation that failed. In particular, PSR002 MUST NOT report a pointer whose ignore status git could not determine, and REF001 MUST NOT report a symbol whose presence at HEAD or at the doc's revision git could not determine. Each MUST count what it withheld in the gap, and MUST still report what it could determine. `symbolExistsAtRev` MUST distinguish "no match" (exit 1) from "no answer".
- **FR-007**: A consumer of a tracked-file list that falls back to the working tree when git fails MUST record the gap and check the working-tree files. It MUST NOT continue with an empty list. This applies to `doc-references`, `doc-deps`, `doc-ownership` and `anchors`.
- **FR-008**: Every call site, in `cli/validators/` and `cli/scanners/`, of a shared git helper that can return no answer MUST be listed in a reviewed inventory with its handling: records a gap, falls back with a gap, or legitimately silent with a reason. A test MUST fail when a call site is added that the inventory does not list.
- **FR-009**: A git spawn that fails with `EAGAIN`, `EMFILE`, `ENFILE` or `ETIMEDOUT` MUST be retried once before a gap is recorded. No other failure is retried.
- **FR-010**: A validator that throws MUST keep `status: 'fail'`, its `error` applicability and its current exit code effect, and MUST carry verdict `blocked`.
- **FR-011**: `guard --fail-on-inconclusive` MUST exit 4 when no error is present and any validator's verdict is `inconclusive` or `blocked`. `empty` and `skipped` MUST NOT trigger it. Exit 4 is a new code, distinct from 2 (warnings), so a pipeline that tolerates warnings can still fail on an undecided check. It outranks warnings, and an error still exits 1 (3 when uninitialized). The run MUST name each triggering validator with its reason. Without the flag, exit codes MUST be unchanged. `ci --fail-on-inconclusive` MUST block readiness with the reason `CI_INCONCLUSIVE_BLOCKED` and exit 1, as `--fail-on-warning` does there. The GitHub Action input `fail-on-inconclusive` MUST pass the flag and fail the step on exit 4.
- **FR-012**: Guard JSON MUST carry a run-level `verdicts` summary with a count per verdict, and the full list of gaps with the validator each belongs to. The compact form MUST state each validator's verdict and each distinct gap reason once.
- **FR-013**: SARIF output MUST record each `blocked` validator as a tool execution notification at level `error`, and each `inconclusive` validator at level `warning` with its reason. `executionSuccessful` MUST be `false` when any validator is `blocked`. `pass`, `fail`, `empty` and `skipped` produce no notification; a `fail` is already reported through its results.
- **FR-014**: JUnit output MUST render `blocked` as an `<error>` test case, `inconclusive` and `empty` as `<skipped message="…">` with the reason, and `skipped` as `<skipped/>`. `pass` and `fail` MUST render as today.
- **FR-015**: Human output MUST print one summary line counting the verdicts, and MUST print the reason for every `inconclusive` and `blocked` validator without `--verbose`. `empty` keeps today's dim N/A line.
- **FR-016**: Every finding and result that 0.45.2 reports with a working git MUST be reported unchanged. The verdict and applicability class fields MUST be additive in every format.
- **FR-017**: `docs-canonical/DATA-MODEL.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `docs/reference/` (CLI and output formats), `action.yml`, the Spec Kit extension's guard command, and `CHANGELOG.md` MUST describe the verdict, the class, the ledger and the new flag.

### Key Entities

- **Verdict**: The closed outcome of one validator in one run: `pass`, `fail`, `empty`, `inconclusive`, `blocked` or `skipped`. It is derived, never configured.
- **Applicability class**: A coarse grouping of the existing applicability states into applicable, not-applicable and unknown. It is the axis that decides whether a skip is legitimate.
- **Observation gap**: A record that a helper could not observe something. It holds the operation, the cause, the affected scope and the validator in whose run it occurred. It lives for one run and is never persisted.
- **Observation ledger**: The per-run collection of gaps that guard brackets around each validator.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The 2026-10-12 PSR002 reproduction, run against a git that fails `check-ignore`, reports 0 PSR002 findings and 1 recorded gap. On 0.45.2 it reports one PSR002 for every unresolved pointer. A positive control with a working git reports the same findings on both versions.
- **SC-002**: Each of the six verdicts is produced by a fixture and asserted in the JSON, compact JSON, SARIF, JUnit and human output. That is 30 assertions, all passing.
- **SC-003**: The call-site inventory covers 100% of shared git helper call sites in `cli/validators/` and `cli/scanners/`, and the guard test fails on an unlisted call site.
- **SC-004**: A hermetic guard A/B (0.45.2 against this change, one fresh `git archive` copy per CLI, run serially on a quiet machine), on this repository and on every local project, shows no added, removed or changed finding. The only differences are the new fields.
- **SC-005**: A fault-injection run with `check-ignore` and `ls-files` failing produces no new findings on any of those projects. Every validator affected is `inconclusive` or `fail`, never `pass`.
- **SC-006**: On this repository, `guard --fail-on-inconclusive` passes. Each validator that is inconclusive today is resolved either by a reasoned N/A declaration that is true (for example, API-Surface on a CLI with no HTTP API) or by fixing its input. No declaration hides a check that applies.

## Assumptions

- The verdict is derived per validator, not per finding. A finding already carries severity, confidence and disposition. A per-finding verdict would duplicate them.
- `empty` is a verdict of its own, and does not count as `inconclusive`. On this repository, Drift (no `// DRIFT:` comments) and Diff-Suspicion (no code change in range) are `no-matches`, and both did their job completely. Folding them into `inconclusive` would force false N/A declarations, which is what Constitution IX forbids. Spec 013 FR-020 reached the same conclusion. AI-DLC's rule, that only a proven NOT_APPLICABLE may bypass a gate, still holds: `empty` keeps applicability class `unknown`, and a blocking rule in spec 083 can choose to hold on it.
- Simulating a failing git by putting a stub `git` first on `PATH` is a sufficient test seam. Production code gets no test-only switches.
- Retrying once is enough to absorb the load-induced spawn errors observed (`docguard-ab-hermetic` notes). A second failure is a real gap.

## Out of Scope

- Changing any score formula. Score continues to use `status`. The enforcement ladder (spec 083) decides how verdicts gate per rule.
- Gaps from non-git sources (parser timeouts, unreadable files). The ledger accepts them, but only git helpers are instrumented here. Other sources are added where later specs touch them.
- A verdict per finding, or per evidence declaration (evidence keeps the states of `docguard.evidence-scoped-verification`).
- Persisting gaps across runs.
