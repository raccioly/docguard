/**
 * Go, Spring and Rails route extraction (specs/047-go-spring-rails-routes):
 * a route is reported at the path its framework serves it under — group,
 * class-base and namespace prefixes included — and a route whose path cannot
 * be read is omitted, never guessed.
 *
 * Every ground truth below was written by hand from the framework's documented
 * routing semantics before the fix. Against the scanner this spec replaces,
 * the eight reference projects found 6 of 80 routes and reported 43 that do
 * not exist.
 *
 * @req docguard.go-spring-rails-routes#FR-001
 * @req docguard.go-spring-rails-routes#FR-002
 * @req docguard.go-spring-rails-routes#FR-003
 * @req docguard.go-spring-rails-routes#FR-004
 * @req docguard.go-spring-rails-routes#FR-005
 * @req docguard.go-spring-rails-routes#FR-006
 * @req docguard.go-spring-rails-routes#FR-007
 * @req docguard.go-spring-rails-routes#FR-008
 * @req docguard.go-spring-rails-routes#FR-009
 * @req docguard.go-spring-rails-routes#SC-001
 * @req docguard.go-spring-rails-routes#SC-002
 * @req docguard.go-spring-rails-routes#SC-003
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { extractGoRoutes } from '../cli/scanners/go-routes.mjs';
import { extractSpringRoutes } from '../cli/scanners/spring-routes.mjs';
import { extractRailsRoutes, singularize, pluralize } from '../cli/scanners/rails-routes.mjs';
import { detectEcosystems } from '../cli/scanners/project-type.mjs';
import { computeApiSurfaceDrift } from '../cli/validators/api-surface.mjs';
import { diffRoutes } from '../cli/commands/diff.mjs';

const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-047-'));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const NO_SPEC = { openapi: { found: false } };
const keys = routes => routes.map(r => `${r.method} ${r.path}`).sort();
const sources = files => Object.entries(files).map(([file, content]) => ({ file, content }));
const go = files => keys(extractGoRoutes(sources(files)));
const spring = files => keys(extractSpringRoutes(sources(files)));
const rails = (content, readDraw) => keys(extractRailsRoutes(content, { readDraw }));
const STANDARD_OR_ANY = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'ANY']);

const REFERENCE_PROJECTS = [
  {
    name: 'gin', framework: 'Gin',
    files: {
      'cmd/api/main.go': `package main

import "github.com/gin-gonic/gin"

func main() {
	r := gin.Default()
	r.GET("/health", health) // liveness
	v1 := r.Group("/api/v1")
	{
		users := v1.Group("/users")
		users.GET("", listUsers)
		users.POST("", createUser)
		users.GET("/:id", getUser)
		users.DELETE("/:id", deleteUser)
		admin := v1.Group("/admin", authRequired())
		admin.PUT("/settings", updateSettings)
	}
	registerOrders(v1)
	r.Handle("OPTIONS", "/api/v1/ping", ping)
	r.Run()
}
`,
      'cmd/api/orders.go': `package main

import "github.com/gin-gonic/gin"

// registerOrders mounts the order endpoints under the group it is given.
func registerOrders(rg *gin.RouterGroup) {
	orders := rg.Group("/orders")
	orders.GET("", listOrders)
	orders.GET("/:id", getOrder)
}
`,
      'cmd/api/main_test.go': `package main

func TestRoutes(t *testing.T) {
	r := gin.New()
	r.GET("/only-in-test", nil)
}
`,
    },
    truth: [
      'GET /health',
      'GET /api/v1/users', 'POST /api/v1/users', 'GET /api/v1/users/:id', 'DELETE /api/v1/users/:id',
      'PUT /api/v1/admin/settings',
      'GET /api/v1/orders', 'GET /api/v1/orders/:id',
      'OPTIONS /api/v1/ping',
    ],
  },
  {
    name: 'echo', framework: 'Echo',
    files: {
      'server.go': `package main

func main() {
	e := echo.New()
	e.GET("/", home)
	g := e.Group("/admin", middleware.BasicAuth(check))
	g.GET("/stats", stats)
	g.Any("/proxy", proxy)
	e.Match([]string{"GET", "POST"}, "/form", form)
	e.Logger.Fatal(e.Start(":1323"))
}
`,
    },
    truth: ['GET /', 'GET /admin/stats', 'ANY /admin/proxy', 'GET /form', 'POST /form'],
  },
  {
    name: 'chi', framework: 'Chi',
    files: {
      'internal/http/router.go': `package http

func NewRouter() http.Handler {
	r := chi.NewRouter()
	r.Get("/", index)
	r.Route("/articles", func(r chi.Router) {
		r.Get("/", listArticles)
		r.Post("/", createArticle)
		r.Route("/{articleID}", func(r chi.Router) {
			r.Get("/", getArticle)
			r.Put("/", updateArticle)
		})
	})
	r.Mount("/admin", adminRouter())
	r.Group(func(r chi.Router) {
		r.Use(auth)
		r.Get("/me", me)
	})
	return r
}

func adminRouter() http.Handler {
	r := chi.NewRouter()
	r.Get("/", adminIndex)
	r.With(paginate).Get("/accounts", listAccounts)
	return r
}
`,
    },
    truth: [
      'GET /', 'GET /articles', 'POST /articles', 'GET /articles/{articleID}', 'PUT /articles/{articleID}',
      'GET /me', 'GET /admin', 'GET /admin/accounts',
    ],
  },
  {
    name: 'net/http', framework: 'Go',
    files: {
      'main.go': `package main

import "net/http"

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthz)
	mux.HandleFunc("GET /items/{id}", getItem)
	mux.HandleFunc("POST /items", createItem)
	mux.Handle("DELETE /items/{id}", http.HandlerFunc(deleteItem))
	mux.HandleFunc("GET /files/{path...}", files)
	mux.HandleFunc("GET /{$}", root)
	http.HandleFunc("/legacy", legacy)
	resp, _ := http.Get("https://upstream.internal/status")
	_ = resp
	http.ListenAndServe(":8080", mux)
}
`,
    },
    truth: [
      'ANY /healthz', 'GET /items/{id}', 'POST /items', 'DELETE /items/{id}',
      'GET /files/{path...}', 'GET /', 'ANY /legacy',
    ],
  },
  {
    name: 'gorilla+fiber', framework: 'Go Fiber',
    files: {
      'gorilla.go': `package main

func routes() {
	r := mux.NewRouter()
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/users", users).Methods("GET", "POST")
	r.HandleFunc("/status", status).Methods(http.MethodGet)
}
`,
      'fiber.go': `package main

func app() {
	app := fiber.New()
	api := app.Group("/v2")
	api.Get("/products", products)
	api.Delete("/products/:id", deleteProduct)
	app.All("/any", anyHandler)
}
`,
    },
    truth: [
      'GET /api/users', 'POST /api/users', 'GET /status',
      'GET /v2/products', 'DELETE /v2/products/:id', 'ANY /any',
    ],
  },
  {
    name: 'spring-java', framework: 'Spring Boot',
    files: {
      'src/main/java/acme/web/CategoryController.java': `package acme.web;

import org.springframework.web.bind.annotation.*;

/**
 * Categories. Example: @GetMapping("/not-a-route") inside a comment.
 */
