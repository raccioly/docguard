/**
 * @req SC-006 — TODOs documented in ROADMAP.md (or any tracking doc) with
 *   their file location are recognized as tracked. The "passes skipped test
 *   with explanation" test and the broader checkUntrackedTodos pipeline
 *   exercise the tracking-source matching (ROADMAP / TODO-LOG / similar).
 */
// @req docguard.adoption-workflow-integrity#FR-015
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { validateTodoTracking } from '../cli/validators/todo-tracking.mjs';
import { CODES } from '../cli/findings.mjs';
import { loadConfig } from '../cli/config.mjs';

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

// ── docguard.todo-quoted-forms (spec 073): a keyword quoted in backticks or
// held in a string is not an annotation, and the result does not depend on
// where DocGuard is installed. Each acceptance scenario has a case here; the
// spec 019 cases above run unchanged, and the real-annotation cases below are
// the unit-scale half of the cross-repository A/B.
// @req docguard.todo-quoted-forms#SC-001
// @req docguard.todo-quoted-forms#SC-003
describe('Todo-Tracking — quoted forms are not annotations (spec 073)', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const VALIDATOR = 'cli/validators/todo-tracking.mjs';
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-todo-quoted-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const write = (name, lines) => {
    mkdirSync(dirname(join(tmpDir, name)), { recursive: true });
    writeFileSync(join(tmpDir, name), Array.isArray(lines) ? lines.join('\n') + '\n' : lines);
  };
  const tdo002 = (dir = tmpDir, config = {}) =>
    (validateTodoTracking(dir, config).findings || []).filter(f => f.code === 'TDO002');
  const locations = findings => findings.map(f => f.location).sort();

  // @req docguard.todo-quoted-forms#FR-001
  it('does not report annotation forms quoted in backticks (US1.1, US1.2)', () => {
    write('style.mjs', [
      '// Accepted: `TODO: …`, `HACK - …`, `TEMP(ana) …`, `FIXME(bo): …`.',
      '// `TODO(ana): …` used to be reported as "ana): …".',
      '// ``TODO: x`` is quoted with a double-backtick span.',
      '// `TODO`: fix the parser',
      'export const style = 1;',
    ]);
    assert.deepEqual(locations(tdo002()), []);
  });

  // @req docguard.todo-quoted-forms#FR-001
  // @req docguard.todo-quoted-forms#FR-006
  it('still reports real annotations beside quoted ones (US1.3, US1.4)', () => {
    write('real.mjs', [
      '// TODO: fix retries',
      '// TODO fix retries later',
      '// a stray ` then TODO: still an annotation',
      '// ``TODO: y` is not a closed span',
    ]);
    assert.deepEqual(locations(tdo002()), ['real.mjs:1', 'real.mjs:2', 'real.mjs:3', 'real.mjs:4']);
  });

  // @req docguard.todo-quoted-forms#FR-002
  it('reports the first keyword outside spans with the original text (US1.5, US1.6)', () => {
    write('text.mjs', [
      '// TODO: rename `foo` later',
      '// see `HACK - x`; FIXME: real',
      '// HACK: `setTimeout(0)`',
    ]);
    const messages = tdo002().map(f => f.message).sort();
    assert.equal(messages.length, 3, messages.join('\n'));
    assert.match(messages[0], /^Untracked FIXME at text\.mjs:2: "real"/);
    assert.match(messages[1], /^Untracked HACK at text\.mjs:3: "`setTimeout\(0\)`"/);
    assert.match(messages[2], /^Untracked TODO at text\.mjs:1: "rename `foo` later"/);
  });

  // @req docguard.todo-quoted-forms#FR-003
  it('does not report keywords inside strings, templates or regexes (US2.1, US2.2)', () => {
    write('strings.mjs', [
      "const a = '// TODO: not a comment';",
      'const u = "https://example.com/HACK: x";',
      'const t = `# FIXME: fixture text`;',
      'const r = /\\/\\/ XXX: in a regex/;',
      '// TODO: real one',
    ]);
    assert.deepEqual(locations(tdo002()), ['strings.mjs:5']);
  });

  // @req docguard.todo-quoted-forms#FR-003
  it('reads Python and Go strings as strings (US2.3)', () => {
    write('app.py', ['x = "# TODO: s"', '# TODO: real python', 'def f(): pass']);
    write('main.go', ['package main', '', 'var s = "// TODO: s"', '', '// TODO: real go', 'func f() {}']);
    assert.deepEqual(locations(tdo002()), ['app.py:2', 'main.go:5']);
  });

  // @req docguard.todo-quoted-forms#FR-003
  it('falls back to the string-aware lexer when JavaScript does not parse', () => {
    write('broken.js', ["const s = '// TODO: in a string';", 'function (', '// TODO: real']);
    assert.deepEqual(locations(tdo002()), ['broken.js:3']);
  });

  // @req docguard.todo-quoted-forms#FR-004
  it('reports each line of a block comment at its own line (US2.4)', () => {
    write('block.mjs', [
      '/*',
      ' * first',
      ' * TODO: investigate',
      ' */',
      '/**',
      ' * Something.',
      ' *',
      ' * FIXME(bo): later',
      ' */',
      'export function f() {}',
    ]);
    assert.deepEqual(locations(tdo002()), ['block.mjs:3', 'block.mjs:8']);
  });

  // @req docguard.todo-quoted-forms#FR-003
  it('scans languages without a comment reader by line, code spans masked (US2.5)', () => {
    write('comp.vue', [
      '<template>',
      '  <!-- TODO: wire the button -->',
      '  <!-- see `HACK - x` -->',
      '</template>',
      '<script>',
      '// FIXME: real',
      '</script>',
    ]);
    assert.deepEqual(locations(tdo002()), ['comp.vue:2', 'comp.vue:6']);
  });

  // @req docguard.todo-quoted-forms#FR-005
  it("scans a copy of the validator's own source like any file (US3.2)", () => {
    const source = readFileSync(join(ROOT, VALIDATOR), 'utf8');
    write(VALIDATOR, source + '// TODO: appended real annotation\n');
    const appended = source.split('\n').length;
    assert.deepEqual(locations(tdo002()), [`${VALIDATOR}:${appended}`]);
  });

  // @req docguard.todo-quoted-forms#FR-005
  it('reports the same for the validator scanned in place and as a copy (US3.1)', () => {
    write(VALIDATOR, readFileSync(join(ROOT, VALIDATOR), 'utf8'));
    const inPlace = tdo002(ROOT, { changedFiles: [VALIDATOR] }).filter(f => f.location?.startsWith(VALIDATOR));
    assert.deepEqual(locations(inPlace), locations(tdo002()));
    // The only way a module can recognise its own file is its own URL.
    assert.doesNotMatch(readFileSync(join(ROOT, VALIDATOR), 'utf8'), /import\.meta\.url|fileURLToPath|__filename/);
  });

  // The two TDO002 that 0.44.3 reported here, run from npm, were quotations.
  // @req docguard.todo-quoted-forms#SC-002
  it("reports no TDO002 on this repository's own tree, the validator included", () => {
    assert.deepEqual(tdo002(ROOT, loadConfig(ROOT)).map(f => f.message), []);
  });

  // @req docguard.todo-quoted-forms#FR-007
  it('says in the TDO002 help that quotations are not annotations', () => {
    assert.match(CODES.TDO002.help, /Only real comments count: a keyword inside a string, or quoted in backticks within a comment, is a quotation/);
  });
});
