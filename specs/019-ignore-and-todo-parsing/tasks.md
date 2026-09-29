# Tasks: Ignore and TODO Parsing Correctness

**Status**: Complete — benchmark comparison PASS; parity test covers this repository's .docguardignore
**Spec**: `specs/019-ignore-and-todo-parsing/spec.md`
**Plan**: `specs/019-ignore-and-todo-parsing/plan.md`

## Phase 1: One ignore parser (US1)

- [x] T001 `tests/ignore-parser-parity.test.mjs`: `dir/` fails on the current tree; parity over this repository's `.docguardignore` (SC-001).
- [x] T002 `cli/shared.mjs`: `loadIgnorePatterns` delegates to `buildIgnoreFilter` (FR-001).

## Phase 2: TODO parsing (US2)

- [x] T003 `cli/validators/todo-tracking.mjs`: relaxed TODO/FIXME tier, strict tier for the rest, author-aware extraction (FR-002–FR-004).
- [x] T004 `tests/todo-tracking.test.mjs`: PR #453's cases plus precision negatives (FR-005, SC-003).

## Phase 3: Verification

- [x] T005 `npm run benchmark` comparison stays PASS (SC-002).
- [x] T006 `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`; `docguard guard`; `npm test`.
