# Implementation Plan: Spec Kit Init Delegation

**Branch**: `fix/specify-init-delegation` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/014-specify-init-delegation/spec.md`

## Summary

Move the `specify` subprocess contract into one module that reads the installed CLI's
capabilities, builds an argument array for the integration model (Spec Kit ≥ 0.10.0), and
returns a structured delegation result instead of swallowing errors. Only `docguard init` calls
it; the per-command `ensureSpecKit()` becomes a one-line hint. After a successful init, DocGuard
registers its own packaged extension with `specify extension add <dir> --dev` (offline,
version-matched). See [research.md](research.md).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18

**Primary Dependencies**: Node built-ins only (`node:child_process`, `node:fs`, `node:path`); no new dependency

**Storage**: Reads `.specify/integration.json`, `.specify/init-options.json`, `.specify/extensions/.registry`

**Testing**: `node:test`, with a stub `specify` executable on `PATH`

**Target Platform**: macOS, Linux; Windows through the existing `cmd.exe /c specify.cmd` shim

**Project Type**: CLI

**Performance Goals**: One `specify init --help` call (≈0.5 s) added to `docguard init` only

**Constraints**: No shell interpolation (issue #190); no network access; no writes outside `init`

**Scale/Scope**: 3 source files changed, 1 module added, 1 test file added, 2 test files updated

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|-----------|-----------|
| I. LLM-first | `init` has no machine mode; the delegation returns a structured result so one can be added without loss. Pass. |
| II. Dependencies | None added. Pass. |
| III. Docs as truth | ARCHITECTURE.md gains the delegation module; README Spec Kit section updated. Pass. |
| IV. Validator isolation | No validator touched. Pass. |
| V. AI as author | No prose authored. Pass. |
| VI. Safe writes | Removes the background bulk write path; writes occur only under explicit `init`, performed by `specify`. Pass (improves). |
| VII. Delegation | This feature implements it: current flags, reported failure. Pass. |
| VIII. Local-first | `specify init` scaffolds from bundled assets; extension registration uses the packaged directory. No network. Pass. |
| IX. Honest assurance | Hardcoded skill counts removed; failure never reported as success. Pass. |
| X. Spec-first | This plan. Pass. |

Post-design re-check: unchanged, all pass.

## Project Structure

### Documentation (this feature)

```text
specs/014-specify-init-delegation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/specify-cli.md
└── tasks.md
```

### Source Code (repository root)

```text
cli/
├── spec-kit-delegation.mjs     # NEW: capabilities, integration resolution, arg building,
│                               #      delegateSpecKitInit(), registerDocGuardExtension()
├── ensure-skills.mjs           # getDetectedAgent/isSpecKitInitialized read integration.json;
│                               # ensureSpecKit() stops spawning (hint only); signal map fix
├── commands/init.mjs           # uses the delegation module; renders its result; drops counts
└── docguard.mjs                # unchanged call site (ensureSkills no longer spawns)

tests/
├── spec-kit-delegation.test.mjs     # NEW: stub-`specify` end-to-end + unit coverage
├── security-init-injection.test.mjs # extended: allowlist on integration.json values
└── ensure-skills-idempotent.test.mjs# updated: ensureSpecKit never spawns
```

**Structure Decision**: One new module keeps the upstream CLI contract in a single place
(research R1), so the next upstream flag change touches one file and one test.

## Complexity Tracking

No constitution violations to justify.
