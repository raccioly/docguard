/**
 * Route reader gaps found by running DocGuard on public RealWorld example
 * applications (spec 071).
 *
 * Every fixture is a minimal look-alike of a shape a real project uses,
 * written to a fresh temp dir; no public project's code is vendored.
 *
 * @req docguard.real-project-route-gaps#FR-001
 * @req docguard.real-project-route-gaps#FR-002
 * @req docguard.real-project-route-gaps#FR-003
 * @req docguard.real-project-route-gaps#FR-004
 * @req docguard.real-project-route-gaps#FR-005
 * @req docguard.real-project-route-gaps#FR-006
 * @req docguard.real-project-route-gaps#FR-007
 * @req docguard.real-project-route-gaps#FR-008
 * @req docguard.real-project-route-gaps#SC-001
 * @req docguard.real-project-route-gaps#SC-002
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { validateApiSurface } from '../cli/validators/api-surface.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-071-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const routesOf = (dir, framework) => scanRoutesDeep(dir, { framework }, {}, { config: {} });
const keys = routes => routes.map(r => `${r.method} ${r.path}`).sort();
const unresolvedOf = routes => (routes.scan?.unresolved || []).map(u => `${u.framework} ${u.code} ${u.file}:${u.line}`).sort();

// ── FR-001: Actix builder style ─────────────────────────────────────────────

const ACTIX = {
  'Cargo.toml': '[package]\nname = "notes"\n\n[dependencies]\nactix-web = "4"\n',
  'src/main.rs': `use actix_web::{App, HttpServer};
mod handlers;
mod routes;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| App::new().configure(routes::configure))
        .bind("0.0.0.0:8080")?
        .run()
        .await
}
`,
  'src/routes.rs': `use actix_web::web;
use crate::handlers::{accounts, posts};

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(web::resource("/").to(health))
        .service(
            web::scope("/v2")
                // accounts
                .service(web::resource("accounts")
                    .route(web::post().to_async(accounts::create))
                )
                .service(web::resource("accounts/{name}")
                    .route(web::get().to_async(accounts::show))
                    .route(web::put().to_async(accounts::edit))
                    .route(web::delete().to_async(accounts::remove))
                )
                .service(posts_scope())
                .service((posts::pinned, posts::starred))
        );
}

fn posts_scope() -> actix_web::Scope {
    web::scope("/posts")
        .route("", web::get().to(posts::list))
        .route("/{id}", web::patch().to(posts::patch))
        .service(web::scope("/drafts").configure(|c| {
            c.route("/count", web::get().to(posts::drafts));
        }))
}
`,
  'src/handlers/posts.rs': `use actix_web::{get, post, HttpResponse};

#[get("/pinned")]
pub async fn pinned() -> HttpResponse { HttpResponse::Ok().finish() }

#[post("/starred")]
pub async fn starred() -> HttpResponse { HttpResponse::Ok().finish() }

#[get("/orphan")]
async fn orphan() -> HttpResponse { HttpResponse::Ok().finish() }
`,
};

describe('FR-001: Actix scopes, resources and registered handler macros', () => {
  it('composes scope prefixes across functions, configure() and closures', () => {
    const routes = routesOf(project(ACTIX), 'Actix Web');
    assert.deepEqual(keys(routes), [
      'ANY /',
      'DELETE /v2/accounts/{name}',
      'GET /orphan',
      'GET /v2/accounts/{name}',
      'GET /v2/pinned',
      'GET /v2/posts',
      'GET /v2/posts/drafts/count',
      'PATCH /v2/posts/{id}',
      'POST /v2/accounts',
      'POST /v2/starred',
      'PUT /v2/accounts/{name}',
    ]);
    assert.ok(routes.filter(r => r.path.startsWith('/v2')).every(r => r.source === 'actix'));
    assert.deepEqual(unresolvedOf(routes), []);
  });

  it('keeps the one-line App::route form', () => {
    const routes = routesOf(project({
      'src/main.rs': 'fn app() { App::new().route("/login", web::post().to(login)).route("/me", web::get().to(me)); }\n',
    }), 'Actix Web');
    assert.deepEqual(keys(routes), ['GET /me', 'POST /login']);
  });

  it('mounts Rocket handlers under their mount() prefix', () => {
    const routes = routesOf(project({
      'src/main.rs': `#[macro_use] extern crate rocket;

#[get("/")]
fn index() -> &'static str { "hi" }

#[get("/<id>?<verbose>")]
fn item(id: u32, verbose: bool) -> String { id.to_string() }

#[post("/", data = "<form>")]
fn create(form: String) -> String { form }

#[launch]
fn rocket() -> _ {
    rocket::build()
        .mount("/", routes![index])
        .mount("/items", routes![item, create])
}
`,
    }), 'Rocket');
    assert.deepEqual(keys(routes), ['GET /', 'GET /items/<id>', 'POST /items']);
  });
});

// ── FR-002: Axum method chains, nest and merge ──────────────────────────────

const AXUM = {
  'src/main.rs': `use axum::{routing::get, Router};
mod api;

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/health", get(health))
        .nest("/api", api::router())
        .merge(api::admin_routes());
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
`,
  'src/api/mod.rs': `use axum::{routing::{get, on, MethodFilter}, Router};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/session", get(current).put(update_session))
        .route(
            "/notes/:id",
            get(show_note)
                .put(edit_note)
                .delete(drop_note),
        )
        .route("/upload", on(MethodFilter::POST | MethodFilter::PUT, upload))
        .route("/echo", axum::routing::any(echo))
}

pub fn admin_routes() -> Router<AppState> {
    Router::new().route("/admin/stats", get(stats).route_layer(axum::middleware::from_fn(require_admin)))
}
`,
};

describe('FR-002: every method of an Axum method router, under nest() prefixes', () => {
  it('reports each chained method, across lines, with nest and merge composed', () => {
    const routes = routesOf(project(AXUM), 'Axum');
    assert.deepEqual(keys(routes), [
      'ANY /api/echo',
      'DELETE /api/notes/:id',
      'GET /admin/stats',
      'GET /api/notes/:id',
      'GET /api/session',
      'GET /health',
      'POST /api/upload',
      'PUT /api/notes/:id',
      'PUT /api/session',
      'PUT /api/upload',
    ]);
    assert.ok(routes.every(r => r.source === 'axum'));
    assert.deepEqual(unresolvedOf(routes), []);
  });
});

// ── FR-003: Symfony invokable controllers ───────────────────────────────────

const SYMFONY = {
  'composer.json': JSON.stringify({ require: { 'symfony/framework-bundle': '^6.0' } }),
  'config/routes.yaml': 'controllers:\n    resource: ../src/Controller/\n    type: annotation\n',
  'src/Controller/Account/CreateAccountController.php': `<?php
namespace App\\Controller\\Account;

use Symfony\\Component\\Routing\\Annotation\\Route;

/**
 * @Route("/api/accounts", methods={"POST"}, name="api_accounts_post")
 *
 * @View(statusCode=201)
 */
