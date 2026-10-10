/**
 * Laravel, Symfony and ASP.NET Core route extraction
 * (specs/059-php-dotnet-routes): DocGuard classified these frameworks but
 * read no route from them. Each route is now reported at the path the
 * framework serves it under, and a route whose path cannot be read is omitted,
 * counted and disclosed, never guessed.
 *
 * Every ground truth below was written by hand from the framework's documented
 * routing rules (`php artisan route:list`, `bin/console debug:router`, ASP.NET
 * Core attribute routing and route groups) before the readers existed. Before
 * this change each reference project reported no route at all.
 *
 * @req docguard.php-dotnet-routes#FR-001
 * @req docguard.php-dotnet-routes#FR-002
 * @req docguard.php-dotnet-routes#FR-003
 * @req docguard.php-dotnet-routes#FR-004
 * @req docguard.php-dotnet-routes#FR-005
 * @req docguard.php-dotnet-routes#FR-006
 * @req docguard.php-dotnet-routes#FR-007
 * @req docguard.php-dotnet-routes#FR-008
 * @req docguard.php-dotnet-routes#FR-009
 * @req docguard.php-dotnet-routes#FR-010
 * @req docguard.php-dotnet-routes#SC-001
 * @req docguard.php-dotnet-routes#SC-002
 * @req docguard.php-dotnet-routes#SC-003
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { extractSymfonyRoutes, lexPhp } from '../cli/scanners/php-routes.mjs';
import { extractAspNetRoutes, lexCSharp } from '../cli/scanners/dotnet-routes.mjs';
import { detectEcosystems } from '../cli/scanners/project-type.mjs';
import { computeApiSurfaceDrift, routeScanGaps, validateApiSurface } from '../cli/validators/api-surface.mjs';
import { diffRoutes } from '../cli/commands/diff.mjs';

const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-059-'));
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
const aspnet = files => keys(extractAspNetRoutes(sources(files)));
const STANDARD_OR_ANY = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ANY']);
const scan = (files, framework) => scanRoutesDeep(project(files), { framework }, NO_SPEC);
const authOf = (routes, method, path) => {
  const r = routes.find(x => x.method === method && x.path === path);
  assert.ok(r, `${method} ${path} is reported`);
  return r.auth;
};

const LARAVEL_11 = {
  'composer.json': JSON.stringify({ require: { php: '^8.2', 'laravel/framework': '^11.0' } }),
  'bootstrap/app.php': `<?php

use Illuminate\\Foundation\\Application;
use Illuminate\\Support\\Facades\\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function () {
            Route::middleware('api')
                ->prefix('webhooks')
                ->group(base_path('routes/webhooks.php'));
        },
    )
    ->withMiddleware(function ($middleware) {
        //
    })
    ->create();
`,
  'routes/web.php': `<?php

use App\\Http\\Controllers\\ProfileController;
use Illuminate\\Support\\Facades\\Route;

Route::get('/', function () {
    return view('welcome');
});

// Route::get('/commented', fn () => 'no');
# Route::get('/hash-commented', fn () => 'no');
/* Route::get('/block-commented', fn () => 'no'); */
Route::view('/about', 'about');
Route::redirect('/home', '/dashboard');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('/dashboard', [DashboardController::class, 'index'])->name('dashboard');
    Route::controller(ProfileController::class)->group(function () {
        Route::get('/profile', 'edit')->name('profile.edit');
        Route::patch('/profile', 'update')->name('profile.update');
        Route::delete('/profile', 'destroy')->name('profile.destroy');
    });
});

Route::match(['get', 'post'], '/contact', ContactController::class);
$text = "Route::get('/in-a-string', h)";

require __DIR__.'/auth.php';
`,
  'routes/auth.php': `<?php

use Illuminate\\Support\\Facades\\Route;

Route::middleware('guest')->group(function () {
    Route::get('register', [RegisteredUserController::class, 'create'])->name('register');
    Route::post('register', [RegisteredUserController::class, 'store']);
});

Route::post('logout', [AuthenticatedSessionController::class, 'destroy'])
    ->middleware('auth')
    ->name('logout');
`,
  'routes/api.php': `<?php

use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::apiResource('posts', PostController::class);
Route::resource('photos.comments', PhotoCommentController::class)->only(['index', 'store', 'show']);

Route::prefix('v1')->group(function () {
    Route::get('/status', [StatusController::class, 'show']);
    Route::any('/echo', EchoController::class);
    Route::group(['prefix' => 'admin', 'middleware' => 'can:admin'], function () {
        Route::put('/settings', [SettingsController::class, 'update']);
    });
});

Route::singleton('profile', ProfileController::class);
`,
  'routes/webhooks.php': `<?php

Route::post('/stripe', StripeWebhookController::class);
`,
  'routes/console.php': `<?php

use Illuminate\\Support\\Facades\\Artisan;

