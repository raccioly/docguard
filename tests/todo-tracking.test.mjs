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

  it('does not match TODO inside a regex literal (false-positive guard)', () => {
    // The validator's own TODO_PATTERN regex contains the literal keyword
    // "TODO" inside a regex. Before the fix this matched as a real TODO.
    // Verifies fix for: TODO keywords outside comments are not flagged.
    writeFileSync(join(tmpDir, 'mock-validator.mjs'), `
      // Real comment unrelated to TODOs
      const KEYWORD_RE = /\\b(TODO|FIXME|HACK)\\s*[(:]/;
      const TEMP_RE = /TEMP(?!late|orar)\\s*[(:]/;
      function check(line) { return KEYWORD_RE.test(line); }
    `);

    const result = validateTodoTracking(tmpDir, {});
    // Zero TODO warnings — none of the keywords above are inside comments
    const todoWarnings = result.warnings.filter(w => /Untracked (TODO|FIXME|HACK|TEMP|XXX|WORKAROUND)/.test(w));
    assert.equal(todoWarnings.length, 0,
      `Expected no false-positive TODOs from regex source, got: ${JSON.stringify(todoWarnings)}`);
  });

  it('still matches TODOs in block comments and continuation lines', () => {
    writeFileSync(join(tmpDir, 'block.mjs'), `
      /*
       * TODO: investigate the legacy caching path
       */
      function legacy() {}
    `);

    const result = validateTodoTracking(tmpDir, {});
    const todoWarnings = result.warnings.filter(w => /Untracked TODO at block.mjs/.test(w));
    assert.equal(todoWarnings.length, 1,
      `Expected 1 TODO warning from block comment, got: ${JSON.stringify(result.warnings)}`);
  });

  it('matches TODOs in Python-style # comments', () => {
    writeFileSync(join(tmpDir, 'app.py'), `
      # TODO: handle the new auth flow
      def login(): pass
    `);

    const result = validateTodoTracking(tmpDir, {});
    const todoWarnings = result.warnings.filter(w => /Untracked TODO at app.py/.test(w));
    assert.equal(todoWarnings.length, 1,
      `Expected 1 TODO warning from # comment, got: ${JSON.stringify(result.warnings)}`);
  });
});