final class CreateAccountController
{
    public function __construct(private Repo $repo)
    {
    }

    public function __invoke(Request $request): array
    {
        return [];
    }
}
`,
  'src/Controller/Account/ShowAccountController.php': `<?php
namespace App\\Controller\\Account;

use Symfony\\Component\\Routing\\Attribute\\Route;

#[Route('/api/accounts/{id}', methods: ['GET'], name: 'api_accounts_get')]
final class ShowAccountController
{
    public function __invoke(string $id): array
    {
        return [];
    }
}
`,
  'src/Controller/PostController.php': `<?php
namespace App\\Controller;

/**
 * @Route("/api/posts")
 */
class PostController
{
    /**
     * @Route("", methods={"GET"})
     */
    public function list(): array { return []; }

    /**
     * @Route("/{id}", methods={"DELETE"})
     */
    public function remove(int $id): array { return []; }
}
`,
};

describe('FR-003: a class-level route is the route of an invokable controller', () => {
  it('reads the annotation and attribute forms, and keeps a class route on a controller with method routes a prefix', () => {
    const routes = routesOf(project(SYMFONY), 'Symfony');
    assert.deepEqual(keys(routes), [
      'DELETE /api/posts/{id}',
      'GET /api/accounts/{id}',
      'GET /api/posts',
      'POST /api/accounts',
    ]);
    const create = routes.find(r => r.path === '/api/accounts');
    assert.equal(create.handler, 'CreateAccountController::__invoke');
    assert.deepEqual(unresolvedOf(routes), []);
  });
});

// ── FR-004: Koa routers exported as routes() ────────────────────────────────

const KOA = {
  'package.json': JSON.stringify({ dependencies: { koa: '2.15.0', 'koa-router': '12.0.0' } }),
  'src/app.js': "const Koa = require('koa');\nconst routes = require('./routes');\nconst app = new Koa();\napp.use(routes.routes());\nmodule.exports = app;\n",
  'src/routes/index.js': `const Router = require("koa-router")
