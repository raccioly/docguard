# Implementation Plan: Accurate Python Web Extraction

**Branch**: `fix/python-extraction` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

Both parser tiers produce the same per-file **outline** of a Python module,
and one set of resolvers turns outlines into routes, entities and
relationships. The tiers differ only in how the outline is read:

- `cli/scanners/py-ast.mjs` (AST tier): the extractor that already runs inside
  `python3` also emits the outline: imports with their local names,
  module-level assignments and calls, classes (bases, keywords, body
  assignments, methods with decorators and parameters) and functions. Each
  expression is encoded in a small JSON form (string, f-string, reference,
  call, list, subscript, binary operator). The route and schema lists it used
  to emit are replaced by the outline. Module-level public names join the
  symbol list (FR-016). Results are cached per file content, so the four
  scanners that ask for the same files in one run parse them once.
- `cli/scanners/py-outline.mjs` (pattern tier, NEW): the same outline from
  source text. A tokenizer that knows strings and comments splits logical
  lines. Indentation gives blocks, and a small expression reader covers the
  subset the resolvers need; anything else becomes an opaque expression.
  It is the pattern tier: it reads standard layouts the same way, and results
  from it keep `parserTier: regex-fallback`.
- `cli/scanners/python-routes.mjs` (NEW): the FastAPI/Flask and Django
  resolvers.
  - Module index over dotted paths, with import resolution (aliases, relative
    imports, package attributes, unique suffix match).
  - FastAPI/Flask: router objects, route decorators, include/register/mount
    edges, prefix evaluation (constants, f-strings, settings defaults), BFS
    from the applications; authentication from dependencies and decorators
    (FR-001, FR-002).
  - Django: URL configuration graph from `ROOT_URLCONF`, path conversion,
    includes, DRF router expansion from viewset capabilities, view methods and
    authentication (FR-003).
- `cli/scanners/python-models.mjs` (NEW): ORM classification with
  inheritance, columns, relationships with cardinality and merged sides, base
  types, and the Pydantic-only fallback (FR-005 to FR-007). Used by
  `scanSchemasDeep` and by the schema-sync validator (FR-008).
- `cli/scanners/py-env.mjs` (NEW): `BaseSettings` fields and `os` imports,
  over the outline tokenizer, called from `grepEnvUsage` for `.py` files
  (FR-009).
- `cli/scanners/routes.mjs`: the Django and FastAPI functions are replaced by
  one call to `python-routes.mjs`; the Python scan tier is carried as before.
- `cli/scanners/api-doc.mjs`: `normalizePath` collapses `<converter:name>` and
  `<name>` (FR-004).
- `cli/scanners/schemas.mjs`: Python via `python-models.mjs`; the result
  carries `scanTier`; the entity diagram draws `many-to-many`.
- `cli/config.mjs`: `autoDetectProjectType` maps the ecosystem profile
  (FR-010). `cli/commands/init.mjs`: smart mode for Python web layouts
  (FR-011). `cli/commands/generate.mjs`: the legacy stack detector takes the
  Python framework from the profile (same detector).
- Tier honesty: `cli/scanners/memory-plan.mjs` (surface `parserTiers`, partial
  sections, note), `cli/commands/generate.mjs` (confidence and tier lines),
  `cli/scanners/as-built.mjs` + `cli/commands/generate-as-built.mjs` (fact tier)
  and `cli/validators/spec-registry.mjs` (SPR007 tier and confidence)
  (FR-012, FR-013); `cli/scanners/module-diagram.mjs` (FR-014).
- `cli/scanners/as-built.mjs` `areaTests` (FR-015);
  `cli/scanners/project-type.mjs` `pyprojectDeps` (FR-017).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18; Python 3.8+ for the
optional AST tier (`ast.unparse` is used only when present, as today).
**Primary Dependencies**: none new.
**Testing**: `node:test`. `tests/python-extraction.test.mjs` builds a FastAPI
and a Django reference project in a temporary directory, each with a written
ground truth, and asserts it through the AST tier (skipped when `python3` is
absent) and through the pattern tier (a child process whose `PATH` holds only
`node` and `git`). CLI behaviour (`init`, `generate --plan`, `generate --spec`,
guard) runs as child processes.

## Research decisions

