/**
 * Tests for `.docguardignore` — the gitignore-style exclusions file.
 *
 * @req SC-K3-001 — .docguardignore is read at config load time
 * @req SC-K3-002 — patterns from .docguardignore merge into config.ignore
 * @req SC-K3-003 — patterns from both .docguard.json and .docguardignore are deduped
 * @req SC-K3-004 — missing file is a no-op
 * @req SC-K3-005 — comments and blank lines are skipped
 * @req FR-013 — Shared ignore utility module provides consistent glob matching
 *   across all validators. Covered by the loader + merger tests below.
 * @req FR-014 — Constitution Principle IV (shared infrastructure encouraged) is
 *   exemplified by these tests — they exercise the shared utility from
 *   `cli/shared-ignore.mjs` that v0.11.x extracted.
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadDocguardIgnore,
  mergeIgnoreFile,
  shouldIgnore,
} from '../cli/shared-ignore.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-ignorefile-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('.docguardignore — loader', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('returns [] when file is missing', () => {
    dir = make({ 'package.json': '{}' });
    assert.deepEqual(loadDocguardIgnore(dir), []);
  });

  it('parses simple patterns, one per line', () => {
    dir = make({
      'package.json': '{}',
      '.docguardignore': 'build/\nvendor/legacy.ts\n**/*.snap\n',
    });
    assert.deepEqual(
      loadDocguardIgnore(dir).sort(),
      ['**/*.snap', 'build/', 'vendor/legacy.ts'].sort()
    );
  });

  it('skips comments and blank lines', () => {
    dir = make({
      'package.json': '{}',
      '.docguardignore': [
        '# top comment',
        '',
        'build/',
        '   # indented comment',
        '',
        'dist/',
        '',
      ].join('\n'),
    });
    assert.deepEqual(loadDocguardIgnore(dir).sort(), ['build/', 'dist/']);
  });

  it('trims whitespace per line', () => {
    dir = make({
      'package.json': '{}',
      '.docguardignore': '  build/  \n\tdist/\t\n',
    });
    assert.deepEqual(loadDocguardIgnore(dir).sort(), ['build/', 'dist/']);
  });
});

describe('.docguardignore — merge into config.ignore', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('appends .docguardignore patterns to an empty config', () => {
    dir = make({ '.docguardignore': 'build/\nvendor/\n' });
    const config = { ignore: [] };
    mergeIgnoreFile(dir, config);
    assert.deepEqual(config.ignore.sort(), ['build/', 'vendor/']);
  });

  it('merges with existing config.ignore, deduping', () => {
    dir = make({ '.docguardignore': 'build/\nvendor/\n' });
    const config = { ignore: ['build/', 'docs/'] };  // build/ overlap
    mergeIgnoreFile(dir, config);
    assert.deepEqual(config.ignore.sort(), ['build/', 'docs/', 'vendor/']);
  });

  it('is idempotent — second call adds nothing new', () => {
    dir = make({ '.docguardignore': 'build/\n' });
    const config = { ignore: [] };
    mergeIgnoreFile(dir, config);
    mergeIgnoreFile(dir, config);
    assert.deepEqual(config.ignore, ['build/']);
  });

  it('handles config without an ignore array', () => {
    dir = make({ '.docguardignore': 'build/\n' });
    const config = {};
    mergeIgnoreFile(dir, config);
    assert.deepEqual(config.ignore, ['build/']);
  });

  it('no-op when .docguardignore is missing', () => {
    dir = make({ 'package.json': '{}' });
    const config = { ignore: ['docs/'] };
    mergeIgnoreFile(dir, config);
    assert.deepEqual(config.ignore, ['docs/']);
  });
});

describe('.docguardignore — end-to-end: shouldIgnore honors merged patterns', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('a path matching a .docguardignore glob is ignored', () => {
    dir = make({ '.docguardignore': '**/__generated__/**\n' });
    const config = {};
    mergeIgnoreFile(dir, config);
    assert.equal(shouldIgnore('src/__generated__/types.ts', config), true);
    assert.equal(shouldIgnore('src/manual/types.ts', config), false);
  });

  it('a path matching a .docguard.json ignore is still ignored after merge', () => {
    dir = make({ '.docguardignore': '**/__generated__/**\n' });
    const config = { ignore: ['vendor/**'] };
    mergeIgnoreFile(dir, config);
    assert.equal(shouldIgnore('vendor/legacy.ts', config), true);
    assert.equal(shouldIgnore('src/__generated__/x.ts', config), true);
    assert.equal(shouldIgnore('src/main.ts', config), false);
  });
});