@RestController
@RequestMapping(path = "/api/categories", produces = "application/json")
public class CategoryController {

    @GetMapping
    public List<Category> list() { return service.all(); }

    @GetMapping(path = "/{id}")
    public Category get(@PathVariable Long id) { return service.get(id); }

    @PostMapping(value = "/bulk")
    public void bulk(@RequestBody List<Category> body) {}

    @GetMapping({"/search", "/find"})
    public List<Category> search(@RequestParam String q) { return null; }

    @RequestMapping(value = "/{id}", method = RequestMethod.PATCH)
    public Category patch(@PathVariable Long id) { return null; }

    @RequestMapping(method = {RequestMethod.PUT, RequestMethod.POST}, path = "/{id}/tags")
    public void tags(@PathVariable Long id) {}

    @DeleteMapping("/{id:\\\\d+}")
    public void delete(@PathVariable Long id) {}
}
`,
      'src/main/java/acme/web/ApiPaths.java': `package acme.web;

public final class ApiPaths {
    public static final String BASE = "/api";
    public static final String USERS = BASE + "/users";
    public static final String BY_ID = "/{userId}";
}
`,
      'src/main/java/acme/web/UserController.java': `package acme.web;

@RestController
@RequestMapping(ApiPaths.USERS)
public class UserController {
    @GetMapping(ApiPaths.BY_ID)
    public User get(@PathVariable String userId) { return null; }

