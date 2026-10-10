# Implementation Plan: NestJS and Cloudflare Workers Route Extraction

**Branch**: `spec/058-js-framework-routes` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

Three readers, each a function from file contents to route records, in their own modules so the dispatch in `routes.mjs` stays a few lines (two sibling specs, 059 and 060, add readers to the same dispatcher in parallel):

| FR | Change |
|---|---|
| FR-001, FR-002, FR-003 | `cli/scanners/nest-routes.mjs` — `extractNestRoutes(sources)`: one syntax-tree pass per file collects controllers, method decorators, guards, `@Module` controller lists, `RouterModule` tables and bootstrap settings; a second step composes paths per application. Pattern fallback per unparseable file. |
| FR-004 | `cli/scanners/worker-routes.mjs` — `extractWorkerRoutes(sources, resolveImport)`: finds the public `fetch` entry, follows its imports, and reads pathname comparisons, `switch`, keyed lookups and `URLPattern`, with method context from the surrounding conditions. |
| FR-005 | `cli/scanners/router-routes.mjs` — `extractRouterRoutes(sources, resolveImport, opts)`: router nodes (Hono, itty-router, names that look like routers) with `base`/`basePath`, `route()` mount edges across files, `use()` auth, then prefix composition. |
| FR-006 | Each reader attaches `tier`/`tierReason` from `tierFor` and returns its `limitations` and per-file tiers. `routes.mjs` records the files with the scan and keeps the limitations in `scan.unresolved`; `routeScanGaps` in `cli/validators/api-surface.mjs` turns them into a `partial` reason. |
| FR-007 | `cli/scanners/project-type.mjs`: `@nestjs/core` is checked before `express`. `api-surface.mjs`'s `package.json` fallback names NestJS. |
| FR-008 | `docs/reference/languages.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, `llms` bundle. |

`cli/scanners/js-route-support.mjs` holds what the three share: one parse per file with its tier, served-path joining, the test-file rule, import resolution (relative and `tsconfig`-aliased) and a JavaScript lexer for the pattern fallback. `cli/scanners/js-ast.mjs` exports four existing helpers (`topLevelStaticStrings`, `pathArgValue`, `isAuthMiddlewareNode`, `functionBodies`) so the readers judge paths and auth exactly as the Express reader does.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new; `@babel/parser` (already the runtime dependency, loaded optionally, with `decorators-legacy`)
**Testing**: `node:test`. `tests/js-framework-routes.test.mjs` writes six reference projects from `tests/fixtures/js-framework-projects.mjs` to temp directories, each with a hand-written truth, and asserts the scan reports exactly that set; focused cases cover each form, the pattern fallback, the limitations and the coverage reason.

## Research decisions

- **Decorators through the syntax tree, not text.** Nest's routing is entirely decorators, and `@babel/parser` already parses them (`decorators-legacy` is on for every file). Text matching would lose which method a `@UseGuards` belongs to. Rejected: a regex-first reader like Spring's (spec 047) — Spring has no parser in DocGuard; TypeScript does. The regex stays as the per-file fallback only.
- **Nest's own path order.** Nest's `RoutePathFactory` builds `version + module path + controller path + method path`, then prepends the global prefix unless the route is excluded; the reader follows that order, so `exclude` is matched against the path without the prefix.
- **Application scope by directory.** A Nest monorepo has one `main.ts` per app. Settings found in a file apply to controllers under that file's directory; when all settings sit in one directory (a single app), they apply everywhere. Test files and test directories are skipped, because e2e specs call `setGlobalPrefix` too. Rejected: following `NestFactory.create(AppModule)` through the module import graph — exact, but it needs the whole module graph resolved, and the directory rule gives the same answer for the standard layouts.
- **Guards signal auth by name, minus the `Guard` suffix.** `isAuthMiddlewareName` counts the word `guard` as auth, which in Nest would mark `ThrottlerGuard` as auth. The reader strips `Guard` and reads the rest (`JwtAuth`, `Roles`, `ApiKey`).
- **Worker dispatch is read from the entry outward.** A Durable Object's `fetch` handles internal stub calls, not public HTTP, and browser code compares `location.pathname`. Reading only the public entry and its imports, and skipping other classes, keeps both out. Rejected: every `pathname` comparison in the project — simpler, and wrong on exactly those two shapes.
- **Prefix dispatch is a limitation, not a route.** `if (url.pathname.startsWith('/api/'))` delegates somewhere the reader cannot enumerate. Reporting `ALL /api/*` would invent an endpoint; omitting it silently would claim completeness. It is recorded and lowers coverage.
- **One Hono reader for Workers and plain Hono.** The same Hono code must read the same with or without `wrangler.toml`. The new router reader keeps the old one's reach (any receiver named like a router) and adds prefixes. Koa stays on the old scanner (its mount form is `router.use('/x', sub.routes())`, a different shape).

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | Unresolvable paths are limitations that lower coverage; routes carry the tier they were read by. |
| X (spec-first) | Spec, plan and tasks precede code; tests are written first. |

Pass.

## Project Structure

```text
cli/scanners/nest-routes.mjs          # NEW — FR-001, FR-002, FR-003, FR-006
cli/scanners/worker-routes.mjs        # NEW — FR-004, FR-006
cli/scanners/router-routes.mjs          # NEW — FR-005, FR-006
cli/scanners/js-route-support.mjs     # NEW — shared parse/tier, path joining, import resolution, pattern lexer
cli/scanners/js-ast.mjs               # helper exports
cli/scanners/routes.mjs               # dispatch, scan.unresolved
cli/scanners/project-type.mjs         # FR-007
cli/validators/api-surface.mjs        # FR-006 coverage reason, FR-007 fallback
tests/fixtures/js-framework-projects.mjs  # NEW
tests/js-framework-routes.test.mjs        # NEW
docs/reference/languages.md, docs/commands.md, docs-canonical/ARCHITECTURE.md, CHANGELOG.md, llms.txt, llms-full.txt   # FR-008
```
