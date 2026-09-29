/**
 * @req SC-006 — TODOs documented in ROADMAP.md (or any tracking doc) with
 *   their file location are recognized as tracked. The "passes skipped test
 *   with explanation" test and the broader checkUntrackedTodos pipeline
 *   exercise the tracking-source matching (ROADMAP / TODO-LOG / similar).
 */
// @req docguard.adoption-workflow-integrity#FR-015
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
    // REASON: string concat hides the skip token from the outer scanner.
    // Without this, TODO-Tracking would scan this very file and flag the
    // line as an untracked skipped test. Same class as the v0.15.1 fixture issue.
    const SKIP = 's' + 'kip';
    writeFileSync(join(tmpDir, 'test1.test.mjs'), `
      import { test } from 'node:test';
      test.${SKIP}('skipped test', () => {});
    `);

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /Skipped test without explanation/);
  });

  it('passes skipped test with explanation', () => {
    const SKIP = 's' + 'kip';
    writeFileSync(join(tmpDir, 'test2.test.mjs'), `
      import { test } from 'node:test';
      // REASON: waiting for upstream fix
      test.${SKIP}('skipped test', () => {});
    `);

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.length, 0);
    assert.equal(result.passed, 3);
  });

  it('accepts a contiguous multiline REASON comment block', () => {
    const SKIP = 's' + 'kip';
    writeFileSync(join(tmpDir, 'multiline.test.mjs'), [
      '// REASON:',
      '// The platform reports a transient unsupported state while',
      '// the upstream compatibility fix is pending.',
      `test.${SKIP}('compatibility case', () => {});`,
    ].join('\n'));

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.length, 0);
  });

  it('retains a multiline REASON block disconnected by a blank line', () => {
    const SKIP = 's' + 'kip';
    writeFileSync(join(tmpDir, 'disconnected.test.mjs'), [
      '// REASON:',
      '// Waiting for the upstream compatibility fix.',
      '',
      `test.${SKIP}('compatibility case', () => {});`,
    ].join('\n'));

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.filter(w => /Skipped test without explanation/.test(w)).length, 1);
  });

  it('retains a multiline REASON block disconnected by code', () => {
    const SKIP = 's' + 'kip';
    writeFileSync(join(tmpDir, 'intervening-code.test.mjs'), [
      '// REASON:',
      '// Waiting for the upstream compatibility fix.',
      'prepareFixture();',
      `test.${SKIP}('compatibility case', () => {});`,
    ].join('\n'));

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.filter(w => /Skipped test without explanation/.test(w)).length, 1);
  });

  it('retains an empty multiline REASON header', () => {
    const SKIP = 's' + 'kip';
    writeFileSync(join(tmpDir, 'empty-reason.test.mjs'), [
      '// REASON:',
      '//   ',
      `test.${SKIP}('compatibility case', () => {});`,
    ].join('\n'));

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.filter(w => /Skipped test without explanation/.test(w)).length, 1);
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

  it('TODO in a Python test file (test_*.py) is excluded from source TODOs', () => {
    writeFileSync(join(tmpDir, 'test_app.py'), `
      # TODO: fix this test
      def test_foo(): pass
    `);

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.length, 0, 'Should not flag TODO in a Python test file');
  });

  it('TODO in a Go test file (*_test.go) is excluded from source TODOs', () => {
    writeFileSync(join(tmpDir, 'app_test.go'), `
      // TODO: fix this test
      func TestFoo(t *testing.T) {}
    `);

    const result = validateTodoTracking(tmpDir, {});
    assert.equal(result.warnings.length, 0, 'Should not flag TODO in a Go test file');
  });

  // ── docguard.ignore-and-todo-parsing — PR #453's cases (Jules), kept, plus
  // the precision negatives that PR's bare-word matching would have broken.
  // @req docguard.ignore-and-todo-parsing#FR-002
  // @req docguard.ignore-and-todo-parsing#FR-003
  // @req docguard.ignore-and-todo-parsing#FR-004
  // @req docguard.ignore-and-todo-parsing#FR-005
  // @req docguard.ignore-and-todo-parsing#SC-003
  const untracked = (name, source) => {
    writeFileSync(join(tmpDir, name), source);
    return validateTodoTracking(tmpDir, {}).warnings.filter(w => /Untracked/.test(w));
  };

  it('strips the author from TODO(user): text (PR #453)', () => {
    const w = untracked('todo-user.mjs', '// TODO(user): need to refactor this function\nfunction f() {}\n');
    assert.equal(w.length, 1);
    assert.match(w[0], /need to refactor this function/);
    assert.doesNotMatch(w[0], /user\)/);
  });

  it('matches TODO(user) without a colon (PR #453)', () => {
    const w = untracked('todo-user2.mjs', '// TODO(user) need to refactor this function\nfunction f() {}\n');
    assert.equal(w.length, 1);
    assert.match(w[0], /need to refactor this function/);
  });

  it('matches bare TODO and FIXME followed by text (PR #453)', () => {
    assert.equal(untracked('todo-bare.mjs', '// TODO fix this function\n').length, 1);
    // tmpDir accumulates files: the second scan sees both.
    assert.equal(untracked('fixme-bare.mjs', '// FIXME fix this function\n').length, 2);
  });

  it('does not match TEMPLATE (PR #453)', () => {
    assert.equal(untracked('todo-template.mjs', '// TEMPLATE is here\n').length, 0);
  });

  it('does not treat ordinary words HACK, XXX, TEMP or WORKAROUND as annotations', () => {
    const w = untracked('prose.mjs', [
      '// TEMP directory path for the build',
      '// no HACK needed here',
      '// XXX marks the spot',
      '// the WORKAROUND below is documented',
      '// XXX-large sizes are rare',
    ].join('\n') + '\n');
    assert.equal(w.length, 0, w.join('\n'));
  });

  // Both were false findings on DocGuard's own code during this change.
  it('does not treat a placeholder or a keyword list as an annotation', () => {
    const w = untracked('lists.mjs', [
      "console.log('The document should have NO <!-- TODO --> or <!-- e.g. --> placeholders.');",
      "const help = 'Add a `// REASON:` comment (SKIP/NOTE/WHY/TODO/FIXME prefixes also count).';",
      '// see the TODO list in the tracker',
    ].join('\n') + '\n');
    assert.equal(w.length, 0, w.join('\n'));
  });

  it('still matches HACK/XXX/TEMP/WORKAROUND with a separator or author', () => {
    const w = untracked('marked.mjs', ['// HACK: retry twice', '// XXX - revisit', '// TEMP(ana) remove after v2', '// WORKAROUND: vendor bug'].join('\n') + '\n');
    assert.equal(w.length, 4, w.join('\n'));
  });
});
