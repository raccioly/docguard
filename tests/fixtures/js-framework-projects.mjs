/**
 * Scratch NestJS, Cloudflare Workers and Hono projects with a written ground
 * truth, for specs/058-js-framework-routes (docguard.js-framework-routes).
 *
 * Each FILES object is a small but realistic project the test writes to a
 * fresh temp dir; each TRUTH states, by hand, every route a correct scan
 * reports (method and path as served -> auth). The truths follow the
 * frameworks' documented semantics: Nest's RoutePathFactory order (global
 * prefix, version, module path, controller path, method path), Hono's
 * basePath/route composition, itty-router's `base`.
 * @req docguard.js-framework-routes#SC-001
 */

export { writeFiles, UNPARSEABLE } from './js-ts-projects.mjs';

const pkg = (deps, devDeps = { typescript: '5.4.5' }) =>
  JSON.stringify({ name: 'fixture', dependencies: deps, devDependencies: devDeps }, null, 2);

// ── NestJS: global prefix with exclusions, URI versioning, RouterModule ──────

export const NEST_FILES = {
  // `express` is listed beside Nest, as @nestjs/platform-express projects often do.
  'package.json': pkg({
    '@nestjs/common': '10.3.8', '@nestjs/core': '10.3.8', '@nestjs/platform-express': '10.3.8',
    '@nestjs/passport': '10.0.3', '@nestjs/throttler': '5.1.2', express: '4.19.2',
  }),
  'src/main.ts': `import { NestFactory } from '@nestjs/core';
import { RequestMethod, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api', {
    exclude: ['health', { path: 'metrics', method: RequestMethod.GET }],
  });
  app.enableVersioning({ type: VersioningType.URI });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
`,
  'src/app.module.ts': `import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { HealthController } from './health.controller';
import { CatsModule } from './cats/cats.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    CatsModule,
    AdminModule,
    RouterModule.register([{ path: 'admin', module: AdminModule }]),
  ],
  controllers: [HealthController],
})
export class AppModule {}
`,
  'src/health.controller.ts': `import { Controller, Get, Post } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  check() { return { ok: true }; }

  @Get('metrics')
  metrics() { return ''; }

  @Post('metrics')
  pushMetrics() { return ''; }
}
`,
  'src/cats/cats.module.ts': `import { Module } from '@nestjs/common';
import { CatsController } from './cats.controller';

@Module({ controllers: [CatsController] })
export class CatsModule {}
`,
  'src/cats/cat-routes.ts': `export const CatRoutes = { search: 'search' };
`,
  'src/cats/cats.controller.ts': `import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CatRoutes } from './cat-routes';

const BY_ID = ':id';

@Controller({ path: 'cats', version: '1' })
@UseGuards(ThrottlerGuard)
export class CatsController {
  @Get()
  findAll() { return []; }

  @Get(BY_ID)
  findOne(@Param('id') id: string) { return { id }; }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  create(@Body() dto: unknown) { return dto; }

  @Put(':id')
  @Version('2')
  @UseGuards(AuthGuard('jwt'))
  replace(@Param('id') id: string, @Body() dto: unknown) { return dto; }

  @Delete([':id', ':id/remove'])
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) { return null; }

  @Get('ping')
  @Version(VERSION_NEUTRAL)
  ping() { return 'pong'; }

  // An imported constant: not resolvable from this file, so not guessed.
  @Get(CatRoutes.search)
  search() { return []; }
}
`,
  'src/auth/jwt-auth.guard.ts': `import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
`,
  'src/admin/admin.module.ts': `import { Module } from '@nestjs/common';
import { UsersAdminController } from './users-admin.controller';

@Module({ controllers: [UsersAdminController] })
export class AdminModule {}
`,
  'src/admin/users-admin.controller.ts': `import { Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

@Controller('users')
@UseGuards(RolesGuard)
export class UsersAdminController {
  @Get()
  list() { return []; }

  @Patch(':id')
  update() { return {}; }
}
`,
  // Same decorator names from another library: not NestJS routes.
  'src/legacy/report.controller.ts': `import { Controller, Get } from 'routing-controllers';

@Controller('/reports')
export class ReportController {
  @Get('/daily')
  daily() { return []; }
}
`,
  // An end-to-end test sets its own prefix; it must not prefix product routes.
  'test/app.e2e-spec.ts': `import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

it('boots', async () => {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('e2e');
  await app.init();
});
`,
};

