/**
 * v0.14-P2 — Environment + API-Surface honor config.changedFiles.
 *
 * @req SC-P2-001 — grepEnvUsage with config.changedFiles only scans those paths
 * @req SC-P2-002 — API-Surface returns N/A when no route files in changed set
 * @req SC-P2-003 — API-Surface runs normally when at least one route file changed
 * @req SC-P2-004 — full --changed-only flow scopes both validators in concert
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { grepEnvUsage } from '../cli/shared-source.mjs';
import { validateApiSurface } from '../cli/validators/api-surface.mjs';

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-p2-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('grepEnvUsage — config.changedFiles scope', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('scans only the listed paths when changedFiles is set', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't' }),
      'src/a.ts': 'const x = process.env.SCOPED_VAR;',
      'src/b.ts': 'const y = process.env.UNSCOPED_VAR;',
    });
    // Scoped: only a.ts in the list
    const scoped = grepEnvUsage(dir, { changedFiles: ['src/a.ts'] });
    assert.ok(scoped.has('SCOPED_VAR'), 'scoped scan finds SCOPED_VAR');
    assert.ok(!scoped.has('UNSCOPED_VAR'),
      `scoped scan should NOT find UNSCOPED_VAR (b.ts not in changedFiles); got: ${[...scoped]}`);
  });

  it('scans everything when changedFiles is missing or empty', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't' }),
      'src/a.ts': 'const x = process.env.A_VAR;',
      'src/b.ts': 'const y = process.env.B_VAR;',
    });
    const full1 = grepEnvUsage(dir, {});
    const full2 = grepEnvUsage(dir, { changedFiles: [] });
    assert.ok(full1.has('A_VAR') && full1.has('B_VAR'));
    assert.ok(full2.has('A_VAR') && full2.has('B_VAR'));
  });
});

describe('validateApiSurface — config.changedFiles scope', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('returns N/A when no route/spec files changed', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', dependencies: { express: '^4' } }),
      'src/routes/users.ts': 'export const r = 1;',
      'docs-canonical/API-REFERENCE.md': '# API\n',
    });
    const r = validateApiSurface(dir, {
      projectName: 't',
      changedFiles: ['README.md', 'src/utils/helpers.ts'],
    });
    assert.equal(r.applicable, false,
      'API-Surface should be N/A when only docs/utils changed');
    assert.equal(r.total, 0);
  });

  it('runs normally when a route file IS in the changed set', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', dependencies: { express: '^4' } }),
      'src/routes/users.ts': 'export const r = 1;',
      'docs-canonical/API-REFERENCE.md': '# API\n',
    });
    const r = validateApiSurface(dir, {
      projectName: 't',
      changedFiles: ['src/routes/users.ts'],
    });
    // applicable may be true or false depending on OpenAPI presence — what
    // we're asserting here is the scoping doesn't short-circuit.
    assert.notEqual(r.applicable, false,
      'changed-routes case should NOT short-circuit to N/A');
  });

  it('runs normally when no changedFiles is set (no scoping)', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', dependencies: { express: '^4' } }),
      'src/routes/users.ts': 'export const r = 1;',
      'docs-canonical/API-REFERENCE.md': '# API\n',
    });
    const r = validateApiSurface(dir, { projectName: 't' });
    // Without changedFiles, scoping is disabled — original behavior preserved.
    assert.notEqual(r.applicable, false);
  });

  it('detects OpenAPI specs as route-relevant for scoping', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't' }),
      'openapi.yaml': 'openapi: 3.0.0\n',
      'docs-canonical/API-REFERENCE.md': '# API\n',
    });
    // openapi.yaml in changed set should keep the validator active
    const r = validateApiSurface(dir, {
      projectName: 't',
      changedFiles: ['openapi.yaml'],
    });
    assert.notEqual(r.applicable, false,
      'OpenAPI spec changes should keep API-Surface active');
  });
});
