import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServedRoots } from '../cli/commands/mcp.mjs';

describe('buildServedRoots', () => {
  it('builds roots from a single project directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-test-roots-'));
    try {
      const result = buildServedRoots(dir);
      assert.equal(result.dir, dir);
      assert.equal(result.realDir, realpathSync.native(dir));
      assert.equal(result.roots.length, 1);
      assert.equal(result.roots[0], realpathSync.native(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds roots from project directory and extra roots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-test-roots-'));
    const extra1 = mkdtempSync(join(tmpdir(), 'docguard-test-extra1-'));
    const extra2 = mkdtempSync(join(tmpdir(), 'docguard-test-extra2-'));
    try {
      const result = buildServedRoots(dir, [extra1, extra2]);
      assert.equal(result.dir, dir);
      assert.equal(result.roots.length, 3);
      assert.ok(result.roots.includes(realpathSync.native(dir)));
      assert.ok(result.roots.includes(realpathSync.native(extra1)));
      assert.ok(result.roots.includes(realpathSync.native(extra2)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(extra1, { recursive: true, force: true });
      rmSync(extra2, { recursive: true, force: true });
    }
  });

  it('throws an error if an extra root does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-test-roots-'));
    const nonExistent = join(dir, 'does-not-exist');
    try {
      assert.throws(() => {
        buildServedRoots(dir, [nonExistent]);
      }, /--root does not exist/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws an error if an extra root is not a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-test-roots-'));
    const file = join(dir, 'file.txt');
    writeFileSync(file, 'content');
    try {
      assert.throws(() => {
        buildServedRoots(dir, [file]);
      }, /--root is not a directory/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deduplicates roots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-test-roots-'));
    const extra = mkdtempSync(join(tmpdir(), 'docguard-test-extra-'));
    try {
      const result = buildServedRoots(dir, [extra, extra, dir]);
      assert.equal(result.roots.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(extra, { recursive: true, force: true });
    }
  });
});
