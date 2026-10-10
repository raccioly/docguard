# Implementation Plan: Laravel, Symfony and ASP.NET Core Route Extraction

**Branch**: `spec/059-php-dotnet-routes` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

- Two new pattern readers, each a pure function from file contents to
  `{ method, path, handler, file, line, auth }` records plus a non-enumerable
  `omitted` list of `{ file, line, reason }`:
  - `cli/scanners/php-routes.mjs`: `extractLaravelRoutes(root, readFile)`
    (FR-001, FR-002, FR-007) and `extractSymfonyRoutes(sources, yamlFiles)`
    (FR-003, FR-007), with a PHP lexer.
  - `cli/scanners/dotnet-routes.mjs`: `extractAspNetRoutes(sources)` (FR-004,
    FR-005, FR-006, FR-007), with a C# lexer.
- `cli/scanners/routes.mjs`: three dispatch lines and three small wrappers that
  list files, record their tier and call the readers. `patternScan` records
  each scanner's omitted count.
- `cli/validators/api-surface.mjs`: `routeScanGaps` turns an omitted count into
  a partial-coverage reason (FR-007).
- `cli/scanners/project-type.mjs`: ASP.NET Core from the project SDK, the
  framework reference or any `Microsoft.AspNetCore.*` package (FR-008).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (Constitution II)
**Testing**: `node:test`. `tests/php-dotnet-routes.test.mjs` writes five
reference projects to temp directories, each with a ground truth written by
hand from the framework's documented routing rules (`route:list`,
`debug:router`, ASP.NET Core's attribute-routing and route-group rules), and
asserts the scanner reports exactly that set. Readers are also called
directly for the edge cases.

## Research decisions

- **A lexer per language, reusing spec 047's bracket tools.**
  - Decision: `lexPhp` and `lexCSharp` mask comments and string bodies without
    moving offsets and return the same `{ code, lits }` shape as `lexCLike`, so
    `matchPairs`, `splitTopLevel` and `literalIn` from `route-lexing.mjs` work
    unchanged.
  - Rejected: extending `lexCLike` with PHP and C# options. PHP's single-quoted
    strings, `#` comments that are not `#[` attributes, heredocs and docblock
    capture, and C#'s verbatim and interpolated strings, would each be another
    option on a function three other readers depend on, and two parallel specs
    (058, 060) touch the route files at the same time.
- **Laravel: evaluate the route DSL as chains, recursively.**
  - Decision: a statement is `Route::a(...)->b(...)->…`. Calls before the
    terminal call (`get`, `resource`, `group`, …) build the group attributes,
    calls after it modify the routes it made. A group's closure body or file is
    read with the extended attributes. Entry files come from `bootstrap/app.php`
    (Laravel 11+), else `RouteServiceProvider` (Laravel ≤ 10), else the
    defaults, which is the order Laravel itself uses.
  - Rejected: one regex per verb. It cannot carry a group's prefix or
    middleware into its closure, which is how almost every Laravel API is
    written.
- **Laravel resource parameters** use the singular of the last name segment
  (`photos` → `{photo}`, dashes to underscores), as Laravel's
  `ResourceRegistrar` does; the singular comes from the Rails reader's
  inflector.
- **Symfony: attributes attach to the next declaration; YAML imports carry the
  prefix.** A Flex project imports `src/Controller/` from `config/routes.yaml`;
  an import's `prefix` applies to every attribute route under that directory.
  An attribute route under no import is reported unprefixed, which is the
  default Flex layout.
  - Rejected: reading `config/routes.php` and XML. Both are rare in current
    Symfony projects and need a second evaluator each; they stay out of scope.
- **ASP.NET Core: walk class members, then follow route groups like Go.**
  - Controllers: each class's members are split at depth 0, with their leading
    attribute groups, so an action's attributes and modifiers are known.
    Class-level `[Route]` and `[Authorize]` are inherited through base classes
    found in the scanned files, as `RouteAttribute` and `AuthorizeAttribute`
    are inherited at run time.
  - Minimal APIs: each `Map*` chain is evaluated from its receiver. A receiver
    variable bound to a `MapGroup` chain in the same method carries its prefix;
    a method parameter carries the prefixes of every call site, as spec 047
    does for Go. A method never called with a known group keeps no prefix.
  - Rejected: requiring `Program.cs`. Endpoint registration is commonly split
    into extension methods in other files.
- **`[controller]` keeps the class name's case** (`/api/Users`). ASP.NET Core
  matches case-insensitively, and the expanded template is what Swagger shows.
  Lowercasing would invent a path the template does not contain.
- **Omit, count, disclose (FR-007).** Like spec 047, an unresolvable path is
  dropped. Unlike spec 047, each drop is counted and the API-surface check
  says so, because a Laravel `Route::prefix(config(...))` hides a whole group
  and the tier alone does not say how much.
- **AutoMapper's `.Map(...)`** is not a route: a plain `Map` must have a
  literal path starting with `/`; other `Map*` names are specific enough.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added; no PHP or C# parser. |
| IX (honest assurance) | Unresolvable routes are omitted and counted, never guessed; routes carry the `fallback-language` tier. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/php-routes.mjs          # NEW: Laravel and Symfony readers, PHP lexer
cli/scanners/dotnet-routes.mjs       # NEW: ASP.NET Core reader, C# lexer
cli/scanners/routes.mjs              # dispatch, wrappers, omitted count
cli/scanners/project-type.mjs        # ASP.NET Core classification (FR-008)
cli/validators/api-surface.mjs       # omitted routes as partial coverage (FR-007)
tests/php-dotnet-routes.test.mjs     # NEW
docs/reference/languages.md, docs/commands.md, docs-canonical/ARCHITECTURE.md, docs-canonical/TEST-SPEC.md, CHANGELOG.md   # FR-010
```
