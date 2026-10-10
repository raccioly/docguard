# Tasks: Suppressions That Carry a Reason and an Expiry

**Status**: Complete. SC-001: `tests/ignore-reasons.test.mjs` failed before each change (23 of 51 for FR-010–FR-012 before the matcher fix) and passes after (51 tests). SC-002: full suite 3010/3011 after the matcher fix; the one failure was a stale `llms-full.txt` (regenerated after a last DATA-MODEL edit; `tests/llms-bundle-drift.test.mjs` then passes 6/6). Guard on this repository passes all checks except the expected DLC002; every emitted claimspec document validates against the vendored schema.
**Spec**: `specs/057-ignore-reasons/spec.md`
**Plan**: `specs/057-ignore-reasons/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/ignore-reasons.test.mjs`: grammar and old-parser equivalence (FR-001, FR-002), expiry and invalid entries through config and `guard` (FR-003, FR-004, FR-005), the suppression model (FR-006), `docguard ignore` text/json (FR-007), the claimspec export and the vendored-schema validator against the conformance fixtures (FR-008, FR-009). Run it and see it fail.

## Phase 2: Implementation

- [x] T002 FR-001–FR-004: `cli/shared-ignore.mjs` parser and active-pattern loader
- [x] T003 FR-005: IGN codes in `cli/findings.mjs`, `cli/validators/suppressions.mjs`, guard/explain/config-schema registration
- [x] T004 FR-006: `parseInlinePragma`, `listValidatorMarkers`, `cli/scanners/suppressions.mjs`
- [x] T005 FR-009: vendored schemas, `cli/claimspec-schema.mjs`, conformance fixtures
- [x] T006 FR-007, FR-008: `cli/writers/claimspec-ignore.mjs`, `cli/commands/ignore.mjs`, `cli/docguard.mjs`; `tests/read-only-commands.test.mjs`

## Phase 3: Docs and verification

- [x] T007 `docs/configuration.md`, `docs/commands.md`, `docs/guides/troubleshooting.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/SECURITY.md`, README, `CHANGELOG.md`; `npm run docs:reference`; `npm run llms`
- [x] T008 `docguard specs --write`; `docguard guard`; `npm test` (SC-002)

## Phase 4: Matcher fixes found while building the export

- [x] T009 Tests first in `tests/ignore-reasons.test.mjs`: every pattern class (FR-010), each caller (`config.ignore`, `securityIgnore` end to end through the Security validator, `todoIgnore`, `documentLifecycle`, `.docguardignore`), the before/after table against the old matcher, the export of newly agreeing patterns (FR-011), the schema and docs for `documentLifecycle` (FR-012). Run and see them fail.
- [x] T010 FR-010: `globToRegex` in `cli/shared-ignore.mjs`
- [x] T011 FR-011: `claimspecPathPattern` in `cli/writers/claimspec-ignore.mjs`
- [x] T012 FR-012 and docs: config schema, `docs/configuration.md` (pattern syntax table), `docs/commands.md`, `docs/guides/troubleshooting.md`, `docs-canonical/DATA-MODEL.md`, `CHANGELOG.md` ### Fixed; `npm run llms`; `specs --write`; guard; `npm test`