Artisan::command('inspire', function () {
    $this->comment('quote');
});
Route::get('/never-served', fn () => 'console routes are not HTTP routes');
`,
};

const LARAVEL_11_TRUTH = [
  'GET /', 'GET /about', 'ANY /home', 'GET /dashboard',
  'GET /profile', 'PATCH /profile', 'DELETE /profile',
  'GET /contact', 'POST /contact',
  'GET /register', 'POST /register', 'POST /logout',
  'GET /up', 'POST /webhooks/stripe',
  'GET /api/user',
  'GET /api/posts', 'POST /api/posts', 'GET /api/posts/{post}', 'PUT /api/posts/{post}', 'PATCH /api/posts/{post}', 'DELETE /api/posts/{post}',
  'GET /api/photos/{photo}/comments', 'POST /api/photos/{photo}/comments', 'GET /api/photos/{photo}/comments/{comment}',
  'GET /api/v1/status', 'ANY /api/v1/echo', 'PUT /api/v1/admin/settings',
  'GET /api/profile', 'GET /api/profile/edit', 'PUT /api/profile', 'PATCH /api/profile',
];

const LARAVEL_10 = {
  'composer.json': JSON.stringify({ require: { 'laravel/framework': '^10.10' } }),
  'app/Providers/RouteServiceProvider.php': `<?php

namespace App\\Providers;

use Illuminate\\Foundation\\Support\\Providers\\RouteServiceProvider as ServiceProvider;
use Illuminate\\Support\\Facades\\Route;

class RouteServiceProvider extends ServiceProvider
{
    public const HOME = '/home';

    public function boot(): void
    {
        $this->routes(function () {
            Route::middleware('api')
                ->prefix('api/v2')
                ->group(base_path('routes/api.php'));

            Route::middleware('web')
                ->group(base_path('routes/web.php'));

            Route::prefix('admin')->middleware(['web', 'auth'])->group(base_path('routes/admin.php'));
        });
    }
}
`,
  'routes/api.php': `<?php
Route::get('ping', fn () => 'pong');
Route::resource('users', UserController::class)->except(['create', 'edit']);
Route::resource('user-profiles', UserProfileController::class)->only('show')->parameters(['user-profiles' => 'profile']);
`,
  'routes/web.php': `<?php
Route::get('/', [HomeController::class, 'index']);
`,
  'routes/admin.php': `<?php
Route::get('/reports', [ReportController::class, 'index']);
`,
};

const LARAVEL_10_TRUTH = [
  'GET /api/v2/ping',
  'GET /api/v2/users', 'POST /api/v2/users', 'GET /api/v2/users/{user}', 'PUT /api/v2/users/{user}', 'PATCH /api/v2/users/{user}', 'DELETE /api/v2/users/{user}',
  'GET /api/v2/user-profiles/{profile}',
  'GET /', 'GET /admin/reports',
];

const SYMFONY = {
  'composer.json': JSON.stringify({ require: { 'symfony/framework-bundle': '7.1.*' } }),
  'config/routes.yaml': `# Routes
controllers:
    resource:
        path: ../src/Controller/
        namespace: App\\Controller
    type: attribute

api_controllers:
    resource: ../src/Api/
    type: attribute
    prefix: /api

health:
    path: /health
    controller: App\\Controller\\HealthController::check
    methods: GET|HEAD

legacy:
    resource: legacy.yaml
    prefix: /legacy

when@dev:
    _errors:
        resource: '@FrameworkBundle/Resources/config/routing/errors.xml'
        prefix: /_error
`,
  'config/legacy.yaml': `legacy_index:
    path: /index
    controller: App\\Controller\\LegacyController::index
    methods: [GET, POST]
legacy_any:
    path: '/any'
    controller: App\\Controller\\LegacyController::any
`,
  'config/routes/feeds.yaml': `feed:
    path: /feed.xml
    controller: App\\Controller\\FeedController
    methods:
        - GET
`,
  'src/Controller/BlogController.php': `<?php

namespace App\\Controller;

use Symfony\\Component\\Routing\\Attribute\\Route;
use Symfony\\Component\\Security\\Http\\Attribute\\IsGranted;

#[Route('/blog', name: 'blog_')]
final class BlogController extends AbstractController
{
    #[Route('', name: 'index', methods: ['GET'])]
    public function index(): Response
    {
        return $this->render('blog/index.html.twig');
    }

    #[Route('/{slug}', name: 'show', methods: ['GET', 'HEAD'])]
    public function show(string $slug): Response
    {
        return $this->render('blog/show.html.twig', ['url' => "/blog/{$slug}"]);
    }

    #[Route('/new', name: 'new', methods: ['GET', 'POST'])]
    #[IsGranted('ROLE_ADMIN')]
    public function new(): Response
    {
    }

    #[Route(path: '/{id}/edit', methods: 'POST')]
    public function edit(int $id): Response
    {
        $this->denyAccessUnlessGranted('EDIT');
    }

    // #[Route('/commented')]
    public function helper(): void
    {
    }

