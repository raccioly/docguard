/**
 * Regression: Next.js App Router HTTP path emission.
 *
 * Bug (v0.20.0 field test, hugocross_revamp): for projects using the `src/`
 * layout, the API-Surface code-scan emitted `GET /app/api/health` instead of
 * `GET /api/health`. Root cause: `appDir.split('/')[0]` stripped only the
 * first segment (`src/`) when computing the route's relative path, leaking
 * `app/` into the emitted HTTP path. Fix: strip everything up to and
 * including the last `/` (the parent of `api/`).
 *
 * These tests pin both layouts so the bug cannot regress.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanRoutesDeep } from '../cli/scanners/routes.mjs';

const NO_SPEC = { openapi: { found: false } };

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-nextjs-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('Next.js App Router — HTTP path emission', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('emits /api/health (not /app/api/health) for the src/ layout', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { next: '^15' } }),
      'src/app/api/health/route.ts': 'export async function GET() {}',
    });
    const routes = scanRoutesDeep(dir, { framework: 'Next.js' }, NO_SPEC);
    const paths = routes.map(r => `${r.method} ${r.path}`);
    assert.ok(paths.includes('GET /api/health'),
      `expected 'GET /api/health' in ${JSON.stringify(paths)}`);
    assert.ok(!paths.some(p => p.includes('/app/api/')),
      `no route should leak '/app/api/' prefix; got ${JSON.stringify(paths)}`);
  });

  it('emits /api/health for the non-src layout (no regression)', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { next: '^15' } }),
      'app/api/health/route.ts': 'export async function GET() {}',
    });
    const routes = scanRoutesDeep(dir, { framework: 'Next.js' }, NO_SPEC);
    const paths = routes.map(r => `${r.method} ${r.path}`);
    assert.ok(paths.includes('GET /api/health'),
      `expected 'GET /api/health' in ${JSON.stringify(paths)}`);
  });

  it('preserves nested segments for the src/ layout', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { next: '^15' } }),
      'src/app/api/users/[id]/posts/route.ts': 'export async function GET() {}',
    });
    const routes = scanRoutesDeep(dir, { framework: 'Next.js' }, NO_SPEC);
    const paths = routes.map(r => `${r.method} ${r.path}`);
    assert.ok(paths.includes('GET /api/users/:id/posts'),
      `expected 'GET /api/users/:id/posts' in ${JSON.stringify(paths)}`);
  });
});