const router = new Router()
const api = new Router()

const accounts = require("./accounts-router")
const notes = require("./notes-router")
const requireAuth = require("../middleware/require-auth")

api.use(accounts)
api.use(requireAuth)
api.use(notes)

router.use("/api", api.routes())

module.exports = router
`,
  'src/routes/accounts-router.js': `const Router = require("koa-router")
const ctrl = require("../controllers").accounts
const router = new Router()

router.post("/accounts/login", ctrl.login)
router.post("/accounts", ctrl.post)
router.get("/account", ctrl.get)

module.exports = router.routes()
`,
  'src/routes/notes-router.js': `import Router from '@koa/router'
const router = new Router({ prefix: '/notes' })

router.get('/', list)
router.del('/:id', remove)

export default router.middleware()
`,
  'src/middleware/require-auth.js': 'module.exports = async (ctx, next) => { if (!ctx.state.user) ctx.throw(401); await next(); };\n',
};

describe('FR-004: a Koa router mounted through a routes() export keeps its prefix', () => {
  it('follows module.exports = router.routes(), export default router.middleware() and use() of an imported router', () => {
    const routes = routesOf(project(KOA), 'Koa');
    assert.deepEqual(keys(routes), [
      'DELETE /api/notes/:id',
      'GET /api/account',
      'GET /api/notes',
      'POST /api/accounts',
      'POST /api/accounts/login',
    ]);
    const auth = Object.fromEntries(routes.map(r => [`${r.method} ${r.path}`, Boolean(r.auth)]));
    assert.equal(auth['POST /api/accounts'], false, 'mounted before the auth middleware');
    assert.equal(auth['GET /api/notes'], true, 'mounted after api.use(requireAuth)');
  });
});

// ── FR-008: a pass-through JWT middleware does not mark routes auth ───────

const KOA_JWT = passthrough => ({
  'package.json': JSON.stringify({ name: 'jwt', dependencies: { koa: '2.15.0', 'koa-router': '12.0.0', 'koa-jwt': '4.0.0' } }),
  'src/middleware/jwt.js': `const koaJwt = require('koa-jwt')\nmodule.exports = koaJwt({\n  secret: process.env.SECRET,\n${passthrough ? '  passthrough: true,\n' : ''}  key: 'jwt',\n})\n`,
  'src/middleware/auth-required.js': 'module.exports = (ctx, next) => { ctx.assert(ctx.state.jwt, 401); return next() }\n',
  'src/routes/users.js': `const Router = require('koa-router')