    @RequestMapping("/export")
    public void export() {}
}
`,
      'src/main/java/acme/clients/BillingClient.java': `package acme.clients;

@FeignClient(name = "billing", path = "/billing")
public interface BillingClient {
    @GetMapping("/invoices/{id}")
    Invoice invoice(@PathVariable String id);
}
`,
    },
    truth: [
      'GET /api/categories', 'GET /api/categories/{id}', 'POST /api/categories/bulk',
      'GET /api/categories/search', 'GET /api/categories/find', 'PATCH /api/categories/{id}',
      'PUT /api/categories/{id}/tags', 'POST /api/categories/{id}/tags', 'DELETE /api/categories/{id:\\d+}',
      'GET /api/users/{userId}', 'ANY /api/users/export',
    ],
  },
  {
    name: 'spring-kotlin', framework: 'Spring Boot',
    files: {
      'src/main/kotlin/acme/OrderController.kt': `package acme

@RestController
@RequestMapping(value = ["/api/v2/orders"])
class OrderController(private val service: OrderService) {

    @GetMapping
    fun list(): List<Order> = service.all()

    @GetMapping("/{orderId}")
    fun get(@PathVariable orderId: Long): Order = service.get(orderId)

    @PostMapping(path = ["", "/new"])
    fun create(@RequestBody order: Order): Order = service.save(order)

    @RequestMapping("/{orderId}/cancel", method = [RequestMethod.POST])
    fun cancel(@PathVariable orderId: Long) = service.cancel(orderId)
}
`,
    },
    truth: [
      'GET /api/v2/orders', 'GET /api/v2/orders/{orderId}', 'POST /api/v2/orders',
      'POST /api/v2/orders/new', 'POST /api/v2/orders/{orderId}/cancel',
    ],
  },
  {
    name: 'rails', framework: 'Rails',
    files: {
      'config/routes.rb': `Rails.application.routes.draw do
  # Health check: get "commented-out"
  root "home#index"
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :admin do
    resources :users, only: [:index, :show]
    resource :settings, only: %i[show update]
  end

  namespace :api, defaults: { format: :json } do
    namespace :v1 do
      resources :articles, except: [:new, :edit] do
        resources :comments, only: [:index, :create]
        member do
          post :publish
        end
        collection do
          get :search
        end
        get :preview, on: :member
      end
    end
  end

  scope "/billing", module: "billing" do
    get "invoices", to: "invoices#index"
    match "webhook", to: "webhooks#receive", via: [:post, :put]
  end

  resource :profile
  resources :photos, param: :slug, only: :show
