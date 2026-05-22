import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateApiSurface } from '../cli/validators/api-surface.mjs';

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

// Minimal OpenAPI spec with the given paths.
function openapi(paths) {
  const lines = ['openapi: 3.0.3', 'info:', '  title: t', '  version: 1.0.0', 'paths:'];
  for (const [p, methods] of Object.entries(paths)) {
    lines.push(`  ${p}:`);
    for (const m of methods) {
      lines.push(`    ${m}:`);
      lines.push(`      summary: ${m} ${p}`);
    }
  }
  return lines.join('\n');
}

describe('api-surface validator', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'docguard-api-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('returns 0/0 (not applicable) when API-REFERENCE.md is absent', () => {
    const r = validateApiSurface(tmp, {});
    assert.equal(r.total, 0);
    assert.equal(r.errors.length, 0);
    assert.equal(r.warnings.length, 0);
  });

  it('flags a documented-but-absent endpoint as an ERROR when a spec confirms it', () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write(tmp, 'docs/openapi.yaml', openapi({ '/api/users': ['get'] }));
    write(tmp, 'docs-canonical/API-REFERENCE.md', [
      '#### GET `/api/users`',
      '#### GET `/api/admin/observability/xray`',
    ].join('\n'));

    const r = validateApiSurface(tmp, {});
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /observability\/xray/);
    assert.equal(r.warnings.length, 0);
  });

  it('warns (not errors) for documented-but-absent when only code-scanning (no spec)', () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write(tmp, 'src/routes.js', "app.get('/api/users', h);");
    write(tmp, 'docs-canonical/API-REFERENCE.md', [
      '#### GET `/api/users`',
      '#### GET `/api/gone`',
    ].join('\n'));

    const r = validateApiSurface(tmp, {});
    assert.equal(r.errors.length, 0, 'no spec → must not hard-fail');
    assert.ok(r.warnings.some(w => /\/api\/gone/.test(w)));
  });

  it('warns for a present-but-undocumented endpoint', () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write(tmp, 'docs/openapi.yaml', openapi({ '/api/users': ['get'], '/api/extra': ['post'] }));
    write(tmp, 'docs-canonical/API-REFERENCE.md', '#### GET `/api/users`');

    const r = validateApiSurface(tmp, {});
    assert.equal(r.errors.length, 0);
    assert.ok(r.warnings.some(w => /POST \/api\/extra/.test(w)));
  });

  it('prefers the spec under the configured sourceRoot over a stale root copy', () => {
    // stale root spec is missing the endpoint; backend spec has it
    write(tmp, 'package.json', JSON.stringify({ workspaces: [] }));
    write(tmp, 'docs/openapi.yaml', openapi({ '/api/users': ['get'] }));
    write(tmp, 'backend/package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write(tmp, 'backend/docs/openapi.yaml', openapi({
      '/api/users': ['get'],
      '/api/groups/{groupId}/recover': ['post'],
    }));
    write(tmp, 'backend/src/x.ts', 'export {};');
    write(tmp, 'docs-canonical/API-REFERENCE.md', [
      '#### GET `/api/users`',
      '#### POST `/api/groups/{groupId}/recover`',
    ].join('\n'));

    const r = validateApiSurface(tmp, { sourceRoot: 'backend/src' });
    // recover endpoint exists in the backend spec → no false documented-but-absent
    assert.equal(r.errors.length, 0, `unexpected errors: ${r.errors.join('; ')}`);
  });
});
