/**
 * Sinatra, Starlette, Warp, Tide and net/http-only Go routes
 * (specs/060-more-route-frameworks, raccioly/docguard#519).
 *
 * These frameworks were classified but never read: a project using one had an
 * empty API surface. Each reference project below carries a ground truth
 * written by hand from the framework's documented routing before the readers
 * existed; against the scanner this spec extends, every one reported 0 routes.
 *
 * @req docguard.more-route-frameworks#FR-001
 * @req docguard.more-route-frameworks#FR-002
 * @req docguard.more-route-frameworks#FR-003
 * @req docguard.more-route-frameworks#FR-004
 * @req docguard.more-route-frameworks#FR-005
 * @req docguard.more-route-frameworks#FR-006
 * @req docguard.more-route-frameworks#FR-007
 * @req docguard.more-route-frameworks#FR-008
 * @req docguard.more-route-frameworks#SC-001
 * @req docguard.more-route-frameworks#SC-002
 * @req docguard.more-route-frameworks#SC-003
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { detectEcosystems } from '../cli/scanners/project-type.mjs';
import { detectRouteFramework, routeScanGaps } from '../cli/validators/api-surface.mjs';
import { pyAstAvailable } from '../cli/scanners/py-ast.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function project(files) {
  const dir = tempDir('dg-060-');
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const NO_SPEC = { openapi: { found: false } };
const keys = routes => routes.map(r => `${r.method} ${r.path}`).sort();
const sources = files => Object.entries(files).map(([file, content]) => ({ file, content }));
/** The routes of a project, end to end: detection, dispatch, reader, filters. */
const scan = dir => scanRoutesDeep(dir, { framework: detectRouteFramework(dir, {}) }, NO_SPEC, { config: {} });

async function readers() {
  const sinatra = await import('../cli/scanners/sinatra-routes.mjs');
  const rust = await import('../cli/scanners/rust-routes.mjs');
  return { ...sinatra, ...rust };
}

// ── Reference projects (SC-001) ─────────────────────────────────────────────

const SINATRA = {
  Gemfile: "source 'https://rubygems.org'\ngem 'sinatra'\ngem 'sinatra-contrib'\n",
  'config.ru': `require_relative 'app'
require_relative 'lib/admin_app'

map '/admin' do
  run AdminApp
end

map '/' do
  run App
end
`,
  'app.rb': `require 'sinatra/base'
require 'sinatra/namespace'
require_relative 'lib/base_app'
require_relative 'lib/health_routes'

class App < BaseApp
  register Sinatra::Namespace
  register HealthRoutes

  before '/api/*' do
    authenticate!
  end

  get '/' do
    erb :index
  end

  namespace '/api' do
    namespace '/v1' do
      get '/users' do
        json User.all
      end

      post '/users' do # create
        status 201
      end

      get '/users/:id' do |id|
        json User.find(id)
      end

      patch('/users/:id') { update(params) }
      delete '/users/:id' do
        halt 204
      end
    end
  end

  # get '/commented-out' do
  route :put, :post, '/sync' do
    sync!
  end

  get %r{/legacy/(\\d+)} do |n|
    "legacy #{n}"
  end

  get "/greet/#{PREFIX}" do
    'hi'
  end

  def helper
    get '/not-a-route'
  end
end
`,
  'lib/base_app.rb': `require 'sinatra/base'

class BaseApp < Sinatra::Base
  set :sessions, true
  helpers do
    def authenticate!
      halt 401 unless session[:user]
    end
  end
end
`,
  'lib/health_routes.rb': `module HealthRoutes
  def self.registered(app)
    app.get '/health' do
      'ok'
    end
    app.options '/health' do
      200
    end
  end
end
`,
  'lib/admin_app.rb': `require 'sinatra/base'

class AdminApp < Sinatra::Base
  get '/' do
    'admin'
  end

  put '/settings' do
    'saved'
  end
end
`,
  'lib/client.rb': `class ApiClient
  def fetch
    get '/remote' do |req|
      req
    end
  end
end

class Cache
  get '/not-sinatra' do
    1
  end
end
`,
  'spec/app_spec.rb': `require_relative '../app'

describe App do
  it 'lists users' do
    get '/api/v1/users'
    expect(last_response).to be_ok
  end
end
`,
};
const SINATRA_TRUTH = [
  'GET /', 'GET /api/v1/users', 'POST /api/v1/users', 'GET /api/v1/users/:id', 'PATCH /api/v1/users/:id',
  'DELETE /api/v1/users/:id', 'PUT /sync', 'POST /sync', 'GET /health', 'OPTIONS /health',
  'GET /admin', 'PUT /admin/settings',
];

