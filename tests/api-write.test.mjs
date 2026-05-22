import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { removeEndpoints, hasGeneratedMarker } from '../cli/writers/api-reference.mjs';
import { applyApiSurfaceWrites } from '../cli/commands/fix.mjs';

const API_DOC = [
  '# API Reference',
  '',
  '<!-- docguard:generated true -->',
  '',
  '| Method | Path | Auth |',
  '|--------|------|------|',
  '| `GET` | `/api/live` | 🔓 |',
  '| `GET` | `/api/dead` | 🔓 |',
  '| `POST` | `/api/users/{id}` | 🔒 |',
  '',
  '#### GET `/api/live`',
  '> Source: spec',
  '- **Auth:** None',
  '',
  '#### GET `/api/dead`',
  '> Source: spec',
  '- This endpoint is gone.',
  '',
  '#### POST `/api/users/{id}`',
  '- **Auth:** Required',
  '',
  '## Notes',
  'Trailing content survives.',
  '',
].join('\n');

describe('api-reference writer: removeEndpoints', () => {
  it('removes the table row AND the detail block for a target endpoint', () => {
    const { content, removed } = removeEndpoints(API_DOC, [{ method: 'GET', path: '/api/dead' }]);
    assert.deepEqual(removed, ['GET /api/dead']);
    assert.ok(!content.includes('/api/dead'), 'all /api/dead references removed');
    assert.ok(!content.includes('This endpoint is gone'), 'detail block body removed');
  });

  it('preserves other endpoints and trailing sections', () => {
    const { content } = removeEndpoints(API_DOC, [{ method: 'GET', path: '/api/dead' }]);
    assert.ok(content.includes('| `GET` | `/api/live` | 🔓 |'), 'live row kept');
    assert.ok(content.includes('#### GET `/api/live`'), 'live block kept');
    assert.ok(content.includes('#### POST `/api/users/{id}`'), 'next block kept');
    assert.ok(content.includes('## Notes'), 'trailing section kept');
    assert.ok(content.includes('Trailing content survives.'), 'trailing body kept');
  });

  it('treats :id and {id} as the same endpoint when removing', () => {
    const { removed } = removeEndpoints(API_DOC, [{ method: 'POST', path: '/api/users/:id' }]);
    assert.deepEqual(removed, ['POST /api/users/{}']);
  });

  it('is idempotent — removing an already-absent endpoint changes nothing', () => {
    const once = removeEndpoints(API_DOC, [{ method: 'GET', path: '/api/dead' }]).content;
    const twice = removeEndpoints(once, [{ method: 'GET', path: '/api/dead' }]);
    assert.equal(twice.content, once);
    assert.equal(twice.removed.length, 0);
  });

  it('hasGeneratedMarker detects the generated marker', () => {
    assert.equal(hasGeneratedMarker(API_DOC), true);
    assert.equal(hasGeneratedMarker('# Hand-written doc\nno marker'), false);
  });
});

describe('applyApiSurfaceWrites (gated, spec-confirmed removals)', () => {
  let tmp;
  const openapi = (paths) => {
    const lines = ['openapi: 3.0.3', 'info:', '  title: t', '  version: 1.0.0', 'paths:'];
    for (const [p, methods] of Object.entries(paths)) {
      lines.push(`  ${p}:`);
      for (const m of methods) { lines.push(`    ${m}:`); lines.push(`      summary: ${m} ${p}`); }
    }
    return lines.join('\n');
  };
  const write = (rel, content) => {
    const full = join(tmp, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'docguard-write-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('removes a spec-confirmed absent endpoint from a generated doc', () => {
    write('package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write('docs/openapi.yaml', openapi({ '/api/live': ['get'] }));
    write('docs-canonical/API-REFERENCE.md', API_DOC);

    const r = applyApiSurfaceWrites(tmp, { sourceRoot: 'src' });
    assert.equal(r.applied, true);
    assert.ok(r.removed.some(e => e.path === '/api/dead'));
    const after = readFileSync(join(tmp, 'docs-canonical/API-REFERENCE.md'), 'utf-8');
    assert.ok(!after.includes('/api/dead'));
    assert.ok(after.includes('/api/live'));
  });

  it('SKIPS a doc without the generated marker unless --force', () => {
    write('package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write('docs/openapi.yaml', openapi({ '/api/live': ['get'] }));
    write('docs-canonical/API-REFERENCE.md', API_DOC.replace('<!-- docguard:generated true -->', ''));

    const skipped = applyApiSurfaceWrites(tmp, { sourceRoot: 'src' });
    assert.equal(skipped.applied, false);
    assert.ok(skipped.skipped && /not marked/.test(skipped.skipped));
    // Doc untouched
    assert.ok(readFileSync(join(tmp, 'docs-canonical/API-REFERENCE.md'), 'utf-8').includes('/api/dead'));

    // With force, it applies.
    const forced = applyApiSurfaceWrites(tmp, { sourceRoot: 'src' }, { force: true });
    assert.equal(forced.applied, true);
  });

  it('does NOT delete on a heuristic code-scan (no spec) — needs spec confidence', () => {
    write('package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write('src/routes.js', "app.get('/api/live', h);"); // code scan, no OpenAPI spec
    write('docs-canonical/API-REFERENCE.md', API_DOC);

    const r = applyApiSurfaceWrites(tmp, { sourceRoot: 'src' });
    assert.equal(r.applied, false, 'must not auto-delete without spec confirmation');
  });
});
