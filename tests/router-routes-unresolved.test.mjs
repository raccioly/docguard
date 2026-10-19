import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRouterRoutes } from '../cli/scanners/router-routes.mjs';

/**
 * Governing spec: docguard.real-project-route-gaps
 *
 * "When the detected framework is Actix Web, Axum, Rocket, Symfony or Laravel, a route declaration the reader recognises but cannot turn into a route MUST be recorded in scan.unresolved as { framework, code, file, line, target } with a route-unresolved-path, route-unresolved-prefix, route-unresolved-method or route-unresolved-declaration code."
 * (This logic applies to JavaScript routes via docguard.js-route-shapes FR-004 and docguard.real-project-route-gaps)
 */
test('router-unresolved-path limit on router.use() without mount', () => {
  const sources = [
    {
      file: 'app.js',
      abs: '/path/to/app.js',
      content: `
        const app = new Koa();
        app.use(PATH_VAR, authMiddleware);
      `,
    }
  ];
  const routes = extractRouterRoutes(sources, () => null, { defaultSource: 'koa', framework: 'koa' });
  const limits = routes.limitations.filter(l => l.code === 'router-unresolved-path');
  assert.equal(limits.length, 1);
  assert.equal(limits[0].target, 'PATH_VAR');
});