    #[Route(['en' => '/about-us', 'nl' => '/over-ons'], name: 'about')]
    public function about(): Response
    {
    }
}
`,
  'src/Controller/ShopController.php': `<?php

namespace App\\Controller;

use Symfony\\Component\\Routing\\Annotation\\Route;

/**
 * @Route("/shop")
 */
class ShopController extends AbstractController
{
    /**
     * Lists products.
     *
     * @Route("/products", name="shop_products", methods={"GET"})
     */
    public function products()
    {
    }

    /**
     * @Route(path="/cart", methods={"POST","DELETE"})
     * @IsGranted("ROLE_USER")
     */
    public function cart()
    {
    }
}
`,
  'src/Api/UserApiController.php': `<?php

namespace App\\Api;

use Symfony\\Component\\Routing\\Attribute\\Route;

#[Route('/users')]
#[IsGranted('ROLE_API')]
class UserApiController
{
    #[Route('/{id}', methods: ['GET'])]
    public function show(int $id)
    {
    }

    #[Route('', methods: ['POST'])]
    public function create()
    {
    }
}
`,
};

const SYMFONY_TRUTH = [
  'GET /blog', 'GET /blog/{slug}', 'HEAD /blog/{slug}', 'GET /blog/new', 'POST /blog/new',
  'POST /blog/{id}/edit', 'ANY /blog/about-us', 'ANY /blog/over-ons',
  'GET /shop/products', 'POST /shop/cart', 'DELETE /shop/cart',
  'GET /api/users/{id}', 'POST /api/users',
  'GET /health', 'HEAD /health',
  'GET /legacy/index', 'POST /legacy/index', 'ANY /legacy/any',
  'GET /feed.xml',
];

const ASPNET_CONTROLLERS = {
  'src/Shop.Api/Shop.Api.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
`,
  'src/Shop.Api/Controllers/ApiControllerBase.cs': `using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Shop.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public abstract class ApiControllerBase : ControllerBase
{
    protected IActionResult Invalid() => BadRequest();
}
`,
  'src/Shop.Api/Controllers/UsersController.cs': `namespace Shop.Api.Controllers;

/// <summary>Users. [HttpGet("/doc-comment")] is not a route.</summary>
public class UsersController : ApiControllerBase
{
    private readonly IUserService _users;

    public UsersController(IUserService users) { _users = users; }

    [HttpGet]
    public ActionResult<IEnumerable<User>> GetAll() => Ok(_users.All());

    [HttpGet("{id:int}", Name = "GetUser")]
    public ActionResult<User> GetById(int id) => Ok();

    [HttpPost]
    [AllowAnonymous]
    public async Task<IActionResult> CreateAsync([FromBody] User user)
    {
        await _users.Add(user);
        return CreatedAtRoute("GetUser", new { id = user.Id }, user);
    }

    [HttpPut("{id}")]
    [HttpPatch("{id}")]
    public IActionResult Update(int id)
    {
        if (id > 0) { return Ok(); }
        return NotFound();
    }

    // [HttpDelete("{id}/commented")]
    [HttpDelete("{id}")]
    public IActionResult Delete(int id) => NoContent();

    [NonAction]
    public void Helper() { }

    [HttpGet("/health/users")]
    public IActionResult Health() => Ok(@"C:\\temp\\");

    [HttpGet("[action]")]
    public IActionResult SearchAsync(string q) => Ok($"query {q}");
}
`,
  'src/Shop.Api/Controllers/OrdersController.cs': `using Microsoft.AspNetCore.Mvc;

namespace Shop.Api.Controllers
{
    [ApiController]
    [Route(ApiRoutes.Orders)]
    public class OrdersController : ControllerBase
    {
        [HttpGet("{id}")]
        [Authorize(Policy = "Orders")]
        public IActionResult Get(string id) => Ok();

        [Route("export")]
        [HttpGet]
        public IActionResult Export() => Ok();

        [AcceptVerbs("GET", "HEAD", Route = "summary")]
        public IActionResult Summary() => Ok();

        [Route("ping")]
        public IActionResult Ping() => Ok();
    }

    public static class ApiRoutes
    {
        public const string Root = "api/v1";
        public const string Orders = Root + "/orders";
    }
}
`,
  'src/Shop.Api/Areas/Admin/ReportsController.cs': `[Area("Admin")]
[Route("[area]/[controller]")]
public class ReportsController : Controller
{
    [HttpGet("")]
    public IActionResult Index() => View();

    [HttpPost("[action]")]
    public IActionResult Rebuild() => Ok();
}

public class HomeController : Controller
{
    public IActionResult Index() => View();
}
`,
  'src/Shop.Api/Program.cs': `var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
var app = builder.Build();
app.MapControllers();
app.MapControllerRoute(name: "default", pattern: "{controller=Home}/{action=Index}/{id?}");
app.Run();
`,
};