end
`,
    },
    truth: [
      'GET /', 'GET /up',
      'GET /admin/users', 'GET /admin/users/:id',
      'GET /admin/settings', 'PATCH /admin/settings', 'PUT /admin/settings',
      'GET /api/v1/articles', 'POST /api/v1/articles', 'GET /api/v1/articles/:id',
      'PATCH /api/v1/articles/:id', 'PUT /api/v1/articles/:id', 'DELETE /api/v1/articles/:id',
      'GET /api/v1/articles/:article_id/comments', 'POST /api/v1/articles/:article_id/comments',
      'POST /api/v1/articles/:id/publish', 'GET /api/v1/articles/search', 'GET /api/v1/articles/:id/preview',
      'GET /billing/invoices', 'POST /billing/webhook', 'PUT /billing/webhook',
      'GET /profile', 'GET /profile/new', 'POST /profile', 'GET /profile/edit',
      'PATCH /profile', 'PUT /profile', 'DELETE /profile',
      'GET /photos/:slug',
    ],
  },
];

describe('SC-001: the reference projects report exactly their ground truth', () => {
  for (const ref of REFERENCE_PROJECTS) {
    it(`${ref.name} (${ref.framework})`, () => {
      const routes = scanRoutesDeep(project(ref.files), { framework: ref.framework }, NO_SPEC);
      assert.deepEqual(keys(routes), [...ref.truth].sort());
      for (const r of routes) assert.ok(STANDARD_OR_ANY.has(r.method), `${r.method} is a standard method or ANY (FR-006)`);
    });
  }

  it('routes keep their source, file and handler', () => {
    const [gin] = REFERENCE_PROJECTS;
    const routes = scanRoutesDeep(project(gin.files), { framework: 'Gin' }, NO_SPEC);
    const orders = routes.find(r => r.path === '/api/v1/orders/:id');
    assert.equal(orders.source, 'go-web');
    assert.equal(orders.file.split(/[\\/]/).join('/'), 'cmd/api/orders.go');
    assert.equal(orders.handler, 'getOrder');
    const spring = REFERENCE_PROJECTS.find(r => r.name === 'spring-java');
    const list = scanRoutesDeep(project(spring.files), { framework: 'Spring Boot' }, NO_SPEC).find(r => r.path === '/api/categories');
    assert.equal(list.source, 'spring-boot');
    assert.equal(list.handler, 'list');
    const rails = REFERENCE_PROJECTS.find(r => r.name === 'rails');
    const users = scanRoutesDeep(project(rails.files), { framework: 'Rails' }, NO_SPEC).find(r => r.path === '/admin/users/:id');
    assert.equal(users.source, 'rails');
    assert.equal(users.handler, 'admin/users#show');
  });
});

describe('FR-001: Go prefixes compose across blocks, functions, files and mounts', () => {
  it('a name reused in two functions does not share a prefix', () => {
    assert.deepEqual(go({ 'a.go': `package main
func a(r *gin.Engine) { api := r.Group("/a"); api.GET("/x", h) }
func b(r *gin.Engine) { api := r.Group("/b"); api.GET("/y", h) }
` }), ['GET /a/x', 'GET /b/y']);
  });

  it('a function called with two groups reports its routes under both', () => {
    assert.deepEqual(go({ 'main.go': `package main
func main() {
	r := gin.New()
	register(r.Group("/v1"))
	register(r.Group("/v2"))
}
func register(rg *gin.RouterGroup) { rg.GET("/items", list) }
` }), ['GET /v1/items', 'GET /v2/items']);
  });

  it('a function never called with a known group keeps its own prefix', () => {
    assert.deepEqual(go({ 'solo.go': `package main
func Solo(rg *gin.RouterGroup) { rg.GET("/solo", h) }
` }), ['GET /solo']);
  });

  it('same-named methods are told apart by package and receiver type', () => {
    const routes = go({
      'internal/users/handler.go': `package users
type Handler struct{}
func NewHandler() *Handler { return &Handler{} }
func (h *Handler) Register(rg *gin.RouterGroup) {
	rg.GET("", h.list)
	rg.GET("/:id", h.get)
}
`,
      'internal/orders/handler.go': `package orders