const STARLETTE = {
  'requirements.txt': 'starlette==0.37.2\nuvicorn\n',
  'app.py': `from starlette.applications import Starlette
from starlette.routing import Route, Mount
from starlette.endpoints import HTTPEndpoint
from starlette.authentication import requires
from starlette.staticfiles import StaticFiles

from api.routes import api_routes
from admin import admin_router


async def homepage(request):
    """The landing page."""
    return None


@requires('authenticated')
async def dashboard(request):
    return None


class UserDetail(HTTPEndpoint):
    async def get(self, request):
        return None

    async def delete(self, request):
        return None


routes = [
    Route('/', homepage),
    Route('/dashboard', dashboard, methods=['GET', 'POST']),
    Route('/users/{user_id:int}', UserDetail),
    Mount('/api', routes=api_routes),
    Mount('/admin', app=admin_router),
    Mount('/static', app=StaticFiles(directory='static'), name='static'),
]

app = Starlette(debug=True, routes=routes)


@app.route('/legacy', methods=['PUT'])
async def legacy(request):
    return None


app.add_route('/ping', homepage)
`,
  'api/__init__.py': '',
  'api/views.py': `async def list_items(request):
    return None

async def create_item(request):
    return None

async def health(request):
    return None
`,
  'api/routes.py': `from starlette.routing import Route, Mount
from . import views

v1 = [
    Route('/items', views.list_items),
    Route('/items', views.create_item, methods=['POST']),
]

api_routes = [
    Mount('/v1', routes=v1),
    Route('/health', views.health, methods=['GET', 'HEAD']),
]
`,
  'admin.py': `from starlette.routing import Router, Route


async def stats(request):
    return None


admin_router = Router(routes=[Route('/stats', stats)])
`,
};
const STARLETTE_TRUTH = [
  'GET /', 'GET /dashboard', 'POST /dashboard', 'GET /users/{user_id:int}', 'DELETE /users/{user_id:int}',
  'GET /api/v1/items', 'POST /api/v1/items', 'GET /api/health', 'HEAD /api/health', 'GET /admin/stats',
  'PUT /legacy', 'GET /ping',
];

const FILTER = 'impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone';
const WARP = {
  'Cargo.toml': '[package]\nname = "todos"\nversion = "0.1.0"\n\n[dependencies]\nwarp = "0.3"\ntokio = { version = "1", features = ["full"] }\n',
  'src/main.rs': `use warp::Filter;

mod filters;
mod handlers;

const API: &str = "api";

#[tokio::main]
async fn main() {
    let db = models::blank_db();
    // let ghost = warp::path!("ghost").and(warp::get());
    let hello = warp::path!("hello" / String)
        .and(warp::get())
        .map(|name: String| format!("Hello, {}!", name));
    let health = warp::path("health").and(warp::path::end()).map(|| "ok");
    let api = warp::path(API).and(filters::todos(db));
    let routes = hello.or(health).or(api).with(warp::log("todos"));
    warp::serve(routes).run(([127, 0, 0, 1], 3030)).await;
}
`,
  'src/filters.rs': `use warp::Filter;
use super::handlers;

pub fn todos(db: Db) -> ${FILTER} {
    todos_list(db.clone())
        .or(todos_create(db.clone()))
        .or(todos_update(db.clone()))
        .or(todos_delete(db))
}

pub fn todos_list(db: Db) -> ${FILTER} {
    warp::path!("todos")
        .and(warp::get())
        .and(warp::query::<ListOptions>())
        .and(with_db(db))
        .and_then(handlers::list_todos)
}

pub fn todos_create(db: Db) -> ${FILTER} {
    warp::path!("todos")
        .and(warp::post())
        .and(json_body())
        .and(with_db(db))
        .and_then(handlers::create_todo)
}

pub fn todos_update(db: Db) -> ${FILTER} {
    warp::path!("todos" / u64)
        .and(warp::put())
        .and(json_body())
        .and(with_db(db))
        .and_then(handlers::update_todo)
}

pub fn todos_delete(db: Db) -> ${FILTER} {
    let admin_only = warp::header::exact("authorization", "Bearer admin");
    warp::path!("todos" / u64)
        .and(admin_only)
        .and(warp::delete())
        .and(with_db(db))
        .and_then(handlers::delete_todo)
}

fn with_db(db: Db) -> impl Filter<Extract = (Db,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || db.clone())
}

fn json_body() -> impl Filter<Extract = (Todo,), Error = warp::Rejection> + Clone {
    warp::body::content_length_limit(1024 * 16).and(warp::body::json())
}
`,
  'src/handlers.rs': `pub async fn list_todos(opts: ListOptions, db: Db) -> Result<impl warp::Reply, std::convert::Infallible> {
    let todos = db.lock().await;
    Ok(warp::reply::json(&*todos))
}
`,
};
const WARP_TRUTH = [
  'GET /hello/{String}', 'ANY /health', 'GET /api/todos', 'POST /api/todos', 'PUT /api/todos/{u64}', 'DELETE /api/todos/{u64}',
];

