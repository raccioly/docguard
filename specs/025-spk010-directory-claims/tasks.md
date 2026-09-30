# Tasks: SPK010 Directory Claims

**Status**: Complete. The #458 reproduction is silent, and the precision cases still report.
**Spec**: `specs/025-spk010-directory-claims/spec.md`
**Plan**: `specs/025-spk010-directory-claims/plan.md`

## Phase 1: Fix

- [x] T001 `cli/scanners/speckit.mjs`: `touchedWithin()` and the directory branch in `detectUntouchedClaims` (FR-001, FR-002).

## Phase 2: Tests and verification

- [x] T002 `tests/spk010-directory-claims.test.mjs`: the #458 reproduction (SC-001), shown to fail on `main`, and the precision cases (SC-002).
- [x] T003 `testguard.claims.json`: claim `SPK010-DIRECTORY-CLAIMS` with faults; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`; `docguard guard`; `npm test`.
