# Feature Specification: Accurate Python Web Extraction

**Feature Branch**: `fix/python-extraction`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.python-extraction`

**Lineage**:
- Extends `docguard.language-repository-coverage`, which made Python a
  supported language with an optional `python3` AST tier and a regex fallback.
- Extends `docguard.calibrated-finding-channels`: the parser tier is already
  carried on scanned items. This spec makes the commands that report Python
  facts say which tier read them.
- Touches `docguard.as-built-specs` (fact tiers on `generate --spec` and
  SPR007), `docguard.code-derived-diagrams` (module graph without an
  interpreter, entity diagram) and `docguard.symbol-map` (module-level names).

**Input**: Maintainer report (2026-09-30): nine confirmed extraction-accuracy
bugs on a standard FastAPI project and a standard Django project, reproduced
with both parser tiers.

## Problem

DocGuard reads a Python web project to generate its API reference, data model,
environment doc and as-built specs, and guard re-reads it to find drift. On
the two most common Python layouts that reading is wrong in ways the output
does not reveal.

Measured on two small reference projects (a FastAPI app with versioned,
nested routers and SQLAlchemy 2.0 models; a Django app with included URL
configurations, a DRF router and three apps):

- **FastAPI routes.** Router and include prefixes are ignored, so
  `/api/v1/users/{user_id}` is reported as `/{user_id}`. The users and posts
  list routes both become `GET /` and collapse into one. As-built facts then
  collide, so deleting one of the two routes changes nothing guard can see.
  The pattern tier only knows routers named `app` or `router`. A router
  guarded by `dependencies=[Depends(require_admin)]` is reported as public.
- **Django routes.** `include()` prefixes are ignored; `re_path` and DRF
  router registrations are not read; each include mount is reported as an
  endpoint of its own (`ALL /api/`) that does not exist. A route documented as
  `/authors/{pk}/` never matches the code's `/authors/<int:pk>/`, because path
  normalization turns `<int:pk>` into `<int{}`.
- **Entities.** SQLAlchemy 2.0 models (`name: Mapped[int] = mapped_column()`)
  come back with no fields, so they are dropped, and the Pydantic request and
  response classes are listed as the data model instead. Relationships are
  reduced to untyped `||--||` edges labelled `"undefined"`, drawn to entities
  that are not in the diagram. Django models are not read at all, so no
  DATA-MODEL.md is generated, while guard's schema check finds them with a
  second, separate pattern. The two disagree on the same project.
- **Environment variables.** Settings read through pydantic `BaseSettings`
  (with `env_prefix` or field aliases) and `environ.get()` after
  `from os import environ` are not found.
- **Project type.** `init --skip-prompts` types a FastAPI project as a
  `library`, because the config detector types every `pyproject.toml` that
  way, while the ecosystem detector gets it right. Plain `init` on a standard
  Django layout stops at interactive prompts instead of scanning the code.
- **Tier honesty.** Without a Python interpreter, `generate --plan` and
  `generate --spec` report the same confidence as with one, with no note.
  SPR007 findings always claim `parserTier: not-applicable` and high
  confidence, so a route the pattern tier could not see produced a
  high-confidence "vanished fact". The module graph says "No source modules
  found" when the modules exist and only the interpreter is missing.
- **Smaller defects.** Entity diagram types are mangled (`Optional_str_`,
  `str___None`); `tests/__init__.py` is counted as a test file; the symbol map
  omits module-level names such as `app`, `api_router` and `settings`; and a
  `pyproject.toml` dependency list stops at the first `]`, so every dependency
  after one with extras (`uvicorn[standard]`) is lost.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - FastAPI and Flask routes carry their full paths (Priority: P1)

A developer runs `docguard generate --plan` on a FastAPI app whose routers are
split across modules and mounted with prefixes.

**Acceptance Scenarios**:

1. **Given** `app.include_router(api_router, prefix="/api/v1")`,
   `api_router.include_router(users.router, prefix="/users")` and
   `@router.get("/{user_id}")` in three modules, **Then** the route is
   `GET /api/v1/users/{user_id}`.
2. **Given** `router = APIRouter(prefix="/posts")` included without a prefix,
   **Then** its list route is `GET /api/v1/posts/`, distinct from the users
   list route.
3. **Given** a router named `admin_router`, **Then** both tiers read its routes.
4. **Given** `APIRouter(dependencies=[Depends(require_admin)])`, **Then** its
   routes are marked as requiring authentication.
5. **Given** the same project with no Python interpreter, **Then** the pattern
   tier reports the same routes.
6. **Given** a prefix DocGuard cannot evaluate, **Then** the route keeps the
   parts it can read and is flagged incomplete; it is never silently shortened.

### User Story 2 - Django routes follow the URL configuration (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `ROOT_URLCONF = "mysite.urls"` and
   `path("api/", include("blog.urls"))`, **Then** routes in `blog/urls.py`
   carry the `/api/` prefix, and `/api/` itself is not reported as an endpoint.
2. **Given** a DRF `SimpleRouter` registering a `ModelViewSet` at `posts`,
   **Then** the list route `/api/posts/` has GET and POST, the detail route
   `/api/posts/{pk}/` has GET, PUT, PATCH and DELETE, and an
   `@action(detail=True)` adds its own route.
3. **Given** `re_path(r"^legacy/(?P<slug>[-\w]+)/$", view)`, **Then** the route
   is `/legacy/{slug}/`.
4. **Given** a doc that lists `/api/authors/{pk}/` and code that declares
   `authors/<int:pk>/`, **Then** API-surface comparison treats them as the same
   path.
5. **Given** an `include()` of a module that is not in the project, **Then** no
   endpoint is invented for the mount; the gap is reported.

### User Story 3 - The data model is the ORM model (Priority: P1)

**Acceptance Scenarios**:

1. **Given** SQLAlchemy 2.0 models on a `DeclarativeBase` subclass, **Then**
   each model is an entity with its columns, and relationship attributes are
   relationships, not columns.
2. **Given** Pydantic request and response classes in the same project,
   **Then** they are not entities.
3. **Given** `User.posts` (a list) with `Post.author` pointing back, **Then** one
   one-to-many edge is drawn; a `secondary=` association table gives one
   many-to-many edge; no edge is drawn to a class that is not an entity and no
   label reads `undefined`.
4. **Given** Django models with `ForeignKey`, `ManyToManyField` and
   `OneToOneField`, **Then** generate produces DATA-MODEL.md with those
   entities and edges, and guard's schema check counts the same models.
5. **Given** `Mapped[Optional[str]]` or `str | None`, **Then** the diagram type
   is `str` and the field is optional.

### User Story 4 - Settings classes are environment variables (Priority: P2)

**Acceptance Scenarios**:

1. **Given** `class Settings(BaseSettings)` with
   `model_config = SettingsConfigDict(env_prefix="SHOP_")` and a field
   `database_url: str`, **Then** `SHOP_DATABASE_URL` is an environment variable.
2. **Given** `Field(..., alias="JWT_SECRET")` or
   `Field(validation_alias="CACHE_URL")`, **Then** the alias is the variable and
   the prefix does not apply.
3. **Given** `from os import environ` then `environ.get("SENTRY_DSN")`, **Then**
   `SENTRY_DSN` is found.

### User Story 5 - init recognises Python web projects (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a FastAPI project, **When** `docguard init --skip-prompts` runs,
   **Then** the project type is `api`.
2. **Given** a Django project with `manage.py`, a project package and apps,
   **When** plain `docguard init` runs, **Then** it scans the code (smart mode)
   instead of asking which documents to create.

### User Story 6 - Pattern-tier results say so (Priority: P1)

**Acceptance Scenarios**:

1. **Given** no Python interpreter, **When** `generate --plan` runs (text or
   JSON), **Then** it names the pattern tier for endpoints and entities, lowers
   the surface confidence, adds a note, and marks those code sections partial.
2. **Given** no Python interpreter, **When** `generate --spec` runs, **Then** the
   result reports the pattern tier and low confidence.
3. **Given** an as-built spec checked without an interpreter, **Then** SPR007
   findings carry `parserTier: regex-fallback` and low confidence.
4. **Given** no interpreter, **Then** the module graph says the Python parser
   was unavailable, not that no modules exist.

### Edge Cases

- **A router included twice** (for example under `/v1` and `/v2`): each mount
  yields its own routes.
- **A router nobody includes**: its routes are still reported with the prefix
  it declares, as before, since the include may be dynamic.
- **An include cycle** between URL configurations or routers: each is followed
  once per path.
- **Two modules with the same dotted suffix** (`a/users.py`, `b/users.py`): an
  import resolves only when exactly one file matches; otherwise the include is
  unresolved and reported, never guessed.
- **A Pydantic-only project** (no ORM): its Pydantic classes remain the data
  model, as Zod schemas are when a JavaScript project has no ORM.
- **A Django `abstract` model or a SQLAlchemy `__abstract__` class**: not an
  entity, but its fields are inherited by the models that extend it.
- **A settings class with `case_sensitive=True`**: the field name keeps its case.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: FastAPI and Flask route paths MUST compose every prefix that
  applies:
  - `APIRouter(prefix=)` and `Blueprint(url_prefix=)`;
  - `include_router(..., prefix=)` and `register_blueprint(..., url_prefix=)`,
    nested and across modules, resolving imports (aliases, relative imports,
    package attributes);
  - `mount()` of a sub-application.

  Any router variable name MUST work in both tiers. A prefix given as a string
  constant, a module constant, an f-string or a settings field default MUST be
  evaluated; a prefix that cannot be MUST flag the route as incomplete.
- **FR-002**: A FastAPI route MUST be marked as requiring authentication when a
  `Depends()` or `Security()` dependency whose name signals authentication
  applies to it at the route, the function signature (including `Annotated`
  aliases), the router, the include or the application. Flask routes MUST honour
  authentication decorators.
- **FR-003**: Django routes MUST be read from the URL configuration graph,
  starting at `ROOT_URLCONF`:
  - `path()`, `re_path()` and `url()`, with converters and named groups
    rendered as `{name}`;
  - `include()` of a module, of a list, and of a DRF router's `urls`;
  - `DefaultRouter`/`SimpleRouter` registrations, expanded into list and detail
    routes with the methods the viewset provides, plus `@action` routes and the
    `DefaultRouter` root.

  An include mount MUST NOT be reported as an endpoint. An include DocGuard
  cannot resolve MUST be reported as a limitation. Views with declared methods
  (`@api_view`, `require_http_methods`, class-based `get`/`post`, DRF generic
  views) MUST report those methods, and Django authentication decorators,
  mixins and permission classes MUST mark the route.
- **FR-004**: API path comparison MUST treat a `<converter:name>` or `<name>`
  segment as a path parameter, like `{name}` and `:name`.
- **FR-005**: Python entities MUST be the ORM models:
  - SQLAlchemy classic `Column` and 2.0 `Mapped`/`mapped_column` columns on
    classes derived from a `DeclarativeBase` subclass, a `declarative_base()`
    result, `db.Model`, or carrying `__tablename__`;
  - Django `models.Model` subclasses;
  - SQLModel classes declared with `table=True`.

  Relationship attributes MUST NOT be listed as columns. Pydantic classes MUST
  NOT be entities when the project has ORM entities; with none, they remain the
  data model. Abstract bases are not entities; their fields are inherited.
- **FR-006**: Relationships MUST carry cardinality: one-to-many
  (collections, `ForeignKey`), many-to-many (`secondary=`, `ManyToManyField`),
  one-to-one (`uselist=False`, `OneToOneField`). The two sides of one
  relationship MUST produce one edge. The entity diagram MUST only draw edges
  between entities it draws, each with a field label.
- **FR-007**: Python field types MUST be recorded as their base type
  (`Optional[X]`, `X | None`, `Mapped[X]` and `Annotated[X, ...]` unwrapped),
  with optionality in `required`, so the diagram shows `str`, not
  `Optional_str_`.
- **FR-008**: `generate` and guard's schema check MUST read Python models from
  the same scanner, so they report the same models on the same project.
- **FR-009**: Environment variables MUST include pydantic `BaseSettings` fields
  (`env_prefix` from `SettingsConfigDict`, a dict or `class Config`; `alias`,
  `validation_alias`, `AliasChoices` and v1 `env=`; `case_sensitive`), and reads
  through `environ` or `getenv` imported from `os`, in code, not in strings or
  comments.
- **FR-010**: The project type written by `init` and assumed when no config
  exists MUST come from the ecosystem detector, so a FastAPI project is `api`,
  a Django project `webapp` and a click project `cli`.
- **FR-011**: Plain `init` MUST treat a Django, Flask or FastAPI layout as an
  existing codebase and run the scan (smart mode).
- **FR-012**: `generate --plan`, in text and JSON, MUST report the parser tier
  of its endpoints and entities. When either was read by the pattern tier, the
  surface confidence MUST be `low`, a note MUST say why, and the endpoint,
  entity and entity-diagram sections MUST be marked partial.
- **FR-013**: `generate --spec` MUST report the parser tier of its route and
  entity facts and lower its confidence when the pattern tier read them. SPR007
  findings MUST carry the tier of the facts they concern and `low` confidence
  when that tier is the pattern tier.
- **FR-014**: When Python files exist but no interpreter is available, the
  module graph MUST say so instead of reporting that no modules were found.
- **FR-015**: An as-built spec's list of existing tests MUST NOT count
  `__init__.py` or `conftest.py`.
- **FR-016**: The Python symbol list MUST include public module-level names
  assigned at the top level.
- **FR-017**: A PEP 621 `dependencies` array MUST be read in full when a
  dependency carries extras.
- **FR-018**: `docs-canonical/ARCHITECTURE.md`, `docs-canonical/ENVIRONMENT.md`,
  `docs/configuration.md`, `docs/commands.md` and the CHANGELOG MUST describe
  the corrected extraction and the tier reporting.

## Success Criteria *(mandatory)*

- **SC-001**: On the FastAPI reference project, each tier reports all 9 routes
  with their full paths and no others, the one guarded router as
  authenticated, the 3 ORM entities (not the 2 Pydantic classes), 2
  relationships and the 6 environment variables.
- **SC-002**: On the Django reference project, each tier reports all 12
  routes and no invented mount, the 4 models with their relationships, and
  guard's schema check and generate agree on the model count.
- **SC-003**: No command reports Python facts read by the pattern tier with
  normal confidence and no note.
- **SC-004**: Deleting one route from the FastAPI project changes the as-built
  facts (no collision).

## Assumptions

- The reference projects follow the layouts the frameworks' own documentation
  and project templates use. Code that builds routes in loops or from
  configuration is out of reach of static reading; it is flagged, not guessed.
- An authentication dependency is recognised by name
  (`auth`, `user`, `admin`, `token`, `permission`, `jwt`, `oauth`, `api_key`,
  `require…`, `verify…`, …). A dependency named otherwise is not claimed.

## Out of Scope

- Starlette `Route` lists, Django Ninja, Litestar and other Python frameworks.
- Nested settings models (`env_nested_delimiter`) and `.env` file contents.
- Per-method authentication (a DRF viewset whose permissions differ by action
  is marked as a whole).
- Making the regex tier a parser: it reads the same facts from standard
  layouts, and it stays the lower-confidence tier.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `d17dee0a5924795582cae3b0fcd97bfdbad93c76` — Reviewed at d17dee0 on main: all 12 tasks are checked and were delivered by #502; the full suite (2909 tests) passes and guard reports 0 errors at this revision. Evidence: `cli/commands/init.mjs`, `cli/config.mjs`, `cli/scanners/api-doc.mjs`, `cli/scanners/as-built.mjs`, `cli/scanners/memory-plan.mjs`, `cli/scanners/module-diagram.mjs`, `cli/scanners/project-type.mjs`, `cli/scanners/py-ast.mjs`, `cli/scanners/py-env.mjs`, `cli/scanners/py-outline.mjs`, `cli/scanners/py-sources.mjs`, `cli/scanners/python-models.mjs`, `cli/scanners/python-routes.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/ENVIRONMENT.md`, `tests/python-extraction.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
