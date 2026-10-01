# Implementation Plan: Accurate JS/TS Extraction for Express and Next.js Projects

**Branch**: `fix/js-ts-extraction` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/scanners/js-ast.mjs`:
  - `extractJsRouteCalls` also reads `<receiver>.route('<path>').<method>()`
    chains (FR-001).
  - Each route carries its line and its own auth evidence:
    - auth middleware among its arguments;
    - an auth check in an inline or same-file named handler;
    - an earlier `use(auth)` on the same receiver (FR-002).
  - `extractJsMountsAndImports` marks a mount that passes auth middleware
    before the router (FR-002).
  - `nextRouteHandlerAuth` reads each exported App Router handler's own body
    (FR-002).
  - `extractJsSchemaBodies` returns parsed Drizzle columns and Mongoose
    fields from the syntax tree, and the Mongoose `model('Name', schema)`
    names (FR-006, FR-007).
- `cli/scanners/routes.mjs`:
  - route-chain regex fallback;
  - mount-level auth composed along the mount chain;
  - per-route auth for Express and the App Router;
  - Next.js `middleware.*` matchers;
  - alias-aware import resolution for mounts;
  - a `line` on every JS/TS route (FR-001, FR-002, FR-005, FR-009).
- `cli/scanners/ts-paths.mjs` (new): read-only `tsconfig`/`jsconfig` path
  resolution with `extends`, JSONC tolerance and per-directory caching
  (FR-005).
- `cli/scanners/import-graph.mjs`: non-relative specifiers go through the
  alias resolver (FR-005).
- `cli/shared-source.mjs`:
  - `grepEnvUsage` reads destructuring and records `sites` (name → `{ file,
    line, defaulted, default }[]`, the shape spec 044 consumes) (FR-003);
  - `resolveSourceRoots` adds the Next.js roots only for a Next.js project;
    the env scan reads the Next.js root files (FR-004).
- `cli/scanners/schemas.mjs`:
  - `discoverOrmSchemaFiles` and `scanOrmEntities`, shared with guard
    (FR-010);
  - Drizzle config-first discovery and column parsing (FR-006);
  - Mongoose nested fields, arrays, refs and model names (FR-007);
  - Prisma line parser, enums in `enums`, one edge per relation (FR-008);
  - Mermaid-safe ER types and arrows for one-to-one and many-to-many.
- `cli/validators/schema-sync.mjs`: Prisma, Drizzle and Mongoose names come
  from `scanOrmEntities` (FR-010). The other detectors are unchanged.
- `cli/writers/doc-generators.mjs`: one line, so the DATA-MODEL enum section
  reads the scanner's `enums` (FR-008).
- `cli/scanners/project-type.mjs`: `libraries` per JS/TS ecosystem.
  `cli/scanners/memory-plan.mjs`: a Libraries column in the tech-stack table,
  only when any ecosystem has one, so other projects' tables are unchanged
  (FR-008).
- `cli/scanners/as-built.mjs`:
  - drops handler exports that duplicate a route fact;
  - route and env facts cite file and line (FR-009).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (`@babel/parser` as today)
**Testing**: `node:test`.
- `tests/fixtures/js-ts-projects.mjs` writes three projects into a temp dir
  (Express + Mongoose, Next.js + Drizzle, Prisma), each with a hand-written
  ground truth.
- `tests/js-ts-extraction.test.mjs` compares every scanner with that truth.
- The regex fallback is exercised by appending a line no parser recovers
  from (a merge-conflict marker), as `tests/js-ts-extraction.test.mjs` does
  for Drizzle, Mongoose, route chains and per-route auth.

## Research decisions

- **Per-route auth evidence.**
  - Decision: auth is a property of one route. It comes from:
    - the route's own middleware arguments;
    - its own handler body;
    - an earlier `use(auth)` on its receiver;
    - an auth mount above it;
    - a Next.js middleware matcher.
  - Rationale: a file-wide text match marks public `login` and `register` as
    protected when a sibling reads `req.user`. It also misses auth added at
    the mount, which is the usual Express layout.
  - Rejected: keeping the file-wide match as a fallback. It is exactly the
    false signal the spec removes.
  - Pages Router files and non-JS frameworks keep file-level checks: one
    handler per file there, or no AST.
- **Auth names.** The existing name list (`auth`, `protect`, `requireAuth`,
  `isAuthenticated`, `authenticate`, ...) is extended with common forms
  (`passport.authenticate(...)`, `verifyToken`, `ensureLoggedIn`,
  `requireRole(...)`, `withAuth`, `clerkMiddleware`, `next-auth/middleware`).
  A bare `req.user` read is not evidence; a guard such as `if (!req.user)`
  is.
- **Env read sites.**
  - Decision: a `sites` map on the returned Set, `{ file, line, defaulted,
    default }`, the same shape spec 044's `collectEnvVars` reads.
  - Rationale: the Set stays the public contract for every existing caller.
    The sites are additive.
  - Destructuring is read lexically in both parser tiers, because the env
    scan has no AST tier for `process.env` today and the pattern is
    self-delimiting (`{ ... } = process.env`).
- **Next.js roots only for Next.js.**
  - Decision: add `pages`, `components`, `hooks` and `utils` when `next` is a
    dependency or `next.config.*` exists. Their `src/` forms are already
    under the `src` root, so adding them would walk those files twice.
  - Rationale: other projects' roots, and so every other scanner's input,
    stay byte-identical (spec 043 relies on that).
- **Path aliases.**
  - Decision:
    - the nearest `tsconfig.json`/`jsconfig.json` above the importing file;
    - `extends` followed to relative files and `node_modules` package
      configs, depth ≤ 8, cycle-safe;
    - `paths` patterns with one `*`; `baseUrl` alone also resolves;
    - comments and trailing commas stripped outside strings.
  - Rationale: this is what TypeScript and Next.js do, and aliases are the
    default in `create-next-app`.
  - A target that does not exist adds no edge.
  - Rejected: reading `package.json` `imports` (`#x`). It is rare in
    application code; left for later.
