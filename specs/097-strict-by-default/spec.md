# Feature Specification: Strict by Default

**Feature Branch**: `spec/097-strict-by-default`

**Created**: 2026-11-12

**Status**: Draft

**Spec ID**: `docguard.strict-by-default`

**Lineage**: Follow-up to issue 628 and to the read-only defaults audit run on v0.47.0.
- It extends `docguard.verdict-contract` (spec 081): the verdicts, the applicability classes and exit code 4.
- It extends `docguard.enforcement-ladder` (spec 083): strict mode treats every applicable validator the way `requiredChecks` treats a listed one.
- It builds on `docguard.accountable-suppressions` (spec 084): a waiver carries a reason, an owner and an expiry.
- It reuses the finding baseline (`.docguard.baseline.json`, `guard --update-baseline`) as the record of existing findings.
- It absorbs spec 096 (staleness visibility): the reason on every empty result is FR-005 here.
- It sets how the codes of spec 095 (FRS006 to FRS009) become failures: by FR-008 here, not by a per-project severity setting.

**Input**: An agent-instruction file stayed stale for seven weeks while guard exited 2 (issue 628). The audit that followed measured eight repositories (two public, six private) on v0.47.0 with their default configuration:
- A default guard run examined 19 to 29 of 37 validators per repository.
- None of the eight could exit 1. Every protection that can fail a build needs a file or a key that `init` does not write.
- 97 of 115 `empty` results carried the same sentence, so the output never said what was missing.
- Some validators reported `pass` having checked nothing.
- The `enterprise` profile differs from the default by two validators and is not strict.

The maintainer's decision (2026-11-12): the tool must work well with no configuration. Strict is the default for everyone, including a project that upgrades. A lower strictness is an explicit choice. A new check joins the default in the release that ships it. The answer to "upgrading turned my build red" is a true reason and one command, not a default that asks nothing.

## Problem

- **Protection is opt-in, and nobody opts in.** `requiredChecks`, `--fail-on-inconclusive`, `surfaceSync.surfaces`, `ownership`, `anchors.enabled`, `severity.<validator>` and `findingSeverity.<CODE>` each need someone to know they exist. An agent working in a project does not, and neither do most adopters.
- **`empty` is silent.** A validator that selected nothing prints a dim N/A line with a generic sentence. The run reads as green.
- **`pass` can mean nothing was checked.** `deriveVerdict` returns `pass` when a validator set no applicability and found nothing.
- **Profiles mix two questions.** `profile` answers "what kind of project is this" (`cli`, `library`) and "how strict" (`starter`, `standard`, `enterprise`) with one key, and the stored value was written by `init`, not chosen by a person.
- **A red that is wrong destroys the default.** With security turned on, two of the eight repositories exited 1. Of the six error findings opened, none was clearly true: four were test fixtures or placeholders and two were demo credentials. A strict default that fails on findings like these gets switched off.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A project that made no choice is checked in full (Priority: P1)

As an adopter, I run `docguard guard` with whatever configuration I have. Every validator that applies to my project either examines something or the run fails and tells me which one did not and why.

**Why this priority**: This is the failure of issue 628. A check that applies and examined nothing must not read as green.

**Independent Test**: A fixture project with route files and no API reference. On v0.47.0 guard exits 2 with API checks `empty`. With this feature it exits 4 and names the validator, the cause and the fix.

**Acceptance Scenarios**:

1. **Given** a project with no `enforcement` key and a validator that applies but selected nothing, **When** guard runs, **Then** it exits 4 and lists that validator under "applies here, examined nothing", with its cause and its fix.
2. **Given** the same project and a validator that does not apply, **When** guard runs, **Then** that validator is `skipped` with a reason that names what was looked for and not found, and it does not affect the exit code.
3. **Given** a validator that ran and performed zero checks, **When** guard runs, **Then** its verdict is `empty`, never `pass`.
4. **Given** a reasoned waiver for a validator (`docguard:validator <key> n/a — reason`), **When** guard runs, **Then** that validator is `skipped`, is counted as waived in the summary, and does not affect the exit code until the waiver expires.

---

### User Story 2 - A failure says what to do (Priority: P1)

As an adopter or an agent, when strict mode fails my run I read one block that states each cause in my project's terms and the one command or configuration snippet that resolves it.

**Why this priority**: A red with no next step is the reason people disable a tool. An agent that meets the fix in the output does not reinvent it.

**Independent Test**: For every validator, a fixture where it applies and is empty. The output carries a cause from the closed set and a fix that, applied to the fixture, makes the validator examine at least one thing.

**Acceptance Scenarios**:

