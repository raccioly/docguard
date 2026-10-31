/**
 * Auth middleware behind a path the router reader cannot read (spec 080,
 * FR-006; found by the Jules bug-hunt routine in #595).
 *
 * `use(path, ...middleware)` covers that path and everything under it
 * (docguard.js-route-shapes#FR-001). When the path is not literal, the scope
 * is unknown: it is recorded in `scan.unresolved` and never guessed as "every
 * route" (docguard.js-route-shapes#FR-005).
 *
 * @req docguard.consumer-report-precision#FR-006
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFiles } from './fixtures/js-route-shape-projects.mjs';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { extractRouterRoutes } from '../cli/scanners/router-routes.mjs';

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

function koa(source) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-080-'));
  dirs.push(dir);
  writeFiles(dir, {
    'package.json': JSON.stringify({ dependencies: { koa: '2.15.3', '@koa/router': '12.0.1' } }),
    'src/routes.js': source,
  });
  return scanRoutesDeep(dir, { framework: 'Koa' }, {}, { config: {} });
}

const authMap = routes => Object.fromEntries(routes.map(r => [`${r.method} ${r.path}`, Boolean(r.auth)]));
const unresolved = routes => (routes.scan?.unresolved || []).map(u => ({ file: u.file, line: u.line }));

describe('FR-006: auth under an unreadable use() path is recorded, not widened to every route', () => {
  it('records the path and does not mark the routes after it as auth', () => {
    const routes = koa(`const Router = require('@koa/router');
const router = new Router();
router.use(API_PREFIX, requireAuth);
router.get('/me', show);
module.exports = router;
`);
    assert.deepEqual(authMap(routes), { 'GET /me': false });
    assert.deepEqual(unresolved(routes), [{ file: 'src/routes.js', line: 3 }]);
  });

  it('a literal use() path still marks its routes (unchanged)', () => {
    const routes = koa(`const Router = require('@koa/router');
const router = new Router();
router.use('/me', requireAuth);
router.get('/me', show);
router.get('/open', show);
module.exports = router;
`);
    assert.deepEqual(authMap(routes), { 'GET /me': true, 'GET /open': false });
    assert.deepEqual(unresolved(routes), []);
  });

  it('auth middleware with no path still covers every later route (unchanged)', () => {
    const routes = koa(`const Router = require('@koa/router');
const router = new Router();
router.use(requireAuth);
router.get('/me', show);
module.exports = router;
`);
    assert.deepEqual(authMap(routes), { 'GET /me': true });
    assert.deepEqual(unresolved(routes), []);
  });

  it('records nothing for a single middleware argument or middleware that is not auth', () => {
    const routes = koa(`const Router = require('@koa/router');
const router = new Router();
router.use(LOGGER);
router.use(STATIC_PATH, serve('public'));
router.get('/open', show);
module.exports = router;
`);
    assert.deepEqual(authMap(routes), { 'GET /open': false });
    assert.deepEqual(unresolved(routes), []);
  });

  it('the #595 shape on an application records router-unresolved-path with its target', () => {
    const routes = extractRouterRoutes([{
      file: 'app.js',
      abs: '/project/app.js',
      content: 'const app = new Koa();\napp.use(PATH_VAR, authMiddleware);\n',
    }], () => null, { defaultSource: 'koa', framework: 'Koa' });
    const limits = routes.limitations.filter(l => l.code === 'router-unresolved-path');
    assert.deepEqual(limits.map(l => ({ line: l.line, target: l.target })), [{ line: 2, target: 'PATH_VAR' }]);
  });
});
