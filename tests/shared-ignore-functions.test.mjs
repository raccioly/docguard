import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isNonProductDir,
  isNonProductPath,
  walkFiles
} from '../cli/shared-ignore.mjs';

test('isNonProductDir identifies detection ignore dirs correctly', (t) => {
  assert.strictEqual(isNonProductDir('tests'), true);
  assert.strictEqual(isNonProductDir('src'), false);
  assert.strictEqual(isNonProductDir('examples'), true);

  // Honours config override
  assert.strictEqual(
    isNonProductDir('tests', { detection: { includeNonProduct: true } }),
    false
  );
});

test('isNonProductPath handles deep paths correctly', (t) => {
  assert.strictEqual(isNonProductPath('src/tests/helper.js'), true);
  assert.strictEqual(isNonProductPath('src/components/button.jsx'), false);
  assert.strictEqual(isNonProductPath('examples/basic/index.js'), true);

  // Honours config override
  assert.strictEqual(
    isNonProductPath('src/tests/helper.js', { detection: { includeNonProduct: true } }),
    false
  );

  // Handles undefined/empty
  assert.strictEqual(isNonProductPath(null), false);
  assert.strictEqual(isNonProductPath(''), false);
});

test('walkFiles recursively visits files and respects options', (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-walkfiles-'));

  mkdirSync(join(tmpDir, 'src'));
  writeFileSync(join(tmpDir, 'src', 'index.js'), 'console.log("hello");');

  mkdirSync(join(tmpDir, '.hidden'));
  writeFileSync(join(tmpDir, '.hidden', 'config.json'), '{}');

  mkdirSync(join(tmpDir, 'node_modules'));
  writeFileSync(join(tmpDir, 'node_modules', 'pkg.js'), '');

  const visited = [];
  const complete = walkFiles(tmpDir, (file) => visited.push(file));

  assert.strictEqual(complete, true);
  // Default ignores node_modules but .hidden depends on skipDotEntries
  assert.strictEqual(visited.length, 1);
  assert.ok(visited[0].endsWith('index.js'));

  // Test keeping dot entries conditionally
  const visitedKeepDot = [];
  walkFiles(tmpDir, (file) => visitedKeepDot.push(file), {
    keepDot: (entry) => entry === '.hidden' || entry === 'config.json'
  });

  assert.strictEqual(visitedKeepDot.length, 2);
  assert.ok(visitedKeepDot.some(f => f.endsWith('index.js')));
  assert.ok(visitedKeepDot.some(f => f.endsWith('config.json')));

  rmSync(tmpDir, { recursive: true, force: true });
});