1. **Given** any validator with verdict `empty`, **When** guard prints or serializes it, **Then** the result carries a cause code from the closed set and a `howToConfigure` text owned by that validator. No two validators share a generic sentence.
2. **Given** a strict failure, **When** guard prints the text output, **Then** an "Adopt" block lists, in this order: the fix per unexamined validator, the command that records existing findings in the baseline, the waiver form, and the key that selects the lower mode.
3. **Given** `--format json`, **Then** the same facts are in `strict.unexamined[]`, `strict.gating[]` and `enforcement`.

---

### User Story 3 - A finding fails the build only when it has earned it (Priority: P1)

As an adopter, a finding makes my build fail only if its code is one that already failed builds before this feature, or its measured precision clears the bar. Everything else is a warning.

**Why this priority**: The maintainer accepted a red default on the condition that a red is true.

**Independent Test**: A fixture with a hardcoded credential in a test file and one in a source file. Under strict the source finding fails the build only once SEC001 is a gating code; the test-file finding never does.

**Acceptance Scenarios**:

1. **Given** a code with no precision evidence that was not an error under the 0.47.0 defaults, **When** it fires under strict, **Then** it is a warning.
2. **Given** a code whose evidence clears the bar, **When** it fires under strict, **Then** it is an error, unless `findingSeverity` sets it otherwise.
3. **Given** a secret-shaped literal in a test path or with a placeholder value, **When** security runs, **Then** the finding is a warning with a reason and can never be a gating finding.

---

### User Story 4 - An upgrading project records what it already has (Priority: P1)

As a maintainer of a project that adopted an earlier version, I upgrade and my build turns red. I either fix what it shows, record the existing findings in the baseline with one command, waive a check with a reason and an expiry, or select the lower mode in one line.

**Why this priority**: Every existing adopter meets this on the day they upgrade.

**Independent Test**: A fixture frozen at the 0.47.0 behavior with three gating findings and two unexamined validators. `guard --update-baseline` then two waivers bring it to exit 0 or 2, with the debt counted in the summary. `"enforcement": "standard"` alone restores the 0.47.0 exit code.

**Acceptance Scenarios**:

1. **Given** existing gating findings, **When** the maintainer runs `guard --update-baseline` and commits the file, **Then** those findings no longer fail the run, a new finding of the same code does, and every run prints how many findings are baselined.
2. **Given** `"enforcement": "standard"`, **When** guard runs, **Then** findings, exit codes and output match 0.47.0 except for the corrected verdicts of FR-004 and one line that states the mode.
3. **Given** a project with no `.docguard.json`, **When** guard runs, **Then** it exits 3 as today with one line that says to run `docguard init`. Strict mode adds nothing to an uninitialized project.

---

### User Story 5 - New checks arrive without anyone asking (Priority: P2)

As an adopter on the default, when a release adds a validator or promotes a code to gating, my next run includes it and says it is new.

**Why this priority**: A default that stops growing is the current state with a different name.

**Independent Test**: A fixture release table that lists a validator as added in the running version. A project where it applies and is empty exits 4, and the line carries "new in vX.Y".

**Acceptance Scenarios**:

1. **Given** a validator added in the running version, **When** it is unexamined under strict, **Then** the output marks it "new in vX.Y".
2. **Given** `"enforcement": { "mode": "strict", "asOf": "0.49" }`, **When** a later release adds a validator or a gating code, **Then** it is reported as "pending: strict since vX.Y" and does not affect the exit code.

---

### User Story 6 - A person chooses a mode on purpose (Priority: P2)

As someone setting a project up, `docguard init` tells me the default is strict and lets me choose the lower mode, and the wizard asks.

**Independent Test**: `init --skip-prompts` writes no `enforcement` key. `init --enforcement standard` writes it. The wizard's answer writes it only when the answer is not the default.

**Acceptance Scenarios**:

1. **Given** `init` with no enforcement option, **Then** the configuration has no `enforcement` key and the closing text says the project is on the strict default.
2. **Given** `init --enforcement standard`, **Then** the key is written and the closing text names what the lower mode does not check.

### Edge Cases

- **Monorepo**: applicability is decided per configured project root, the same root guard already uses.
- **Git unreadable**: an observation gap is `inconclusive` (spec 081). Under strict an applicable `inconclusive` validator exits 4, which is today's `--fail-on-inconclusive` behavior made default.
- **`--changed-only`**: the pre-commit subset does not evaluate the unexamined rule, because it does not run the full validator set. It says so in one line.
- **Generated hooks**: the hook's handling of exit codes is unchanged. Exit 4 is treated as it is today.
- **A CI that pins an older DocGuard**: unaffected, provided the older version loads a configuration that carries `enforcement` (FR-002).
- **A validator that cannot decide whether it applies**: it must decide. An undecided answer is allowed only when an observation failed, and that is `inconclusive`.
- **A waiver that expires**: the validator is unexamined again from the next UTC day (spec 084 FR-004).

## Requirements *(mandatory)*

### Functional Requirements

#### Mode

