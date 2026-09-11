import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { compareEndpoints, normalizePath } from '../cli/scanners/api-doc.mjs';
import { validateApiSurface } from '../cli/validators/api-surface.mjs';

const config = { sourceRoot: 'backend/src' };
const scan = dir => scanRoutesDeep(dir, { framework: 'Express' }, {}, { config });

describe('mounted route field precision', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'docguard-route-precision-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const write = (path, content) => safeWrite(join(dir, path), content);

  it('finds named export aliases with middleware and preserves HTTP method mismatches', () => {
    write('backend/src/server.ts', [
      "import { itemRoutes as mountedItems } from './routes/items';",
      "app.use('/api/items', authenticate, mountedItems);",
      "app.get('/health', health);",
    ].join('\n'));
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
    write('backend/src/routes/items.ts', [
      "import { Router as makeRouter } from 'express';",
      'const endpoints = makeRouter();',
      ...methods.map(method => 'endpoints.' + method + "('/:id', enabled, authorize('items'), handler);"),
      "endpoints.get('/summary', enabled, summary);",
      'export const itemRoutes = endpoints;',
    ].join('\n'));
    const routes = scan(dir);
    assert.deepEqual(routes.map(r => r.method + ' ' + r.path).sort(), [
      ...methods.map(method => method.toUpperCase() + ' /api/items/:id'),
      'GET /api/items/summary', 'GET /health',
    ].sort());
    const comparison = compareEndpoints([
      ...methods.map(method => ({ method: method.toUpperCase(), path: '/api/items/{id}' })),
      { method: 'POST', path: '/api/items/summary' },
      { method: 'GET', path: '/api/items/{id}/missing' },
    ], routes);
    assert.equal(comparison.matched.length, methods.length);
    assert.deepEqual(comparison.documentedButAbsent, [
      { method: 'POST', path: '/api/items/summary' },
      { method: 'GET', path: '/api/items/{id}/missing' },
    ]);
  });

  it('keeps removed exports flagged while matching shared-prefix routers in code-only validation', () => {
    write('backend/src/server.ts', [
      "import { deliveryRoutes } from './routes/deliveries';",
      "import statusRoutes from './routes/status';",
      "app.use('/api', authenticate, deliveryRoutes);",
      "app.use('/api', statusRoutes);",
    ].join('\n'));
    write('backend/src/routes/deliveries.ts', [
      'const router = Router();',
      "router.post('/deliveries', enabled, create);",
      "router.get('/deliveries/group/:groupId', enabled, list);",
      "router.get('/deliveries/:id/recipients', enabled, recipients);",
      "router.get('/deliveries/:id', enabled, detail);",
      "// Removed: router.get('/deliveries/:id/recipients/export', exportCsv);",
      'export const deliveryRoutes = router;',
    ].join('\n'));
    write('backend/src/routes/status.ts', "const status = Router(); status.get('/status', health); export default status;");
    const present = [
      ['POST', '/api/deliveries'], ['GET', '/api/deliveries/group/{groupId}'],
      ['GET', '/api/deliveries/{id}/recipients'], ['GET', '/api/deliveries/{id}'],
      ['GET', '/api/status'],
    ];
    const removed = '/api/deliveries/{id}/recipients/export';
    write('docs-canonical/API-REFERENCE.md', [...present, ['GET', removed]]
      .map(([method, path]) => '#### ' + method + ' `' + path + '`').join('\n'));
    const routes = scan(dir);
    assert.equal(routes.length, present.length);
    assert.ok(!routes.some(route => route.path.endsWith('/export')));
    const result = validateApiSurface(dir, config);
    const missing = result.findings.filter(finding => finding.code === 'API004');
    assert.equal(missing.length, 1);
    assert.ok(missing[0].message.includes(normalizePath(removed)));
    assert.equal(missing[0].confidence, 'low');
    assert.equal(result.errors.length, 0);
  });
});