type Handler struct{}
func (h *Handler) Register(rg *gin.RouterGroup) { rg.POST("", h.create) }
`,
      'cmd/api/main.go': `package main
func main() {
	r := gin.New()
	v1 := r.Group("/v1")
	uh := users.NewHandler()
	uh.Register(v1.Group("/users"))
	oh := &orders.Handler{}
	oh.Register(v1.Group("/orders"))
	s.admin.Register(v1.Group("/admin")) // which Register? unknown: omitted, not guessed
}
`,
    });
    assert.deepEqual(routes, ['GET /v1/users', 'GET /v1/users/:id', 'POST /v1/orders']);
  });

  it('package-qualified functions and returned routers resolve by package', () => {
    assert.deepEqual(go({
      'internal/users/routes.go': `package users
func Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/", list)
	return r
}
`,
      'internal/orders/routes.go': `package orders
func Routes() http.Handler {
	r := chi.NewRouter()
	r.Post("/", create)
	return r
}
`,
      'main.go': `package main
func main() {
	r := chi.NewRouter()
	r.Mount("/users", users.Routes())
	r.Mount("/orders", orders.Routes())
	r.Route("/reports", reportRoutes)
}
func reportRoutes(r chi.Router) { r.Get("/daily", daily) }
`,
    }), ['GET /reports/daily', 'GET /users', 'POST /orders']);
  });

  it('net/http StripPrefix mounts a sub-mux; a sub-mux handed the full path is not itself a route', () => {
    assert.deepEqual(go({ 'main.go': `package main
func main() {
	api := http.NewServeMux()
	api.HandleFunc("GET /items", list)
	v2 := http.NewServeMux()
	v2.HandleFunc("/v2/ping", ping)
	mux := http.NewServeMux()
	mux.Handle("/api/", http.StripPrefix("/api", api))
	mux.Handle("/v2/", v2)
	mux.Handle("/static/", http.FileServer(http.Dir("./public")))
}
` }), ['ANY /static/', 'ANY /v2/ping', 'GET /api/items']);
  });

  it('a struct-field router and a string constant prefix resolve', () => {
    assert.deepEqual(go({
      'server.go': `package server
type Server struct{ router *gin.Engine }
func New() *Server {
	s := &Server{}
	s.router = gin.New()
	s.api = s.router.Group(apiPrefix)
	return s
}
func (s *Server) routes() {
	s.router.GET("/healthz", s.health)
	s.api.GET("/users", s.users)
}
`,
      'config.go': `package server
const (
	apiPrefix = "/api" + version
	version   = "/v3"
)
`,
    }), ['GET /api/v3/users', 'GET /healthz']);
  });

  it('cyclic calls stop, and no route is reported twice', () => {
    const routes = extractGoRoutes(sources({ 'loop.go': `package main
func a(g *gin.RouterGroup) { b(g.Group("/x")) }
func b(g *gin.RouterGroup) { g.GET("/z", h); a(g.Group("/y")) }
` }));
    assert.ok(routes.length >= 1);
    assert.ok(routes.every(r => r.path.endsWith('/z')));
    assert.equal(new Set(keys(routes)).size, routes.length);
  });
});

describe('FR-002: every Go registration form is read, and only registrations', () => {
  it('method-first, Match, Add, Method/MethodFunc, raw strings and constants', () => {
    assert.deepEqual(go({ 'forms.go': `package main
