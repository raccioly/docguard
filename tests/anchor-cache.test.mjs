/**
 * Anchor cache units (Jules test-gaps #599; spec 080 SC-004).
 *
 * @req docguard.consumer-report-precision#SC-004
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { contentSha, openAnchorCache } from '../cli/scanners/anchor-cache.mjs';
import { STATE_DIR } from '../cli/writers/state-dir.mjs';
import { fixtureGit } from './helpers/git.mjs';

// The cache turns itself off when CI is set, which it is on every CI runner, so
// tests that need it enabled pass an explicit environment instead of the process's.
const LOCAL = {};
const SHA = '626f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f';

describe('anchor-cache', () => {
  it('contentSha produces a correct hex digest', () => {
    assert.equal(contentSha('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('openAnchorCache handles cache misses, writes, and reads', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'docguard-anchor-cache-'));
    try {
      fixtureGit(tmp, ['init', '-q', '-b', 'main']);

      const identity = 'test-id';
      const cache = openAnchorCache(tmp, { identity, env: LOCAL });
      assert.equal(cache.enabled, true);
      assert.equal(cache.reason, null);
      assert.equal(cache.get('file.mjs', SHA), undefined);

      cache.set('file.mjs', SHA, 'value1');
      cache.save();

      const cache2 = openAnchorCache(tmp, { identity, env: LOCAL });
      assert.equal(cache2.get('file.mjs', SHA), 'value1');
      assert.equal(cache2.get('file.mjs', SHA.replace('f', 'e')), undefined);
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
      fixtureGit(tmp, ['init', '-q', '-b', 'main']);
      mkdirSync(join(tmp, STATE_DIR), { recursive: true });
      writeFileSync(join(tmp, STATE_DIR, 'foo.txt'), 'bar');
      fixtureGit(tmp, ['add', join(STATE_DIR, 'foo.txt')]);

      const cache = openAnchorCache(tmp, { identity: 'test-id', env: LOCAL });
      assert.equal(cache.enabled, false);
      assert.ok(cache.reason.includes('git tracks'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