const auth = require('../middleware/auth-required')
const router = new Router()
router.post('/users/login', ctx => {})
router.get('/user', auth, ctx => {})
module.exports = router.routes()
`,
  'src/routes/index.js': `const Router = require('koa-router')
const router = new Router()
const api = new Router()
const users = require('./users')
api.use(users)
router.use('/api', api.routes())
module.exports = router
`,
  'src/app.js': `const Koa = require('koa')
const jwt = require('./middleware/jwt')
const routes = require('./routes')
const app = new Koa()
app.use(jwt)
app.use(routes.routes())
module.exports = app
`,
});

describe('FR-008: an app-wide JWT middleware that lets anonymous requests through marks nothing auth', () => {
  const authOf = dir => Object.fromEntries(routesOf(dir, 'Koa').map(r => [`${r.method} ${r.path}`, Boolean(r.auth)]));

  it('koa-jwt with passthrough: true in an imported module: only the route-level auth middleware counts', () => {
    const auth = authOf(project(KOA_JWT(true)));
    assert.equal(auth['POST /api/users/login'], false, 'login is public');
    assert.equal(auth['GET /api/user'], true, 'route-level auth middleware');
  });

  it('without passthrough the same middleware still marks every route below it', () => {
    const auth = authOf(project(KOA_JWT(false)));
    assert.equal(auth['POST /api/users/login'], true);
    assert.equal(auth['GET /api/user'], true);
  });

  it('inline: express-jwt with credentialsRequired: false is pass-through, the default is not', () => {
    const app = optional => ({
      'package.json': JSON.stringify({ name: 'ex', dependencies: { koa: '2.15.0', 'koa-router': '12.0.0' } }),
      'src/app.js': `const Koa = require('koa')
const Router = require('koa-router')
const { expressjwt } = require('express-jwt')
const app = new Koa()
const router = new Router()
router.get('/open', ctx => {})
app.use(expressjwt({ secret: 's', algorithms: ['HS256']${optional ? ', credentialsRequired: false' : ''} }))
app.use(router.routes())
`,
    });
    assert.equal(authOf(project(app(true)))['GET /open'], false);
    assert.equal(authOf(project(app(false)))['GET /open'], true);
  });
});

// ── FR-005: no silent zero ──────────────────────────────────────────────────

describe('FR-005: a recognised declaration that yields no route is recorded', () => {
  it('Actix: a runtime scope prefix, a runtime resource path, an unreadable method and a resource with no route', () => {
    const routes = routesOf(project({
      'src/routes.rs': `use actix_web::web;

pub fn configure(cfg: &mut web::ServiceConfig, prefix: String, name: String, m: Method) {
    cfg.service(web::scope(&prefix).route("/hidden", web::get().to(h)))
        .service(web::resource(name).route(web::get().to(h)))
        .service(web::resource("/odd").route(web::method(m).to(h)))
        .service(web::resource("/named").name("named"))
        .service(web::resource("/ok").route(web::get().to(h)));
}
`,
    }), 'Actix Web');
    assert.deepEqual(keys(routes), ['GET /ok']);
    assert.deepEqual(unresolvedOf(routes), [
      'Actix Web route-unresolved-declaration src/routes.rs:7',
      'Actix Web route-unresolved-method src/routes.rs:6',
      'Actix Web route-unresolved-path src/routes.rs:5',
      'Actix Web route-unresolved-prefix src/routes.rs:4',
    ]);
  });

  it('Axum: an unreadable method router and a runtime nest prefix', () => {
    const routes = routesOf(project({
      'src/main.rs': `use axum::{routing::get, Router};

