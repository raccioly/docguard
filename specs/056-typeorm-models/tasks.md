# Tasks: TypeORM and Sequelize Models in Every Consumer

**Status**: Complete. SC-001: `tests/typeorm-models.test.mjs` (32 tests) — each behaviour failed before its change and passes in both parser tiers; SC-002: full suite 2986 tests, 2985 passing, the one failure `tests/watch-reliability.test.mjs` (known load flake #523) passes alone; guard reports only DLC002 for this spec.
**Spec**: `specs/056-typeorm-models/spec.md`
**Plan**: `specs/056-typeorm-models/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/fixtures/orm-class-projects.mjs`: a TypeORM project (base class, table names, column options, all four relation kinds, `src/entity` and `*.entity.ts` layouts) and a Sequelize project (`define`, `init`, associations), each with a hand-written truth.
- [x] T002 `tests/typeorm-models.test.mjs`: discovery (FR-001), fields (FR-002), relations once (FR-003), inheritance (FR-004), pattern tier and tier reporting (FR-005), Sequelize (FR-006), guard = generate = diff and the plan (FR-007), docs (FR-008). Run it and see it fail.

## Phase 2: Implementation

- [x] T003 FR-002, FR-005: `extractDecoratedClasses` and `extractSequelizeModels` in `js-ast.mjs`.
- [x] T004 FR-001..FR-006: discovery and readers in `schemas.mjs`.
- [x] T005 FR-007: `scanSchemasDeep` and `schema-sync.mjs`.

## Phase 2b: Follow-up requirements (FR-009..FR-012)

- [x] T008 Tests first in `tests/typeorm-models.test.mjs`: Drizzle/Mongoose tiers and plan partiality (FR-009), Mongoose + Zod and Zod-only (FR-010), SCH001 help (FR-011), relative, nested, alias and workspace barrels and the MikroORM negatives (FR-012); 8 failed before the change.
- [x] T009 FR-009, FR-010: tiers in the Drizzle and Mongoose readers; Mongoose before the Zod check; Zod files read once.
- [x] T010 FR-011: SCH001 help; `npm run docs:reference`.
- [x] T011 FR-012: `decoratorsFromTypeOrm` and `workspaceModule` in `schemas.mjs`.

## Phase 3: Docs and verification

- [x] T006 FR-008: `schemas.mjs` header, `docs/reference/languages.md`, `docs/commands.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, `docguard explain` Schema-Sync text; `npm run llms`.
- [x] T007 SC-002: `docguard specs --write`, `docguard guard`, `npm test`.