const TIDE = {
  'Cargo.toml': '[package]\nname = "blog"\nversion = "0.1.0"\n\n[dependencies]\ntide = "0.16"\nasync-std = { version = "1", features = ["attributes"] }\n',
  'src/main.rs': `mod users;

#[async_std::main]
async fn main() -> tide::Result<()> {
    let mut app = tide::new();
    app.at("/").get(|_| async { Ok("Hello, world!") });
    app.at("/health").get(health).head(health);
    let mut posts = app.at("/posts");
    posts.get(list_posts).post(create_post);
    posts.at("/:id").get(get_post).put(update_post).delete(delete_post);
    app.at("/api").nest(users::api());
    app.at("/admin").nest({
        let mut admin = tide::with_state(State::new());
        admin.at("/stats").get(stats);
        admin
    });
    app.at("/static").serve_dir("public/")?;
    app.at("/webhook").method(http_types::Method::Post, webhook);
    app.at("/any").all(catch_all);
    // app.at("/commented").get(nothing);
    app.listen("127.0.0.1:8080").await?;
    Ok(())
}
`,
  'src/users.rs': `pub fn api() -> tide::Server<()> {
    let mut api = tide::new();
    api.at("/users").get(list).post(create);
    register_profile(&mut api);
    api
}

fn register_profile(app: &mut tide::Server<()>) {
    app.at("/users/:id/profile").get(profile);
}
`,
};
const TIDE_TRUTH = [
  'GET /', 'GET /health', 'HEAD /health', 'GET /posts', 'POST /posts', 'GET /posts/:id', 'PUT /posts/:id',
  'DELETE /posts/:id', 'GET /api/users', 'POST /api/users', 'GET /api/users/:id/profile', 'GET /admin/stats',
  'GET /static/*', 'POST /webhook', 'ANY /any',
];

const NET_HTTP = {
  'go.mod': 'module example.com/notes\n\ngo 1.22\n',
  'cmd/server/main.go': `package main

import (
	"log"
	"net/http"

	"example.com/notes/internal/api"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz)
	api.Register(mux)
	mux.Handle("/v1/", http.StripPrefix("/v1", api.V1()))
	log.Fatal(http.ListenAndServe(":8080", mux))
}
`,
  'internal/api/api.go': `package api

import "net/http"

func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /notes", listNotes)
	mux.HandleFunc("POST /notes", createNote)
	mux.HandleFunc("GET /notes/{id}", getNote)
	mux.HandleFunc("DELETE /notes/{id}", deleteNote)
}

func V1() *http.ServeMux {
	m := http.NewServeMux()
	m.HandleFunc("GET /status", status)
	return m
}
`,
};
const NET_HTTP_TRUTH = ['GET /healthz', 'GET /notes', 'POST /notes', 'GET /notes/{id}', 'DELETE /notes/{id}', 'GET /v1/status'];

