# Feature Specification: Spec Kit Init Delegation

**Feature Branch**: `fix/specify-init-delegation`

**Created**: 2026-09-29

**Status**: Draft

**Spec ID**: `docguard.specify-init-delegation`

**Lineage**: extends `docguard.adoption-workflow-integrity` (US3, avoid false success) for the
Spec Kit delegation path. Tracking issue #455.

**Input**: User description: "DocGuard's Spec Kit delegation silently fails on every current
Spec Kit release; report failures, use the current CLI contract, and register DocGuard as an
extension when Spec Kit is present."

## Problem

DocGuard presents itself as a Spec Kit extension and offers to set up Spec Kit for the adopter.
Spec Kit 0.10 replaced the agent-selection options DocGuard passes (`--ai`, `--ai-skills`,
`--ai-commands-dir`, `--no-git`) with an integration model (`--integration <key>`,
`--integration-options`, `--non-interactive`), and records the selected agent in
`.specify/integration.json`. Against any current Spec Kit release the delegated setup fails
immediately. DocGuard hides that failure: the explicit `init` path prints a warning with no
cause unless `--debug` is passed, and the background path used by other commands discards the
error entirely while its success message advertises a fixed skill count that was never measured.

The adopter therefore believes the spec-driven workflow is installed when nothing was installed,
which is the false-success class `docguard.adoption-workflow-integrity` exists to eliminate.

A naive flag correction would create a second defect. The background path runs on every
write-capable DocGuard command; with working flags it would start rewriting an adopter's
repository with `specify init --force` during unrelated commands such as `sync` or `fix`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Initialize a project with current Spec Kit installed (Priority: P1)

An adopter with a current Spec Kit CLI runs `docguard init` in a repository that has no Spec Kit
scaffold. Spec Kit is set up for the coding agent the repository already uses, and DocGuard's
extension is registered with Spec Kit so its workflow hooks run.

**Why this priority**: This is the advertised integration and it is broken for every adopter on a
current Spec Kit release.

**Independent Test**: Run `docguard init` in a fresh repository containing a `CLAUDE.md`, with a
current `specify` on the path; the repository ends with a Spec Kit scaffold for the Claude
integration and DocGuard registered as an extension.

**Acceptance Scenarios**:

1. **Given** a repository with a Claude signal and a current Spec Kit CLI, **When** the adopter
   runs `docguard init`, **Then** Spec Kit is initialized for the `claude` integration and the
   output names the integration that was used.
2. **Given** the same repository, **When** initialization succeeds, **Then** DocGuard is
   registered as a Spec Kit extension and the output states whether registration succeeded.
3. **Given** a repository with no recognizable agent signal, **When** the adopter runs
   `docguard init`, **Then** DocGuard does not silently choose an agent on the adopter's
   behalf; it initializes with the generic integration pointed at DocGuard's command directory
   and says so.

---

### User Story 2 - Learn why delegation failed (Priority: P1)

An adopter whose Spec Kit setup fails for any reason (unsupported CLI version, unknown
integration, timeout, permission error) sees that it failed, why, and what to run next.

**Why this priority**: The defect's harm is concealment. Even after the flags are corrected,
future upstream changes will break delegation again; failure must never again be silent.

**Independent Test**: Put a stub `specify` on the path that rejects the options it is given;
run `docguard init`; the output contains the stub's error text and a manual next step, and no
success line.

**Acceptance Scenarios**:

1. **Given** a Spec Kit CLI that rejects the invocation, **When** `docguard init` runs, **Then**
   the output reports failure, includes the CLI's own error message, and prints the exact
   command the adopter can run manually.
2. **Given** a failed delegation, **When** DocGuard prints its summary, **Then** it does not list
   the Spec Kit scaffold as created and does not print a skill count.
3. **Given** any caller of the delegation (today only `init`, which has no machine-readable
   mode), **When** delegation fails, **Then** the caller receives a structured result carrying the
   failure status and reason, so a future machine mode cannot lose it.

---

### User Story 3 - Run other commands without surprise writes (Priority: P1)

An adopter runs a routine command (`sync`, `fix`, `generate`, …) in a repository without a Spec
Kit scaffold. DocGuard does not initialize Spec Kit behind their back; it may point out that
Spec Kit is available and how to set it up.

**Why this priority**: Correcting the flags would otherwise turn a harmless broken code path into
an unrequested bulk rewrite of the adopter's repository on ordinary commands.

**Independent Test**: With a working stub `specify` that records its invocations, run a
write-capable non-init command in an uninitialized repository; the stub is never invoked and
no `.specify/` directory appears.

**Acceptance Scenarios**:

1. **Given** an uninitialized repository and a working Spec Kit CLI, **When** the adopter runs
   any command other than `init`, **Then** Spec Kit is not initialized and at most a short hint
   is printed.
2. **Given** the adopter passed `--no-spec-kit` or uses the starter profile, **When** any command
   runs, **Then** no hint is printed and Spec Kit is not invoked.

---

### User Story 4 - Recognize an already-initialized project (Priority: P2)

An adopter whose repository was initialized by a current Spec Kit release (which records the
agent in `integration.json`) runs DocGuard; DocGuard recognizes the project as initialized and
reports the agent correctly.

**Why this priority**: Current Spec Kit projects are detected today only through a compatibility
field that upstream may drop; mis-detection leads to re-initialization prompts or a wrong agent
in guidance.

**Independent Test**: A repository containing only `.specify/integration.json` (no
`init-options.json`) is reported as initialized with its default integration.

**Acceptance Scenarios**:

1. **Given** `.specify/integration.json` names a default integration, **When** DocGuard detects
   the agent, **Then** it reports that integration.
2. **Given** only a legacy `.specify/init-options.json`, **When** DocGuard detects the agent,
   **Then** it falls back to that file's agent field.
3. **Given** either file contains a value outside the allowed identifier pattern, **When**
   DocGuard detects the agent, **Then** the value is rejected and never reaches a subprocess.

### Edge Cases

- A Spec Kit CLI older than the integration model (pre-0.10): DocGuard states the minimum
  supported Spec Kit version and the upgrade command instead of attempting either flag set
  blindly.
- A filesystem signal maps to an agent the installed Spec Kit no longer supports (for example
  `.windsurf` or `.roo`): delegation reports the rejection like any other failure; DocGuard does
  not substitute a different agent.
- `.agents/` is shared by several Spec Kit integrations (Codex, Antigravity and others): it is not
  treated as evidence of any single agent.
- The Spec Kit CLI hangs: delegation times out, is reported as failed, and DocGuard continues.
- Extension registration fails after Spec Kit initialization succeeded: initialization is
  reported as succeeded and registration as failed, separately.
- The repository already has DocGuard registered as a Spec Kit extension: registration is not
  repeated.
- Windows, where `specify` is a `.cmd` shim: the same array-argument invocation contract holds.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DocGuard MUST invoke the Spec Kit CLI only with options that the installed CLI
  documents, determined from the CLI itself before invocation.
- **FR-002**: DocGuard MUST declare a minimum supported Spec Kit version (the first release with
  the integration model). When the installed CLI is older, DocGuard MUST NOT invoke it for
  initialization and MUST print the minimum version and the upgrade command.
- **FR-003**: Initialization MUST always name an integration explicitly and MUST be
  non-interactive, so an adopter is never silently given Spec Kit's default agent.
- **FR-004**: DocGuard MUST map each supported agent signal to a Spec Kit integration key. A
  signal shared by several integrations MUST NOT select any of them. With no usable signal,
  DocGuard MUST use the generic integration pointed at DocGuard's command directory.
- **FR-005**: Every agent or integration value read from the repository MUST pass the existing
  identifier allowlist before use, and the CLI MUST be invoked with an argument array, never a
  shell string.
- **FR-006**: Agent detection MUST read `.specify/integration.json` (default integration) first
  and fall back to the agent field of `.specify/init-options.json`. A project MUST count as
  initialized when either file exists.
- **FR-007**: When delegation fails, DocGuard MUST report the failure in its output without
  requiring a debug flag, including a bounded excerpt of the CLI's own error text and the manual
  command to run. The delegation MUST return a structured result (status, reason, integration,
  registration status) to its caller rather than only printing.
- **FR-008**: DocGuard MUST NOT print a hardcoded count of installed skills or files; any count
  it prints MUST be measured from what was installed.
- **FR-009**: Only an explicit `docguard init` MAY initialize Spec Kit. Other commands MUST NOT
  invoke Spec Kit initialization; in an uninitialized repository they MAY print a single-line
  hint, which `--no-spec-kit`, the starter profile, quiet and machine modes suppress.
- **FR-010**: After successful initialization, or when the project is already initialized,
  `docguard init` MUST register DocGuard as a Spec
  Kit extension through the Spec Kit CLI, from the extension directory shipped inside the running
  DocGuard package (so the registered version matches the running CLI and no download occurs).
  It MUST skip registration when DocGuard is already registered and report the registration
  result separately from initialization.
- **FR-011**: DocGuard's own skills and slash commands MUST continue to install into `.agent/`
  for adopters who do not use Spec Kit. Spec-Kit-enabled projects MUST receive DocGuard's
  workflow through extension registration; any `.agent/` copy is a fallback, not the integration.
- **FR-012**: Delegation MUST time out, and a timeout MUST be reported as a failure.
- **FR-013**: The regression suite MUST reproduce the original defect with a stub Spec Kit CLI
  that rejects removed options, and MUST cover the success path, pre-minimum versions,
  failure reporting in human and JSON output, non-init commands not invoking Spec Kit, detection
  from both state files, and allowlist rejection.

### Key Entities

- **Integration key**: Spec Kit's identifier for a coding agent (for example `claude`, `codex`,
  `copilot`, `cursor-agent`, `gemini`, `generic`).
- **Agent signal**: a repository path that indicates which coding agent the adopter uses.
- **Delegation result**: status (initialized, already initialized, skipped, unsupported version,
  failed), integration used, CLI error excerpt, extension-registration status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the current Spec Kit release, `docguard init` in a repository with a Claude
  signal produces a working Spec Kit scaffold and a registered DocGuard extension in 100% of
  test runs.
- **SC-002**: Zero delegation failures are silent: every failing stub scenario produces a
  failure line containing the CLI's error text and a structured failure result.
- **SC-003**: Zero non-init commands invoke Spec Kit initialization across the test matrix.
- **SC-004**: No output line contains an unmeasured skill or file count.
- **SC-005**: The regression test reproducing the removed-option failure fails against the
  pre-fix code and passes after it.

## Assumptions

- The minimum supported Spec Kit release is the first whose `init` accepts `--integration`
  (0.10.0 removed `--ai`; the exact floor is confirmed during planning). Older CLIs are not given
  a legacy code path.
- Capability is read from the CLI's help or version output, which is available offline.
- Registration uses the extension directory already present in the DocGuard package
  (`extensions/spec-kit-docguard/`), so it needs no network access and cannot fetch a catalog
  version that differs from the running CLI.
- Changing the content of DocGuard's skills is out of scope.
