# Implementation Plan: Go, Spring and Rails Route Extraction

**Branch**: `fix/go-spring-rails-routes` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- Three new pattern readers, one per language, each a pure function from file
  contents to `{ method, path, handler, file, auth }` records:
  - `cli/scanners/go-routes.mjs` — `extractGoRoutes(sources)` (FR-001, FR-002,
    FR-006).
  - `cli/scanners/spring-routes.mjs` — `extractSpringRoutes(sources)` (FR-003,
    FR-004, FR-006).
  - `cli/scanners/rails-routes.mjs` — `extractRailsRoutes(content, readDraw)`
    (FR-005, FR-006).
- `cli/scanners/routes.mjs`: `scanGoWebRoutes`, `scanSpringBootRoutes` and
  `scanRailsRoutes` keep their file discovery and call the readers. The
  function signatures and the file walk stay as they are, so spec 043's changes
  to discovery and tier disclosure merge with a small conflict confined to
  those three bodies.
- `cli/scanners/project-type.mjs`: `has()` strips a Go module's `/vN`
  major-version suffix before matching, and gorilla/mux is classified (FR-007).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (Constitution II)
**Testing**: `node:test`. `tests/go-spring-rails-routes.test.mjs` writes eight
reference projects to temp directories, each with a hand-written ground truth
taken from the framework's documented semantics, and asserts the scanner
reports exactly that set (SC-001). The readers are also called directly, so the
tests do not depend on how deep spec 043 lets the walk go.

## Research decisions

- **A small lexer per language, not more regular expressions.**
  - Decision: each reader first masks comments while keeping string literals
    and offsets, then walks brackets and blocks.
  - Rationale: every defect above is structure a line regex cannot see: which
    group a variable holds, which class a method is in, which `do … end` a
    `resources` sits in.
  - Rejected: widening the existing regexes. A regex that finds
    `@RequestMapping(...)` still cannot tell a class base from a method route,
    and a regex for `Group(` cannot follow the variable.
- **Go: symbolic router nodes, resolved after the scan.**
  - Decision: every router expression becomes a node (a constructor, a group
    of a parent node with a literal prefix, a function parameter, a function's
    return value). Routes attach to nodes. Mounts, calls and returns are edges.
    Prefixes are resolved once the whole project is read.
  - Rationale: chi's `Mount` and gin's `registerOrders(v1)` bind a prefix after
    or outside the code that registers the routes; resolving at the end makes
    order and file irrelevant.
  - Calls match functions by name across the project, which covers the common
    `routes.Register(v1)` layout. Cycles stop at a visited set.
- **Spring: annotations attach to the next declaration.**
  - Decision: collect each annotation run, and read the declaration that
    follows (`class`/`interface`/`object` or a method). A class's base applies
    to the methods inside its braces.
  - Constants: `static final String X = …` and Kotlin `const val X = …` across
    the scanned files, resolved by simple and `Class.NAME` form, `+` joins.
- **Rails: a token stream and a recursive statement reader.**
  - Decision: tokenize Ruby (strings, symbols, `%i[]`/`%w[]`, labels, `=>`,
    brackets, `do`/`end`), read one DSL call and its block at a time, and carry
    a scope (path prefix, and the current resource for nesting).
  - A `{` is a block after a complete argument and a hash after `,`, `(`,
    `=>` or a label, which is how Ruby itself decides.
- **Omit, don't guess (FR-006).** A route whose prefix or path is not literal is
  dropped. A wrong path produces two false findings; an omission at most one,
  and these scanners' `fallback-language` tier already says a missing route is
  weak evidence.
- **Update is PATCH and PUT.** `rails routes` lists both for every
  resource; reporting only PATCH hid a routed method.
- **`ANY`, not a method list, for method-agnostic routes.** It is the existing
  convention of this scanner (`HandleFunc`), and spec 044 teaches the API
  reference parser to accept it.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added; no parser for Go, Java, Kotlin or Ruby. |
| IX (honest assurance) | Unresolvable routes are omitted, never guessed; the pattern tier is unchanged. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/go-routes.mjs          # NEW: Go route reader
cli/scanners/spring-routes.mjs      # NEW: Spring route reader
cli/scanners/rails-routes.mjs       # NEW: Rails route reader
cli/scanners/routes.mjs             # the three scanners call the readers
cli/scanners/project-type.mjs       # Go /vN module suffix; gorilla/mux
tests/go-spring-rails-routes.test.mjs   # NEW
tests/routes-multilang.test.mjs     # corrected gin group assertion
docs/commands.md, docs-canonical/TEST-SPEC.md, CHANGELOG.md
testguard.claims.json               # GO-SPRING-RAILS-ROUTES-COMPOSE-PREFIXES
```