const ASPNET_CONTROLLERS_TRUTH = [
  'GET /api/Users', 'GET /api/Users/{id:int}', 'POST /api/Users',
  'PUT /api/Users/{id}', 'PATCH /api/Users/{id}', 'DELETE /api/Users/{id}',
  'GET /health/users', 'GET /api/Users/Search',
  'GET /api/v1/orders/{id}', 'GET /api/v1/orders/export',
  'GET /api/v1/orders/summary', 'HEAD /api/v1/orders/summary', 'ANY /api/v1/orders/ping',
  'GET /Admin/Reports', 'POST /Admin/Reports/Rebuild',
];

const ASPNET_MINIMAL = {
  'Api.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <PackageReference Include="AutoMapper" Version="13.0.1" />
  </ItemGroup>
</Project>
`,
  'Program.cs': `var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => "Hello World!");
app.MapHealthChecks("/healthz");

var api = app.MapGroup("/api");
var todos = api.MapGroup("/todos").RequireAuthorization();
todos.MapGet("/", GetTodos);
todos.MapGet("/{id:int}", (int id, TodoDb db) => db.Find(id)).WithName("GetTodo");
todos.MapPost("/", CreateTodo).AllowAnonymous();
todos.MapMethods("/{id}/touch", new[] { "PUT", "PATCH" }, Touch);

api.MapGroup("/users").MapUserEndpoints();
app.MapAdmin();
UserEndpoints.MapReports(app.MapGroup("/reports"));

app.MapDelete("/cache", [Authorize] () => Results.NoContent());
app.Map("/legacy", () => "any verb");
var dto = mapper.Map<TodoDto>(todo);
// app.MapGet("/commented", () => "no");
var s = "app.MapGet(\\"/in-a-string\\", h)";
app.Run();
`,
  'Endpoints/UserEndpoints.cs': `public static class UserEndpoints
{
    public static RouteGroupBuilder MapUserEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/", ListUsers);
        group.MapGet("/{id}", GetUser);
        group.MapPut("/{id}", UpdateUser).RequireAuthorization();
        return group;
    }

    public static void MapAdmin(this IEndpointRouteBuilder routes)
    {
        var admin = routes.MapGroup("/admin").RequireAuthorization("admin");
        admin.MapPost("/reindex", Reindex);
        admin.MapGet("/public-stats", Stats).AllowAnonymous();
    }

    public static void MapReports(RouteGroupBuilder reports)
    {
        reports.MapGet("/daily", Daily);
    }
}
`,
};

const ASPNET_MINIMAL_TRUTH = [
  'GET /', 'ANY /healthz',
  'GET /api/todos', 'GET /api/todos/{id:int}', 'POST /api/todos',
  'PUT /api/todos/{id}/touch', 'PATCH /api/todos/{id}/touch',
  'GET /api/users', 'GET /api/users/{id}', 'PUT /api/users/{id}',
  'POST /admin/reindex', 'GET /admin/public-stats',
  'GET /reports/daily', 'DELETE /cache', 'ANY /legacy',
];

const REFERENCE_PROJECTS = [
  { name: 'laravel-11', framework: 'Laravel', source: 'laravel', files: LARAVEL_11, truth: LARAVEL_11_TRUTH },
  { name: 'laravel-10', framework: 'Laravel', source: 'laravel', files: LARAVEL_10, truth: LARAVEL_10_TRUTH },
  { name: 'symfony', framework: 'Symfony', source: 'symfony', files: SYMFONY, truth: SYMFONY_TRUTH },
  { name: 'aspnet-controllers', framework: 'ASP.NET Core', source: 'aspnet-core', files: ASPNET_CONTROLLERS, truth: ASPNET_CONTROLLERS_TRUTH },
  { name: 'aspnet-minimal', framework: 'ASP.NET Core', source: 'aspnet-core', files: ASPNET_MINIMAL, truth: ASPNET_MINIMAL_TRUTH },
];

describe('SC-001: the reference projects report exactly their ground truth', () => {
  for (const ref of REFERENCE_PROJECTS) {
    it(`${ref.name} (${ref.framework})`, () => {
      const routes = scan(ref.files, ref.framework);
      assert.deepEqual(keys(routes), [...ref.truth].sort());
      for (const r of routes) {
        assert.ok(STANDARD_OR_ANY.has(r.method), `${r.method} is a standard method or ANY (FR-007)`);
        assert.equal(r.source, ref.source);
        assert.equal(r.tier, 'fallback-language');
      }
    });
  }
});

describe('FR-001 / FR-002: Laravel', () => {
  it('auth evidence from route, group, chain and provider middleware', () => {
    const routes = scan(LARAVEL_11, 'Laravel');
    assert.equal(authOf(routes, 'GET', '/dashboard'), true);
    assert.equal(authOf(routes, 'PATCH', '/profile'), true);
    assert.equal(authOf(routes, 'GET', '/api/user'), true);
    assert.equal(authOf(routes, 'PUT', '/api/v1/admin/settings'), true);
    assert.equal(authOf(routes, 'POST', '/logout'), true);
    assert.equal(authOf(routes, 'GET', '/register'), false);
    assert.equal(authOf(routes, 'GET', '/'), false);
    const l10 = scan(LARAVEL_10, 'Laravel');
    assert.equal(authOf(l10, 'GET', '/admin/reports'), true);
    assert.equal(authOf(l10, 'GET', '/api/v2/ping'), false);
  });

  it('handlers and files', () => {
    const routes = scan(LARAVEL_11, 'Laravel');
    const dash = routes.find(r => r.path === '/dashboard');
    assert.equal(dash.handler, 'DashboardController@index');
    assert.equal(dash.file.split(/[\\/]/).join('/'), 'routes/web.php');
    assert.equal(routes.find(r => r.path === '/register' && r.method === 'POST').file.split(/[\\/]/).join('/'), 'routes/auth.php');
    assert.equal(routes.find(r => r.method === 'PATCH' && r.path === '/profile').handler, 'ProfileController@update');
    assert.equal(routes.find(r => r.method === 'GET' && r.path === '/api/posts/{post}').handler, 'PostController@show');
    assert.equal(routes.find(r => r.path === '/').handler, 'inline');
  });

  it('withRouting apiPrefix, an array of web files, and using: replacing the defaults', () => {
    const dir = {
      'bootstrap/app.php': `<?php
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: [__DIR__.'/../routes/web.php', __DIR__.'/../routes/pages.php'],
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api/admin',
    )->create();