- **FR-001**: `.docguard.json` MUST accept `enforcement`, either a string (`"strict"` or `"standard"`) or an object `{ "mode": "strict" | "standard", "asOf": "<major.minor>" }`. When the key is absent the mode is `strict`. `profile` keeps its meaning for the document set and required files and MUST NOT select the mode. The stored value `profile: "standard"` MUST NOT be read as a mode.
- **FR-002**: An older DocGuard MUST keep working on a configuration that carries `enforcement`. Before the default changes, a test MUST show v0.47.0 loading such a configuration without an error. If it does not, the key ships first in a release that only accepts it.
- **FR-003**: Under `strict`, every registered validator MUST run, whatever the profile's `validators` block says, unless a reasoned waiver covers it or `validators.<key>: false` is written in the project's own configuration file. A validator disabled by the project's own file is reported as "disabled by configuration" in the summary on every run.

#### Truthful verdicts (both modes)

- **FR-004**: A validator result MUST report how many checks it performed. `deriveVerdict` MUST return `pass` only when that count is at least one. A result with no findings and zero checks is `empty`. This applies in both modes, because it corrects the verdict and does not change an exit code under `standard`.
  - Requirement-Anchors enabled with zero anchors is `empty`.
  - A Doc-Ownership entry whose purpose is a placeholder (`<purpose>` or empty) MUST be a finding, so a drafted block applied unedited does not pass.
- **FR-005**: Every `empty` result MUST carry a cause from this closed set and a `howToConfigure` text, both owned by the validator beside its applicability logic, not by a central table:
  - `needs-declaration`: the validator needs a key or a file the project has not written (the text gives the snippet or the command);
  - `needs-content`: the configured input exists and contains nothing to check;
  - `layout-not-recognized`: inputs of this kind exist in a layout the validator does not read (the text names where it looked);
  - `nothing-of-this-kind`: the project has none of what this validator checks.

  A test MUST fail when two validators' empty results share the same reason sentence, and when a validator can return `empty` without a cause.

#### Applicability

- **FR-006**: Every validator MUST decide whether it applies to the project from the project's files, and return `applies: true | false` with the evidence it used. `nothing-of-this-kind` means it does not apply, and the verdict is `skipped` with that evidence as the reason. The other three causes mean it applies. A validator MUST NOT answer `false` because its own configuration is missing.
- **FR-007**: Under `strict`, guard MUST exit 4 when no error is present and a validator that applies has verdict `empty`, `inconclusive` or `blocked`, unless a waiver covers it. This is the `requiredChecks` rule of spec 083 applied to every applicable validator. `requiredChecks` keeps working under `standard`; under `strict` it adds nothing.

#### Which findings fail a build

- **FR-008**: Under `strict` a finding resolves to error when one of these holds, in this order:
  1. `findingSeverity.<CODE>` says `high`;
  2. the finding is an intrinsic error of a code that could exit 1 under the 0.47.0 default configuration (the closed list is recorded in the plan and asserted by a test);
  3. the code is a gating code (FR-009).

  A finding whose `findingSeverity` says `medium` or `low` keeps that level. An intrinsic error of a validator that the 0.47.0 defaults left off (Security, Architecture) is a warning until its code is gating.
- **FR-009**: A code is gating when its committed precision evidence shows at least 30 labeled findings and a 95% Wilson lower bound of at least 0.85, measured on a DocGuard version no more than two minor versions behind the release that promotes it. The gating set MUST be derived from the evidence file, never listed by hand. A test MUST fail when a code is gating without evidence that meets the bar.
- **FR-010**: Security MUST classify a secret-shaped literal as `test-or-placeholder` when the file is a test, fixture, example or mock path (`isNonProductPath`), or the value matches the placeholder patterns (the list is recorded in the plan and includes values containing `placeholder`, `example`, `dummy`, `synthetic`, `not-a-real`, `changeme`, `xxx`). Such a finding is a warning with that reason, is excluded from the code's gating status, and is measured as its own row in the precision evidence.
- **FR-011**: The baseline MUST keep working as it does: a finding whose fingerprint is in `.docguard.baseline.json` does not fail the run. Under `strict` every run MUST print the number of baselined findings, and JSON MUST carry it. The baseline does not cover an unexamined validator; only a fix or a waiver does.

#### Rolling default

- **FR-012**: Each release MUST ship a table of what joined strict in which version: validator keys and gating codes. Guard MUST label a strict failure caused by an item added in the running minor version or the one before it as "new in vX.Y". A test MUST fail when a validator or gating code exists that the table does not list.
- **FR-013**: With `enforcement.asOf` set, an item the table lists under a later version MUST be reported as pending and MUST NOT affect the exit code. Without `asOf`, every item applies.

#### Output

