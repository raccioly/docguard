# Implementation Plan: Route Reader Gaps Found on Real Projects

**Branch**: `fix/real-project-route-gaps` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002 | `cli/scanners/rust-routes.mjs` gains `extractRustBuilderRoutes`, one reader for the Actix, Axum and Rocket builder APIs. It reuses the Tide reader's model: a router, scope or resource is a node, `.service()`, `.configure()`, `.nest()`, `.merge()` and `.mount()` are edges, project functions, `let` bindings, parameters and configure closures are followed, and prefixes are resolved once every file is read. Handler macros (`#[get("/p")]`) are indexed by function name and take the prefix of the node that registers them. `cli/scanners/routes.mjs` `scanRustWebRoutes` calls it instead of its three one-line patterns. |
| FR-003 | `cli/scanners/php-routes.mjs` `symfonyFileRoutes` reports a class-level route as the `__invoke` route when no method declares one. |
| FR-004 | `cli/scanners/router-routes.mjs` records `module.exports = x.routes()` / `x.middleware()` and `export default x.routes()` as an export of `x`, and reads a Koa `use()` of an imported value (not an auth middleware) as a mount with no path. |
| FR-005 | The Rust reader returns `unresolved` records; `extractSymfonyRoutes` and `extractLaravelRoutes` return `unresolved` for declarations that yield no route (Symfony) and route files no application loads (Laravel). `routes.mjs` adds them to `scan.unresolved` with the framework label. |
| FR-006 | Verified by re-running the scan on every reference project. |
| FR-007 | `docs/reference/languages.md`, `docs-canonical/DATA-MODEL.md` (`scan.unresolved` codes), `docs-canonical/ARCHITECTURE.md` (Rust reader row), `CHANGELOG.md`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new. Rust and PHP are read with the masking lexers already in `route-lexing.mjs` and `php-routes.mjs` (neither file's lexer changes).
**Testing**: `node:test`. `tests/real-project-route-gaps.test.mjs` holds minimal look-alike fixtures of each failing shape; no public project's code is vendored.

## Research decisions

- **One builder reader for Actix, Axum and Rocket, not three regexes.** The failures are composition failures: a resource's path, its method and its scope's prefix sit in different calls, often in different functions. The Tide reader already models exactly this (nodes, mounts, parameters, `let`, functions across files). Rejected: widening the single-line regexes (cannot see a prefix in another call, and is what produced 0 of 19).
- **An unknown receiver keeps the old behaviour.** A `.route("/x", get(h))` whose receiver the reader cannot evaluate is still reported at its literal path, as the regex did, so no route reported today is lost. Only a registration the reader recognises and cannot read is recorded as unresolved. Rejected: dropping unknown receivers (would regress real projects).
- **A registered handler macro takes its registration's prefix; an unregistered one keeps its own path.** Reporting both would double-count; reporting only registered ones would drop the routes of projects whose registration the reader cannot see.
- **Symfony: follow Symfony's loader.** `AnnotationClassLoader` uses the class route as the `__invoke` route only when no method has a route; otherwise it is a prefix. Same rule here, for annotations and attributes alike. Rejected: always reporting class routes (would add a bogus route for every prefixed controller).
- **Koa: mount an imported identifier only in Koa context and only when it is not an auth middleware.** Hono's `use()` never mounts a router, and an imported `requireAuth` must stay auth evidence. An edge to a module that turns out not to export a router carries no routes, so a wrong guess costs nothing.
- **Unresolved, not omitted.** Spec 064 put JavaScript readers' gaps in `scan.unresolved` with `route-unresolved-*` codes and a file and line; the Rust, Symfony and Laravel gaps join that list, so `routeScanGaps` reports them with their location. Warp and Tide keep their `omitted` records.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | A recognised declaration that yields no route is recorded; nothing is guessed. |
| X (spec-first) | Spec, plan and tasks precede code; tests fail first. |

Pass.

## Project Structure

```text
cli/scanners/rust-routes.mjs        # FR-001, FR-002, FR-005: extractRustBuilderRoutes
cli/scanners/routes.mjs             # FR-001, FR-002, FR-005: scanRustWebRoutes, scanSymfonyRoutes, scanLaravelRoutes
cli/scanners/php-routes.mjs         # FR-003, FR-005
cli/scanners/router-routes.mjs      # FR-004
tests/real-project-route-gaps.test.mjs   # NEW
docs/reference/languages.md, docs-canonical/DATA-MODEL.md, docs-canonical/ARCHITECTURE.md, CHANGELOG.md   # FR-007
```
