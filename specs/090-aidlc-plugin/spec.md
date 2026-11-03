# Feature Specification: DocGuard Runs Inside AWS AI-DLC as a Plugin

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-02

**Status**: Draft

**Spec ID**: `docguard.aidlc-plugin`

**Lineage**: Eighth feature of the DocGuard × AI-DLC program (issue 607). It uses:
- the verdict contract (spec 081) and required checks (spec 083) to decide a sensor result;
- the AI-DLC validator (spec 089) and memory export (spec 091) as what the plugin brings into the workflow.

The plugin follows AI-DLC 2.11.2's third-party plugin mechanism, which treats first- and third-party plugins identically:
- `.aidlc-plugin/plugin.json`;
- sensors as `sensors/aidlc-<id>.md`, run by `tools/aidlc-sensor-<id>.ts`;
- additive contributions to core stages;
- a catalogue of its own, named in `aidlc.marketplace`.

**Input**: An AI-DLC user should get DocGuard's checks at the stage gates that matter, through AI-DLC's own sensor and contribution seams, without changing how they run AI-DLC. A study of AI-DLC's sensor dispatcher found three constraints:
1. A sensor command must be a TypeScript file named exactly `aidlc-sensor-<id>.ts`. `npx docguard` cannot be named directly.
2. A third-party sensor receives only `--stage` and one `--output-path` per fire, and fires once per declared output file.
3. Exit 127 is recorded as a pass ("tool-unavailable"), so a missing tool passes silently unless the wrapper says otherwise.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - DocGuard checks the project at AI-DLC's construction gates (Priority: P1)

As an AI-DLC user, after code generation and build-and-test, I see a DocGuard sensor result for the whole project, recorded in AI-DLC's audit like any other sensor.

**Independent Test**: A scratch AI-DLC project (configured with `aidlc config`) with the plugin composed in. `aidlc engine sensor fire` runs the DocGuard sensor on a code-generation output, once with drift seeded and once clean.

**Acceptance Scenarios**:

1. **Given** seeded drift (a documented endpoint that no longer exists), **Then** the sensor reports `pass: false` with the finding codes and counts, and AI-DLC records `SENSOR_FAILED`.
2. **Given** a clean project, **Then** `pass: true` and `SENSOR_PASSED`.
3. **Given** DocGuard not installed, **Then** the wrapper exits 1 with an install hint, and AI-DLC records `SENSOR_COULD_NOT_RUN`, never a pass.

### User Story 2 - One guard run per tree, however many files fire (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the sensor fires for five output files of one gate with no change in between, **Then** guard runs once and the other four fires return the cached result.
2. **Given** a file changes between fires, **Then** the next fire runs guard again.

### User Story 3 - The plugin is valid and installable through AI-DLC's own tooling (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `extensions/aidlc/docguard/`, **Then** `aidlc engine plugin validate` passes.
2. **Given** `aidlc engine plugin build claude <out>`, **Then** it produces a Claude Code plugin projection with the plugin's own catalogue (`aidlc.marketplace: docguard-aidlc`).
3. **Given** the plugin composed into a scratch project, **Then** the compiled stage graph lists `docguard-guard` among the sensors applicable to code-generation and build-and-test.

### User Story 4 - The developer agent knows what DocGuard is for (Priority: P2)

**Acceptance Scenarios**:

1. **Given** the plugin, **Then** the developer agent's knowledge includes a DocGuard guide: what a DocGuard finding means, which verdicts block, how to fix drift and when to run `docguard memory --export aidlc`.

### Edge Cases

- **A sensor fire with no git repository**: the cache key falls back to file mtimes under the project, and the sensor still answers.
- **A blocked validator** (verdict `blocked`): `pass: false`, because a check that could not run must never read as a pass (spec 081).
- **An inconclusive required check** (spec 083): `pass: false` with the reason.
- **Large finding lists**: the sensor output names at most 20 findings and gives the total, so AI-DLC's audit stays small.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `docguard sensor --aidlc [--stage <slug>] [--output-path <path>]` MUST print one JSON line `{ pass, findings_count, new_findings_count, compared_with, findings, verdicts, docguard }` and exit 0 when guard ran.
  - `pass` is false when guard has effective errors, a `blocked` validator, or an undecided required check, or when the working tree has a finding that the HEAD commit does not have. Those last findings are the drift the work in progress introduced.
  - The HEAD baseline is a guard run on a local clone of HEAD, which keeps history. It is cached per commit in `.docguard/sensor-head.json`.
  - A finding located in a git-ignored file is machine-local state and is never counted as introduced.
  - `findings` holds at most 20 `CODE file:line message` strings, introduced ones first.
  - `verdicts` holds the spec 081 counts.
  - It MUST exit 1 with a message on stderr when guard could not run.
