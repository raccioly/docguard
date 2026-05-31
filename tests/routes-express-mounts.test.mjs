/**
 * Express mount-prefix resolution (item 1).
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

  it('leaves an UNMOUNTED router file at its bare path (no regression)', () => {
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    // No app file mounts this — bare paths, exactly the pre-mount-map behavior.
    writeFileSync(join(dir, 'src', 'routes', 'orphan.ts'),
      "const router = Router();\nrouter.get('/thing', h);\n");

    assert.deepEqual(express(dir), ['GET /thing']);
  });
});
