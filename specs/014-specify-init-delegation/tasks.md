# Tasks: Spec Kit Init Delegation

**Status**: Complete — all phases landed; live quickstart passed against `specify` 1.0.13
**Spec**: `specs/014-specify-init-delegation/spec.md`
**Plan**: `specs/014-specify-init-delegation/plan.md`

Format: `[ID] [P?] [Story] Description` — `[P]` = parallelizable (different files, no
dependency). One PR for all phases.

## Phase 1: Reproduce (blocking)

- [x] T001 Add `tests/spec-kit-delegation.test.mjs` with a POSIX stub `specify` on `PATH` (modes: `current`, `removed-flags`, `legacy-help`, `hang`) that records argv; the removed-flag scenario asserts `docguard init` reports failure with the stub's error text (FR-013, SC-005). Confirm it fails on the pre-fix code.

## Phase 2: Delegation module (US1, US2)

- [x] T002 [US1] Create `cli/spec-kit-delegation.mjs`: `readSpecKitCapabilities()`, `resolveIntegration()`, `buildInitArgs()`, `delegateSpecKitInit()`, `registerDocGuardExtension()`, returning `DelegationResult` per `data-model.md` and invoking `specify` per `contracts/specify-cli.md` (FR-001–FR-005, FR-007, FR-010, FR-012).
- [x] T003 [US4] `cli/ensure-skills.mjs`: `getDetectedAgent()` reads `integration.json` then `init-options.json` (`integration`, then `ai`) with the allowlist; `isSpecKitInitialized()` accepts either file; drop the `.agents → agy` signal (FR-004, FR-005, FR-006).
- [x] T004 [US3] `cli/ensure-skills.mjs`: `ensureSpecKit()` never spawns `specify`; prints one hint line when uninitialized and `specify` is available, nothing under `--no-spec-kit`, `--quiet`, or JSON; remove the boxed reminder's skill counts (FR-008, FR-009).
- [x] T005 [US1] [US2] `cli/commands/init.mjs`: replace the inline `safeSpawnSpecify` block with `delegateSpecKitInit()` + `registerDocGuardExtension()`; render status, integration, reason and manual command; push `.specify/` to `created` only on success; remove hardcoded counts from the not-installed box (FR-007, FR-008, FR-010).
- [x] T006 [P] [US4] Extend `tests/security-init-injection.test.mjs`: allowlist applies to `integration.json` values; argv never carries a rejected value.
- [x] T007 [P] [US3] Cover FR-009 in `tests/spec-kit-delegation.test.mjs`: `sync`, `fix` and `diagnose` with a working stub never invoke `specify init` and create no `.specify/` (SC-003). (Originally planned in `tests/ensure-skills-idempotent.test.mjs`, which only exercises an already-initialized project; the stub harness is where a non-init invocation is observable.)
- [x] T008 Complete `tests/spec-kit-delegation.test.mjs`: success path (argv contains `--integration claude`, no removed flags), generic fallback with `--integration-options`, legacy-help → `unsupported-version`, hang → `failed` on timeout, registry already lists docguard → `already-registered`, registration failure reported separately, no output line with a hardcoded skill count (SC-001–SC-004).

**Checkpoint**: `npm test` green; T001 scenario passes.

## Phase 3: Documentation and verification

- [x] T009 [P] `docs-canonical/ARCHITECTURE.md`: add a **Spec Kit delegation** row naming `cli/spec-kit-delegation.mjs` and its guarantees.
- [x] T010 [P] `README.md` Spec Kit section: minimum Spec Kit 0.10.0; `docguard init` registers the extension; other commands never initialize.
- [x] T011 `CHANGELOG.md` entry; `npm run llms`.
- [x] T012 Run `quickstart.md` live against `specify` 1.0.13 in a temporary repository; record the result in the PR.
- [x] T013 `docguard guard` passes; `docguard specs --write` refreshes `.docguard-specs.json`.
