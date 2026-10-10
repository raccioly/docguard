# Tasks: Baseline Fingerprints Ignore Advisory Hints

**Status**: Complete. SC-001: a new test file that changes the hint leaves the baselined finding suppressed; SC-002: full suite 2,931/2,931, guard unchanged.
**Spec**: `specs/052-baseline-stable-fingerprint/spec.md`
**Plan**: `specs/052-baseline-stable-fingerprint/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/baseline-stable-fingerprint.test.mjs`:
  - hint-free fingerprints, and fingerprints unchanged for other codes (FR-001, FR-004);
  - legacy fallback, and budget consumed from one entry only (FR-002);
  - `--update-baseline` writes new fingerprints (FR-003);
  - an end-to-end case where a new test file changes the hint and guard stays PASS (SC-001).

## Phase 2: Implementation

- [x] T002 `cli/writers/baseline.mjs`: `ADVISORY_TAILS`, `fingerprintFinding`, `legacyFingerprint` (FR-001, FR-004).
- [x] T003 `cli/commands/guard.mjs`: try the new fingerprint, then the legacy one (FR-002).

## Phase 3: Docs and verification

- [x] T004 `docs/configuration.md`; `CHANGELOG.md` (FR-005); `npm test`; `docguard specs --write`; `docguard guard` (SC-002).
