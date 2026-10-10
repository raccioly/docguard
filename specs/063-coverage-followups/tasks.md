# Tasks: Coverage Follow-ups From Specs 056–061

**Status**: Complete. SC-001: every reproduction in `tests/coverage-followups.test.mjs` was run before its fix and failed for the reported reason (26 of the first 28; the Spring/Laravel case-sensitivity guard and the example-file negative passed, as they must); the `.NET` env/inventory and model-walker cases were rewritten once to reproduce the defect directly and failed before the fix. SC-002: the 24 related suites (552 tests) pass; the full suite passes (3226 tests, 0 failures; after FR-009/FR-010, 3241 tests, 0 failures); `guard` reports 0 errors and 8 warnings, all DLC002 on earlier specs, none from this change.
**Spec**: `specs/063-coverage-followups/spec.md`
**Plan**: `specs/063-coverage-followups/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/coverage-followups.test.mjs`: plan `patternRead` for Go, no `degraded` for JS+Go, Python unchanged (FR-001); `obj`/`_build` skipped, `bin` skipped only beside a .NET project file (FR-002); ASP.NET Core case-insensitive in guard and `diff`, Spring and Laravel still case-sensitive (FR-003); Python unresolved paths make API-surface coverage partial (FR-004); Angular, Svelte and the official clients detected, every vocabulary name has a path (FR-005); `diff` reads mapped documents (FR-006); `generate --spec` confidence for JS+Go (FR-007). Confirm each fails before its fix.

## Phase 2: Implementation

- [x] T002 FR-001: `shared-source.mjs`, `memory-plan.mjs`, `generate.mjs`, `schemas.mjs`
- [x] T003 FR-002: `shared-ignore.mjs` and the walkers
- [x] T004 FR-003: `routes.mjs`, `api-doc.mjs`, `api-surface.mjs`
- [x] T005 FR-004: `routes.mjs`
- [x] T006 FR-005: `tech-stack.mjs`
- [x] T007 FR-006: `diff.mjs`
- [x] T008 FR-007: `as-built.mjs`, `generate-as-built.mjs`

## Phase 2b: Follow-up FRs (tests first)

- [x] T011 `tests/coverage-followups.test.mjs`: Express default, app setting, `Router({ caseSensitive })`, non-literal setting with a `diff` note; Koa `sensitive`; Fastify `caseSensitive: false`; NestJS adapters; Hono and Next.js unmarked (FR-009). Advice per cause: JS/TS parse error, no Python interpreter, Python parse error, `@babel/parser` missing, and `generate --spec` (FR-010). Run against the previous commit: 11 of 15 failed; the four that passed assert what was already true (Express with `app.set(…, true)` and with `app.enable(…)` is case-sensitive, Hono/Next.js unmarked, the no-interpreter note names python3).
- [x] T012 FR-009: `route-case.mjs`, `routes.mjs`, `diff.mjs`
- [x] T013 FR-010: `shared-source.mjs`, `py-sources.mjs`, `memory-plan.mjs`, `as-built.mjs`, `generate-as-built.mjs`

## Phase 3: Docs and verification

- [x] T009 FR-008: user docs, ARCHITECTURE, DATA-MODEL, `CHANGELOG.md`; `npm run llms`
- [ ] T010 `docguard specs --write`; `docguard guard`; `npm test` (SC-002)