const base = "/c"
func main() {
	r := gin.Default()
	r.Handle("OPTIONS", "/opt", h)
	r.Match([]string{http.MethodGet, http.MethodHead}, "/probe", h)
	r.GET(\`/raw\`, h)
	r.GET(base+"/k", h)
	r.Any("/any", h)
	e := echo.New()
	e.Add("PUT", "/put", h)
	c := chi.NewRouter()
	c.Method("PATCH", "/m", h)
	c.MethodFunc(http.MethodDelete, "/mf", h)
	c.Connect("/tunnel", h)
	c.HandleFunc("/chi-any", h)
}
` }), [
      'ANY /any', 'ANY /chi-any', 'CONNECT /tunnel', 'DELETE /mf', 'GET /c/k', 'GET /probe', 'GET /raw',
      'HEAD /probe', 'OPTIONS /opt', 'PATCH /m', 'PUT /put',
    ]);
  });

  it('Go 1.22 patterns: method, host, {name...} and {$}', () => {
    assert.deepEqual(go({ 'mux.go': `package main
func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("POST api.example.com/hooks", hook)
	mux.HandleFunc("GET /files/{path...}", files)
	mux.HandleFunc("GET /items/{$}", items)
	mux.HandleFunc("BREW /pot", brew)
	bus.Handle("user/created", onCreated)
}
` }), ['GET /files/{path...}', 'GET /items/', 'POST /hooks']);
  });

  it('comments, strings, test files, client calls and context accessors are not routes', () => {
    assert.deepEqual(go({
      'main.go': `package main
func main() {
	r := gin.Default()
	// r.GET("/commented", h)
	/* r.GET("/block", h) */
	r.GET("/redirect", redirectTo("http://example.org/x"))
	r.GET("/after", h)
	s := "r.GET(\\"/in-string\\", h)"
	_ = s
	resp, _ := http.Get("https://upstream.internal/status")
	client.R().Get("/users")
	cache.Get("/cache-key") // a capitalised verb on something that is not a known router
	r.GET("/ctx", func(c *gin.Context) { v, _ := c.Get("user"); c.JSON(200, v) })
}
`,
      'main_test.go': `package main
func TestX(t *testing.T) { r := gin.New(); r.GET("/test-only", nil) }
`,
    }), ['GET /after', 'GET /ctx', 'GET /redirect']);
  });
});

describe('FR-003 / FR-004: Spring class bases and method mappings, Java and Kotlin', () => {
  it('several class bases combine with several method paths', () => {
    assert.deepEqual(spring({ 'A.java': `
@RestController
@RequestMapping({"/a", "/b"})
class A {
  @GetMapping(value = {"/x", "/y"}) public String x() { return ""; }
}
` }), ['GET /a/x', 'GET /a/y', 'GET /b/x', 'GET /b/y']);
  });

  it('a nested class uses its own base, not the outer one', () => {
    assert.deepEqual(spring({ 'Outer.java': `
@RestController
@RequestMapping("/outer")
public class Outer {
  @GetMapping("/o") public String o() { return ""; }

  @RestController
  @RequestMapping("/inner")
  public static class Inner {
    @PostMapping("/i") public String i() { return ""; }
  }

  @PutMapping("/after") public String after() { return ""; }
}
` }), ['GET /outer/o', 'POST /inner/i', 'PUT /outer/after']);
  });

  it('Kotlin arrayOf, nested comments, and a class without a base', () => {
    assert.deepEqual(spring({ 'Ping.kt': `
/* outer /* inner */ @GetMapping("/in-comment") */
@RestController
class PingController {
    @GetMapping(path = arrayOf("/ping", "/pong"))
    fun ping() = "pong"

    @RequestMapping(value = ["/multi"], method = [RequestMethod.GET, RequestMethod.HEAD])
    fun multi() = ""
}
` }), ['GET /multi', 'GET /ping', 'GET /pong', 'HEAD /multi']);
  });

  it('a constant in an interface and a qualified constant resolve', () => {
    assert.deepEqual(spring({
      'Paths.java': `public interface Paths { String ROOT = "/root"; }`,
      'C.java': `
@RestController
@RequestMapping(Paths.ROOT)
public class C {
  @DeleteMapping(path = Paths.ROOT + "/child") public void d() {}
}
`,
    }), ['DELETE /root/root/child']);
  });
});

