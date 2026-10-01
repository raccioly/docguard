# Feature Specification: Accurate JS/TS Extraction for Express and Next.js Projects

**Feature Branch**: `fix/js-ts-extraction`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.js-ts-extraction`

**Lineage**:
- Corrects facts that `docguard.adoption-workflow-integrity` (route scanning,
  mount prefixes) and `docguard.as-built-specs` (as-built facts, SPR007) rely on.
- Feeds `docguard.code-derived-diagrams` (entity and module diagrams) and
  `docguard.symbol-map` (import-graph ranking), which were right about the
  edges they saw but saw too few.
- Runs beside `docguard.fallback-language-coverage` (spec 043, other languages)
  and `docguard.generated-docs-consistency` (spec 044, the generated
  documents). This spec fixes what the JS/TS scanners extract; 044 decides how
  generators present it. The env read-site data this spec records uses the
  shape 044 consumes.

**Input**: Scratch Express and Next.js projects scanned with `generate`,
`generate --plan`, `generate --spec` and `guard`. Ten extraction defects were
confirmed against a hand-written ground truth.

## Problem

DocGuard documents a JS/TS project from what its scanners extract. On two
ordinary projects the extraction was wrong in ways a reader cannot see:

- **Express** (routers, a mount with auth middleware, Mongoose models in
  `lib/models`, a `@/` path alias, env read by destructuring):
  - 1 of 8 routes found, and 3 reported at the wrong path;
  - 1 of 8 auth flags correct;
  - 0 of 3 entities;
  - 1 of 5 env vars;
  - 5 of 8 module-graph edges.
- **Next.js** (App Router, `pages/`, `components/`, Drizzle in `lib/db` named
  by `drizzle.config.ts`, `@/` alias):
  - 3 of 6 auth flags correct;
  - 0 of 3 entities, while guard's schema check found all 3;
  - 2 of 4 env vars;
  - 1 of 8 module-graph edges;
  - React and Drizzle missing from the tech stack.
- **Prisma**:
  - enums listed as entities;
  - relations drawn twice;
  - a model body cut short by `@default("{}")`.

The causes:
1. `router.route('/x').get(h).post(h)` chains are skipped: only a plain
   identifier receiver is read.
2. Auth is judged from the text of the whole route file, so:
   - middleware added at a mount point is ignored;
   - one `req.user` anywhere marks every route in the file as protected.
3. `const { A, B = 'x' } = process.env` is not read, and no read records
   whether the code supplies a default.
4. Next.js `pages/` and `components/` are not source roots, so the env reads
   in them are never scanned.
5. Imports through `compilerOptions.paths` (`@/lib/x`) are dropped. This
   affects the module graph, the symbol-map ranking, `impact` and Express
   mount resolution.
6. Drizzle schemas are found only in a fixed directory list:
   - `drizzle.config.*` is not read;
   - `src/db` and `src` are both walked, so each table appears twice;
   - a column with an options argument, a multi-line chain or a
     `.references(..., { onDelete })` loses its field or relation;
   - types render as `integer__auto_` and `priorityEnum`.
7. Mongoose:
   - `{ type: String, required: true }` becomes a field named `type`;
   - nested objects leak their inner keys;
   - `ref:` relations and array refs are lost;
   - `lib/models` is never scanned.
8. Prisma:
   - enums are entities;
   - both sides of a relation are drawn;
   - back-reference fields are listed as scalar columns;
   - the stack table has no ORM or UI library.
9. The as-built spec for a Next.js area lists each handler twice (as the
   export `route.ts#GET` and as the route), so SPR007 reports each drift
   twice. Route and env facts carry no line, and env facts no file, although
   the docs promise a file citation.
10. Guard's schema check and generate's scanner discover entities
    independently and disagree.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Express routes and their auth are right (Priority: P1)

A maintainer runs `generate` on an Express API that mounts routers under a
prefix, adds auth at the mount, and declares routes with `router.route()`.

**Acceptance Scenarios**:

1. **Given** `router.route('/').get(a).post(b)` in a router mounted at
   `/api/orders`, **Then** `GET /api/orders` and `POST /api/orders` are
   reported once each.
2. **Given** `apiRouter.use('/orders', requireAuth, ordersRouter)`, **Then**
   every orders route is authenticated.
3. **Given** a users router where only `/me` takes `requireAuth` and its
   handler reads `req.user`, **Then** `/login` and `/register` are not
   authenticated.
4. **Given** the app imports its router as `@/routes`, **Then** the `/api`
   mount still applies.

### User Story 2 - Next.js facts are complete and counted once (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `pages/index.tsx` and `components/Header.tsx` read
   `process.env.NEXT_PUBLIC_*`, **Then** both names are reported.
