# Feature Specification: Required Checks and Evidence-Based Rule Promotion

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-02

**Status**: Draft

**Spec ID**: `docguard.enforcement-ladder`

**Lineage**: Second feature of the DocGuard × AI-DLC program (issue 607).
- It extends `docguard.verdict-contract` (spec 081). A required check uses the verdict and the exit code 4 that spec 081 introduced.
- It keeps the enforcement model that guard already has: `severity.<validator>` (`high`, `medium`, `low`), `findingSeverity.<CODE>`, intrinsic errors, and per-code default levels (`codeDefaultLevel`).
- It extends the run history of `docguard ci` (`.docguard/history.jsonl`, `docguard.read-only-commands` FR-005) with per-code counts.

**Input**: AI-DLC binds each sensor to a stage with a `default_severity` of advisory or blocking. A blocking sensor holds the gate unless it ran and passed, and only a proven NOT_APPLICABLE may bypass it. The AWS collaborative sample adds a strictness ladder: a new structural rule is advisory until the team turns it to blocking by config, once compliance supports it. DocGuard already lets a team set severity per validator and per code. It lacks two things:
1. A way to say "this check must actually decide". Today a validator that finds no inputs, or cannot observe them, never stops a pipeline, even when the team relies on it.
2. Evidence for when an advisory rule is safe to make blocking. Teams promote rules by guessing, and a premature promotion turns a pipeline red on noise.

## Problem

- **Severity governs findings, not decisions.** `severity.apiSurface: "high"` makes API-Surface warnings fail CI. If API-Surface cannot find the API reference, or the router is unsupported, it reports nothing and CI passes. The strictest setting a team can write leaves the check optional in practice.
- **`--fail-on-inconclusive` is all or nothing.** It holds the gate on every validator that could not decide. A team that depends on three validators must either hold the gate on all of them or on none.
- **No promotion evidence.** Nothing tells a team that a code has been silent for the last N CI runs on their project. That record is exactly what makes it safe to promote that code to blocking. History keeps only totals.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A team names the checks it depends on (Priority: P1)

As a team lead, I list the validators my pipeline relies on. A run in which any of them did not reach a decision fails, while every other validator stays advisory.

**Why this priority**: This is AI-DLC's blocking-sensor rule applied to DocGuard. It is the control a team needs before relying on DocGuard as a gate. The AI-DLC plugin (spec 090) uses it.

**Independent Test**: A fixture whose `.docguard.json` sets `"requiredChecks": ["apiSurface"]`. Run it with and without the API reference document present.

**Acceptance Scenarios**:

1. **Given** `requiredChecks: ["apiSurface"]` and no API reference document, **When** guard runs, **Then** it exits 4 and names API-Surface, its verdict (`inconclusive`) and its reason.
2. **Given** the same project with a matching API reference, **Then** API-Surface passes and the exit code follows the findings as today.
3. **Given** `requiredChecks: ["drift"]` on a codebase with no `// DRIFT:` comments (verdict `empty`), **Then** guard exits 4. Finding nothing does not prove that a required check does not apply. A reasoned `docguard:validator drift n/a` marker, or `validators.drift: false`, makes it `skipped` and the run passes. A required check can be bypassed only by a declaration.
4. **Given** a required validator that is disabled in config, **Then** the run reports the conflict as an error (`REQ001`), because the configuration both requires and disables the check.
5. **Given** a key in `requiredChecks` that names no validator, **Then** guard reports `REQ002` naming the unknown key and the valid keys.

### User Story 2 - Promotion is backed by this project's own history (Priority: P1)

As a maintainer, I ask DocGuard which advisory codes have been silent long enough on my project to promote to blocking, and which blocking codes are noisy enough to reconsider.

**Why this priority**: It turns rule promotion from a guess into a decision backed by recorded evidence, the strictness ladder the AWS sample describes.

**Independent Test**: A history file with eight `ci` entries carrying per-code counts. `docguard policy --format json` reads it.

**Acceptance Scenarios**:

1. **Given** eight recorded runs in which `PSR001` (effective level `warn`) never occurred, and the run before them in which it did, **When** `docguard policy` runs, **Then** PSR001 is listed under "ready to promote", with its run count and the `findingSeverity` line that would promote it.
2. **Given** a code at effective level `error` that occurred in at least half of the recorded runs, **Then** it is listed under "noisy blocking code", with its occurrence rate.
3. **Given** fewer recorded runs than the window (default 5), **Then** no promotion is recommended, and the report says how many more runs are needed.
4. **Given** no history, **Then** the report lists each code's current effective level and source, says no evidence exists, and exits 0.

### User Story 3 - Every run records what promotion needs (Priority: P2)

As a CI owner, I keep the history artifact between runs (CI-RECIPES), and each entry carries what `policy` needs, without growing the file noticeably.

**Independent Test**: Two `ci` runs on a fixture, then the history file is read.

**Acceptance Scenarios**:

1. **Given** a `ci` run, **Then** its history entry carries `codes`: a map from each finding code that occurred to its count (after the baseline is applied) and the effective level it had. It also carries `verdicts`: the counts from spec 081.
2. **Given** an entry written by 0.45.2 (no `codes`), **Then** `policy` skips it as carrying no per-code evidence, and says so.

### Edge Cases

