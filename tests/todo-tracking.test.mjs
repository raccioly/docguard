import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateTodoTracking } from '../cli/validators/todo-tracking.mjs';

describe('Todo-Tracking Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-todo-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles empty project gracefully', () => {
    const result = validateTodoTracking(tmpDir, {});
    assert.deepEqual(result, { errors: [], warnings: [], passed: 1, total: 1 });
  });

  it('warns about skipped test without explanation', () => {
    writeFileSync(join(tmpDir, 'test1.test.mjs'), `
      import { test } from 'node:test';
      test.skip('skipped test', () => {});
    `);

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /Skipped test without explanation/);
  });

  it('passes skipped test with explanation', () => {
    writeFileSync(join(tmpDir, 'test2.test.mjs'), `
      import { test } from 'node:test';
      // REASON: waiting for upstream fix
      test.skip('skipped test', () => {});
    `);

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.length, 0);
    assert.equal(result.passed, 3);
  });

  it('warns about untracked TODOs', () => {
    writeFileSync(join(tmpDir, 'index.mjs'), `
      // TODO: need to refactor this function
      function myFunc() {}
    `);

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /Untracked TODO at index.mjs/);
  });

  it('passes when TODO is tracked in a roadmap', () => {
    writeFileSync(join(tmpDir, 'index.mjs'), `
      // TODO: need to refactor this function heavily for performance reasons
      function myFunc() {}
    `);

    writeFileSync(join(tmpDir, 'ROADMAP.md'), `
      Here is the roadmap:
      - need to refactor this function heavily for performance reasons
    `);

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.length, 0);
  });
});
