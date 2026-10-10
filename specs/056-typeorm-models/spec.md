# Feature Specification: TypeORM and Sequelize Models in Every Consumer

**Feature Branch**: `spec/056-typeorm-models`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.typeorm-models`

**Lineage**: Extends `docguard.js-ts-extraction` (spec 045), whose shared ORM discovery (`scanOrmEntities`) covers Prisma, Drizzle and Mongoose only. Found while verifying the Languages and Frameworks reference (`docguard.user-documentation`, spec 053) and deferred by `docguard.docs-verification-findings` (spec 054). Closes #520.

**Input**: "TypeORM entities are read by guard's Schema-Sync check but not by `generate` (DATA-MODEL entity tables / `generate --plan`) nor `docguard diff`. Make TypeORM a first-class model source shared by all three consumers."

## Problem

1. **`generate` and `diff` do not read TypeORM.** The header of `cli/scanners/schemas.mjs` lists TypeORM, but `scanSchemasDeep` never reads an `@Entity()` class. A TypeORM project gets an empty entity table and ER diagram from `generate` and `generate --plan`, and `diff` skips its Data Entities section.
2. **Guard reads TypeORM by a different, narrower rule.** The Schema-Sync check matches `@Entity` in `*.entity.ts` / `*.entity.js` files under `src/entities`, `src/entity` or `entities` only. A TypeORM project laid out the way `typeorm init` lays it out (`src/entity/User.ts`) or the way NestJS does (`src/users/user.entity.ts`) is not read, and the name it reports is the table name when one is given, not the class name.
3. **Sequelize has the same split, and guard's pattern misses `Model.init`.** Guard matches `.init('X')`, but `Model.init` takes the attributes object first (`User.init({ … }, { sequelize, modelName: 'User' })`), so only `sequelize.define('X', …)` models are found. `generate` and `diff` read no Sequelize model.
4. **The docs overstate.** The `schemas.mjs` header and a comment in it name ORMs it does not read, and `docs/reference/languages.md` lists TypeORM and Sequelize as `guard` only, by name.
5. **Drizzle and Mongoose entities carry no parser tier.** A Drizzle or Mongoose schema file that does not parse is read by pattern, but nothing says so: the plan's entity surface stays "complete".
6. **Mongoose escapes the Zod rule.** Zod schemas are meant to be the data model only when no ORM entity is found, but Mongoose entities were added after that check, so a Mongoose project with Zod schemas reported both. A Zod-only project also listed each schema twice, because `src/schemas` was walked once on its own and again inside `src`.
7. **SCH001's help names a partial list** of the model sources guard reads (no Mongoose, SQLAlchemy or SQLModel).
8. **Entities whose decorators come through a local module were lost.** Requiring a direct `typeorm` import drops an entity that imports `{ Entity, Column }` from a project barrel (`../orm`, `@/orm`, a workspace package) that re-exports `typeorm`, which guard's old `*.entity.ts` rule would have read.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A TypeORM project gets its data model documented (Priority: P1)

1. **Given** a TypeORM project with `@Entity()` classes, **When** `generate` runs, **Then** DATA-MODEL.md lists every entity with its columns, types, nullability, primary keys, unique columns and defaults, and the ER diagram draws each relation once.
2. **Given** an entity that extends an abstract base class declaring `id`, `createdAt` and `updatedAt`, **Then** the entity's columns include the inherited ones, and the base class is not an entity.
3. **Given** the same project, **When** `generate --plan` runs, **Then** the plan's entity surface lists the same entities and fields.
4. **Given** a DATA-MODEL.md that documents some of the entities, **When** `diff` runs, **Then** the Data Entities section lists the undocumented ones as in code only.

### User Story 2 - Guard, generate and diff name the same models (Priority: P1)

1. **Given** a TypeORM or Sequelize project, **Then** guard's Schema-Sync check and `generate` report the same entity names.
2. **Given** an entity file in `src/entity/User.ts` (no `.entity.` suffix) or `src/users/user.entity.ts`, **Then** both find it.

### User Story 3 - A file that does not parse is still read, and says so (Priority: P2)

1. **Given** an entity file with a syntax error, **Then** its entities, columns and relations are read by pattern, and each entity reports the `regex-fallback` tier, so the plan marks its entity surface partial.

### User Story 5 - Every JS/TS ORM reports its tier and follows the Zod rule (Priority: P2)

1. **Given** a Drizzle or Mongoose schema file that does not parse, **Then** its entities report `regex-fallback` and the plan marks its entity surface partial.
2. **Given** a Mongoose project with Zod schemas, **Then** only the Mongoose models are reported; **Given** a Zod-only project, **Then** each schema is reported once.

### User Story 6 - Barrel imports (Priority: P2)

1. **Given** an entity importing its decorators from a relative barrel, a tsconfig path alias or a workspace package that re-exports `typeorm`, **Then** it is read; **Given** a barrel that re-exports `@mikro-orm/core`, **Then** it is not.

### User Story 4 - Sequelize models are read the same way (Priority: P2)

1. **Given** models declared with `sequelize.define('User', { … })` or `User.init({ … }, { sequelize, modelName })`, **Then** every consumer lists them with their declared attributes, and `belongsTo` / `hasMany` / `hasOne` / `belongsToMany` associations are drawn once.

## Requirements *(mandatory)*

- **FR-001**: TypeORM entities MUST be discovered once, by the discovery Prisma, Drizzle and Mongoose use (`discoverOrmSchemaFiles`): JS/TS files under the conventional schema directories (now including `entities` and `entity`) and the source roots, that import `typeorm` and use an `@Entity` or column decorator. Test, fixture and ignored files are excluded as for the other ORMs.
- **FR-002**: An `@Entity()` class MUST be reported as one entity named by its class, with the table name from `@Entity('name')` or `@Entity({ name })` kept as `table` when given. Each column decorator (`@Column`, `@PrimaryGeneratedColumn`, `@PrimaryColumn`, `@CreateDateColumn`, `@UpdateDateColumn`, `@DeleteDateColumn`, `@VersionColumn`) MUST produce one field: type from the decorator (`@Column('varchar')`, `{ type }`, `@PrimaryGeneratedColumn('uuid')`) or else the property's TypeScript type; `required` false only for `nullable: true` (and for `@DeleteDateColumn` unless `nullable: false`); `primaryKey` for the primary decorators and `primary: true`; `unique` from `unique: true`; `default` from `default:`; `description` from `comment:`.
- **FR-003**: Relation decorators (`@ManyToOne`, `@OneToMany`, `@OneToOne`, `@ManyToMany`) MUST produce relationships, not fields. Each relation MUST be drawn once: from the `@ManyToOne` side, the `@JoinColumn` side of a one-to-one and the `@JoinTable` side of a many-to-many. An inverse side is drawn only when its counterpart is not found.
- **FR-004**: A class that `extends` another class declared in a scanned file MUST inherit that class's columns and relations (base first, transitively). A class without `@Entity` MUST NOT be reported as an entity.
- **FR-005**: Entities MUST be read from the syntax tree (`js-ast`) when the file parses, and by pattern from the same text otherwise, with the same fields and relations. Every TypeORM and Sequelize entity MUST carry the tier that read it (`js-ast` or `regex-fallback`, with a reason) and the line of its declaration.
- **FR-006**: Sequelize models declared with `sequelize.define('Name', { … }, options?)` or `Name.init({ … }, { sequelize, modelName?, tableName? })` MUST be read through the same discovery (files that reference `sequelize` and call `define` or `init`), with their declared attributes: `DataTypes.X` or `{ type, allowNull, primaryKey, unique, defaultValue, comment }`. `required` is true only for `allowNull: false` or a primary key. Associations (`belongsTo`, `hasMany`, `hasOne`, `belongsToMany`) MUST be drawn once each: from the `belongsTo` side when both sides are declared, and a many-to-many once.
- **FR-007**: `scanSchemasDeep` (used by `generate`, `generate --plan`, `generate --spec` and `diff`) and guard's Schema-Sync check MUST both take TypeORM and Sequelize models from `scanOrmEntities`, so they report the same names. Guard MUST accept either the class name or the table name as documented. The separate TypeORM and Sequelize patterns in `cli/validators/schema-sync.mjs` MUST be removed.
- **FR-009**: Drizzle and Mongoose entities MUST carry the tier that read them (`js-ast`, or `regex-fallback` with a reason), like TypeORM and Sequelize, so a pattern-read Drizzle or Mongoose file marks the plan's entity surface partial.
- **FR-010**: Zod schemas MUST be the data model only when no Prisma, Drizzle, Mongoose, TypeORM or Sequelize entity is found, and each Zod schema MUST be reported once.
- **FR-011**: SCH001's help (`cli/findings.mjs`, and the generated `docs/reference/findings.md`) MUST name every model source the Schema-Sync check reads: Prisma, Drizzle, Mongoose, TypeORM, Sequelize, Django, SQLAlchemy, SQLModel, and Knex and Rails migration tables.
- **FR-012**: A file MUST count as TypeORM when the decorators it uses are imported from `typeorm` directly or through local modules that re-export it — relative imports, tsconfig path aliases and workspace packages, up to three modules away. Only imports that bring in a decorator name or a namespace are followed from the entity file, so an entity of another ORM that imports a TypeORM data source is not read.
- **FR-008**: The `schemas.mjs` header and comments, `docs/reference/languages.md`, `docs/commands.md`, `docs-canonical/ARCHITECTURE.md` and the CHANGELOG MUST state what is read for TypeORM, Sequelize and Knex, and by which consumers. Knex stays `guard` only, by table name.

## Success Criteria *(mandatory)*

- **SC-001**: On fixtures with a hand-written truth (entities, fields with type, required, primary and unique, relations, inheritance; Sequelize models and associations), each behaviour above has a test that fails before the change and passes after, in both parser tiers.
- **SC-002**: The full suite passes and `docguard guard` on this repository reports no new finding.

## Out of Scope

- TypeORM `EntitySchema` objects (entities declared without decorators), `@ViewEntity`, `@ChildEntity` single-table inheritance, embedded columns (`@Column(() => Address)`), class-level `@Unique([...])` and `@Index` constraints.
- Columns an ORM adds without a declaration: TypeORM's relation foreign keys (`authorId` from `@JoinColumn`), Sequelize's default `id`, `createdAt` and `updatedAt`. A declared column is listed; an implied one is not.
- `sequelize-typescript` decorators (`@Table`, `@Column` from `sequelize-typescript`) and the `through` model of a Sequelize many-to-many.
- Knex columns, and Knex tables in `generate` and `diff`: migrations add and drop columns over time, so a reader would have to replay them.
- MikroORM, which also uses `@Entity()`: files that do not import `typeorm` are not read as TypeORM.
