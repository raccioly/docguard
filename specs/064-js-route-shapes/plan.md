# Implementation Plan: Koa Mounts, Cloudflare Pages Functions and Hono OpenAPI Routes

**Branch**: `spec/064-js-route-shapes` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

Two readers grow and one is added; the dispatch in `routes.mjs` changes by a few lines:

| FR | Change |
|---|---|
| FR-001 | `cli/scanners/router-routes.mjs` reads Koa: `@koa/router`/`koa-router` routers and Koa applications are nodes; the `prefix` option and `router.prefix()` set a node's base; `use(path?, sub.routes())`, `app.use(sub.routes())` and koa-mount's `mount(path?, x)` are edges, with auth middleware beside a mount on the edge. CommonJS `require()`/`module.exports` bind like `import`/`export`. `routes.mjs` runs it for Koa through `patternScan`, so Koa routes carry tiers and limitations; the method-shorthand Koa walker (`scanHonoRoutes`) is removed. |
| FR-002 | `isPagesProject()` in `cli/shared-source.mjs` (next to `hasWorkerConfig`); `classify()` in `cli/scanners/project-type.mjs` checks it before the Workers label. |
| FR-003 | New `cli/scanners/pages-routes.mjs`, `extractPagesRoutes(sources)`: the `onRequest*` exports of each file under `functions/`, the path from the file's location, `_middleware` auth by directory and method, router delegation skipped. `routes.mjs` runs it with the router reader for Pages projects, as the Workers scan does. |
| FR-004 | `router-routes.mjs`: `openapi(route, handler)` calls; `createRoute({...})` definitions bound to variables are collected per file and resolved across files through the same alias/export maps as routers; `{param}` → `:param`; `doc()`/`doc31()` on an `OpenAPIHono` value. |
| FR-005 | Unresolved prefixes mark the router node `unresolved`; unresolved mount paths become edges marked `unresolved`; `effective()` yields no chain through either, so the routes below are omitted rather than reported at the root. Limitations go to `scan.unresolved` as in spec 058. |
| FR-006 | `docs/reference/languages.md`, `docs/commands.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`, `llms` bundle. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new; `@babel/parser` (already the runtime dependency, loaded optionally)
**Testing**: `node:test`. `tests/js-route-shapes.test.mjs` writes three reference projects from `tests/fixtures/js-route-shape-projects.mjs` to temp directories, each with a hand-written truth, and asserts the scan reports exactly that set; focused cases cover each form, the pattern fallback, the limitations, the labels and the coverage reason.

## Research decisions

- **Koa moves to the router reader.** Koa's composition (`prefix`, `use(path, sub.routes())`, koa-mount) has the shape the router graph already models for Hono (`basePath`, `route()`): a node with a base and edges carrying prefixes, resolved across files. A comparison on a scratch Koa project (method shorthand on bound and router-named receivers, `all`/`head`/`options`, same-file constants, `use(auth)`, `withAuth(h)` handlers) gave the same routes and auth flags from both scanners. Rejected: keeping the method-shorthand scanner and adding a Koa mount pass to it — a second prefix composer beside the one Hono uses, and no tiers or limitations for Koa. One deliberate difference: a template path with an unresolvable `${…}` was reported as `/x/:param`; it is now a limitation, the rule every reader since spec 047 follows.
- **A Koa `use()` path is a prefix.** koa-router matches `use('/admin', mw)` against `/admin` and every path under it, where Hono needs `/admin/*`. The coverage test takes the node's kind into account.
- **Unresolved prefixes hide the routes below them.** Before, an itty-router `base` or Hono `basePath`/`route()` prefix that was not literal was recorded, and the routes were still reported without it — a guessed path. Now the router is marked unresolved and its routes, and those of routers mounted below it, are omitted; the prefix is the one recorded limitation.
- **Pages is its own label, checked first.** A Pages project may have a `wrangler.toml`, which the Workers check would claim, and its routes are files, not a `fetch` entry. `pages_build_output_dir` is what makes a Wrangler file a Pages configuration. Without a Wrangler file, an `onRequest` export under `functions/` is the signal; Firebase's `functions/` exports handlers under other names (`export const api = onRequest(app)`), so it is not matched. Rejected: reading `functions/` in every project — a Firebase or Netlify `functions/` tree is not file-routed this way.
- **Catch-all as `:name*`.** The Next.js reader renders `[...slug]` as `:slug*`; Pages `[[path]]` is the same kind of segment and is rendered the same way.
- **Middleware scope by directory and method.** A `_middleware` file runs before every Function in its directory and below; a middleware that exports only `onRequestPost` runs only for `POST`. Auth evidence follows that scope.
- **Delegation is not a route.** `export const onRequest = handle(app)` serves a Hono app from a catch-all file; reporting `ALL /api/:route*` would invent an endpoint while the app's real routes are read by the router reader.
- **OpenAPI parameters as Hono serves them.** OpenAPIHono rewrites `/{id}` to `/:id` before registering, and every other Hono route is reported with `:id`, so the reader does the same rewrite. `security` in a route definition is OpenAPI documentation, like Swagger decorators in spec 058, so it is not auth evidence; the definition's `middleware` is.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | Unresolvable paths are limitations that lower coverage; routes below an unresolved prefix are omitted, not reported at a guessed path; routes carry the tier they were read by. |
| X (spec-first) | Spec, plan and tasks precede code; tests are written first and seen failing. |

Pass.

## Project Structure

```text
cli/scanners/router-routes.mjs        # FR-001, FR-004, FR-005: Koa, CommonJS, zod-openapi, unresolved prefixes
cli/scanners/pages-routes.mjs         # NEW — FR-003, FR-005
cli/scanners/routes.mjs               # dispatch: Koa and Pages through patternScan; old Koa walker removed
cli/scanners/project-type.mjs         # FR-002 label
cli/shared-source.mjs                 # FR-002 isPagesProject
tests/fixtures/js-route-shape-projects.mjs  # NEW
tests/js-route-shapes.test.mjs              # NEW
docs/reference/languages.md, docs/commands.md, docs-canonical/ARCHITECTURE.md, CHANGELOG.md, llms.txt, llms-full.txt   # FR-006
```
