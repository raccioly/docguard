/**
 * Accurate Python web extraction (specs/046-python-extraction).
 *
 * Two reference projects — a FastAPI app with nested, prefixed routers across
 * modules and SQLAlchemy 2.0 models, and a Django app with included URL
 * configurations, a DRF router and three apps — each with a written ground
 * truth. Every scanner assertion runs through BOTH parser tiers: the AST tier
 * (the developer's python3; skipped when absent) and the pattern tier (a child
 * process whose PATH holds only node and git, so no interpreter exists).
 *
 * @req docguard.python-extraction#FR-001
 * @req docguard.python-extraction#FR-002
 * @req docguard.python-extraction#FR-003
 * @req docguard.python-extraction#FR-004
 * @req docguard.python-extraction#FR-005
 * @req docguard.python-extraction#FR-006
 * @req docguard.python-extraction#FR-007
 * @req docguard.python-extraction#FR-008
 * @req docguard.python-extraction#FR-009
 * @req docguard.python-extraction#FR-010
 * @req docguard.python-extraction#FR-011
 * @req docguard.python-extraction#FR-012
 * @req docguard.python-extraction#FR-013
 * @req docguard.python-extraction#FR-014
 * @req docguard.python-extraction#FR-015
 * @req docguard.python-extraction#FR-016
 * @req docguard.python-extraction#FR-017
 * @req docguard.python-extraction#FR-018
 * @req docguard.python-extraction#SC-001
 * @req docguard.python-extraction#SC-002
 * @req docguard.python-extraction#SC-003
 * @req docguard.python-extraction#SC-004
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pyAstAvailable } from '../cli/scanners/py-ast.mjs';
import { endpointKey } from '../cli/scanners/api-doc.mjs';
import { detectEcosystems } from '../cli/scanners/project-type.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const HAS_PYTHON = pyAstAvailable();

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function writeFiles(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

function project(files, { git = false } = {}) {
  const dir = writeFiles(tempDir('dg-py046-'), files);
  if (git) {
    const run = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    run('init', '-q'); run('config', 'user.email', 't@t'); run('config', 'user.name', 't');
    run('add', '-A'); run('commit', '-q', '-m', 'fixture');
  }
  return dir;
}

/** A PATH holding node and git but deliberately no Python interpreter. */
let _noPython;
function pathWithoutPython() {
  if (_noPython) return _noPython;
  const dir = tempDir('dg-nopy-');
  for (const bin of ['node', 'git']) {
    const which = spawnSync('command', ['-v', bin], { shell: true, encoding: 'utf8' }).stdout.trim();
    if (which) symlinkSync(which, join(dir, bin));
  }
  _noPython = dir;
  return dir;
}

const TIERS = [
  { name: 'AST tier', env: () => process.env, expected: 'py-ast', skip: HAS_PYTHON ? false : 'python3 not on PATH' },
  { name: 'pattern tier', env: () => ({ ...process.env, PATH: pathWithoutPython() }), expected: 'regex-fallback', skip: false },
];

// One child process per tier and project: imports the scanners by absolute
// path and prints every fact the tests assert on.
const PROBE = `
const [root, dir, framework] = process.argv.slice(2);
const imp = p => import(root + '/' + p);
const { scanRoutesDeep } = await imp('cli/scanners/routes.mjs');
const { scanSchemasDeep, generateERDiagram } = await imp('cli/scanners/schemas.mjs');
const { grepEnvUsage } = await imp('cli/shared-source.mjs');
const { validateSchemaSync } = await imp('cli/validators/schema-sync.mjs');
const { buildImportGraph } = await imp('cli/scanners/import-graph.mjs');
const { renderModuleGraph } = await imp('cli/scanners/module-diagram.mjs');
const routes = scanRoutesDeep(dir, { framework }, {}, { config: {} });
const schemas = scanSchemasDeep(dir, { framework }, {}, {});
const sync = validateSchemaSync(dir, {});
console.log(JSON.stringify({
  routes: routes.map(r => ({ key: r.method + ' ' + r.path, auth: !!r.auth, tier: r.tier, incomplete: !!r.pathIncomplete, mounted: r.mounted !== false })),
  scanTier: routes.scanTier || null,
  limitations: routes.limitations || [],
  entities: schemas.entities.map(e => ({ name: e.name, source: e.source, tier: e.tier, fields: e.fields.map(f => ({ name: f.name, type: f.type, required: f.required })) })),
  relationships: schemas.relationships,
  schemaTier: schemas.scanTier || null,
  er: generateERDiagram(schemas.entities, schemas.relationships),
  env: [...grepEnvUsage(dir, {})].sort(),
  schemaSync: (sync.findings || []).map(f => ({ code: f.code, message: f.message, parserTier: f.parserTier })),
  moduleGraph: renderModuleGraph(buildImportGraph(dir, {}), {}),
}));
`;