const REFERENCE = [
  { name: 'Sinatra', files: SINATRA, truth: SINATRA_TRUTH, framework: 'Sinatra', source: 'sinatra', tier: 'fallback-language' },
  { name: 'Starlette', files: STARLETTE, truth: STARLETTE_TRUTH, framework: 'Starlette', source: 'starlette' },
  { name: 'Warp', files: WARP, truth: WARP_TRUTH, framework: 'Warp', source: 'warp', tier: 'fallback-language' },
  { name: 'Tide', files: TIDE, truth: TIDE_TRUTH, framework: 'Tide', source: 'tide', tier: 'fallback-language' },
  { name: 'net/http', files: NET_HTTP, truth: NET_HTTP_TRUTH, framework: 'net/http', source: 'go-web', tier: 'fallback-language' },
];

describe('reference projects report exactly their hand-written routes (SC-001, FR-007)', () => {
  for (const ref of REFERENCE) {
    it(`${ref.name}: detected, dispatched and read end to end`, () => {
      const dir = project(ref.files);
      assert.deepEqual(detectEcosystems(dir).map(e => e.framework), [ref.framework]);
      const routes = scan(dir);
      assert.deepEqual(keys(routes), [...ref.truth].sort());
      assert.ok(routes.every(r => r.source === ref.source), `every route carries source ${ref.source}`);
      if (ref.tier) assert.ok(routes.every(r => r.tier === ref.tier), `every route carries tier ${ref.tier}`);
      else assert.ok(routes.every(r => r.tier === 'py-ast' || r.tier === 'regex-fallback'));
    });
  }
});

// ── Sinatra (FR-001) ────────────────────────────────────────────────────────

describe('Sinatra (FR-001)', () => {
  it('reads a classic app split across files, with every verb and brace blocks', async () => {
    const { extractSinatraRoutes } = await readers();
    const routes = extractSinatraRoutes(sources({
      'app.rb': `require 'sinatra'
require_relative 'routes/users'

get('/') { 'home' }
head '/ping' do end
link '/docs' do end
unlink '/docs' do end
put '/items/:id', provides: :json do
  'x'
end
`,
      'routes/users.rb': `get '/users' do
  'list'
end
options '/users' do
end
`,
    }));
    assert.deepEqual(keys(routes), ['GET /', 'GET /users', 'HEAD /ping', 'LINK /docs', 'OPTIONS /users', 'PUT /items/:id', 'UNLINK /docs'].sort());
  });

  it('resolves app classes through project superclasses, Sinatra.new and Class.new', async () => {
    const { extractSinatraRoutes } = await readers();
    const routes = extractSinatraRoutes(sources({
      'base.rb': "module Web\n  class Base < Sinatra::Application\n  end\nend\n",
      'a.rb': "class Users < Web::Base\n  get '/users' do\n  end\nend\n",
      'b.rb': "Ping = Sinatra.new do\n  get '/ping' do\n  end\nend\nPong = Class.new(Sinatra::Base) do\n  post '/pong' do\n  end\nend\n",
      'c.rb': "class Plain\n  get '/plain' do\n  end\nend\n",
    }));
    assert.deepEqual(keys(routes), ['GET /ping', 'GET /users', 'POST /pong']);
  });

  it('`use` serves a middleware app under its host prefix; Rack::URLMap maps apps', async () => {
    const { extractSinatraRoutes } = await readers();
    const routes = extractSinatraRoutes(sources({
      'config.ru': "run Rack::URLMap.new('/api' => Api, '/' => Site)\n",
      'api.rb': "class Api < Sinatra::Base\n  use Auth\n  get '/items' do\n  end\nend\n",
      'auth.rb': "class Auth < Sinatra::Base\n  post '/login' do\n  end\nend\n",
      'site.rb': "class Site < Sinatra::Base\n  get '/about' do\n  end\nend\n",
    }));
    assert.deepEqual(keys(routes), ['GET /about', 'GET /api/items', 'POST /api/login']);
  });

  it('auth comes from the route block or a before filter covering it', async () => {
    const { extractSinatraRoutes } = await readers();
    const routes = extractSinatraRoutes(sources({
      'app.rb': `class App < Sinatra::Base
  before '/admin/*' do
    halt 401 unless authorized?
  end
  get '/admin/panel' do
  end
  get '/public' do
  end
  get '/me' do
    authenticate!
  end
end
`,
    }));
    const auth = Object.fromEntries(routes.map(r => [r.path, r.auth]));
    assert.deepEqual(auth, { '/admin/panel': true, '/public': false, '/me': true });
  });

  it('heredocs, comments and =begin blocks do not produce routes', async () => {
    const { extractSinatraRoutes } = await readers();
    const routes = extractSinatraRoutes(sources({
      'app.rb': `require 'sinatra'
=begin
get '/doc-block' do
end
=end
get '/text' do
  <<~HTML
    get '/in-heredoc' do
    end
  HTML
end
x = "get '/in-string' do end"
`,
    }));
    assert.deepEqual(keys(routes), ['GET /text']);
  });
});