`,
      'routes/web.php': "<?php\nRoute::get('/', fn () => 'home');\n",
      'routes/pages.php': "<?php\nRoute::get('/terms', fn () => 'terms');\n",
      'routes/api.php': "<?php\nRoute::get('/users', fn () => []);\n",
    };
    assert.deepEqual(keys(scan(dir, 'Laravel')), ['GET /', 'GET /api/admin/users', 'GET /terms']);
    const using = {
      'bootstrap/app.php': `<?php
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        commands: __DIR__.'/../routes/console.php',
        using: function () {
            Route::middleware('api')->prefix('internal')->group(base_path('routes/api.php'));
        },
    )->create();
`,
      'routes/web.php': "<?php\nRoute::get('/', fn () => 'not loaded');\n",
      'routes/api.php': "<?php\nRoute::get('/users', fn () => []);\n",
    };
    assert.deepEqual(keys(scan(using, 'Laravel')), ['GET /internal/users']);
  });

  it('defaults without bootstrap/app.php or a provider: web.php and api.php under /api', () => {
    const dir = {
      'routes/web.php': "<?php\nRoute::get('/', fn () => 'home');\n",
      'routes/api.php': "<?php\nRoute::post('orders', [OrderController::class, 'store']);\n",
      'routes/channels.php': "<?php\nBroadcast::channel('orders.{id}', fn () => true);\n",
    };
    assert.deepEqual(keys(scan(dir, 'Laravel')), ['GET /', 'POST /api/orders']);
  });

  it('resources: nesting, shallow, options array, resources(), apiSingleton, creatable', () => {
    const dir = {
      'routes/web.php': `<?php
Route::resource('photos.comments', CommentController::class)->shallow()->only(['index', 'show']);
Route::resource('tags', TagController::class, ['only' => ['index', 'destroy']]);
Route::resources(['books' => BookController::class, 'authors' => AuthorController::class]);
Route::apiSingleton('settings', SettingsController::class);
Route::singleton('avatar', AvatarController::class)->creatable();
Route::apiResources(['categories' => CategoryController::class]);
`,
    };
    const routes = keys(scan(dir, 'Laravel')).filter(k => !/books|authors|categories/.test(k));
    assert.deepEqual(routes, [
      'DELETE /avatar', 'DELETE /tags/{tag}',
      'GET /avatar', 'GET /avatar/create', 'GET /avatar/edit',
      'GET /comments/{comment}', 'GET /photos/{photo}/comments',
      'GET /settings', 'GET /tags',
      'PATCH /avatar', 'PATCH /settings',
      'POST /avatar', 'PUT /avatar', 'PUT /settings',
    ].sort());
    const all = keys(scan(dir, 'Laravel'));
    assert.equal(all.filter(k => k.includes('/books')).length, 8);
    assert.equal(all.filter(k => k.includes('/authors')).length, 8);
    assert.ok(all.includes('GET /authors/{author}/edit'));
    assert.equal(all.filter(k => k.includes('/categories')).length, 6);
  });

  it('withoutMiddleware removes auth; a file outside the project is never read', () => {
    const dir = project({
      'routes/web.php': `<?php