function probe(dir, framework, tier) {
  const script = join(tempDir('dg-probe-'), 'probe.mjs');
  writeFileSync(script, PROBE);
  const r = spawnSync(process.execPath, [script, ROOT, dir, framework], { encoding: 'utf8', env: tier.env(), maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const cli = (dir, args, env = process.env) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', env: { ...env, NO_COLOR: '1' }, input: '', timeout: 60000,
  });
  // eslint-disable-next-line no-control-regex
  return { ...r, stdout: String(r.stdout || '').replace(/\x1b\[[0-9;]*m/g, '') };
};
const jsonOut = r => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
const keys = routes => routes.map(r => r.key).sort();

// ── Reference project 1: FastAPI ────────────────────────────────────────────

const FASTAPI = {
  'pyproject.toml': `[project]
name = "shop-api"
version = "0.1.0"
dependencies = [
  "uvicorn[standard]>=0.29",
  "fastapi>=0.110",
  "sqlalchemy>=2.0",
  "pydantic-settings>=2.0",
]
`,
  'app/__init__.py': '',
  'app/main.py': `from fastapi import FastAPI

from app.api.v1.api import api_router
from app.core.config import settings

app = FastAPI(title="Shop")
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/health")
def health():
    """Liveness probe."""
    return {"ok": True}
`,
  'app/api/__init__.py': '',
  'app/api/deps.py': `from fastapi import Depends, HTTPException


def require_admin():
    raise HTTPException(status_code=403)
`,
  'app/api/v1/__init__.py': '',
  'app/api/v1/api.py': `from fastapi import APIRouter

from app.api.v1.endpoints import admin, posts, users

api_router = APIRouter()
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(posts.router)
api_router.include_router(admin.admin_router, prefix="/admin")
`,
  'app/api/v1/endpoints/__init__.py': '',
  'app/api/v1/endpoints/users.py': `from fastapi import APIRouter

from app.schemas import UserCreate, UserRead

router = APIRouter()


@router.get("/")
def list_users():
    """List users."""
    return []


@router.post("/", response_model=UserRead)
def create_user(body: UserCreate):
    return body


@router.get("/{user_id}")
def get_user(user_id: int):
    return {}


@router.patch(
    "/{user_id}",
    response_model=UserRead,
)
def update_user(user_id: int, body: UserCreate):
    return body


@router.delete("/{user_id}")
def delete_user(user_id: int):
    return None
`,
  'app/api/v1/endpoints/posts.py': `from fastapi import APIRouter

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("/")
def list_posts():
    return []


@router.post("/")
def create_post():
    return {}
`,
  'app/api/v1/endpoints/admin.py': `from fastapi import APIRouter, Depends

from app.api.deps import require_admin

admin_router = APIRouter(dependencies=[Depends(require_admin)])


@admin_router.get("/stats")
def stats():
    return {}
`,
  'app/core/__init__.py': '',
  'app/core/config.py': `from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SHOP_", env_file=".env")

    API_V1_STR: str = "/api/v1"
    database_url: str
    secret_key: str = Field(..., alias="JWT_SECRET")
    debug: bool = False
    redis_url: str = Field("redis://localhost", validation_alias="CACHE_URL")


settings = Settings()
`,
  'app/core/logging.py': `import os
from os import environ

SENTRY_DSN = environ.get("SENTRY_DSN")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
EXAMPLE = "environ.get('NOT_A_READ')"
`,
  'app/models.py': `from typing import List, Optional

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


post_tags = Table(
    "post_tags",
    Base.metadata,
    Column("post_id", ForeignKey("posts.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    full_name: Mapped[Optional[str]]
    posts: Mapped[List["Post"]] = relationship(back_populates="author")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None]
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    author: Mapped["User"] = relationship(back_populates="posts")
    tags: Mapped[List["Tag"]] = relationship(secondary=post_tags, back_populates="posts")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    posts: Mapped[list["Post"]] = relationship(secondary=post_tags, back_populates="tags")
`,
  'app/schemas.py': `from typing import Optional

from pydantic import BaseModel


class UserCreate(BaseModel):
    email: str
    full_name: Optional[str] = None


class UserRead(BaseModel):
    id: int
    email: str
    full_name: str | None = None
`,
  'tests/__init__.py': '',
  'tests/conftest.py': 'import pytest\n',
  'tests/test_users.py': 'def test_list_users():\n    assert True\n',
};

// The ground truth, written from the code above by reading it as FastAPI does.
const FASTAPI_ROUTES = [
  'DELETE /api/v1/users/{user_id}',
  'GET /api/v1/admin/stats',
  'GET /api/v1/posts/',
  'GET /api/v1/users/',
  'GET /api/v1/users/{user_id}',
  'GET /health',
  'PATCH /api/v1/users/{user_id}',
  'POST /api/v1/posts/',
  'POST /api/v1/users/',
];
const FASTAPI_ENTITIES = {
  Post: ['author_id', 'body', 'id', 'title'],
  Tag: ['id', 'name'],
  User: ['email', 'full_name', 'id'],
};
const FASTAPI_RELATIONSHIPS = ['Post many-to-many Tag', 'User one-to-many Post'];
const FASTAPI_ENV = ['CACHE_URL', 'JWT_SECRET', 'LOG_LEVEL', 'SENTRY_DSN', 'SHOP_API_V1_STR', 'SHOP_DATABASE_URL', 'SHOP_DEBUG'];

// ── Reference project 2: Django + DRF ───────────────────────────────────────

const DJANGO = {
  'requirements.txt': 'Django==5.0.6\ndjangorestframework==3.15.1\n',
  'manage.py': `#!/usr/bin/env python
import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)
`,
  'mysite/__init__.py': '',
  'mysite/settings.py': `import os

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DEBUG = os.environ.get("DJANGO_DEBUG") == "1"
INSTALLED_APPS = ["django.contrib.admin", "rest_framework", "blog", "accounts"]
ROOT_URLCONF = "mysite.urls"
`,
  'mysite/urls.py': `from django.contrib import admin
from django.urls import include, path, re_path

from blog.views import legacy_view

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("blog.urls")),
    path("accounts/", include("accounts.urls")),
    path("oauth/", include("social_django.urls")),
    re_path(r"^legacy/(?P<slug>[-\\w]+)/$", legacy_view),
]
`,
  'mysite/wsgi.py': `import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")
application = get_wsgi_application()
`,
  'blog/__init__.py': '',
  'blog/models.py': `from django.db import models


class Author(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    bio = models.TextField(blank=True, null=True)


class Tag(models.Model):
    name = models.CharField(max_length=50)


class Post(models.Model):
    title = models.CharField(max_length=200)
    author = models.ForeignKey(Author, on_delete=models.CASCADE, related_name="posts")
    tags = models.ManyToManyField(Tag, blank=True)
    published = models.DateTimeField(null=True)
`,
  'blog/views.py': `from rest_framework import viewsets
from rest_framework.decorators import action, api_view

from blog.models import Post


class PostViewSet(viewsets.ModelViewSet):
    queryset = Post.objects.all()

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        return None


@api_view(["GET"])
def author_detail(request, pk):
    return None


def legacy_view(request, slug):
    return None
`,
  'blog/urls.py': `from django.urls import include, path
from rest_framework.routers import SimpleRouter

from blog import views

router = SimpleRouter()
router.register(r"posts", views.PostViewSet, basename="post")

urlpatterns = [
    path("", include(router.urls)),
    path("authors/<int:pk>/", views.author_detail, name="author-detail"),
]
`,
  'accounts/__init__.py': '',
  'accounts/models.py': `from django.conf import settings
from django.db import models


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    website = models.URLField(blank=True)
`,
  'accounts/views.py': `from django.contrib.auth.decorators import login_required


def login_view(request):
    return None


@login_required
def profile(request, username):
    return None
`,
  'accounts/urls.py': `from django.urls import path

from accounts import views

urlpatterns = [
    path("login/", views.login_view, name="login"),
    path("profile/<str:username>/", views.profile, name="profile"),
]
`,
};

const DJANGO_ROUTES = [
  'ALL /accounts/login/',
  'ALL /accounts/profile/{username}/',
  'ALL /admin/',
  'ALL /legacy/{slug}/',
  'DELETE /api/posts/{pk}/',
  'GET /api/authors/{pk}/',
  'GET /api/posts/',
  'GET /api/posts/{pk}/',
  'PATCH /api/posts/{pk}/',
  'POST /api/posts/',
  'POST /api/posts/{pk}/publish/',
  'PUT /api/posts/{pk}/',
];
const DJANGO_ENTITIES = {
  Author: ['bio', 'email', 'name'],
  Post: ['author', 'published', 'title'],
  Profile: ['user', 'website'],
  Tag: ['name'],
};
const DJANGO_RELATIONSHIPS = ['Author one-to-many Post', 'Post many-to-many Tag'];

const entityMap = entities => Object.fromEntries(entities.map(e => [e.name, e.fields.map(f => f.name).sort()]));
const relSet = rels => rels.map(r => `${r.from} ${r.type} ${r.to}`).sort();

// ── Scanner facts, per tier ─────────────────────────────────────────────────

for (const tier of TIERS) {
  describe(`FastAPI reference project — ${tier.name}`, { skip: tier.skip }, () => {
    let facts;
    const get = () => (facts ??= probe(project(FASTAPI), 'FastAPI', tier));

    it('reports every route with its composed prefix and no others (FR-001, SC-001)', () => {
      const f = get();
      assert.deepEqual(keys(f.routes), FASTAPI_ROUTES);
      assert.equal(f.scanTier.tier, tier.expected);
      assert.ok(f.routes.every(r => r.tier === tier.expected));
      assert.ok(f.routes.every(r => !r.incomplete && r.mounted));
    });

    it('marks the router guarded by a dependency as authenticated, and only it (FR-002)', () => {
      const f = get();
      assert.deepEqual(f.routes.filter(r => r.auth).map(r => r.key), ['GET /api/v1/admin/stats']);
    });

    it('lists the ORM models as entities, not the Pydantic payloads (FR-005)', () => {
      const f = get();
      assert.deepEqual(entityMap(f.entities), FASTAPI_ENTITIES);
      assert.ok(f.entities.every(e => e.source === 'sqlalchemy'));
      assert.equal(f.schemaTier.tier, tier.expected);
    });

    it('gives relationships cardinality, one edge per relationship, labelled (FR-006)', () => {
      const f = get();
      assert.deepEqual(relSet(f.relationships), FASTAPI_RELATIONSHIPS);
      assert.match(f.er, /User \|\|--o\{ Post : "posts"/);
      assert.match(f.er, /Post \}o--o\{ Tag : "tags"/);
      assert.doesNotMatch(f.er, /undefined/);
    });

    it('records base types with optionality in required (FR-007)', () => {
      const f = get();
      const field = (e, n) => f.entities.find(x => x.name === e).fields.find(x => x.name === n);
      assert.deepEqual(field('User', 'full_name'), { name: 'full_name', type: 'str', required: false });
      assert.deepEqual(field('Post', 'body'), { name: 'body', type: 'str', required: false });
      assert.equal(field('User', 'id').required, true);
      assert.doesNotMatch(f.er, /Optional|___None|_None/);
    });

    it('reads BaseSettings fields and os imports, and ignores a string mention (FR-009, SC-001)', () => {
      assert.deepEqual(get().env, FASTAPI_ENV);
    });

    it('guard\'s schema check counts the same models generate lists (FR-008)', () => {
      const f = get();
      const sch = f.schemaSync.find(x => x.code === 'SCH001');
      assert.ok(sch, 'no DATA-MODEL.md: SCH001 names the detected models');
      assert.match(sch.message, /Found 3 database model\(s\)/);
      assert.equal(sch.parserTier, tier.expected);
    });
  });

  describe(`Django reference project — ${tier.name}`, { skip: tier.skip }, () => {
    let facts;
    const get = () => (facts ??= probe(project(DJANGO), 'Django', tier));

    it('follows the URL configuration from ROOT_URLCONF, with DRF routes and no invented mount (FR-003, SC-002)', () => {
      const f = get();
      assert.deepEqual(keys(f.routes), DJANGO_ROUTES);
      assert.equal(f.scanTier.tier, tier.expected);
    });

    it('reports an include it cannot resolve as a limitation, not an endpoint (FR-003)', () => {
      const f = get();
      assert.ok(!f.routes.some(r => r.key.includes('/oauth')));
      assert.ok(f.limitations.some(l => l.code === 'django-unresolved-include' && /social_django\.urls/.test(l.target)));
    });

    it('marks the login_required view and the admin site as authenticated (FR-003)', () => {
      assert.deepEqual(get().routes.filter(r => r.auth).map(r => r.key).sort(), ['ALL /accounts/profile/{username}/', 'ALL /admin/']);
    });

    it('reads Django models with their fields and relationships (FR-005, FR-006)', () => {
      const f = get();
      assert.deepEqual(entityMap(f.entities), DJANGO_ENTITIES);
      assert.ok(f.entities.every(e => e.source === 'django'));
      assert.deepEqual(relSet(f.relationships), DJANGO_RELATIONSHIPS);
      assert.match(f.er, /Author \|\|--o\{ Post : "author"/);
      assert.doesNotMatch(f.er, /AUTH_USER_MODEL|undefined/);
      const bio = f.entities.find(e => e.name === 'Author').fields.find(x => x.name === 'bio');
      assert.deepEqual(bio, { name: 'bio', type: 'TextField', required: false });
    });

    it('guard\'s schema check and generate agree on the models (FR-008, SC-002)', () => {
      const f = get();
      const sch = f.schemaSync.find(x => x.code === 'SCH001');
      assert.match(sch.message, new RegExp(`Found ${Object.keys(DJANGO_ENTITIES).length} database model\\(s\\)`));
      assert.equal(f.entities.length, Object.keys(DJANGO_ENTITIES).length);
    });

    it('reads the settings module\'s environment variables (FR-009)', () => {
      assert.deepEqual(get().env, ['DJANGO_DEBUG', 'DJANGO_SECRET_KEY']);
    });
  });

  describe(`smaller layouts — ${tier.name}`, { skip: tier.skip }, () => {
    it('flags a prefix it cannot evaluate instead of shortening the path silently (FR-001)', () => {
      const dir = project({
        'requirements.txt': 'fastapi\n',
        'main.py': [
          'from fastapi import APIRouter, FastAPI',
          'from plugins import prefix_for',
          'items = APIRouter()',
          '@items.get("/items")',
          'def list_items():',
          '    return []',
          'app = FastAPI()',
          'app.include_router(items, prefix=prefix_for("items"))',
          '',
        ].join('\n'),
      });
      const f = probe(dir, 'FastAPI', tier);
      assert.deepEqual(keys(f.routes), ['GET /items']);
      assert.equal(f.routes[0].incomplete, true);
    });

    it('composes Flask blueprints, with register_blueprint overriding url_prefix, and honours login_required (FR-001, FR-002)', () => {
      const dir = project({
        'requirements.txt': 'flask\n',
        'app.py': [
          'from flask import Flask',
          'from api import bp as api_bp',
          'def create_app():',
          '    app = Flask(__name__)',
          '    app.register_blueprint(api_bp, url_prefix="/v2")',
          '    return app',
          '',
        ].join('\n'),
        'api.py': [
          'from flask import Blueprint',
          'from flask_login import login_required',
          'bp = Blueprint("api", __name__, url_prefix="/api")',
          '@bp.route("/items", methods=["GET", "POST"])',
          'def items():',
          '    return []',
          '@bp.get("/me")',
          '@login_required',
          'def me():',
          '    return {}',
          '',
        ].join('\n'),
      });
      const f = probe(dir, 'Flask', tier);
      assert.deepEqual(keys(f.routes), ['GET /v2/items', 'GET /v2/me', 'POST /v2/items']);
      assert.deepEqual(f.routes.filter(r => r.auth).map(r => r.key), ['GET /v2/me']);
    });

    it('expands a DefaultRouter with its API root and a read-only viewset (FR-003)', () => {
      const dir = project({
        'requirements.txt': 'Django\ndjangorestframework\n',
        'manage.py': '',
        'shop/settings.py': 'ROOT_URLCONF = "shop.urls"\n',
        'shop/urls.py': [
          'from django.urls import include, path',
          'from rest_framework import routers',
          'from shop.views import ProductViewSet',
          'router = routers.DefaultRouter()',
          'router.register("products", ProductViewSet)',
          'urlpatterns = [path("v1/", include(router.urls))]',
          '',
        ].join('\n'),
        'shop/views.py': [
          'from rest_framework import viewsets',
          'from rest_framework.permissions import IsAuthenticated',
          'class ProductViewSet(viewsets.ReadOnlyModelViewSet):',
          '    lookup_field = "slug"',
          '    permission_classes = [IsAuthenticated]',
          '',
        ].join('\n'),
      });
      const f = probe(dir, 'Django', tier);
      assert.deepEqual(keys(f.routes), ['GET /v1/', 'GET /v1/products/', 'GET /v1/products/{slug}/']);
      assert.deepEqual(f.routes.filter(r => r.auth).map(r => r.key).sort(), ['GET /v1/products/', 'GET /v1/products/{slug}/']);
    });

    it('keeps Pydantic classes as the data model when there is no ORM, as Zod is (FR-005)', () => {
      const dir = project({
        'requirements.txt': 'fastapi\n',
        'schemas.py': [
          'from pydantic import BaseModel',
          'class Quote(BaseModel):',
          '    symbol: str',
          '    price: float | None = None',
          '',
        ].join('\n'),
      });
      const f = probe(dir, 'FastAPI', tier);
      assert.deepEqual(entityMap(f.entities), { Quote: ['price', 'symbol'] });
      assert.equal(f.entities[0].source, 'pydantic');
      assert.deepEqual(f.entities[0].fields.find(x => x.name === 'price'), { name: 'price', type: 'float', required: false });
    });
  });
}

// ── Path comparison ─────────────────────────────────────────────────────────

describe('API path comparison (FR-004)', () => {
  it('treats Django and Flask converters as path parameters', () => {
    assert.equal(endpointKey('GET', '/api/authors/<int:pk>/'), endpointKey('GET', '/api/authors/{pk}'));
    assert.equal(endpointKey('GET', '/users/<username>'), endpointKey('GET', '/users/:username'));
    assert.equal(endpointKey('GET', '/files/<path:rest>/raw'), 'GET /files/{}/raw');
  });
});

// ── One route removed changes the facts (no collision) ─────────────────────

describe('as-built facts keep distinct routes distinct (SC-004)', () => {
  it('removing the posts list route removes exactly its fact', () => {
    const dir = project(FASTAPI);
    const facts = () => jsonOut(cli(dir, ['generate', '--spec', 'app', '--format', 'json'])).facts
      .filter(x => x.kind === 'route').map(x => x.key);
    const before = facts();
    writeFileSync(join(dir, 'app/api/v1/endpoints/posts.py'), FASTAPI['app/api/v1/endpoints/posts.py']
      .replace('@router.get("/")\ndef list_posts():\n    return []\n\n\n', ''));
    const after = facts();
    assert.deepEqual(before.filter(k => !after.includes(k)), ['GET /api/v1/posts/']);
    assert.equal(after.length, before.length - 1);
  });
});

// ── Project type and init ───────────────────────────────────────────────────

describe('init recognises Python web projects', () => {
  it('init --skip-prompts types a FastAPI project as api (FR-010)', () => {
    const dir = project(FASTAPI, { git: true });
    const r = cli(dir, ['init', '--skip-prompts', '--no-spec-kit']);
    assert.equal(r.status, 0, r.stderr);
    const config = JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf8'));
    assert.equal(config.projectType, 'api');
    assert.match(r.stdout, /Auto-detected project type: api/);
  });

  it('the project type with no config comes from the same detector (FR-010)', async () => {
    const { autoDetectProjectType } = await import('../cli/config.mjs');
    assert.equal(autoDetectProjectType(project(FASTAPI)), 'api');
    assert.equal(autoDetectProjectType(project(DJANGO)), 'webapp');
    assert.equal(autoDetectProjectType(project({ 'pyproject.toml': '[project]\nname="t"\ndependencies = ["click>=8"]\n' })), 'cli');
    assert.equal(autoDetectProjectType(project({ 'pyproject.toml': '[project]\nname="lib"\ndependencies = ["attrs"]\n' })), 'library');
  });

  it('plain init on a Django layout scans the code instead of prompting (FR-011)', () => {
    const dir = project(DJANGO, { git: true });
    const r = cli(dir, ['init', '--no-spec-kit']);
    assert.match(r.stdout, /Smart Mode/);
    assert.doesNotMatch(r.stdout, /Which canonical docs does your project need/);
  });
});

// ── Tier honesty ────────────────────────────────────────────────────────────

describe('pattern-tier results say so', () => {
  const noPy = () => ({ ...process.env, PATH: pathWithoutPython() });

  it('generate --plan JSON names the tier, lowers confidence, adds a note and marks sections partial (FR-012, SC-003)', () => {
    const dir = project(FASTAPI);
    const plan = jsonOut(cli(dir, ['generate', '--plan', '--format', 'json'], noPy()));
    assert.equal(plan.surface.parserTiers.endpoints.tier, 'regex-fallback');
    assert.equal(plan.surface.parserTiers.entities.tier, 'regex-fallback');
    assert.equal(plan.surface.confidence, 'low');
    assert.ok(plan.notes.some(n => /pattern/i.test(n) && /python3/.test(n)), JSON.stringify(plan.notes));
    assert.equal(plan.surface.endpoints, FASTAPI_ROUTES.length);
  });

  it('generate --plan text prints the tier and the note (FR-012, SC-003)', () => {
    const dir = project(FASTAPI);
    const r = cli(dir, ['generate', '--plan'], noPy());
    assert.match(r.stdout, /Parser tier: endpoints regex-fallback · entities regex-fallback/);
    assert.match(r.stdout, /pattern fallback/);
  });

  it('generate --plan with an interpreter reports the AST tier and normal confidence (FR-012)', { skip: HAS_PYTHON ? false : 'python3 not on PATH' }, () => {
    const dir = project(FASTAPI);
    const plan = jsonOut(cli(dir, ['generate', '--plan', '--format', 'json']));
    assert.equal(plan.surface.parserTiers.endpoints.tier, 'py-ast');
    assert.equal(plan.surface.confidence, 'normal');
    assert.ok(!plan.notes.some(n => /pattern/i.test(n)));
  });

  it('the plan marks pattern-tier code sections partial (FR-012)', async () => {
    const dir = project(FASTAPI);
    const script = join(tempDir('dg-plan-'), 'plan.mjs');
    writeFileSync(script, `const { buildMemoryPlan } = await import(${JSON.stringify(join(ROOT, 'cli/scanners/memory-plan.mjs'))});
const plan = buildMemoryPlan(process.argv[2], { diskCache: false });
console.log(JSON.stringify(plan.docs.flatMap(d => d.sections.filter(s => s.source === 'code').map(s => ({ id: s.id, completeness: s.completeness || 'complete', reason: s.partialReason || null })))));`);
    const r = spawnSync(process.execPath, [script, dir], { encoding: 'utf8', env: noPy() });
    assert.equal(r.status, 0, r.stderr);
    const sections = Object.fromEntries(JSON.parse(r.stdout).map(s => [s.id, s]));
    for (const id of ['endpoints', 'entities', 'entity-diagram']) {
      assert.equal(sections[id].completeness, 'partial', id);
      assert.match(sections[id].reason, /pattern/);
    }
  });

  it('generate --spec reports the tier and lowers confidence (FR-013)', () => {
    const dir = project(FASTAPI);
    const r = jsonOut(cli(dir, ['generate', '--spec', 'app', '--format', 'json'], noPy()));
    assert.equal(r.parserTier, 'regex-fallback');
    assert.equal(r.confidence, 'low');
    assert.ok(r.facts.filter(x => x.kind === 'route').every(x => x.tier === 'regex-fallback'));
    const text = cli(dir, ['generate', '--spec', 'app'], noPy()).stdout;
    assert.match(text, /pattern fallback/);
  });

  it('SPR007 carries the facts\' tier and low confidence on the pattern tier (FR-013)', () => {
    const dir = project({ ...FASTAPI, '.docguard.json': JSON.stringify({ projectName: 'shop' }) }, { git: true });
    const w = jsonOut(cli(dir, ['generate', '--spec', 'app', '--write', '--format', 'json']));
    assert.equal(w.status, 'WRITTEN');
    // A new route nobody accounted for.
    writeFileSync(join(dir, 'app/api/v1/endpoints/posts.py'), `${FASTAPI['app/api/v1/endpoints/posts.py']}

@router.delete("/{post_id}")
def delete_post(post_id: int):
    return None
`);
    const guard = env => jsonOut(cli(dir, ['guard', '--format', 'json'], env)).findings.filter(f => f.code === 'SPR007');
    const regex = guard(noPy());
    assert.ok(regex.length > 0);
    const route = regex.find(f => /DELETE \/api\/v1\/posts\/\{post_id\}/.test(f.message));
    assert.ok(route, JSON.stringify(regex.map(f => f.message)));
    assert.equal(route.parserTier, 'regex-fallback');
    assert.equal(route.confidence, 'low');
    if (HAS_PYTHON) {
      const ast = guard(process.env).find(f => /DELETE \/api\/v1\/posts\/\{post_id\}/.test(f.message));
      assert.equal(ast.parserTier, 'py-ast');
      assert.equal(ast.confidence, 'high');
    }
  });

  it('the module graph says the parser was unavailable, not that no modules exist (FR-014)', () => {
    const f = probe(project(FASTAPI), 'FastAPI', TIERS[1]);
    assert.doesNotMatch(f.moduleGraph.body, /No source modules found/);
    assert.match(f.moduleGraph.body, /Python interpreter unavailable/);
    assert.equal(f.moduleGraph.completeness, 'partial');
  });
});

// ── Smaller defects ─────────────────────────────────────────────────────────

describe('smaller extraction defects', () => {
  it('the as-built test list skips __init__.py and conftest.py (FR-015)', () => {
    const dir = project(FASTAPI);
    const r = jsonOut(cli(dir, ['generate', '--spec', '.', '--format', 'json']));
    assert.deepEqual(r.tests, ['tests/test_users.py']);
  });

  it('module-level public names are symbols (FR-016)', { skip: HAS_PYTHON ? false : 'python3 not on PATH' }, async () => {
    const { buildSymbolMap } = await import('../cli/scanners/symbol-map.mjs');
    const text = buildSymbolMap(project(FASTAPI), {}, { maxBytes: 16384 }).text;
    assert.match(text, /`app\/main\.py`: [^\n]*\bapp\b/);
    assert.match(text, /`app\/api\/v1\/api\.py`: [^\n]*\bapi_router\b/);
    assert.match(text, /`app\/core\/config\.py`: [^\n]*\bsettings\b/);
  });

  it('a PEP 621 dependency with extras does not end the list (FR-017)', () => {
    const [eco] = detectEcosystems(project({ 'pyproject.toml': FASTAPI['pyproject.toml'] }));
    assert.ok(eco.deps.fastapi && eco.deps.sqlalchemy && eco.deps['pydantic-settings'] && eco.deps.uvicorn, JSON.stringify(eco.deps));
    assert.equal(eco.framework, 'FastAPI');
    assert.equal(eco.kind, 'api');
  });

  it('the docs and CHANGELOG describe the corrected extraction and tier reporting (FR-018)', () => {
    const read = p => readFileSync(join(ROOT, p), 'utf8');
    assert.match(read('docs-canonical/ARCHITECTURE.md'), /cli\/scanners\/python-routes\.mjs/);
    assert.match(read('docs-canonical/ENVIRONMENT.md'), /generate --plan[\s\S]{0,400}partial/);
    assert.match(read('docs/configuration.md'), /\| `fastapi`[^\n]*\| `api`/);
    assert.doesNotMatch(read('docs/configuration.md'), /\| `pyproject\.toml` \| `library` \(Python\) \|/);
    assert.match(read('docs/commands.md'), /include_router/);
    assert.match(read('docs/commands.md'), /DefaultRouter/);
    assert.match(read('CHANGELOG.md'), /specs\/046-python-extraction/);
  });
});

