# Tasks: Field Report Follow-ups

**Status**: Complete — #454 reproduction leaves the husky dispatcher byte-identical with and without --force
**Spec**: `specs/020-field-report-followups/spec.md`
**Plan**: `specs/020-field-report-followups/plan.md`

## Phase 1: Guard output (#438, #437, #436)

- [x] T001 `cli/commands/guard.mjs`: claims badge `unknown` fallback (FR-001).
- [x] T002 `cli/commands/guard.mjs`: `baselineBySeverity` in JSON and human output (FR-002).
- [x] T003 `tests/field-report-followups.test.mjs`: `upgrade --apply` with a failing install migrates the schema, exits 1, and clears the nudge (FR-003).

## Phase 2: Hook managers (#454)

- [x] T004 `cli/commands/hooks.mjs`: `detectHookManager()`; guidance instead of `--force`; refuse the overwrite (FR-004).

## Phase 3: Tests, docs, verification

- [x] T005 `tests/field-report-followups.test.mjs`: every FR-005 case, with #454's reproduction (SC-001, SC-002).
- [x] T006 `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`; `docguard guard`; `npm test`.