export const NEST_TRUTH = {
  routes: {
    'GET /health': false,
    'GET /metrics': false,
    'POST /api/metrics': false,
    'GET /api/v1/cats': false,
    'GET /api/v1/cats/:id': false,
    'POST /api/v1/cats': true,
    'PUT /api/v2/cats/:id': true,
    'DELETE /api/v1/cats/:id': true,
    'DELETE /api/v1/cats/:id/remove': true,
    'GET /api/cats/ping': false,
    'GET /api/admin/users': true,
    'PATCH /api/admin/users/:id': true,
  },
  handlers: { 'GET /api/v1/cats/:id': 'findOne', 'DELETE /api/v1/cats/:id/remove': 'remove' },
  unresolved: [{ framework: 'NestJS', file: 'src/cats/cats.controller.ts', line: 36 }],
};

// ── NestJS: a global auth guard, @Public(), and a file that does not parse ───

export const NEST_GUARD_FILES = {
  'package.json': pkg({ '@nestjs/common': '10.3.8', '@nestjs/core': '10.3.8', '@nestjs/throttler': '5.1.2' }),
  'src/main.ts': `import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { JwtAuthGuard } from './jwt-auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new JwtAuthGuard(app.get(Reflector)));
  await app.listen(3000);
}
bootstrap();
`,
  // A global guard that is not auth: rate limiting.
  'src/app.module.ts': `import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { ItemsController } from './items.controller';

@Module({
  controllers: [AuthController, ItemsController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
`,
  'src/public.decorator.ts': `import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
`,
  'src/auth.controller.ts': `import { Controller, Get, Post } from '@nestjs/common';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  @Public()
  @Post('login')
  login() { return { token: 'x' }; }

  @Get('me')
  me() { return {}; }
}
`,
};

/** Added to NEST_GUARD_FILES with UNPARSEABLE spliced in, by the test. */
export const NEST_BROKEN_CONTROLLER = `import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from './public.decorator';

@Controller('items')
export class ItemsController {
  @Get()
  @Public()
  list() { return []; }
%UNPARSEABLE%
  @Post(':id/archive')
  @UseGuards(AdminGuard)
  archive() { return null; }
}
`;

export const NEST_GUARD_TRUTH = {
  routes: {
    'POST /auth/login': false,
    'GET /auth/me': true,
    'GET /items': false,
    'POST /items/:id/archive': true,
  },
  regexFallback: ['GET /items', 'POST /items/:id/archive'],
};

// ── Cloudflare Worker: fetch-handler dispatch ───────────────────────────────

export const WORKER_FETCH_FILES = {
  'wrangler.toml': 'name = "edge"\nmain = "src/index.ts"\ncompatibility_date = "2024-06-01"\n',
  'package.json': pkg({}, { wrangler: '3.60.0', typescript: '5.4.5' }),
  'src/index.ts': `import { handleApi } from './api';
import { Counter } from './counter';

export { Counter };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('home');
    if (url.pathname === '/login' && request.method === 'POST') return login(request, env);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    switch (url.pathname) {
      case '/health':
      case '/healthz':
        return new Response('ok');
      case '/admin': {
        if (!isAuthorized(request, env)) return new Response('Unauthorized', { status: 401 });
        if (request.method === 'GET') return admin(env);
        if (request.method === 'DELETE') return purge(env);
        break;
      }
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function login(request: Request, env: Env) { return new Response('token'); }
function isAuthorized(request: Request, env: Env) { return request.headers.get('Authorization') === \`Bearer \${env.TOKEN}\`; }
function admin(env: Env) { return new Response('admin'); }
function purge(env: Env) { return new Response(null, { status: 204 }); }
`,
  'src/api.ts': `const ITEM = new URLPattern({ pathname: '/api/items/:id' });
const routes: Record<string, Record<string, (request: Request) => Response>> = {
  '/api/version': { GET: version },
};

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (ITEM.test(request.url)) {
    if (request.method === 'GET') return getItem(request);
    if (request.method === 'PUT') return putItem(request);
  }
  const route = routes[pathname];
  if (route) return route[request.method](request);
  if (/^\\/api\\/files\\/.+$/.test(pathname)) return files(request);
  return new Response('Not found', { status: 404 });
}

function version() { return new Response('1.0'); }
function getItem(request: Request) { return new Response('item'); }
function putItem(request: Request) { return new Response('saved'); }
function files(request: Request) { return new Response('file'); }
`,
  // A Durable Object's fetch serves stub calls, not public HTTP.
  'src/counter.ts': `export class Counter {
  constructor(private state: DurableObjectState) {}
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === '/increment') return new Response('1');
    return new Response('0');
  }
}
`,
  // Browser code the Worker never imports.
  'src/client/app.ts': `export function boot() {
  if (location.pathname === '/dashboard') render();
}
function render() {}
`,
};

