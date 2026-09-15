/**
 * Express mount-prefix resolution (item 1).
 * @req docguard.adoption-workflow-integrity#FR-013
 * @req docguard.adoption-workflow-integrity#SC-007
 * @req docs-canonical/REQUIREMENTS.md#FR-015
 *
 * A sub-router declares `router.get('/:id')` but the real URL is
 * `/api/users/:id` because the app did `app.use('/api/users', userRoutes)`.
 * Without resolving the mount, the per-file scan emits the bare `/:id`, the
 * documented `/api/users/:id` never matches, and every mounted route
 * double-fires (documented-but-absent AND undocumented). These tests lock in
 * the resolution — and, crucially, that it does NOT over-prefix sibling routes.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanRoutesDeep } from '../cli/scanners/routes.mjs';

function express(dir) {
  return scanRoutesDeep(dir, { framework: 'Express' }, {})
    .filter(r => r.source === 'express')
    .map(r => `${r.method} ${r.path}`)
    .sort();
}

describe('Express mount-prefix resolution', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'docguard-mounts-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('prefixes an IMPORTED sub-router with its mount path (default + named exports)', () => {
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'),
      "import userRoutes from './routes/users';\n" +
      "import { tagRoutes } from './routes/tags';\n" +
      "app.use('/api/users', userRoutes);\n" +
      "app.use('/api/tags', authMiddleware, tagRoutes);\n");
    writeFileSync(join(dir, 'src', 'routes', 'users.ts'),
      "const router = Router();\nrouter.get('/:id', h);\nrouter.post('/', h);\nexport default router;\n");
    writeFileSync(join(dir, 'src', 'routes', 'tags.ts'),
      "export const tagRoutes = Router();\ntagRoutes.get('/', h);\ntagRoutes.delete('/:id', h);\n");

    assert.deepEqual(express(dir), [
      'DELETE /api/tags/:id',
      'GET /api/tags',
      'GET /api/users/:id',
      'POST /api/users',
    ]);
  });

  it('does NOT over-prefix a sibling app route in the mounting file', () => {
    // Same-file mount: a local `router` is mounted at /api, but `app.get('/health')`
    // in the same file must stay bare — receiver-awareness, not file-level prefixing.
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'server.ts'),
      "const app = express();\n" +
      "const router = Router();\n" +
      "router.get('/items', h);\n" +
      "app.use('/api', router);\n" +
      "app.get('/health', h);\n");

    assert.deepEqual(express(dir), ['GET /api/items', 'GET /health']);
  });

  it('emits one path PER mount when the same router is mounted at several prefixes', () => {
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'),
      "import users from './routes/users';\n" +
      "app.use('/api/v1/users', users);\n" +
      "app.use('/api/v2/users', users);\n");
    writeFileSync(join(dir, 'src', 'routes', 'users.ts'),
      "const router = Router();\nrouter.get('/:id', h);\nexport default router;\n");

    assert.deepEqual(express(dir), ['GET /api/v1/users/:id', 'GET /api/v2/users/:id']);
  });

  it('composes imported router mounts across multiple files', () => {
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'),
      "import api from './routes/api';\napp.use('/api', api);\n");
    writeFileSync(join(dir, 'src', 'routes', 'api.ts'),
      "import reports from './reports';\n" +
      "const router = Router();\nrouter.use('/reports', reports);\nexport default router;\n");
    writeFileSync(join(dir, 'src', 'routes', 'reports.ts'),
      "const router = Router();\nrouter.get('/', list);\nrouter.get('/:id', detail);\nexport default router;\n");

    assert.deepEqual(express(dir), [
      'GET /api/reports',
      'GET /api/reports/:id',
    ]);
  });

  it('composes a pathless imported router mount', () => {
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'),
      "import settings from './routes/settings';\napp.use('/api', settings);\n");
    writeFileSync(join(dir, 'src', 'routes', 'settings.ts'),
      "import legacy from './legacy';\nconst router = Router();\nrouter.use(legacy);\nexport default router;\n");
    writeFileSync(join(dir, 'src', 'routes', 'legacy.ts'),
      "const router = Router();\nrouter.get('/tags', list);\nexport default router;\n");

    assert.deepEqual(express(dir), ['GET /api/tags']);
  });

  it('resolves module-level static route and mount path constants', () => {
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'),
      "import groups from './routes/groups';\nconst api = '/api';\napp.use(`${api}/v1`, groups);\n");
    writeFileSync(join(dir, 'src', 'routes', 'groups.ts'),
      "const router = Router();\nconst base = '/groups/:groupId/items';\nrouter.get(base, list);\nrouter.get(`${base}/:itemId`, detail);\nexport default router;\n");

    assert.deepEqual(express(dir), [
      'GET /api/v1/groups/:groupId/items',
      'GET /api/v1/groups/:groupId/items/:itemId',
    ]);
  });

  it('does not select trailing imported middleware as the mounted router', () => {
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'),
      "import child from './routes/child';\nimport after from './after';\napp.use('/api', child, after);\n");
    writeFileSync(join(dir, 'src', 'routes', 'child.ts'),
      "const router = Router();\nrouter.get('/items', list);\nexport default router;\n");
    writeFileSync(join(dir, 'src', 'after.ts'), "export default function after(error, req, res, next) { next(error); }\n");

    assert.deepEqual(express(dir), ['GET /api/items']);
  });

  it('prefixes only the imported router symbol in a multi-router module', () => {
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'),
      "import { publicRouter as publicApi } from './routes/mixed';\napp.use('/api', publicApi);\n");
    writeFileSync(join(dir, 'src', 'routes', 'mixed.ts'),
      "export const publicRouter = Router();\nexport const adminRouter = Router();\n" +
      "publicRouter.get('/public', list);\nadminRouter.get('/admin', list);\n");

    assert.deepEqual(express(dir), ['GET /admin', 'GET /api/public']);
  });

  it('leaves an UNMOUNTED router file at its bare path (no regression)', () => {
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    // No app file mounts this — bare paths, exactly the pre-mount-map behavior.
    writeFileSync(join(dir, 'src', 'routes', 'orphan.ts'),
      "const router = Router();\nrouter.get('/thing', h);\n");

    assert.deepEqual(express(dir), ['GET /thing']);
  });

  it('keeps a product route when a test client calls the same path first', () => {
    mkdirSync(join(dir, 'src', 'handlers', '__tests__'), { recursive: true });
    writeFileSync(join(dir, 'src', 'server.ts'),
      "import contacts from './handlers/contacts';\n" +
      "app.use('/api/contacts', contacts);\n");
    writeFileSync(join(dir, 'src', 'handlers', 'contacts.ts'),
      "const router = Router();\nrouter.get('/', list);\nexport default router;\n");
    writeFileSync(join(dir, 'src', 'handlers', '__tests__', 'contacts.test.ts'),
      "request(app).get('/api/contacts');\n");

    assert.deepEqual(express(dir), ['GET /api/contacts']);
  });

  it('ignores conventional test helper trees during route discovery', () => {
    mkdirSync(join(dir, 'src', 'test-helpers'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'), "app.get('/api/live', live);\n");
    writeFileSync(join(dir, 'src', 'test-helpers', 'app.ts'),
      "testApp.get('/api/fixture-only', fixture);\n");

    assert.deepEqual(express(dir), ['GET /api/live']);
  });
});