describe('FR-005: Rails routes match `rails routes`', () => {
  const routes = rails(`Rails.application.routes.draw do
  concern :commentable do
    resources :comments, only: :index
  end
  resources :posts, only: [:show], concerns: :commentable
  resources :videos, only: [] do
    concerns :commentable
  end
  resources :articles, shallow: true, only: [:index] do
    resources :notes, only: [:index, :show]
  end
  resources :users, only: [] do
    resource :avatar, only: :show
  end
  resources :photos, :books, only: :index
  resources :people, path: 'humans', only: :show
  scope path: '/v2' do
    get :status, to: 'status#show'
  end
  scope '(:locale)' do
    get 'about', to: 'pages#about'
  end
  get 'files(/:name)', to: 'files#show'
  match 'anything', to: 'catch#all', via: :all
  delete 'logout' => 'sessions#destroy'
  constraints(subdomain: 'api') { get 'ping', to: 'health#ping' }
  if Rails.env.development?
    get 'dev', to: 'dev#index'
  end
  get 'after_if', to: 'x#y'
  namespace :admin do
    draw :admin
  end
  mount Sidekiq::Web => '/sidekiq'
  devise_for :users
  get 'redirected', to: redirect('/elsewhere')
end
`, name => (name === 'admin' ? "resources :reports, only: :index\n" : null));

  it('concerns, shallow nesting, singular nested resources, several names, path:', () => {
    for (const k of [
      'GET /posts/:id', 'GET /posts/:post_id/comments', 'GET /videos/:video_id/comments',
      'GET /articles', 'GET /articles/:article_id/notes', 'GET /notes/:id',
      'GET /users/:user_id/avatar', 'GET /photos', 'GET /books', 'GET /humans/:id',
    ]) assert.ok(routes.includes(k), k);
  });

  it('scope path:, optional segments, match via: :all, hash-rocket, brace blocks, if blocks, draw', () => {
    for (const k of [
      'GET /v2/status', 'GET /about', 'GET /files', 'GET /files/:name', 'ANY /anything',
      'DELETE /logout', 'GET /ping', 'GET /dev', 'GET /after_if', 'GET /admin/reports', 'GET /redirected',
    ]) assert.ok(routes.includes(k), k);
  });

  it('nothing else: no mounted app, no devise route, no seven-route expansion', () => {
    assert.equal(routes.length, 21);
    assert.ok(!routes.some(k => k.includes('sidekiq') || k.includes('/users/sign_in')));
  });

  it('draw file routes name their file', () => {
    const routesWithFiles = extractRailsRoutes('namespace :admin do\n  draw :admin\nend\n', { readDraw: () => 'get "stats", to: "stats#index"\n' });
    assert.deepEqual(routesWithFiles.map(r => [r.path, r.file]), [['/admin/stats', 'config/routes/admin.rb']]);
  });

  it('a draw name is never a path', () => {
    const dir = project({
      'config/routes.rb': "Rails.application.routes.draw do\n  draw '../../secret'\n  draw :api\nend\n",
      'config/routes/api.rb': "get 'v1/ping', to: 'ping#show'\n",
      'secret.rb': "get 'leak', to: 'x#y'\n",
    });
    assert.deepEqual(keys(scanRoutesDeep(dir, { framework: 'Rails' }, NO_SPEC)), ['GET /v1/ping']);
  });

  it('inflections for nested params and singular controllers', () => {
    assert.equal(singularize('categories'), 'category');
    assert.equal(singularize('people'), 'person');
    assert.equal(singularize('addresses'), 'address');
    assert.equal(pluralize('profile'), 'profiles');
    assert.equal(pluralize('settings'), 'settings');
  });
});

