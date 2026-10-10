# Implementation Plan: TypeORM and Sequelize Models in Every Consumer

**Branch**: `spec/056-typeorm-models` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

TypeORM and Sequelize join Prisma, Drizzle and Mongoose in `scanOrmEntities`, the one discovery and parse that `scanSchemasDeep` (`generate`, `generate --plan`, `generate --spec`, `diff`) and guard's Schema-Sync check share since spec 045.

| FR | Change |
|---|---|
| FR-001 | `discoverOrmSchemaFiles` returns `typeorm` files (import `typeorm`, use an `@Entity` or column decorator) and `sequelize` files; `entities` and `entity` join the conventional search dirs. |
| FR-002, FR-003, FR-004 | `cli/scanners/js-ast.mjs` gains `extractDecoratedClasses`: each class's name, `extends`, line, class decorators and decorated properties, with every decorator argument as source text. `cli/scanners/schemas.mjs` turns that into entities, fields and relations, and resolves inheritance across files. |
| FR-005 | A pattern reader in `schemas.mjs` produces the same class shape from text when the file does not parse. Entities carry `tier`, `tierReason` and `line`. |
| FR-006 | `js-ast.mjs` `extractSequelizeModels` finds `define` and `init` calls and association calls; a pattern reader does the same from text. `schemas.mjs` reads attributes with the shared object-text helpers. |
| FR-007 | `scanSchemasDeep` adds `orm.typeorm` and `orm.sequelize`; `cli/validators/schema-sync.mjs` reads them from `scanOrmEntities`, matches the class or table name, and drops its TypeORM and Sequelize patterns. |
| FR-008 | `schemas.mjs` header, `docs/reference/languages.md`, `docs/commands.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, and the Schema-Sync text of `docguard explain` (`cli/commands/explain.mjs`), which listed seven ORMs and omitted Mongoose and the Python ones it already read. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: `@babel/parser` (already the single runtime dependency; `decorators-legacy` is already enabled for every file). None new.
**Testing**: `node:test`. `tests/typeorm-models.test.mjs` with fixtures in `tests/fixtures/orm-class-projects.mjs`, each with a truth written by hand.

## Research decisions

- **AST extracts text, one interpreter reads it.** The AST tier returns each decorator's arguments as source text, and the pattern tier returns the same shape from bracket matching. One interpreter (`objectProps`, `unquote`, as Drizzle and Mongoose already do) reads options, so the two tiers cannot disagree on what `{ nullable: true }` means. Rejected: interpreting Babel nodes directly, which would need a second interpreter for the pattern tier.
- **Discover by import, not by file name.** `typeorm init` writes `src/entity/User.ts` and NestJS writes `src/users/user.entity.ts`; the old `*.entity.ts` rule missed the first and the old directory list missed the second. Requiring an import of `typeorm` keeps MikroORM's identical `@Entity()` out. Rejected: reading the DataSource `entities` globs, which are often built at runtime (`__dirname + '/**/*.entity{.ts,.js}'`).
- **Name entities by class.** Prisma and Mongoose name entities by model, and the class is what code and docs refer to. The table name is kept as `table`, and guard accepts either, so a DATA-MODEL.md that documents `users` still passes. Rejected: the table name (guard's old choice), which renames entities with no table name differently from those with one.
- **Relations are relationships, not columns; implied columns are not listed.** Prisma already lists relation fields as relationships only. Listing an implied foreign key or Sequelize timestamp would state a column the code does not declare.
- **Draw each relation from its owning side.** TypeORM requires a `@OneToMany` to have a `@ManyToOne` inverse, and the join decorator marks the owner of the other two kinds, so the owner draws the edge and an inverse draws one only when its counterpart was not scanned.
- **Sequelize is a small addition.** Its models live in the same files and directories, and their attributes are object literals the existing helpers read. Knex is not: its tables are a sequence of migrations.
- **Report the tier per entity.** Drizzle and Mongoose do not; Python models do. A TypeORM entity read by pattern marks the plan's entity surface partial (`surfaceTier`), which is what the fallback is.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IV (validator isolation) | Schema-Sync keeps calling the shared scanner, as it does for Prisma, Drizzle and Mongoose; no validator calls another. |
| IX (honest assurance) | Each entity states the tier that read it; docs list what is and is not read per ORM. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/js-ast.mjs              # FR-002, FR-005, FR-006: decorated-class and Sequelize extraction
cli/scanners/schemas.mjs             # FR-001..FR-007: discovery, readers, header
cli/validators/schema-sync.mjs       # FR-007
tests/fixtures/orm-class-projects.mjs  # NEW: TypeORM and Sequelize fixtures with truth
tests/typeorm-models.test.mjs        # NEW
docs/reference/languages.md, docs/commands.md, docs-canonical/ARCHITECTURE.md, CHANGELOG.md, cli/commands/explain.mjs, llms-full.txt   # FR-008
```