- **FR-014**: Guard's text output under `strict`, when the exit code is 1 or 4, MUST print an "Adopt" block after the validator list with: each unexamined validator's cause and `howToConfigure`; `docguard guard --update-baseline` with the count it would record, when gating findings exist; the waiver form with `owner:` and `expires:`; and `"enforcement": "standard"`. The block is printed with `--quiet` too.
- **FR-015**: Guard JSON MUST carry `enforcement: { mode, asOf, source }` (`source` is `default` or `config`) and `strict: { unexamined: [{ validator, cause, howToConfigure, newIn }], gating: [{ code, count }], pending: [...], waived: [...], baselined: <n> }`. The fields are additive. SARIF and JUnit MUST render an unexamined validator the way spec 081 renders `inconclusive`.
- **FR-016**: In both modes the first line of the summary MUST state the mode and where it came from.

#### Setup

- **FR-017**: `docguard init` MUST write no `enforcement` key by default, MUST accept `--enforcement strict|standard`, and its wizard MUST ask. Its closing text MUST state the mode. `init` MUST NOT write configuration that makes a validator pass without examining anything.
- **FR-018**: `docguard upgrade` MUST report, read-only, what strict changes for this project: the unexamined validators with cause and fix, the gating findings by code, and the commands that record or waive them.

#### Compatibility and proof

- **FR-019**: Under `"enforcement": "standard"`, on the audit corpus and on DocGuard itself, findings and exit codes MUST equal v0.47.0, except verdicts corrected by FR-004 and the mode line.
- **FR-020**: The DocGuard repository MUST run on the strict default and pass without `"enforcement": "standard"`. Each validator it does not examine MUST be fixed or waived with a reason, an owner and an expiry.
- **FR-021**: Spec 095's codes MUST follow FR-008 and FR-009. Its role-scoped `findingSeverity` form stays as an override. Spec 096's requirements are FR-005, FR-014 and FR-015 here.
- **FR-022**: `README.md` (quick start), `docs/configuration.md`, `docs/commands.md`, `docs-canonical/ARCHITECTURE.md` (exit codes and the mode), `docs-canonical/DATA-MODEL.md` (`enforcement`, the `strict` JSON block, the release table), `docs-canonical/CI-RECIPES.md`, `action.yml`, the Spec Kit extension's guard command, `schemas/docguard-config.schema.json`, a migration page "Upgrading to the strict default", and `CHANGELOG.md` with a breaking-change entry MUST describe the change.

### Key Entities

- **Enforcement mode**: `strict` or `standard`, with an optional `asOf` version; resolved once per run with its source.
- **Applicability decision**: per validator, `applies` and the evidence.
- **Empty cause**: one of four codes, with the validator's `howToConfigure`.
- **Gating code**: a finding code whose committed precision evidence meets the bar.
- **Strict additions table**: version to validator keys and gating codes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the eight audit repositories under strict, every validator reported as "applies here, examined nothing" is judged applicable by a human label, and applying its `howToConfigure` makes it examine at least one thing without a vacuous pass. Target: 100% of reported validators, each listed in the verification notes by kind of project, never by name.
- **SC-002**: On the same eight repositories, every finding that fails the build under strict is opened and labeled. Target: no false finding among them. A code with one false finding in this sample loses gating status until re-measured.
- **SC-003**: Under `"enforcement": "standard"`, the hermetic A/B against v0.47.0 on the eight repositories and on DocGuard shows no difference in findings or exit codes beyond FR-004 verdict corrections.
- **SC-004**: The issue 628 case is reproduced as a fixture: an agent-instruction file left stale while the surface it describes changed. On v0.47.0 guard exits 2. With this feature and spec 095 it exits non-zero under the default and names the file.
- **SC-005**: DocGuard's own CI runs the strict default and is green.
- **SC-006**: No validator in the registry can produce `pass` with zero checks, and no two validators share an empty reason; both are asserted by tests that failed before the change.

## Assumptions

- Delivery is staged (see the plan). This document describes the end state. Until the stage that changes the default ships, an absent `enforcement` key resolves to `standard` and the mode line says so.
- Version numbers before 1.0 allow a breaking default in a minor release, announced as breaking in the CHANGELOG.
- The audit's "legitimately not applicable" set was one person's judgment. FR-006 replaces it with a per-validator decision that SC-001 checks.
- The precision corpus of v0.41.7 (13 defect and 13 clean cases, 7 codes measured) is too small and too old to make any code gating under FR-009. Until the corpus grows, the gating set is empty, and strict fails a build through FR-007 and through the codes that already failed builds.

## Out of Scope

- Inferring configuration for a validator automatically. The audit's two trials produced vacuous passes. `howToConfigure` tells a person or an agent what to write.
- A third, advisory-only mode.
- Changing what the generated Git hook does with each exit code.
- New finding codes, other than the classification of FR-010 and the placeholder-purpose finding of FR-004.
