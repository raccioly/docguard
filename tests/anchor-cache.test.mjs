import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { contentSha, openAnchorCache } from '../cli/scanners/anchor-cache.mjs';
import { STATE_DIR } from '../cli/writers/state-dir.mjs';

describe('anchor-cache', () => {
  it('contentSha produces a correct hex digest', () => {
    assert.equal(contentSha('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('openAnchorCache handles cache misses, writes, and reads', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'docguard-anchor-cache-'));
    try {
      execFileSync('git', ['init', tmp]);

      const identity = 'test-id';
      let cache = openAnchorCache(tmp, { identity });
      assert.equal(cache.enabled, true);
      assert.equal(cache.reason, null);
      assert.equal(cache.get('file.mjs', '626f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f'), undefined);

      cache.set('file.mjs', '626f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f', 'value1');
      cache.save();

      const cache2 = openAnchorCache(tmp, { identity });
      assert.equal(cache2.get('file.mjs', '626f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f'), 'value1');
      assert.equal(cache2.get('file.mjs', '626f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f'.replace('f', 'e')), undefined);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('openAnchorCache disables on --no-cache', () => {
    const cache = openAnchorCache('.', { noCache: true });
    assert.equal(cache.enabled, false);
    assert.equal(cache.reason, 'disabled by --no-cache');
  });

  it('openAnchorCache disables in CI', () => {
    const cache = openAnchorCache('.', { env: { CI: 'true' } });
    assert.equal(cache.enabled, false);
    assert.equal(cache.reason, 'disabled in CI');
  });

  it('openAnchorCache disables when git tracks files in STATE_DIR', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'docguard-anchor-cache-tracked-'));
    try {
      execFileSync('git', ['init', tmp]);
      mkdirSync(join(tmp, STATE_DIR), { recursive: true });
      writeFileSync(join(tmp, STATE_DIR, 'foo.txt'), 'bar');
      execFileSync('git', ['add', join(tmp, STATE_DIR, 'foo.txt')], { cwd: tmp });

      const cache = openAnchorCache(tmp, { identity: 'test-id' });
      assert.equal(cache.enabled, false);
      assert.ok(cache.reason.includes('git tracks'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