// ── Starlette (FR-002) ──────────────────────────────────────────────────────

describe('Starlette (FR-002)', () => {
  it('reads the same routes at the regex-fallback tier when no interpreter is available', () => {
    const dir = project(STARLETTE);
    const noPy = tempDir('dg-060-nopy-');
    for (const bin of ['node']) {
      const which = spawnSync('command', ['-v', bin], { shell: true, encoding: 'utf8' }).stdout.trim();
      if (which) symlinkSync(which, join(noPy, bin));
    }
    const script = join(tempDir('dg-060-probe-'), 'probe.mjs');
    writeFileSync(script, `const [root, dir] = process.argv.slice(2);
const { scanRoutesDeep } = await import(root + '/cli/scanners/routes.mjs');
const routes = scanRoutesDeep(dir, { framework: 'Starlette' }, { openapi: { found: false } }, { config: {} });
console.log(JSON.stringify(routes.map(r => ({ key: r.method + ' ' + r.path, tier: r.tier, auth: r.auth }))));
`);
    const r = spawnSync(process.execPath, [script, ROOT, dir], { encoding: 'utf8', env: { ...process.env, PATH: noPy } });
    assert.equal(r.status, 0, r.stderr);
    const routes = JSON.parse(r.stdout);
    assert.deepEqual(routes.map(x => x.key).sort(), [...STARLETTE_TRUTH].sort());
    assert.ok(routes.every(x => x.tier === 'regex-fallback'));
    assert.ok(routes.find(x => x.key === 'POST /dashboard').auth, '@requires marks the route as authenticated');
  });

  it('auth from @requires, handler names, and the AST tier when an interpreter exists', { skip: pyAstAvailable() ? false : 'python3 not on PATH' }, () => {
    const routes = scan(project(STARLETTE));
    const by = Object.fromEntries(routes.map(r => [`${r.method} ${r.path}`, r]));
    assert.equal(by['GET /dashboard'].auth, true);
    assert.equal(by['GET /'].auth, false);
    assert.equal(by['GET /'].handler, 'homepage');
    assert.equal(by['GET /api/v1/items'].handler, 'list_items');
    assert.ok(routes.every(r => r.tier === 'py-ast'));
  });

  it('a Router or Route from another library is not read as Starlette', () => {
    const routes = scan(project({
      'requirements.txt': 'starlette\n',
      'app.py': 'from mylib import Router, Route\nr = Router(routes=[Route("/x", f)])\n',
    }));
    assert.deepEqual(keys(routes), []);
  });

  it('a path that does not evaluate is omitted and recorded as a limitation (FR-005)', () => {
    const routes = scan(project({
      'requirements.txt': 'starlette\n',
      'app.py': 'from starlette.applications import Starlette\nfrom starlette.routing import Route\nimport os\napp = Starlette(routes=[Route(os.environ["P"], f), Route("/ok", f)])\n',
    }));
    assert.deepEqual(keys(routes), ['GET /ok']);
    assert.ok(routes.limitations.some(l => l.code === 'python-unresolved-route-path'));
  });

  it('a FastAPI app keeps its routes and also reads a mounted Starlette router', () => {
    const routes = scan(project({
      'requirements.txt': 'fastapi\n',
      'main.py': `from fastapi import FastAPI
from starlette.routing import Router, Route

app = FastAPI()

@app.get("/items")
def items():
    return []

legacy = Router(routes=[Route("/old", items)])
app.mount("/legacy", legacy)
`,
    }));
    assert.deepEqual(keys(routes), ['GET /items', 'GET /legacy/old']);
  });
});

// ── Warp (FR-003) ───────────────────────────────────────────────────────────