Route::middleware('auth')->group(function () {
    Route::get('/private', fn () => 'p');
    Route::get('/open', fn () => 'o')->withoutMiddleware('auth');
});
require __DIR__.'/../../outside.php';
require base_path('routes/../../escape.php');
`,
    });
    writeFileSync(join(dir, '..', 'outside.php'), "<?php\nRoute::get('/leak', fn () => 'x');\n");
    temps.push(join(dir, '..', 'outside.php'));
    const routes = scanRoutesDeep(dir, { framework: 'Laravel' }, NO_SPEC);
    assert.deepEqual(keys(routes), ['GET /open', 'GET /private']);
    assert.equal(authOf(routes, 'GET', '/private'), true);
    assert.equal(authOf(routes, 'GET', '/open'), false);
  });

  it('a Laravel app in a subdirectory reads its own route files', () => {
    const routes = scan({
      'backend/composer.json': '{"require":{"laravel/framework":"^11.0"}}',
      'backend/routes/api.php': "<?php\nRoute::get('/ping', fn () => 'pong');\n",
    }, 'Laravel');
    assert.deepEqual(keys(routes), ['GET /api/ping']);
  });
});

describe('FR-003: Symfony', () => {
  it('auth evidence: IsGranted on method or class, @IsGranted, denyAccessUnlessGranted', () => {
    const routes = scan(SYMFONY, 'Symfony');
    assert.equal(authOf(routes, 'GET', '/blog/new'), true);
    assert.equal(authOf(routes, 'POST', '/blog/{id}/edit'), true);
    assert.equal(authOf(routes, 'GET', '/blog/{slug}'), false);
    assert.equal(authOf(routes, 'POST', '/shop/cart'), true);
    assert.equal(authOf(routes, 'GET', '/shop/products'), false);
    assert.equal(authOf(routes, 'GET', '/api/users/{id}'), true);
  });

  it('handlers name the controller method', () => {
    const routes = scan(SYMFONY, 'Symfony');
    assert.equal(routes.find(r => r.path === '/blog/{slug}').handler, 'BlogController::show');
    assert.equal(routes.find(r => r.path === '/health').handler, 'App\\Controller\\HealthController::check');
  });

  it('class-level methods apply to methods without their own; a fully qualified attribute is read', () => {
    const out = keys(extractSymfonyRoutes(sources({
      'src/Controller/A.php': `<?php
#[\\Symfony\\Component\\Routing\\Attribute\\Route('/a', methods: ['GET'])]
class A {
    #[\\Symfony\\Component\\Routing\\Attribute\\Route('/one')]
    public function one() {}
    #[Route('/two', methods: ['DELETE']), Cache(maxage: 60)]
    public function two() {}
    #[Route('/three')]
    private function notAnAction() {}
}
`,
    })));
    assert.deepEqual(out, ['DELETE /a/two', 'GET /a/one', 'GET /a/three']);
  });
});

describe('FR-004 / FR-006: ASP.NET Core controllers', () => {
  it('auth: inherited [Authorize], [AllowAnonymous] wins, method [Authorize]', () => {
    const routes = scan(ASPNET_CONTROLLERS, 'ASP.NET Core');
    assert.equal(authOf(routes, 'GET', '/api/Users'), true);
    assert.equal(authOf(routes, 'POST', '/api/Users'), false);
    assert.equal(authOf(routes, 'GET', '/api/v1/orders/{id}'), true);
    assert.equal(authOf(routes, 'GET', '/api/v1/orders/export'), false);
  });

  it('handlers name class and action', () => {
    const routes = scan(ASPNET_CONTROLLERS, 'ASP.NET Core');
    assert.equal(routes.find(r => r.path === '/api/Users/{id:int}').handler, 'UsersController.GetById');
  });

  it('MapControllers().RequireAuthorization() makes every action auth unless AllowAnonymous', () => {
    const routes = extractAspNetRoutes(sources({
      'Program.cs': 'app.MapControllers().RequireAuthorization();\n',
      'C.cs': `[Route("x")] public class XController : ControllerBase {
  [HttpGet] public IActionResult A() => Ok();
  [HttpGet("open"), AllowAnonymous] public IActionResult B() => Ok();
}`,
    }));
    assert.equal(routes.find(r => r.path === '/x').auth, true);
    assert.equal(routes.find(r => r.path === '/x/open').auth, false);
  });

  it('an action without attributes in an attribute-routed controller takes the class route with any method', () => {
    assert.deepEqual(aspnet({
      'C.cs': `[ApiController]
[Route("api/items")]
public class ItemsController : ControllerBase
{
    public IActionResult List() => Ok();
    public static int Count() => 0;
    protected void Hidden() { }
    public override string ToString() => "x";
}`,
    }), ['ANY /api/items']);
  });

  it('[ActionName] renames [action]; a generic base and a record controller are read', () => {
    assert.deepEqual(aspnet({
      'C.cs': `[Route("api/[controller]/[action]")]
