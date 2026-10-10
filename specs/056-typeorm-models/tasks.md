# Tasks: TypeORM and Sequelize Models in Every Consumer

**Status**: Complete. SC-001: `tests/typeorm-models.test.mjs` (22 tests) failed before the change and passes in both parser tiers; SC-002: full suite 2979 tests, 2978 passing; the one failure was `llms-full.txt` gone stale after a last ARCHITECTURE edit, regenerated, and `tests/llms-bundle-drift.test.mjs` then passed. Guard: no finding besides DLC002 for this spec.
**Spec**: `specs/056-typeorm-models/spec.md`
**Plan**: `specs/056-typeorm-models/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/fixtures/orm-class-projects.mjs`: a TypeORM project (base class, table names, column options, all four relation kinds, `src/entity` and `*.entity.ts` layouts) and a Sequelize project (`define`, `init`, associations), each with a hand-written truth.
- [x] T002 `tests/typeorm-models.test.mjs`: discovery (FR-001), fields (FR-002), relations once (FR-003), inheritance (FR-004), pattern tier and tier reporting (FR-005), Sequelize (FR-006), guard = generate = diff and the plan (FR-007), docs (FR-008). Run it and see it fail.

## Phase 2: Implementation

- [x] T003 FR-002, FR-005: `extractDecoratedClasses` and `extractSequelizeModels` in `js-ast.mjs`.
- [x] T004 FR-001..FR-006: discovery and readers in `schemas.mjs`.
- [x] T005 FR-007: `scanSchemasDeep` and `schema-sync.mjs`.

## Phase 3: Docs and verification

- [x] T006 FR-008: `schemas.mjs` header, `docs/reference/languages.md`, `docs/commands.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, `docguard explain` Schema-Sync text; `npm run llms`.
- [x] T007 SC-002: `docguard specs --write`, `docguard guard`, `npm test`.
