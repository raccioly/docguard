import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  resolveSourceRoots,
  collectPackageJsons,
  detectDocker,
  grepEnvUsage,
  getWorkspaceDirs,
} from '../cli/shared-source.mjs';

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

describe('shared-source: monorepo discovery', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'docguard-src-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('resolveSourceRoots honors config.sourceRoot', () => {
    write(tmp, 'backend/src/index.ts', 'export {};');
    const roots = resolveSourceRoots(tmp, { sourceRoot: 'backend/src' });
    assert.ok(roots.some(r => r.endsWith('/backend/src')));
  });

  it('resolveSourceRoots expands package.json workspaces globs', () => {
    write(tmp, 'package.json', JSON.stringify({ workspaces: ['packages/*'] }));
    write(tmp, 'packages/api/package.json', JSON.stringify({ name: 'api' }));
    write(tmp, 'packages/web/package.json', JSON.stringify({ name: 'web' }));
    const ws = getWorkspaceDirs(tmp);
    assert.equal(ws.length, 2);
    const roots = resolveSourceRoots(tmp, {});
    assert.ok(roots.some(r => r.endsWith('/packages/api')));
  });

  it('resolveSourceRoots does NOT fall back to projectDir when a source root exists', () => {
    write(tmp, 'src/index.ts', 'export {};');
    const roots = resolveSourceRoots(tmp, {});
    assert.ok(!roots.includes(tmp), 'projectDir should not be scanned when src/ exists');
  });

  it('resolveSourceRoots falls back to projectDir when nothing else resolves', () => {
    write(tmp, 'index.ts', 'export {};'); // code at root, no conventional dir
    const roots = resolveSourceRoots(tmp, {});
    assert.deepEqual(roots, [tmp]);
  });

  it('collectPackageJsons merges root + source-root packages', () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { react: '^18' } }));
    write(tmp, 'backend/package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write(tmp, 'backend/src/server.ts', 'export {};');
    const pkgs = collectPackageJsons(tmp, { sourceRoot: 'backend/src' });
    const deps = {};
    for (const { pkg } of pkgs) Object.assign(deps, pkg.dependencies);
    assert.ok(deps.react && deps.express, 'should merge both package.json dep sets');
  });

  it('detectDocker finds a Dockerfile under the source-root package', () => {
    write(tmp, 'backend/Dockerfile', 'FROM node:20');
    write(tmp, 'backend/src/x.ts', 'export {};');
    assert.equal(detectDocker(tmp, { sourceRoot: 'backend/src' }), true);
  });

  it('detectDocker returns false when no docker artifacts exist', () => {
    write(tmp, 'src/x.ts', 'export {};');
    assert.equal(detectDocker(tmp, {}), false);
  });

  it('grepEnvUsage finds process.env and import.meta.env usage', () => {
    write(tmp, 'backend/src/config.ts', `
      const a = process.env.ACCESS_TOKEN_TTL_SECONDS || '1';
      const b = process.env['REDIS_URL'];
      const c = import.meta.env.VITE_API_URL;
    `);
    const names = grepEnvUsage(tmp, { sourceRoot: 'backend/src' });
    assert.ok(names.has('ACCESS_TOKEN_TTL_SECONDS'));
    assert.ok(names.has('REDIS_URL'));
    assert.ok(names.has('VITE_API_URL'));
  });
});