public class JobsController : BaseController<Job>
{
    [HttpPost, ActionName("run-now")]
    public IActionResult Run() => Ok();
    [HttpGet]
    public Task<IActionResult> StatusAsync() => null;
}`,
    }), ['GET /api/Jobs/Status', 'POST /api/Jobs/run-now']);
  });
});

describe('FR-005 / FR-006: ASP.NET Core minimal APIs', () => {
  it('auth from group RequireAuthorization, endpoint AllowAnonymous and [Authorize] lambdas', () => {
    const routes = scan(ASPNET_MINIMAL, 'ASP.NET Core');
    assert.equal(authOf(routes, 'GET', '/api/todos'), true);
    assert.equal(authOf(routes, 'POST', '/api/todos'), false);
    assert.equal(authOf(routes, 'PUT', '/api/users/{id}'), true);
    assert.equal(authOf(routes, 'GET', '/api/users'), false);
    assert.equal(authOf(routes, 'POST', '/admin/reindex'), true);
    assert.equal(authOf(routes, 'GET', '/admin/public-stats'), false);
    assert.equal(authOf(routes, 'DELETE', '/cache'), true);
    assert.equal(authOf(routes, 'GET', '/'), false);
  });

  it('a route method called with two groups reports its routes under both; never called, under none', () => {
    assert.deepEqual(aspnet({
      'Program.cs': `app.MapGroup("/v1").MapItems();
app.MapGroup("/v2").MapItems();
`,
      'Items.cs': `static class Items {
  public static IEndpointRouteBuilder MapItems(this IEndpointRouteBuilder r) { r.MapGet("/items", H); return r; }
  public static void Orphan(RouteGroupBuilder g) { g.MapGet("/orphan", H); }
}`,
    }), ['GET /orphan', 'GET /v1/items', 'GET /v2/items']);
  });

  it('a chained group and constants; cyclic calls stop', () => {
    assert.deepEqual(aspnet({
      'Program.cs': `const string Base = "/api";
app.MapGroup(Base).MapGroup("orders").MapGet("{id}", H);
app.MapA();
static class R {
  public static void MapA(this IEndpointRouteBuilder a) { a.MapGet("/a", H); a.MapB(); }
  public static void MapB(this IEndpointRouteBuilder b) { b.MapGet("/b", H); b.MapA(); }
}
`,
    }), ['GET /a', 'GET /api/orders/{id}', 'GET /b']);
  });
});

describe('FR-007 / SC-003: an unreadable path or prefix is omitted, counted and disclosed', () => {
  it('Laravel', () => {
    const routes = scan({
      'routes/web.php': `<?php
Route::get($path, fn () => 'x');
Route::get("/users/$id", fn () => 'x');
Route::prefix(config('app.admin_prefix'))->group(function () {
    Route::get('/hidden', fn () => 'x');
    Route::get('/hidden-too', fn () => 'x');
});
Route::resource($name, Controller::class);
Route::get('/visible', fn () => 'x');
Route::get("/double-quoted", fn () => 'x');
`,
    }, 'Laravel');
    assert.deepEqual(keys(routes), ['GET /double-quoted', 'GET /visible']);
    const pf = routes.scan.patternFrameworks.find(p => p.name === 'Laravel');
    assert.equal(pf.omitted, 5);
    const reasons = routeScanGaps(routes.scan, routes.length).join(' ');
    assert.match(reasons, /Laravel: 5 route registrations/);
    assert.match(reasons, /routes\/web\.php:2/);
  });

  it('Symfony', () => {
    assert.deepEqual(keys(extractSymfonyRoutes(sources({
      'src/Controller/A.php': `<?php
#[Route(self::BASE)]
class A {
    #[Route('/hidden')]
    public function h() {}
}
#[Route('/b')]
class B {
    #[Route(Paths::X)]
    public function u() {}
    #[Route("/b{$x}")]
    public function t() {}
    #[Route('/visible')]
    public function v() {}
}
`,
    }))), ['ANY /b/visible']);
    const out = extractSymfonyRoutes(sources({ 'src/C.php': "<?php\nclass C {\n  #[Route(Paths::X)]\n  public function u() {}\n}\n" }));
    assert.equal(out.omitted.length, 1);
    assert.equal(out.omitted[0].line, 3);
  });

  it('ASP.NET Core', () => {
    const out = extractAspNetRoutes(sources({
      'V.cs': `[Route($"api/{Version}")]
public class VController : ControllerBase { [HttpGet("x")] public IActionResult X() => Ok(); }
[Route("api/[version]")]
public class WController : ControllerBase { [HttpGet] public IActionResult Y() => Ok(); }
`,
      'Program.cs': `app.MapGet(path, H);