- **One outline, two readers.**
  - Decision: both tiers emit the same outline and share the resolvers.
  - Rationale: prefix composition, import resolution and ORM classification
    are the hard part and must not diverge between tiers. The tiers then
    differ only in what they can read.
  - Rejected: separate regex patterns for each fact (today's design; it is
    why the pattern tier only knew `app` and `router`), and running the
    resolvers inside `python3` (the pattern tier would need a second copy).
- **Unmounted routers are still reported.**
  - Decision: a router no resolved include reaches keeps its declared prefix.
  - Rationale: includes can be dynamic (loops, plugins). Dropping the routes
    would turn a gap into a false "no route".
- **Unresolved Django includes report no endpoint.**
  - Decision: an include of a module outside the project is a limitation, not
    an endpoint.
  - Rationale: the mount is not an endpoint (bug 2); DocGuard does not know
    what the third-party module serves.
- **Pydantic follows the Zod rule.** `scanSchemasDeep` already treats Zod
  schemas as the data model only when no ORM is found. Pydantic classes get
  the same rule, so a database-less FastAPI service still has a data model.
- **Path parameters as `{name}`.** Django converters and regex groups are
  written as `{name}`, as FastAPI and OpenAPI write them; `normalizePath`
  also accepts `<int:pk>`, so either spelling in a doc matches.
- **Schema-sync reads the shared scanner.** The Django pattern in
  `SCHEMA_DETECTORS` is replaced by the Python model scanner (Django,
  SQLAlchemy, SQLModel). Guard now checks SQLAlchemy models too; that is
  the agreement FR-008 asks for, not a new rule.
- **Pattern-tier sections are partial.** A code section built from pattern-tier
  facts is `partial`, as the module graph already is without an interpreter
  (spec 035 FR-007). `sync` does not overwrite a complete section with it
  unless `--allow-partial` is passed, and generated-staleness reports it as
  unchecked rather than stale.
- **One project-type detector.** `autoDetectProjectType` maps the ecosystem
  profile: a root ecosystem with a framework wins over a root `library`, and
  `service` maps to `api`. The Worker check stays first.
- **Extraction cache.** `extractPythonFiles` caches by path and content hash
  for the life of the process. Routes, schemas, the import graph and the
  symbol map each ask for the same files; today each parse is a separate
  interpreter run.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added; `python3` stays optional. |
| IX (honest assurance) | Every Python fact keeps its tier. Pattern-tier results lower confidence, carry a note and mark sections partial. Unresolved prefixes and includes are flagged, never guessed. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/py-ast.mjs          # outline in the AST extractor; symbols; cache
cli/scanners/py-outline.mjs      # NEW pattern-tier outline
cli/scanners/python-routes.mjs   # NEW FastAPI/Flask/Django resolvers
cli/scanners/python-models.mjs   # NEW ORM entities and relationships
cli/scanners/py-env.mjs          # NEW BaseSettings and os imports
cli/scanners/routes.mjs          # delegate Python routes
cli/scanners/schemas.mjs         # delegate Python models; scanTier; m:n arrow
cli/scanners/api-doc.mjs         # <converter:name>
cli/scanners/project-type.mjs    # PEP 621 arrays with extras
cli/scanners/module-diagram.mjs  # interpreter-unavailable message
cli/scanners/memory-plan.mjs     # parser tiers, partial sections, note
cli/scanners/as-built.mjs        # fact tiers; test list
cli/shared-source.mjs            # grepEnvUsage calls py-env
cli/validators/schema-sync.mjs   # Python models from the shared scanner
cli/validators/spec-registry.mjs # SPR007 tier and confidence
cli/config.mjs                   # one project-type detector
cli/commands/init.mjs            # smart mode for Python web layouts
cli/commands/generate.mjs        # plan tier output; legacy stack detector
cli/commands/generate-as-built.mjs  # tier and confidence
tests/python-extraction.test.mjs # NEW
tests/py-ast.test.mjs            # outline replaces the route/schema lists
docs-canonical/ARCHITECTURE.md, docs-canonical/ENVIRONMENT.md,
docs/configuration.md, docs/commands.md, CHANGELOG.md
testguard.claims.json            # PYTHON-EXTRACTION-IS-ACCURATE
```