- **One entity discovery.**
  - Decision: `scanOrmEntities(dir, config)` in `schemas.mjs` runs Prisma,
    Drizzle and Mongoose discovery and parsing. `scanSchemasDeep` and
    schema-sync both call it.
  - Rationale: two independent directory lists drifted (guard found the
    `lib/db` tables; generate did not). Sharing the function makes
    agreement structural, and a test asserts it on every fixture.
  - schema-sync keeps its TypeORM, Sequelize, Knex, Django and Rails
    detectors, which the deep scanner does not implement for those names.
- **Drizzle discovery order.**
  1. `drizzle.config.*` `schema` (file, directory, glob or array), relative
     to the config's directory.
  2. Otherwise, a walk of the conventional dirs (`db`, `schema`, `drizzle`)
     and the source roots, keeping files that import a `drizzle-orm/*-core`
     module and call a table builder.

  Files are deduplicated by absolute path, which removes the `src/db` +
  `src` double count.
- **Types.** Drizzle `serial` → `serial`. A column built from a `pgEnum`
  binding → `enum`. ER diagram fields print the first word of the type,
  Mermaid-safe, so `integer (auto)` can never render as `integer__auto_`.
- **Prisma relations.**
  - The side with `@relation(fields: ...)` owns the edge:
    - `many-to-one`;
    - `one-to-one` when the other side is not a list.
  - Two list sides without `@relation` form one `many-to-many` edge, emitted
    by the alphabetically first model.
  - A back-reference with neither emits nothing.
- **Enums.** `scanSchemasDeep` returns `enums` next to `entities`. The
  DATA-MODEL writer appends them to its entity list with the source tag it
  already filters on. That is one line, so spec 044's work in the same file
  is untouched.
- **As-built duplicates.** A JS/TS export is dropped from the facts when a
  route fact exists for the same file and either:
  - its name is that route's HTTP method (App Router);
  - it is `default` in a Pages Router API file.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. `@babel/parser` stays optional-load; every path has a regex fallback or keeps today's behaviour when it is absent. |
| IV (no validator imports a validator) | schema-sync imports the scanner `schemas.mjs`, as it already imports `shared-source.mjs`. |
| VII (read-only analysis) | tsconfig, drizzle config and middleware files are read as text or syntax trees; nothing is executed or written. |
| IX (honest assurance) | Auth, env and entities are claimed only from evidence at the route, read site or schema. Unresolvable aliases add no edge rather than a guessed one. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/js-ast.mjs          # route chains, per-route auth, schema fields
cli/scanners/routes.mjs          # mounts with auth, Next.js auth, lines, aliases
cli/scanners/ts-paths.mjs        # NEW: tsconfig/jsconfig paths
cli/scanners/import-graph.mjs    # alias edges
cli/shared-source.mjs            # env destructuring + sites, Next.js roots
cli/scanners/schemas.mjs         # shared discovery, Drizzle/Mongoose/Prisma
cli/validators/schema-sync.mjs   # shared discovery
cli/writers/doc-generators.mjs   # enums line
cli/scanners/project-type.mjs    # libraries
cli/scanners/memory-plan.mjs     # Libraries column
cli/scanners/as-built.mjs        # dedupe, citations
tests/fixtures/js-ts-projects.mjs      # NEW: fixtures + ground truth
tests/js-ts-extraction.test.mjs        # NEW
docs-canonical/ARCHITECTURE.md, docs/commands.md, CHANGELOG.md
testguard.claims.json            # JS-TS-EXTRACTION-MATCHES-TRUTH
```