export const WORKER_FETCH_TRUTH = {
  routes: {
    // No method check guards '/', so every method is served.
    'ALL /': false,
    'POST /login': false,
    'ALL /health': false,
    'ALL /healthz': false,
    'GET /admin': true,
    'DELETE /admin': true,
    'GET /api/items/:id': false,
    'PUT /api/items/:id': false,
    'GET /api/version': false,
  },
  unresolved: [
    { framework: 'Cloudflare Workers', file: 'src/api.ts', line: 14 },
    { framework: 'Cloudflare Workers', file: 'src/index.ts', line: 11 },
  ],
};

// ── Cloudflare Worker: itty-router ──────────────────────────────────────────

export const WORKER_ITTY_FILES = {
  'wrangler.toml': 'name = "users"\nmain = "src/index.ts"\n',
  'package.json': pkg({ 'itty-router': '5.0.17' }, { wrangler: '3.60.0' }),
  'src/index.ts': `import { AutoRouter } from 'itty-router';
import { withAuth } from './auth';
import { usersRouter } from './users';

const router = AutoRouter();

router
  .get('/', () => 'hello')
  .all('/users/*', usersRouter.fetch)
  .get('/me', withAuth, (request) => request.user);

export default router;
`,
  'src/users.ts': `import { Router } from 'itty-router';
import { withAuth } from './auth';

export const usersRouter = Router({ base: '/users' });

usersRouter.get('/', listUsers);
usersRouter.post('/', withAuth, createUser);
usersRouter.get('/:id', showUser);

function listUsers() { return []; }
function createUser() { return {}; }
function showUser() { return {}; }
`,
  'src/auth.ts': `export const withAuth = (request) => {
  if (!request.headers.get('Authorization')) return new Response(null, { status: 401 });
};
`,
};

export const WORKER_ITTY_TRUTH = {
  routes: {
    'GET /': false,
    'GET /me': true,
    'GET /users': false,
    'POST /users': true,
    'GET /users/:id': false,
  },
};

// ── Hono, with and without Wrangler ─────────────────────────────────────────

export const HONO_FILES = {
  'package.json': pkg({ hono: '4.4.6' }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }, null, 2),
  'src/index.ts': `import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import books from './books';
import { admin } from '@/admin';

type Bindings = { JWT_SECRET: string };
const app = new Hono<{ Bindings: Bindings }>().basePath('/api');

app.get('/health', (c) => c.text('ok'));
app.use('/admin/*', jwt({ secret: 'dev-secret' }));
app.route('/books', books);
app.route('/admin', admin);
app.on(['PUT', 'DELETE'], '/posts/:id', (c) => c.body(null, 204));

export default app;
`,
  'src/books.ts': `import { Hono } from 'hono';

const books = new Hono();

books.get('/', (c) => c.json([])).post((c) => c.json({}, 201));
books.get('/:id', (c) => c.json({ id: c.req.param('id') }));

export default books;
`,
  'src/admin.ts': `import { Hono } from 'hono';

export const admin = new Hono();

admin.get('/stats', (c) => c.json({}));
`,
};

export const HONO_WORKER_FILES = {
  ...HONO_FILES,
  'wrangler.jsonc': '// deployed to Workers\n{ "name": "books", "main": "src/index.ts" }\n',
};

export const HONO_TRUTH = {
  routes: {
    'GET /api/health': false,
    'GET /api/books': false,
    'POST /api/books': false,
    'GET /api/books/:id': false,
    'GET /api/admin/stats': true,
    'PUT /api/posts/:id': false,
    'DELETE /api/posts/:id': false,
  },
};