fn app(handlers: MethodRouter, base: String) -> Router {
    Router::new()
        .route("/ok", get(ok))
        .route("/dyn", handlers)
        .nest(&base, Router::new().route("/inner", get(inner)))
}
`,
    }), 'Axum');
    assert.deepEqual(keys(routes), ['GET /ok']);
    assert.deepEqual(unresolvedOf(routes), [
      'Axum route-unresolved-method src/main.rs:6',
      'Axum route-unresolved-prefix src/main.rs:7',
    ]);
  });

  it('Symfony: a route on a trait method is recorded, not dropped', () => {
    const routes = routesOf(project({
      ...SYMFONY,
      'src/Controller/Pinging.php': '<?php\nnamespace App\\Controller;\n\ntrait Pinging\n{\n    /**\n     * @Route("/ping")\n     */\n    public function ping(): array { return []; }\n}\n',
    }), 'Symfony');
    assert.equal(routes.length, 4);
    assert.deepEqual(unresolvedOf(routes), ['Symfony route-unresolved-declaration src/Controller/Pinging.php:7']);
  });

  it('Laravel: a route file the application never loads is recorded', () => {
    const routes = routesOf(project({
      'routes/web.php': "<?php\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::get('/', fn () => view('welcome'));\n",
      'routes/api.php': "<?php\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::get('/notes', [NoteController::class, 'index']);\n",
      'routes/admin.php': "<?php\nuse Illuminate\\Support\\Facades\\Route;\n\n\nRoute::get('/dashboard', [AdminController::class, 'index']);\n",
      'routes/console.php': "<?php\nuse Illuminate\\Support\\Facades\\Artisan;\n\nArtisan::command('inspire', fn () => 1);\n",
    }), 'Laravel');
    assert.deepEqual(keys(routes), ['GET /', 'GET /api/notes']);
    assert.deepEqual(unresolvedOf(routes), ['Laravel route-unresolved-declaration routes/admin.php:5']);
  });

  it('makes the API-surface check partial and names the location', () => {
    const dir = project({
      'Cargo.toml': '[package]\nname = "x"\n\n[dependencies]\nactix-web = "4"\n',
      'src/main.rs': 'use actix_web::web;\n\nfn configure(cfg: &mut web::ServiceConfig, name: String) {\n    cfg.service(web::resource(name).route(web::get().to(h)))\n        .service(web::resource("/ok").route(web::get().to(h)));\n}\n',
      'docs-canonical/API-REFERENCE.md': '#### GET `/ok`\n',
    });
    const result = validateApiSurface(dir, {});
    assert.equal(result.applicability?.status, 'partial');
    assert.match(result.applicability.reason, /1 Actix Web route/);
    assert.match(result.applicability.reason, /src\/main\.rs:4/);
  });
});

// ── FR-006: forms read before keep their routes ─────────────────────────────

describe('FR-006: routes read before are reported unchanged', () => {
  it('an Axum route on a receiver the reader cannot evaluate keeps its literal path', () => {
    const routes = routesOf(project({
      'src/main.rs': 'fn add(r: Thing) -> Thing { r.route("/legacy", get(legacy)).route("/both", post(a).get(b)) }\n',
    }), 'Axum');
    assert.deepEqual(keys(routes), ['GET /both', 'GET /legacy', 'POST /both']);
  });

  it('an unregistered handler macro keeps its own path', () => {
    const routes = routesOf(project({ 'src/rocket.rs': '#[get("/world")]\nfn world() -> &\'static str { "hi" }\n' }), 'Rocket');
    assert.deepEqual(keys(routes), ['GET /world']);
  });
});

// ── FR-007: docs ────────────────────────────────────────────────────────────

describe('FR-007: the languages reference names the forms read and the known limits', () => {
  it('documents the Actix, Axum, Rocket, Symfony and Koa forms and the two known limitations', () => {
    const doc = readFileSync(join(ROOT, 'docs/reference/languages.md'), 'utf8');
    for (const needle of ['web::scope', 'web::resource', '.nest(', 'routes![', '__invoke', 'router.routes()', 'IControllerModelConvention', 'sqladmin', 'route-unresolved-declaration']) {
      assert.ok(doc.includes(needle), `languages.md mentions ${needle}`);
    }
  });
});
