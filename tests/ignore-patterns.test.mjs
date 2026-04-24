import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadIgnorePatterns } from '../cli/shared.mjs';

describe('loadIgnorePatterns', () => {
  it('returns a function that returns false when .docguardignore is missing', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dg-test-missing-'));
    try {
      const isIgnored = loadIgnorePatterns(tmpDir);
      assert.equal(typeof isIgnored, 'function');
      assert.equal(isIgnored('any/file.txt'), false);
      assert.equal(isIgnored('node_modules/pkg/index.js'), false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns a function that returns false when .docguardignore is empty', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dg-test-empty-'));
    try {
      writeFileSync(join(tmpDir, '.docguardignore'), '');
      const isIgnored = loadIgnorePatterns(tmpDir);
      assert.equal(isIgnored('any/file.txt'), false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('ignores comments and blank lines', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dg-test-comments-'));
    try {
      writeFileSync(join(tmpDir, '.docguardignore'), '# This is a comment\n\n  \n# Another one');
      const isIgnored = loadIgnorePatterns(tmpDir);
      assert.equal(isIgnored('any/file.txt'), false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles simple filename patterns', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dg-test-simple-'));
    try {
      writeFileSync(join(tmpDir, '.docguardignore'), 'temp.log\nsecrets');
      const isIgnored = loadIgnorePatterns(tmpDir);

      // Exact match
      assert.equal(isIgnored('temp.log'), true);
      // In subdirectory
      assert.equal(isIgnored('logs/temp.log'), true);
      // Directory match
      assert.equal(isIgnored('secrets/password.txt'), true);
      assert.equal(isIgnored('top/secrets/key.pem'), true);

      // Should NOT match
      assert.equal(isIgnored('not-temp.log'), false);
      assert.equal(isIgnored('temp.log.bak'), false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles glob patterns with *', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dg-test-glob-star-'));
    try {
      writeFileSync(join(tmpDir, '.docguardignore'), '*.tmp\nbuild');
      const isIgnored = loadIgnorePatterns(tmpDir);

      assert.equal(isIgnored('data.tmp'), true);
      assert.equal(isIgnored('subdir/old.tmp'), true);
      assert.equal(isIgnored('build/main.js'), true);
      assert.equal(isIgnored('build/subdir/main.js'), true);

      assert.equal(isIgnored('tmp.data'), false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles deep glob patterns with **', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dg-test-glob-double-star-'));
    try {
      writeFileSync(join(tmpDir, '.docguardignore'), 'logs\ndist');
      const isIgnored = loadIgnorePatterns(tmpDir);

      assert.equal(isIgnored('logs/today.txt'), true);
      assert.equal(isIgnored('src/logs/debug.log'), true);
      assert.equal(isIgnored('dist/bundle.js'), true);
      assert.equal(isIgnored('packages/app/dist/main.js'), true);

      assert.equal(isIgnored('src/main.js'), false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles dots in filenames correctly', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dg-test-dots-'));
    try {
      writeFileSync(join(tmpDir, '.docguardignore'), 'config.js');
      const isIgnored = loadIgnorePatterns(tmpDir);

      assert.equal(isIgnored('config.js'), true);
      // Should not match config-js if dots are escaped correctly
      assert.equal(isIgnored('config-js'), false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