describe('Warp (FR-003)', () => {
  it('reads path::param, path::tail, bare imports, and routes without warp::serve', async () => {
    const { extractWarpRoutes } = await readers();
    const routes = extractWarpRoutes(sources({
      'src/lib.rs': `use warp::{Filter, path};

pub fn routes() -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
    let item = path("items").and(warp::path::param::<u32>()).and(path::end()).and(warp::get());
    let files = warp::path("files").and(warp::path::tail()).and(warp::get());
    let catch_all = warp::any().map(|| "not found");
    item.or(files).or(catch_all)
}
`,
    }));
    assert.deepEqual(keys(routes), ['GET /files/{*tail}', 'GET /items/{u32}']);
  });

  it('drops alternatives that cannot match: two methods, or segments after path::end', async () => {
    const { extractWarpRoutes } = await readers();
    const routes = extractWarpRoutes(sources({
      'src/main.rs': `fn main() {
    let a = warp::path("a").and(warp::get()).and(warp::post());
    let b = warp::path!("b").and(warp::path("c"));
    let c = warp::path("ok").and(warp::get().or(warp::head()));
    warp::serve(a.or(b).or(c));
}
`,
    }));
    assert.deepEqual(keys(routes), ['GET /ok', 'HEAD /ok']);
  });

  it('auth from an authorization header filter or an auth-named filter function', async () => {
    const { extractWarpRoutes } = await readers();
    const routes = extractWarpRoutes(sources({ 'src/main.rs': WARP['src/main.rs'], 'src/filters.rs': WARP['src/filters.rs'] }));
    const auth = Object.fromEntries(routes.map(r => [`${r.method} ${r.path}`, r.auth]));
    assert.equal(auth['DELETE /api/todos/{u64}'], true);
    assert.equal(auth['GET /api/todos'], false);
    assert.equal(routes.find(r => r.method === 'GET' && r.path === '/api/todos').handler, 'list_todos');
  });
});

// ── Tide (FR-004) ───────────────────────────────────────────────────────────

describe('Tide (FR-004)', () => {
  it('chained at() nests; a route variable reassigned in another function does not leak', async () => {
    const { extractTideRoutes } = await readers();
    const routes = extractTideRoutes(sources({
      'src/main.rs': `fn main() {
    let mut app = tide::new();
    app.at("/a").at("/b").get(h);
    let mut r = app.at("/r");
    r.post(h);
    other();
}
fn other() {
    let mut r = tide::new();
    r.at("/x").get(h);
}
`,
    }));
    assert.deepEqual(keys(routes), ['GET /a/b', 'GET /x', 'POST /r']);
  });
});

// ── Non-literal paths (FR-005, SC-003) ──────────────────────────────────────

describe('non-literal paths are omitted and counted (FR-005, SC-003)', () => {
  it('each reader omits what it cannot read and says so', async () => {
    const { extractSinatraRoutes, extractWarpRoutes, extractTideRoutes } = await readers();
    const sinatra = extractSinatraRoutes(sources({
      'app.rb': "require 'sinatra'\nget \"/u/#{x}\" do\nend\nget %r{/r/\\d+} do\nend\nget PATH do\nend\nnamespace %r{/v\\d} do\n  get '/in' do\n  end\nend\nget '/ok' do\nend\n",
    }));
    assert.deepEqual(keys(sinatra), ['GET /ok']);
    assert.equal(sinatra.omitted.length, 4);

    const warp = extractWarpRoutes(sources({
      'src/main.rs': 'fn main() {\n    let name = std::env::var("P").unwrap();\n    let a = warp::path(name).and(warp::get());\n    let b = warp::path("ok").and(warp::get());\n    warp::serve(a.or(b));\n}\n',
    }));
    assert.deepEqual(keys(warp), ['GET /ok']);
    assert.equal(warp.omitted.length, 1);

    const tide = extractTideRoutes(sources({
      'src/main.rs': 'fn main() {\n    let mut app = tide::new();\n    app.at(&format!("/{}", p)).get(h);\n    let mut s = app.at(prefix);\n    s.at("/inner").get(h);\n    app.at("/ok").get(h);\n}\n',
    }));
    assert.deepEqual(keys(tide), ['GET /ok']);
    assert.equal(tide.omitted.length, 2);
  });

  it('the API-surface coverage reason names the framework and the count', () => {
    const dir = project({
      Gemfile: "gem 'sinatra'\n",
      'app.rb': "require 'sinatra'\nget '/ok' do\nend\nget %r{/r/\\d+} do\nend\n",
    });
    const routes = scan(dir);
    assert.deepEqual(keys(routes), ['GET /ok']);
    const reasons = routeScanGaps(routes.scan, routes.length).join(' ');
    assert.match(reasons, /Sinatra: 1 route whose path is not literal text was omitted/);
  });
});