var g = app.MapGroup(prefix);
g.MapGet("/hidden", H);
app.MapGet($"/{x}", H);
app.MapGet("/visible", H);
`,
    }));
    assert.deepEqual(keys(out), ['GET /visible']);
    assert.equal(out.omitted.length, 5);
  });

  it('the API-surface check reports the omissions as partial coverage', () => {
    const dir = project({
      'composer.json': '{"require":{"laravel/framework":"^11.0"}}',
      'routes/web.php': "<?php\nRoute::get('/visible', fn () => 'x');\nRoute::get($dynamic, fn () => 'x');\n",
      'docs-canonical/API-REFERENCE.md': '# API Reference\n\n| Method | Path | Description |\n|---|---|---|\n| `GET` | `/visible` | |\n',
    });
    const result = validateApiSurface(dir, {});
    const reason = result.applicability?.reason || '';
    assert.equal(result.applicability?.status, 'partial');
    assert.match(reason, /1 route registration .*omitted/);
  });
});

describe('FR-007: lexers keep offsets and mask comments and strings', () => {
  it('PHP: # comments but not #[ attributes, heredoc, interpolation', () => {
    const src = "<?php\n# Route::get('/x')\n#[Route('/a')]\n$h = <<<EOT\nRoute::get('/y')\nEOT;\n$s = \"a{$b}\";\n";
    const { code, lits } = lexPhp(src);
    assert.equal(code.length, src.length);
    assert.ok(!code.includes("Route::get"));
    assert.ok(code.includes('#[Route('));
    const values = [...lits.values()].map(l => l.value);
    assert.ok(values.includes('/a'));
    assert.ok(values.includes(null));
  });

  it('C#: verbatim, interpolated and raw strings', () => {
    const src = 'var a = @"C:\\x\\"; var b = $"/{id}"; var c = """\nMapGet("/z")\n"""; // MapGet("/c")\n';
    const { code, lits } = lexCSharp(src);
    assert.equal(code.length, src.length);
    assert.ok(!code.includes('MapGet'));
    const values = [...lits.values()].map(l => l.value);
    assert.ok(values.includes('C:\\x\\'));
    assert.ok(values.includes(null));
  });
});

describe('FR-008: classification reaches the scanner', () => {
  for (const [name, files, framework] of [
    ['Sdk.Web project', { 'Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>' }, 'ASP.NET Core'],
    ['Sdk element', { 'Api.csproj': '<Project>\n  <Sdk Name="Microsoft.NET.Sdk.Web" />\n</Project>' }, 'ASP.NET Core'],
    ['framework reference', { 'Lib.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><FrameworkReference Include="Microsoft.AspNetCore.App" /></ItemGroup></Project>' }, 'ASP.NET Core'],
    ['AspNetCore package', { 'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="8.0.0" /></ItemGroup></Project>' }, 'ASP.NET Core'],
    ['Laravel', { 'composer.json': '{"require":{"laravel/framework":"^11.0"}}' }, 'Laravel'],
    ['Symfony', { 'composer.json': '{"require":{"symfony/framework-bundle":"7.1.*"}}' }, 'Symfony'],
  ]) {
    it(`${name} → ${framework}`, () => {
      assert.equal(detectEcosystems(project(files))[0].framework, framework);
    });
  }

  it('a plain class library is not ASP.NET Core', () => {
    assert.equal(detectEcosystems(project({ 'Lib.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>' }))[0].framework, null);
  });
});

describe('FR-009: guard and diff agree on a documented project', () => {
  for (const ref of REFERENCE_PROJECTS) {
    it(`${ref.name}: no route gap in either`, () => {
      const documented = ref.truth.map(k => `| \`${k.split(' ')[0]}\` | \`${k.split(' ')[1]}\` | |`).join('\n');
      const dir = project({
        ...ref.files,
        'docs-canonical/API-REFERENCE.md': `# API Reference\n\n| Method | Path | Description |\n|---|---|---|\n${documented}\n`,
      });
      const drift = computeApiSurfaceDrift(dir, {});
      assert.equal(drift.applicable, true);
      assert.deepEqual(drift.presentButUndocumented, []);
      assert.deepEqual(drift.documentedButAbsent, []);
      const diff = diffRoutes(dir, {});
      assert.deepEqual(diff.onlyInDocs, []);
      assert.deepEqual(diff.onlyInCode, []);
    });
  }
});

describe('FR-010: the docs describe what the readers read', () => {
  const read = rel => readFileSync(resolve(rel), 'utf8');
  it('docs/reference/languages.md', () => {
    const text = read('docs/reference/languages.md');
    assert.match(text, /\| Laravel \|/);
    assert.match(text, /\| Symfony \|/);
    assert.match(text, /\| ASP\.NET Core \|/);
    const notRead = text.slice(text.indexOf('Classified but not read'), text.indexOf('Classified but not read') + 600);
    assert.doesNotMatch(notRead, /Laravel|Symfony|ASP\.NET/);
  });
  it('docs/commands.md, ARCHITECTURE, TEST-SPEC and CHANGELOG', () => {
    assert.match(read('docs/commands.md'), /Laravel/);
    assert.match(read('docs-canonical/ARCHITECTURE.md'), /php-routes\.mjs/);
    assert.match(read('docs-canonical/TEST-SPEC.md'), /php-dotnet-routes\.test\.mjs/);
    assert.match(read('CHANGELOG.md'), /specs\/059-php-dotnet-routes/);
  });
});