2. **Given** a route file whose `POST` checks a session and whose `GET` does
   not, **Then** only `POST` is authenticated.
3. **Given** `middleware.ts` re-exports `next-auth/middleware` with a matcher
   `/api/admin/:path*`, **Then** `GET /api/admin/stats` is authenticated.
4. **Given** `generate --spec app/api/projects`, **Then** each handler
   appears once, as a route fact citing its file and line.

### User Story 3 - Entities and relations match the schema (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `drizzle.config.ts` names `./lib/db/schema.ts`, **Then** its three
   tables, every column and both `.references()` relations are reported.
2. **Given** the same schema in `src/db` with no config, **Then** each table
   is reported once.
3. **Given** Mongoose models in `lib/models` with nested `{ type, ref }`
   fields and an array of refs, **Then** field names and both relations
   match the schema.
4. **Given** a Prisma schema with two enums and three relations, **Then**
   it reports four entities, two enums and three relationships.
5. **Given** any of these projects, **Then** guard's schema check and
   generate report the same entity names.

### User Story 4 - Aliased imports are graph edges (Priority: P2)

**Acceptance Scenarios**:

1. **Given** `tsconfig.json` extends a base that maps `@/*` to `src/*`,
   **When** `src/app.ts` imports `@/config`, **Then** the import graph has
   the edge `src/app.ts → src/config.ts`.
2. **Given** an import of a real package (`express`), **Then** no edge is
   added.

### Edge Cases

- **A regex-fallback file** (the parser is unavailable or the file does not
  parse). Route chains, auth on the route's own arguments, and Drizzle and
  Mongoose fields are still read by pattern. Mounts stay AST-only, as today.
- **A named handler** (`router.get('/x', getOrder)`) defined in the same
  file: its body counts as the route's own handler.
- **Auth middleware registered after a route** does not protect it: Express
  applies middleware in order.
- **`...rest` in an env destructuring**: not a variable name; ignored.
- **A variable read with and without a default**: every site is recorded;
  a consumer derives Required from all of them.
- **tsconfig `extends` cycles or a missing base**: resolution stops; the
  imports that cannot resolve are left out, never guessed.
- **A `paths` target that does not exist on disk**: no edge.
- **A glob in `drizzle.config` `schema`** (`./src/db/schema/*.ts`): the
  matching files are read.
- **A Prisma model field typed by an enum**: a scalar field, not a relation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Express scanner MUST report every method of a
  `<receiver>.route('<path>').<method>(...)` chain, including `app.route()`,
  with mount prefixes applied. The regex fallback MUST read the same chains.
- **FR-002**: A JS/TS route MUST be marked authenticated only from evidence
  that applies to that route:
  - auth middleware among its own arguments;
  - auth middleware on a mount above it;
  - `use(auth)` on its receiver before it;
  - an auth check in its own handler (inline, a same-file named function, or
    a Next.js exported handler);
  - a Next.js `middleware` file with auth whose matcher covers its path.

  Text elsewhere in the file MUST NOT mark it.
- **FR-003**: The env scan MUST read names destructured from `process.env` or
  `import.meta.env`, with defaults (`A = 'x'`) and renames (`A: a`). It MUST
  record every read site (file, line, whether the code supplies a default,
  and the literal default) on the result's `sites` map. A read site with a
  default is:
  - a destructuring default;
  - `?? x` or `|| x` after a dotted or bracket read.
- **FR-004**: In a Next.js project (a `next` dependency or a `next.config.*`
  file), the source roots MUST include:
  - `pages/`, `components/`, `hooks/` and `utils/` (their `src/` forms are
    already under the `src` root);
  - for env reads, root `middleware.*`, `instrumentation.*` and
    `next.config.*`.

  Other projects' roots MUST be unchanged.
- **FR-005**: The import graph MUST resolve a non-relative specifier through
  the nearest `tsconfig.json` or `jsconfig.json`:
  - `compilerOptions.paths` and `baseUrl`, following `extends` to relative
    files and to package configs under `node_modules`;
  - comments and trailing commas are tolerated;
  - `extends` is followed at most 8 levels deep; a cycle stops it.

  A specifier that resolves to no project file adds no edge. Express mount
  resolution MUST use the same resolver. Nothing is written.
- **FR-006**: Drizzle discovery MUST:
  - read `drizzle.config.*` `schema` first (a file, directory, glob or
    array);
  - otherwise search the source roots for files that build tables from
    `drizzle-orm`;
  - scan each file once.

  Column parsing MUST keep:
  - columns with an options argument and multi-line chains;
  - `.references(() => t.col, {...})` as a relation to `t`'s table name;
  - enum columns typed `enum`, and `serial` typed `serial`.

  ER diagram types MUST be Mermaid-safe base types.