// ── net/http classification (FR-006) ────────────────────────────────────────

describe('net/http-only Go modules (FR-006)', () => {
  it('a module with no HTTP server stays unclassified', () => {
    const dir = project({ 'go.mod': 'module x\n\ngo 1.22\n', 'main.go': 'package main\n\nimport "net/http"\n\nfunc main() { http.Get("https://example.com") }\n' });
    assert.deepEqual(detectEcosystems(dir).map(e => e.framework), [null]);
  });

  it('a router dependency keeps its classification; _test.go and testdata do not classify', () => {
    const gin = project({ 'go.mod': 'module x\n\nrequire github.com/gin-gonic/gin v1.9.1\n', 'main.go': 'package main\nimport "net/http"\nfunc main() { http.ListenAndServe(":1", nil) }\n' });
    assert.deepEqual(detectEcosystems(gin).map(e => e.framework), ['Gin']);
    const testOnly = project({
      'go.mod': 'module x\n',
      'main_test.go': 'package main\nimport "net/http"\nfunc TestX() { http.HandleFunc("/x", nil) }\n',
      'testdata/srv.go': 'package srv\nimport "net/http"\nfunc s() { http.ListenAndServe(":1", nil) }\n',
    });
    assert.deepEqual(detectEcosystems(testOnly).map(e => e.framework), [null]);
  });
});

// ── Detection gates (FR-007) ────────────────────────────────────────────────

describe('detection routes each framework to its reader (FR-007)', () => {
  it('starlette alongside fastapi stays FastAPI; sinatra alongside rails stays Rails', () => {
    const py = project({ 'requirements.txt': 'fastapi\nstarlette\n' });
    assert.deepEqual(detectEcosystems(py).map(e => e.framework), ['FastAPI']);
    const rb = project({ Gemfile: "gem 'rails'\ngem 'sinatra'\n" });
    assert.deepEqual(detectEcosystems(rb).map(e => e.framework), ['Rails']);
  });
});

// ── Docs (FR-008) ───────────────────────────────────────────────────────────

describe('docs describe the new readers (FR-008)', () => {
  it('the languages reference lists them and no longer calls them unread', () => {
    const doc = readFileSync(join(ROOT, 'docs/reference/languages.md'), 'utf8');
    for (const name of ['Sinatra', 'Starlette', 'Warp', 'Tide']) {
      assert.match(doc, new RegExp(`^\\| ${name}[ ,|]`, 'm'), `${name} has a routes row`);
    }
    assert.match(doc, /sinatra-routes\.mjs/);
    assert.match(doc, /rust-routes\.mjs/);
    const unread = doc.split('Classified but not read for routes')[1]?.split('\n\n')[0] || '';
    for (const name of ['Sinatra', 'Starlette', 'Warp', 'Tide', 'net/http']) assert.doesNotMatch(unread, new RegExp(name));
    const arch = readFileSync(join(ROOT, 'docs-canonical/ARCHITECTURE.md'), 'utf8');
    assert.match(arch, /sinatra-routes\.mjs/);
    assert.match(arch, /rust-routes\.mjs/);
  });
});

describe('omissions under test paths are not counted (FR-005)', () => {
  it('a non-literal route in spec/ does not make the reason', () => {
    const dir = project({
      Gemfile: "gem 'sinatra'\n",
      'app.rb': "require 'sinatra'\nget '/ok' do\nend\n",
      'spec/support/fake_app.rb': "require 'sinatra'\nget %r{/fake/\\d+} do\nend\n",
    });
    const routes = scan(dir);
    assert.deepEqual(keys(routes), ['GET /ok']);
    assert.doesNotMatch(routeScanGaps(routes.scan, routes.length).join(' '), /omitted/);
  });
});
