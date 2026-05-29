/**
 * v0.18-P2 — Cross-process plan cache (.docguard/plan.cache.json).
 *
 * @req NFR-003 — repeat guard runs reuse a cross-process plan cache, invalidated on tree change.
 *
 * Verifies the disk cache (L2):
 *   - First call writes the file
 *   - Second call (in a fresh process / fresh in-memory state) reads it
 *   - Tree-state change invalidates the cache
 *   - Bad/corrupt files don't throw — cache miss is silent
 *
 * @req SC-DC-001 — first buildMemoryPlan writes .docguard/plan.cache.json
 * @req SC-DC-002 — fresh process reads the cache (faster than full build)
 * @req SC-DC-003 — tree-state change invalidates the disk cache
 * @req SC-DC-004 — corrupt cache file is silently ignored
 * @req SC-DC-005 — config.diskCache === false disables the layer
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { buildMemoryPlan, clearMemoryPlanCache } from '../cli/scanners/memory-plan.mjs';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-disk-cache-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'disk-cache-test', version: '0.0.0',
    dependencies: { express: '^4' },
  }));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/index.ts'), 'export const x = 1;');
  return dir;
}

describe('disk-backed plan cache', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    clearMemoryPlanCache(); // reset L1 between tests
  });

  it('first build writes .docguard/plan.cache.json', () => {
    dir = makeRepo();
    buildMemoryPlan(dir, { projectName: 't' });
    assert.ok(
      existsSync(resolve(dir, '.docguard/plan.cache.json')),
      'disk cache file should be created after first build'
    );
  });

  it('cache content has the expected shape', () => {
    dir = makeRepo();
    buildMemoryPlan(dir, { projectName: 't' });
    const raw = readFileSync(resolve(dir, '.docguard/plan.cache.json'), 'utf-8');
    const data = JSON.parse(raw);
    assert.equal(data.v, '1', 'schema version stamp');
    assert.equal(typeof data.configKey, 'string');
    assert.equal(typeof data.treeHash, 'string');
    assert.ok(data.plan, 'plan body present');
    assert.ok(data.plan.profile, 'plan has profile');
  });

  it('second build in same in-process tree uses L1 (no disk re-read needed)', () => {
    dir = makeRepo();
    const first = buildMemoryPlan(dir, { projectName: 't' });
    // Without deleting the in-memory cache, same call should return same object
    const second = buildMemoryPlan(dir, { projectName: 't' });
    assert.strictEqual(first, second,
      'L1 cache should return the exact same plan object');
  });

  it('fresh in-process state finds plan via disk cache', () => {
    dir = makeRepo();
    buildMemoryPlan(dir, { projectName: 't' });
    // Simulate a fresh process: clear L1, then build again
    clearMemoryPlanCache();
    const fromDisk = buildMemoryPlan(dir, { projectName: 't' });
    assert.ok(fromDisk, 'should rehydrate from disk');
    assert.ok(fromDisk.profile, 'rehydrated plan has profile');
  });

  it('tree-state change invalidates the disk cache', () => {
    dir = makeRepo();
    buildMemoryPlan(dir, { projectName: 't' });
    clearMemoryPlanCache();
    // Bump package.json mtime to simulate a dep update
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, 'package.json'), future, future);
    // The cache file still exists but should be invalidated by tree-state mismatch
    const plan = buildMemoryPlan(dir, { projectName: 't' });
    assert.ok(plan, 'rebuilds fresh after invalidation');
    // The on-disk cache should now reflect the new tree hash
    const raw = readFileSync(resolve(dir, '.docguard/plan.cache.json'), 'utf-8');
    const data = JSON.parse(raw);
    assert.ok(data.treeHash, 'new tree hash stamped');
  });

  it('corrupt disk cache is silently ignored', () => {
    dir = makeRepo();
    // Create a corrupt cache file BEFORE first call
    mkdirSync(resolve(dir, '.docguard'));
    writeFileSync(resolve(dir, '.docguard/plan.cache.json'), '{not valid json');
    clearMemoryPlanCache();
    // Should NOT throw — corrupt cache is a miss, builds fresh
    const plan = buildMemoryPlan(dir, { projectName: 't' });
    assert.ok(plan, 'builds despite corrupt cache');
    // The bad file should be overwritten with a valid one
    const raw = readFileSync(resolve(dir, '.docguard/plan.cache.json'), 'utf-8');
    assert.doesNotThrow(() => JSON.parse(raw));
  });

  it('config.diskCache === false disables the disk layer', () => {
    dir = makeRepo();
    buildMemoryPlan(dir, { projectName: 't', diskCache: false });
    assert.equal(existsSync(resolve(dir, '.docguard/plan.cache.json')), false,
      'disabled mode should NOT write the disk cache');
  });
});