- **FR-002**: The command MUST cache its output in `.docguard/sensor-cache.json`, keyed by HEAD, a hash of `git status --porcelain` plus the content of changed files, and a hash of `.docguard.json`. It MUST rerun guard when the key changes.
- **FR-003**: `extensions/aidlc/docguard/` MUST be a valid AI-DLC plugin.
  - `plugin.json`: name `docguard`, version equal to DocGuard's, dependencies `["core"]`, `aidlc.marketplace: "docguard-aidlc"`.
  - `sensors/aidlc-docguard-guard.md`: deterministic, advisory, `fire_on: gate`, matching the record directories.
  - `tools/aidlc-sensor-docguard-guard.ts`: a thin wrapper that runs `docguard sensor --aidlc` with the dispatcher's arguments and passes its output through. It exits 1, never 127, when DocGuard cannot be started.
  - Contributions adding the sensor to `code-generation` and `build-and-test`.
  - A knowledge guide for `aidlc-developer-agent`.
- **FR-004**: The wrapper MUST contain no DocGuard logic. Every decision is made by the DocGuard CLI, so Node's test suite covers it without Bun.
- **FR-005**: `aidlc engine plugin validate extensions/aidlc/docguard` MUST pass in CI on a checksum-verified AI-DLC release, and a projection MUST build for `claude`.
- **FR-006**: The release workflow MUST keep the plugin's version equal to `package.json`, as it does for the Spec Kit extension.
- **FR-007**: `README.md` (an AI-DLC section), `docs/guides/` (an install guide), `docs-canonical/ARCHITECTURE.md`, `TEST-SPEC.md` and `CHANGELOG.md` MUST describe the plugin.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a scratch AI-DLC 2.11.2 project, the seeded-drift fire records `SENSOR_FAILED`, the clean fire `SENSOR_PASSED`, and the fire without DocGuard `SENSOR_COULD_NOT_RUN`. The run is recorded in Verification Notes.
- **SC-002**: Five consecutive fires on an unchanged tree run guard once (cache hits counted).
- **SC-003**: `aidlc engine plugin validate` and `aidlc engine plugin build claude` pass locally and in CI.

## Verification Notes

Run 2026-11-03 with AI-DLC 2.11.2 installed from its checksum-verified release. The scratch project was an Express inventory API with `docs-canonical/API-REFERENCE.md`, configured with `aidlc config --harness claude`.

- **Validation and build**: `aidlc engine plugin validate` reported VALID. It first rejected `extensions/aidlc-docguard/` because the directory must equal the manifest name, so the plugin moved to `extensions/aidlc/docguard/`. `aidlc engine plugin build claude` completed, emitting `.claude-plugin/plugin.json` and its own `marketplace.json` (`docguard-aidlc`).
- **Composition**: `aidlc engine plugin sync`, run with `CLAUDE_PLUGIN_ROOT` set to the build, composed version 0.45.2. `aidlc engine sensor list` showed `docguard-guard`, and the compiled stage graph bound it to `code-generation` and `build-and-test`.
- **SC-001**: `aidlc engine sensor fire docguard-guard` gave these results.

  | Case | Result |
  |---|---|
  | Clean tree | `passed` |
  | A documented endpoint added that the code lacks | `failed` (API004 DELETE /items/:id) |
  | A route deleted from code, doc unchanged | `failed` (API004 POST /items) |
  | Clean again | `passed` |
  | DocGuard not on PATH | `could-not-run` (`script-error: exit-1`), not a pass |

  The audit recorded SENSOR_FIRED with SENSOR_PASSED, SENSOR_FAILED or SENSOR_COULD_NOT_RUN for each fire.
- **What changed the design.** A first version passed whenever guard had no error. Drift is usually a warning, so the doc-drift fire passed. Failing on any warning would have failed every gate of a stock AI-DLC project, which already carries PSR002 and PSR003 warnings on AI-DLC's own `.claude/CLAUDE.md`, a 50 KB instruction load. Comparing with HEAD fails exactly on introduced drift. The first HEAD baseline came from `git archive` and counted 11 history and ignored-file artifacts as new. A local clone plus the ignored-file rule removed all 11.

- **The `main(argv)` contract.** awslabs/aidlc-workflows#3326 reports that a native install can import a plugin sensor in-process and call its exported `main(argv)`. There, `process.argv` holds the engine's own arguments, so a wrapper that reads it at load time breaks. The wrapper now exports `main(argv)` and reads `process.argv` only under `import.meta.main`.
  - Rebuilt and resynced on the same native 2.11.2 install, validation reported 0 errors.
  - The fires gave clean `passed`, doc drift `failed`, restored `passed`, and DocGuard missing `could-not-run`.
  - The earlier wrapper had also passed here, with no `script-error` note, so this 2.11.2 install ran it as a subprocess. The fix is for installs that load it in-process.

## Assumptions

- AI-DLC 2.11.2 is the pinned target. The CI job installs it through its checksum- and attestation-verified installer.
- The sensor is advisory by default, as AI-DLC's own sensors are. A team makes it blocking in its scope, through AI-DLC.

## Out of Scope

- A DocGuard-owned AI-DLC stage. The contribution seam is enough, and adding a stage would change every user's workflow.
- Publishing to any catalogue other than the plugin's own.
