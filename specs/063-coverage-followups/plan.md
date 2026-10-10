# Implementation Plan: Coverage Follow-ups From Specs 056–061

**Branch**: `spec/063-coverage-followups` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | `cli/scanners/memory-plan.mjs` `surfaceTier` separates the two channels: `degraded` from `regex-fallback` counts only, `patternRead`/`patternLanguages` from `fallback-language` counts. Partial sections and the note name the cause. `cli/commands/generate.mjs` prints the pattern-read surfaces. `cli/scanners/schemas.mjs` stamps the file tier on Go, Rust, JPA and Rails entities. `cli/shared-source.mjs` gains `regexFallbackCount(summary)`. |
| FR-002 | `cli/shared-ignore.mjs`: `obj` and `_build` join `DEFAULT_IGNORE_DIRS`; `isIgnoredDirEntry(name, siblings)` adds `bin` beside a .NET project file. Used by `walkFiles`, the route walkers (`routes.mjs`), the schema walker (`schemas.mjs`), the env walk (`shared-source.mjs`) and the module/test inventory (`inventory.mjs`). |
| FR-003 | `cli/scanners/routes.mjs` marks ASP.NET Core routes `caseInsensitive: true`. `cli/scanners/api-doc.mjs` `compareEndpoints` folds case for a marked route. `cli/validators/api-surface.mjs` carries the flag through `resolveApiSurface` and the OpenAPI-versus-code checks; `diff` inherits it from `resolveApiSurface`. |
| FR-004 | `cli/scanners/routes.mjs` pushes each Python limitation, tagged with its framework, into `scan.unresolved` before the non-product filter. |
| FR-005 | `cli/scanners/tech-stack.mjs` `TECH_DEPENDENCIES` gains `@angular/core`, `svelte`, `@sveltejs/kit`, `mongodb`, `mysql`, `postgres`. |
| FR-006 | `cli/commands/diff.mjs` resolves `apiReference`, `architecture`, `dataModel` and `environment` with `resolveDocRole`. |
| FR-007 | `cli/scanners/as-built.mjs` `factsTier` reports `regexRead`; `cli/commands/generate-as-built.mjs` lowers confidence on it instead of on `mixed`. |
| FR-009 | New `cli/scanners/route-case.mjs` reads each framework's case setting. `cli/scanners/routes.mjs` marks Express routes per receiver and through the mount chain (`buildExpressMountMap` carries whether every router that matched a prefix is case-insensitive), Koa routes per router, Fastify routes per project, NestJS routes per adapter; unreadable settings go to `scan.caseNotes`, which `cli/commands/diff.mjs` prints. |
| FR-010 | `cli/shared-source.mjs`: `summarizeTiers` carries `regexCauses`, `regexCause` classifies one item, `patternFallbackAdvice` writes the sentence. `cli/scanners/py-sources.mjs` keeps each file on its tier item. `memory-plan.mjs`, `as-built.mjs` and `generate-as-built.mjs` use the advice. |
| FR-008 | `docs/reference/languages.md`, `docs/commands.md`, `docs/configuration.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `CHANGELOG.md`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; one reproduction per behaviour in `tests/coverage-followups.test.mjs`, each run before its fix.

## Research decisions

- **FR-001: a separate field, not `degraded: true`.** Spec 043 distinguishes a parser that is missing or failed (`regex-fallback`, fixable by installing `python3` or fixing the syntax) from a language with no parser (`fallback-language`, nothing to install). Setting `degraded` for Go would make the existing note tell a Go user to install `python3`, and `surface.confidence: low` would say the detector is unsure when it is only incomplete. Rejected: reusing `degraded` (conflates the two causes); a `coverage` enum on the surface (one more vocabulary when spec 043's `patternOnly` already names the channel). Kept: `degraded` as defined by spec 046 FR-012, plus `patternRead` and `patternLanguages`, matching `summarizeTiers`' `patternOnly`/`fallbackLanguages`. Sections read by pattern are partial either way: what the patterns miss is missing.
- **FR-001: the `mixed` bug.** The old test `['regex-fallback', 'mixed'].includes(scanTier.tier)` fired for any polyglot scan, because `mixed` only says the items disagree. The counts `summarizeTiers` already returns (`degraded - patternOnly`) say whether any item was `regex-fallback`. FR-007 applies the same correction to `generate --spec`.
- **FR-001: entity tiers.** The Go, Rust, JPA and Rails model readers are pattern readers like their route readers but stamped no tier, so a Go project's entities were `not-applicable`. Stamping the file's tier (`tierFor`) at the one place `scanSchemasDeep` gathers them makes them visible without touching each reader.
- **FR-002: `bin` is contextual, `obj` is not.** `obj/` holds intermediate output in .NET and C toolchains and is never hand-written source. `bin/` is real source in Node CLIs (`bin/cli.js`), Ruby binstubs and shell projects, so a name-only rule would drop it; beside a `*.csproj`/`*.fsproj`/`*.vbproj` it is always .NET output. `target/` (Rust, Maven), `vendor/` (PHP, Go), `build/` and `.gradle/` (Gradle) were already skipped. Rejected: `venv` (a dependency tree, not build output; already skipped where it matters by `project-type.mjs`), `deps` (Elixir dependencies, but a common source directory name elsewhere), `Pods`/`DerivedData` (no Swift reader). `_build` is output in Mix, dune and Sphinx alike.
- **FR-003: a per-route flag, set by the reader.** Folding case globally would hide real gaps in Spring, Laravel, Symfony, Rails, Django, Flask, FastAPI, Go and Rust, which match case-sensitively. ASP.NET Core's route matching is case-insensitive with no switch. Express and Koa default to case-insensitive but can be switched per app or router; resolving that setting is out of scope, and marking them unconditionally would hide gaps where it is on. `docs-sync` (DSY003) already lowercases both sides and reads only JavaScript route files, so it needs no change.
- **FR-004: one coverage mechanism.** Spec 058's `scan.unresolved` already counts, locates and filters non-product paths; Python limitations join it rather than gaining a parallel channel.
- **FR-005: the official clients.** Besides Angular and Svelte, `mongodb` (the official driver), `mysql` and `postgres` are the default Node clients of technologies already in the vocabulary, and a Node project using them got the same "documented but not found". `angular` (AngularJS) is a different framework and is not mapped.
- **FR-006: all of `diff`'s document reads.** Spec 061 moved the test-spec read to `resolveDocRole`; the route, entity and environment reads had the same fixed paths, so all move together. The route section keeps its architecture fallback, now through the `architecture` role.
- **FR-009: verified against the frameworks' sources.** Express 5.2.1: `application.js` creates the app's router with `caseSensitive: this.enabled('case sensitive routing')`; `router` 2.2.0 passes `sensitive: this.caseSensitive` to both route and `use` layers; path-to-regexp adds the `i` flag when `sensitive` is false. So a separately created `express.Router()` does NOT inherit the app setting (the request asked for that inheritance; the source says otherwise), and the app's setting governs the mount prefix it matches. A mounted route is therefore case-insensitive only when its own router and every router above it are. `@koa/router` 12: `sensitive: opts.sensitive || this.opts.sensitive || false`. Fastify 5.2.1 passes `options.caseSensitive` to find-my-way, whose default is `true`. Hono 4 routers do not fold case (a custom `getPath` could, but it is code, not a setting). itty-router 5 builds its `RegExp` with no flags. Rejected: marking Express/Koa unconditionally (hides gaps where the setting is on); treating an unknown receiver as insensitive regardless of project settings (a router passed as a parameter may be the case-sensitive one).
- **FR-009: unreadable means case-sensitive.** A non-literal value (`process.env.X === '1'`, an options variable) may make matching case-sensitive; comparing exactly can only show a gap that is not real, never hide one that is. The location is recorded so `diff` can say why.
- **FR-010: causes, not one reason.** `summarizeTiers` kept only the first `regex-fallback` reason, so a project with a Python interpreter missing and a TypeScript parse error could name one. It now keeps the set of causes (interpreter missing, parser missing, Python or JS/TS parse error), classified from each item's reason and file; nested summaries pass theirs up. `generate --spec` facts keep only their tier, so their cause comes from the file's language and which parser this install lacks.
- **Plan schema.** `schemas/` holds no `generate --plan` schema; the JSON shape is documented in `docs/commands.md`.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IV (no validator imports another) | `compareEndpoints` stays in `scanners/api-doc.mjs`; the walker helper lives in `shared-ignore.mjs`. |
| IX (honest assurance) | Pattern-read output is called partial; unread Python routes lower coverage; build output stops counting as source; a case-insensitive framework stops reporting false gaps while case-sensitive ones keep theirs. |
| X (spec-first) | Spec, plan and tasks precede code; every reproduction runs before its fix. |

Pass.

## Project Structure

```text
cli/shared-source.mjs, cli/scanners/memory-plan.mjs, cli/commands/generate.mjs, cli/scanners/schemas.mjs   # FR-001
cli/shared-ignore.mjs, cli/scanners/routes.mjs, cli/scanners/schemas.mjs, cli/shared-source.mjs, cli/scanners/inventory.mjs   # FR-002
cli/scanners/routes.mjs, cli/scanners/api-doc.mjs, cli/validators/api-surface.mjs   # FR-003
cli/scanners/routes.mjs                                  # FR-004
cli/scanners/tech-stack.mjs                              # FR-005
cli/commands/diff.mjs                                    # FR-006
cli/scanners/as-built.mjs, cli/commands/generate-as-built.mjs   # FR-007
cli/scanners/route-case.mjs (NEW), cli/scanners/routes.mjs, cli/commands/diff.mjs   # FR-009
cli/shared-source.mjs, cli/scanners/py-sources.mjs, cli/scanners/memory-plan.mjs, cli/scanners/as-built.mjs, cli/commands/generate-as-built.mjs   # FR-010
docs/reference/languages.md, docs/commands.md, docs/configuration.md, docs-canonical/ARCHITECTURE.md, docs-canonical/DATA-MODEL.md, CHANGELOG.md   # FR-008
tests/coverage-followups.test.mjs                        # NEW
```
