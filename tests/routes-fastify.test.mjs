/**
 * Fastify route scanning (item 2a) — the declarative `fastify.route({ method,
 * url })` form (which the old regex never matched) plus the method shorthand,
 * both via AST with a regex fallback.
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
// @implements docguard.test-temp-dirs#FR-001: this file's temporary directories come from the helper.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';


import { scanRoutesDeep } from '../cli/scanners/routes.mjs';

function fastify(dir) {
  return scanRoutesDeep(dir, { framework: 'Fastify' }, {})
    .filter(r => r.source === 'fastify')
    .map(r => `${r.method} ${r.path}`)
    .sort();
}

describe('Fastify route scanning', () => {
  let dir;
  beforeEach(() => { dir = makeTempDir('docguard-fastify-'); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('extracts the object form AND the method shorthand together', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'routes.ts'),
      "fastify.get('/health', h);\n" +
      "fastify.route({ method: 'GET', url: '/users/:id', handler: getUser });\n" +
      "fastify.route({ method: ['POST', 'PUT'], url: '/users' });\n");

    assert.deepEqual(fastify(dir), [
      'GET /health',
      'GET /users/:id',
      'POST /users',
      'PUT /users',
    ]);
  });
});