- **FR-007**: Mongoose parsing MUST read:
  - `{ type: X, required, unique, default, ref }` as one field of type X;
  - a nested object without `type` as one `object` field;
  - `[X]` and `[{ type: ObjectId, ref: 'Y' }]` as arrays, the latter a
    relation to Y.

  The entity is named by `model('Name', schema)` when present. Discovery
  MUST cover `lib/models` and any source-root file that constructs a
  Mongoose `Schema`, each file once.
- **FR-008**: Prisma parsing MUST:
  - report enums separately from entities;
  - report each relation once (the `@relation` side; an implicit
    many-to-many once);
  - leave back-reference fields out of the scalar fields;
  - read model bodies whose attributes contain braces.

  The project profile MUST name the ORM, UI and auth libraries it finds in
  dependencies (Prisma, Drizzle, Mongoose, TypeORM, Sequelize, React, Vue,
  NextAuth.js, and so on), and the plan's tech-stack table MUST show them.
- **FR-009**: As-built facts MUST:
  - not list a Next.js route handler export as a separate export fact when
    a route fact from the same file and method exists;
  - give route facts the line of their registration or handler;
  - give env facts the file and line of their first read under the area.
- **FR-010**: Guard's schema check and generate's scanner MUST discover
  Prisma, Drizzle and Mongoose entities through one shared function and
  report the same names.
- **FR-011**: The docs MUST describe the scanned forms (route chains,
  per-route auth, env destructuring and read sites, Next.js roots, path
  aliases, Drizzle config discovery, Mongoose nested fields, Prisma enums):
  - `docs-canonical/ARCHITECTURE.md` (scanner and import-graph rows);
  - `docs/commands.md` (`generate` and as-built citations);
  - the CHANGELOG.

## Success Criteria *(mandatory)*

- **SC-001**: On the Express fixture, all 8 routes are found at the right
  path with the right auth flag (before: 1 found, 1 flag right).
- **SC-002**: On the Next.js fixture:
  - 6 of 6 auth flags are correct (before: 3);
  - 4 of 4 env vars are found, with the right default flag (before: 2);
  - 8 of 8 module edges are found (before: 1).
- **SC-003**: On the Express, Next.js and Prisma fixtures:
  - every entity is found once with exactly the written field names;
  - every relationship is found once, with none extra;
  - the regex fallback finds the same Drizzle and Mongoose entity names.
- **SC-004**: Guard's schema check and generate's scanner report the same
  entity set on all three fixtures.
- **SC-005**: The stack names Express, Mongoose, TypeScript; Next.js, React,
  Drizzle, NextAuth.js, TypeScript; and Express, Prisma, for the three
  fixtures.
- **SC-006**: An as-built spec of the Next.js `app/api/projects` area lists
  each handler once, and every route and env fact cites a file and line.

## Assumptions

- Auth evidence is recognised by name (`requireAuth`, `authenticate`,
  `passport.authenticate(...)`, `getServerSession`, `jwt.verify`,
  `next-auth/middleware`, ...), as it is today. A custom name that
  says nothing about auth is not recognised; that is the existing limitation,
  now applied per route instead of per file.
- A Next.js matcher is read when it is a string literal or an array of
  string literals.
- tsconfig `paths` targets are resolved with the same extensions and index
  files as relative imports.

## Out of Scope

- Route and env scanning for other languages (spec 043).
- How generated documents present Required, defaults and handlers (spec 044).
- Layer checks in the Architecture validator, which compare import specifier
  text with configured directories and are unchanged.
- Executing any project code or config: tsconfig, drizzle config and Next.js
  middleware are read as text or syntax trees.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `d17dee0a5924795582cae3b0fcd97bfdbad93c76` — Reviewed at d17dee0 on main: all 10 tasks are checked and were delivered by #503, #508; the full suite (2909 tests) passes and guard reports 0 errors at this revision. Evidence: `cli/scanners/as-built.mjs`, `cli/scanners/import-graph.mjs`, `cli/scanners/js-ast.mjs`, `cli/scanners/memory-plan.mjs`, `cli/scanners/project-type.mjs`, `cli/scanners/routes.mjs`, `cli/scanners/schemas.mjs`, `cli/scanners/ts-paths.mjs`, `cli/shared-source.mjs`, `docs-canonical/ARCHITECTURE.md`, `tests/fixtures/js-ts-projects.mjs`, `tests/js-ts-extraction.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
