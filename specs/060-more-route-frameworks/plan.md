# Implementation Plan: Sinatra, Starlette, Warp, Tide and net/http Routes

**Branch**: `spec/060-more-route-frameworks` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | New `cli/scanners/sinatra-routes.mjs`: `extractSinatraRoutes(sources)`, a Ruby tokenizer and statement walker over `.rb` files and `config.ru`. |
| FR-002 | `cli/scanners/python-routes.mjs`: `Starlette` and `Router` objects join FastAPI/Flask's object graph; their `routes=` lists, `Mount` children and `add_route` calls become routes and edges. |
| FR-003, FR-004 | New `cli/scanners/rust-routes.mjs`: `extractWarpRoutes(sources)` (a filter-expression evaluator) and `extractTideRoutes(sources)` (server and route nodes, resolved after the scan, as `go-routes.mjs` does). |
| FR-005 | Each reader returns its omitted routes; `routes.mjs` records the count per pattern framework and `routeScanGaps` (`cli/validators/api-surface.mjs`) turns it into a coverage reason. |
| FR-006 | `cli/scanners/project-type.mjs`: a Go module with no router dependency is classified `net/http` when a bounded read of its `.go` files finds a server. |
| FR-007 | `cli/scanners/routes.mjs`: dispatch lines for Sinatra, Starlette, Tide and `net/http`; `scanSinatraRoutes` and the Warp/Tide calls in `scanRustWebRoutes`. |
| FR-008 | `docs/reference/languages.md`, `docs-canonical/ARCHITECTURE.md`, `CHANGELOG.md`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (Constitution II)
**Testing**: `node:test`. `tests/more-route-frameworks.test.mjs` writes five
reference projects to temp directories, each with a hand-written ground truth
from the framework's documented routing, and runs them end to end through
`detectEcosystems` → `scanRoutesDeep` (SC-001). The readers are also called
directly for per-requirement cases.

## Research decisions

- **Sinatra: a Ruby token stream and a statement walker, not line regexes.**
  - Decision: tokenize Ruby (strings with interpolation detection, `%` literals,
    regex literals, heredocs, symbols, `do`/`end`), then walk classes, modules,
    `namespace` blocks, `def self.registered(app)` and `config.ru` `map`
    blocks, carrying the prefix. Apps are resolved after every file is read:
    a class is an app when its superclass chain reaches `Sinatra::Base` or
    `Sinatra::Application` through project classes.
  - Rejected: reusing `rails-routes.mjs`'s tokenizer. It has no regex or
    heredoc support (Rails route files rarely need it, Sinatra apps do), and
    changing it would risk the Rails reader's tested behaviour.
  - Rejected: reading any `get '/x'` call anywhere. A Rack::Test call in a spec
    has the same shape; requiring the route's block (`do`/`{`) and an app
    context keeps those out.
- **Starlette: extend the FastAPI/Flask object graph.**
  - Decision: `Starlette(...)` is an application and `Router(...)` a router in
    the same graph; a `Mount` with `routes=` is an anonymous child reached by an
    edge carrying its path. Everything else (prefix evaluation, cross-module
    names, unmounted routers, tiers, limitations) is reused.
  - Rejected: a separate Starlette resolver. FastAPI is built on Starlette, and
    a FastAPI app can mount a Starlette router; one graph reads both.
  - `Router`, `Route` and `Mount` are matched only when imported from
    `starlette.*` or `fastapi.*`, so another library's `Router` is not read.
- **Warp: evaluate filter expressions to sets of alternatives.**
  - Decision: a filter evaluates to alternatives `{segments, method, end}`.
    `a.and(b)` is their product (an alternative needing two different methods,
    or segments after `path::end()`, cannot match and is dropped), `a.or(b)`
    their union. Identifiers resolve to the nearest earlier `let` in the
    function, calls to project functions by name (narrowed by module path when
    several share it), the result being the function's tail expression.
  - Rejected: matching `warp::path!` lines alone. A Warp route's method and its
    prefix are usually in other expressions, often in another function.
  - A filter that cannot be resolved is assumed to add no segment (it is
    nearly always a header, body or state filter); a path segment that is not
    literal makes the alternative unreadable, and it is omitted and counted.
- **Tide: the Go reader's node model.**
  - Decision: servers (`tide::new()`, `tide::with_state(…)`), routes
    (`x.at("/p")`, a child of x) and parameters are nodes; `nest` is an edge;
    prefixes are resolved after every file is read.
- **net/http: classification, not a new reader.**
  - Decision: `go-routes.mjs` already reads `http.HandleFunc`, `mux.Handle`,
    Go 1.22 method patterns and `http.StripPrefix` mounts (spec 047); only the
    classification was missing. A bounded walk (depth 6, 2,000 files, no
    `vendor`, `testdata` or `_test.go`) looks for a `net/http` import together
    with a handler registration or `ListenAndServe`.
  - Rejected: running the Go reader for every Go module. A CLI or library would
    then pay for a route scan and report an empty-surface gap it does not have.
- **Omitted routes become a coverage reason.** The pattern tier already makes
  these readers' coverage `partial`; the reason now also says how many routes
  were omitted, so a reader knows the surface is short and by how much.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IV (deterministic, static) | Source text only; nothing is imported, built or run. |
| IX (honest assurance) | Non-literal paths are omitted and counted, never guessed; every route carries its tier. |
| X (spec-first) | Spec, plan and tasks precede code; tests are written to fail first. |

Pass.

## Project Structure

```text
cli/scanners/sinatra-routes.mjs        # NEW: FR-001, FR-005
cli/scanners/rust-routes.mjs           # NEW: FR-003, FR-004, FR-005
cli/scanners/python-routes.mjs         # FR-002, FR-005
cli/scanners/project-type.mjs          # FR-006
cli/scanners/routes.mjs                # FR-005, FR-007 (dispatch, wrappers)
cli/validators/api-surface.mjs         # FR-005 (routeScanGaps)
tests/more-route-frameworks.test.mjs   # NEW
docs/reference/languages.md, docs-canonical/ARCHITECTURE.md, CHANGELOG.md   # FR-008
```
