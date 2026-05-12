import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateTodoTracking } from '../cli/validators/todo-tracking.mjs';

describe('Todo-Tracking Ignore Logic', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'todo-ignore-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('respects config.ignore', () => {
    // Create a file with TODO that should be ignored
    mkdirSync(join(tmpDir, 'ignored-dir'), { recursive: true });
    writeFileSync(join(tmpDir, 'ignored-dir', 'file.js'), '// TODO: tracked in nothing');

    // Create a file with TODO that should NOT be ignored
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'app.js'), '// TODO: also untracked');

    const config = {
      ignore: ['ignored-dir/**']
    };

    const results = validateTodoTracking(tmpDir, config);

    // It should find only 1 untracked TODO (src/app.js)
    const untrackedTodos = results.warnings.filter(w => w.includes('Untracked TODO'));
    assert.strictEqual(untrackedTodos.length, 1, 'Should find exactly 1 untracked TODO');
    assert.ok(untrackedTodos[0].includes('src/app.js'), 'Should be from src/app.js');
  });

  it('respects config.todoIgnore', () => {
    writeFileSync(join(tmpDir, 'todo-ignored.js'), '// TODO: ignore me');
    writeFileSync(join(tmpDir, 'src-file.js'), '// TODO: dont ignore me');

    const config = {
      todoIgnore: ['todo-ignored.js']
    };

    const results = validateTodoTracking(tmpDir, config);

    const untrackedTodos = results.warnings.filter(w => w.includes('Untracked TODO'));
    assert.strictEqual(untrackedTodos.length, 1);
    assert.ok(untrackedTodos[0].includes('src-file.js'));
  });

  it('respects .docguardignore (EXPECTED TO FAIL CURRENTLY)', () => {
    writeFileSync(join(tmpDir, '.docguardignore'), 'ignored-by-file.js\n');
    writeFileSync(join(tmpDir, 'ignored-by-file.js'), '// TODO: file ignore');
    writeFileSync(join(tmpDir, 'normal.js'), '// TODO: normal');

    const config = {};
    const results = validateTodoTracking(tmpDir, config);

    const untrackedTodos = results.warnings.filter(w => w.includes('Untracked TODO'));
    // If it doesn't respect .docguardignore, it will find 2
    // If it does, it will find 1
    assert.strictEqual(untrackedTodos.length, 1, 'Should respect .docguardignore');
    assert.ok(untrackedTodos[0].includes('normal.js'));
  });

  it('skips ignored directories entirely (EXPECTED TO FAIL CURRENTLY)', () => {
    mkdirSync(join(tmpDir, 'large-ignored-dir'), { recursive: true });
    // This file would be matched by SOURCE_EXTENSIONS and TODO_PATTERN
    writeFileSync(join(tmpDir, 'large-ignored-dir', 'very-large-file.js'), '// TODO: hidden\n'.repeat(1000));

    const config = {
      ignore: ['large-ignored-dir/**']
    };

    const results = validateTodoTracking(tmpDir, config);

    const untrackedTodos = results.warnings.filter(w => w.includes('Untracked TODO'));
    assert.strictEqual(untrackedTodos.length, 0);

    // We can't easily measure "traversal" here without mocking,
    // but we can check if it respects the ignore even if it traverses.
    // The main goal is to ensure it doesn't show up in results.
  });
});