- **A required child key** (`docSections`) follows its own verdict. Requiring `structure` does not require `docSections`.
- **`requiredChecks` combined with `--fail-on-inconclusive`.** Both exit 4. The report names every validator that tripped either rule, once.
- **`--changed-only`** runs a subset of validators. A required check outside that subset is not run, so it is reported once, as not run in lite mode, and the exit code is not changed. Lite mode is a pre-commit aid, not the gate.
- **A code that occurs only because a gap withheld nothing.** Runs whose entry has observation gaps (`verdicts.gaps` count > 0) are excluded from promotion evidence. A run that could not see everything cannot prove a code silent.
- **Codes added to DocGuard after a history entry was written.** The entry cannot show such a code as silent. Only entries written by a version that knew the code count, and the entry records `docguardVersion` for this purpose.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `.docguard.json` MUST accept `requiredChecks`, an array of validator keys. After a guard run, each required validator whose verdict is not `pass`, `fail` or `skipped` MUST make guard exit 4 (spec 081), unless an error exits 1 or 3. The run MUST name the validator, its verdict and its reason.
- **FR-002**: A required validator that has verdict `skipped` because it was disabled in config MUST produce an error finding `REQ001` ("required check disabled"). A required validator that is `skipped` through a reasoned in-repo N/A marker MUST pass the requirement. The marker is the declaration.
- **FR-003**: An entry in `requiredChecks` that names no validator key MUST produce `REQ002` (warn) naming it and listing the valid keys. It MUST NOT stop the other requirements from applying.
- **FR-004**: `ci` MUST block readiness with `CI_REQUIRED_CHECK_UNDECIDED` when FR-001 applies, and MUST list the undecided checks in the assessment.
- **FR-005**: Each `ci` history entry MUST add `docguardVersion`, `codes` (code → `{ n, level }`: the count after baseline and the effective enforcement level the code had in that run) and `verdicts` (the counts from spec 081). Existing fields MUST be unchanged.
- **FR-006**: A new read-only command, `docguard policy`, MUST report every finding code DocGuard defines. For each code it gives the configured enforcement (a `findingSeverity` entry, its validator's `severity`, or the code's registered default), the effective level last observed in history, if any, whether the code's validator is in `requiredChecks`, and history evidence over the last `--window <n>` usable runs (default 5): runs observed and runs with an occurrence.
- **FR-007**: `policy` MUST list a code under "ready to promote" when its last observed effective level is `warn` or `info`, it occurred in none of at least `window` usable runs, and at least one usable run in the history shows it occurring. The last condition proves the project exercises the code. Each listing MUST give the exact `findingSeverity` entry that promotes it.
- **FR-008**: `policy` MUST list a code under "noisy blocking code" when its last observed effective level is `error` and it occurred in at least half of the usable runs in the window.
- **FR-009**: A history entry is usable for code evidence only when it carries `codes`, has zero observation gaps, and was written by a `docguardVersion` that defines the code.
- **FR-010**: `policy --format json` MUST expose the same data, and MUST write nothing.
- **FR-011**: `requiredChecks` MUST be declared in `schemas/docguard-config.schema.json`. `REQ001` and `REQ002` MUST be registered in `cli/findings.mjs` and `docs/reference/findings.md`. `policy` MUST appear in `docguard --help`, `docs/commands.md`, the MCP tool list when a guard-equivalent tool exists for it, and `CHANGELOG.md`.

- **FR-012** *(amendment, 2026-11-03)*: In guard's text output, a validator whose findings are all informational after `findingSeverity` and default levels (status `warn`, effective status `pass`) MUST be shown as an informational row, not as a warning. Its findings stay listed. JSON keeps both `status` and `effectiveStatus` unchanged.

  The final A/B of specs 081–092 showed why: twelve local projects would otherwise have gained a ⚠️ Spec-Kit row made only of advisory SPK013 findings.

### Key Entities

- **Required check**: A validator key the project depends on. It must reach a decision, or be declared N/A, in every gating run.
- **Promotion evidence**: For each code, the usable history runs in a window, and how many of them saw the code.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each acceptance scenario in US1 to US3 has a test. The US1 tests fail on the code before this change, and the US1 control passes there.
- **SC-002**: A hermetic A/B against the release before this change, on this repository and every local project, with configs that set no `requiredChecks`, shows no changed finding, status or exit code.
- **SC-003**: On this repository, with 5 or more CI history entries collected, `docguard policy` makes at least one promotion recommendation. Each one is checked by hand against the run logs.

## Verification Notes

- **SC-001**: the US1 tests run against v0.45.2 fail 9 of 10. The one that passes is the control without `requiredChecks`.
- **SC-002**: no local project sets `requiredChecks`, so REQ001 and REQ002 cannot fire there. The A/B of this spec's commit (with 084–086, 089 and 091) against v0.45.2 changed no exit code, and every finding it added came from specs 085 and 086. The final branch A/B (spec 082's Verification Notes) agrees.
- **SC-003**: not yet measured. It needs 5 CI history entries on this repository, and remains an open task.

## Assumptions

- Exit 4 is shared with `--fail-on-inconclusive`. Both mean the same thing: the team asked that a check decide, and it did not.
- Promotion evidence is local. History lives in `.docguard/` (gitignored), and CI keeps it between runs as an artifact (CI-RECIPES). A project without kept history gets no recommendations, and the report says why.
- A window of 5 runs matches the sample size the precision benchmark uses for runtime claims. It is a default, not a statistical guarantee, and the report says so.

## Out of Scope

- Changing any code's default level. Promotion stays a project decision written in config.
- Automatic promotion, where DocGuard writes `findingSeverity` itself.
- Per-path or per-branch enforcement.