describe('FR-006 / SC-003: an unreadable path or prefix is omitted, never guessed', () => {
  it('Go', () => {
    assert.deepEqual(go({ 'main.go': `package main
func main() {
	r := gin.Default()
	api := r.Group(os.Getenv("PREFIX"))
	api.GET("/hidden", h)
	r.GET(dynamicPath(), h)
	c := chi.NewRouter()
	c.Route(prefix(), func(r chi.Router) { r.Get("/also-hidden", h) })
	r.GET("/visible", h)
}
` }), ['GET /visible']);
  });

  it('Spring', () => {
    assert.deepEqual(spring({
      'P.java': `
@RestController
@RequestMapping("\${api.base}")
public class P { @GetMapping("/hidden") public String h() { return ""; } }
`,
      'Q.kt': `
@RestController
@RequestMapping("/q")
class Q {
    @GetMapping("$base/hidden") fun h() = ""
    @GetMapping(SomeUnknown.PATH) fun u() = ""
    @GetMapping("/visible") fun v() = ""
}
`,
    }), ['GET /q/visible']);
  });

  it('Rails', () => {
    assert.deepEqual(rails(`Rails.application.routes.draw do
  get "users/#{id}", to: 'u#show'
  scope some_prefix do
    get 'hidden', to: 'h#h'
  end
  get 'visible', to: 'v#v'
end
`), ['GET /visible']);
  });
});

describe('FR-007: Go framework classification reads versioned module paths', () => {
  for (const [module, framework] of [
    ['github.com/labstack/echo/v4 v4.11.4', 'Echo'],
    ['github.com/go-chi/chi/v5 v5.0.12', 'Chi'],
    ['github.com/gofiber/fiber/v2 v2.52.0', 'Fiber'],
    ['github.com/gorilla/mux v1.8.1', 'Gorilla Mux'],
  ]) {
    it(`${module} → ${framework}`, () => {
      const dir = project({ 'go.mod': `module acme/svc\n\ngo 1.22\n\nrequire (\n\t${module}\n)\n` });
      assert.equal(detectEcosystems(dir)[0].framework, framework);
    });
  }

  it('the classified framework reaches the Go scanner', () => {
    const gorilla = REFERENCE_PROJECTS.find(r => r.name === 'gorilla+fiber');
    const routes = scanRoutesDeep(project(gorilla.files), { framework: 'Gorilla Mux' }, NO_SPEC);
    assert.ok(keys(routes).includes('GET /api/users'));
  });
});

describe('FR-008: guard and diff agree on a documented Gin service', () => {
  it('no route gap in either', () => {
    const [gin] = REFERENCE_PROJECTS;
    const documented = gin.truth.map(k => `| \`${k.split(' ')[0]}\` | \`${k.split(' ')[1]}\` | |`).join('\n');
    const dir = project({
      ...gin.files,
      'go.mod': 'module acme/shop\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.10.0\n',
      'docs-canonical/API-REFERENCE.md': `# API Reference\n\n| Method | Path | Description |\n|---|---|---|\n${documented}\n`,
    });
    const drift = computeApiSurfaceDrift(dir, {});
    assert.equal(drift.applicable, true);
    assert.deepEqual(drift.presentButUndocumented, []);
    assert.deepEqual(drift.documentedButAbsent, []);
    assert.equal(drift.matched.length, gin.truth.length);
    const diff = diffRoutes(dir, {});
    assert.deepEqual(diff.onlyInDocs, []);
    assert.deepEqual(diff.onlyInCode, []);
  });
});

describe('FR-009: the docs describe what the readers read and omit', () => {
  const read = rel => readFileSync(resolve(rel), 'utf8');
  it('docs/commands.md', () => {
    const text = read('docs/commands.md');
    assert.match(text, /route groups/i);
    assert.match(text, /@RequestMapping/);
    assert.match(text, /namespace/);
    assert.match(text, /omitted/);
  });
  it('docs-canonical/TEST-SPEC.md', () => {
    assert.match(read('docs-canonical/TEST-SPEC.md'), /Go, Spring and Rails route fixtures/);
  });
  it('CHANGELOG.md', () => {
    assert.match(read('CHANGELOG.md'), /specs\/047-go-spring-rails-routes/);
  });
});
