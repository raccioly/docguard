/**
 * shared-test-cases.mjs — the declared-test-case counter behind MET003.
 *
 * The count is a LOWER BOUND of what a runner reports, so every case here is
 * about not over-counting: a `re.test(x)` call, an `it(` spelled out inside a
 * string literal, and a comment must contribute nothing, while every framework
 * the file finder recognises contributes exactly its declared cases.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { findTestFiles, countDeclaredTestCases, countJsCasesByRegex } from '../cli/shared-test-cases.mjs';
import { astTierAvailable } from '../cli/scanners/js-ast.mjs';

describe('declared test-case counter', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'docguard-test-cases-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const put = (rel, content) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };

  it('finds JS/TS, Python and Go test files and skips everything else', () => {
    put('tests/a.test.mjs', '');
    put('tests/b.spec.ts', '');
    put('tests/test_models.py', '');
    put('tests/models_test.py', '');
    put('tests/handler_test.go', '');
    put('tests/helper.mjs', '');          // not a test file
    put('tests/fixtures/README.md', '');
    put('src/__tests__/c.js', '');
    put('src/util.test.tsx', '');
    const names = findTestFiles(dir).map(f => f.slice(dir.length + 1)).sort();
    assert.deepEqual(names, [
      'src/__tests__/c.js', 'src/util.test.tsx',
      'tests/a.test.mjs', 'tests/b.spec.ts', 'tests/handler_test.go',
      'tests/models_test.py', 'tests/test_models.py',
    ]);
  });

  it('counts it()/test() and their .only/.skip/.todo forms, and nothing that only looks like one', () => {
    put('tests/a.test.mjs', [
      "import { describe, it, test } from 'node:test';",
      "describe('x', () => {",
      "  it('one', () => {});",
      "  it.skip('two', () => {});",
      "  test.only('three', () => {});",
      "  test.todo('four');",
      "  const re = /\\.(test|spec)\\./; re.test('a.test.js');",       // regex .test( — not a case
      "  const fixture = \"it('inside a string', () => {})\";",          // string literal — not a case
      "  // it('in a comment', () => {})",                                // comment — not a case
      "  writeFixture(`test('in a template', () => {})`);",              // template literal — not a case
      "});",
    ].join('\n'));
    const { files, cases, parserTier } = countDeclaredTestCases(findTestFiles(dir));
    assert.equal(files, 1);
    if (astTierAvailable()) {
      assert.equal(cases, 4, 'AST tier: exactly the four declared cases');
      assert.equal(parserTier, 'js-ast');
    } else {
      assert.ok(cases <= 4, 'regex tier may under-count but never over-count');
      assert.equal(parserTier, 'regex-fallback');
    }
  });

  it('counts Python def test_ and Go func Test declarations', () => {
    put('tests/test_models.py', [
      'import pytest',
      'def test_one():\n    assert True',
      'async def test_two():\n    assert True',
      'def helper():\n    pass',
      '@pytest.mark.parametrize("x", [1, 2, 3])\ndef test_three(x):\n    assert x',   // expands at runtime: counts once
    ].join('\n'));
    put('tests/handler_test.go', [
      'package handler',
      'func TestOne(t *testing.T) {}',
      'func TestTwo(t *testing.T) { t.Run("sub", func(t *testing.T) {}) }',   // subtest not counted
      'func helper() {}',
    ].join('\n'));
    const { files, cases, parserTier } = countDeclaredTestCases(findTestFiles(dir));
    assert.equal(files, 2);
    assert.equal(cases, 5);
    assert.equal(parserTier, 'regex-fallback');
  });

  it('regex fallback never counts a member call or an inline literal', () => {
    const src = [
      "it('a', () => {});",
      "  test.skip('b', () => {});",
      "const ok = re.test(value); it('c', () => {});",   // `re.test(` skipped, `; it(` counted
      "log(\"it('not a case')\");",                       // literal after `(\"`: skipped
      "expect(x).toBe(y); test.each(rows)('d', () => {});", // `.each` is not a recognised modifier: missed (lower bound)
    ].join('\n');
    assert.equal(countJsCasesByRegex(src), 3);
  });

  it('counts DocGuard\'s own suite with the AST tier', () => {
    // Measured 2026-09-22: 1,721 declared against 2,085 reported by node:test —
    // loops in hooks-contract, docs-coverage-scope, ci-reproducibility and
    // others generate cases a static count cannot see. The runner's number is
    // not available here without running the suite, so only the floor is pinned.
    const own = countDeclaredTestCases(findTestFiles(process.cwd()));
    assert.ok(own.files >= 190, `expected the repo's own test files; got ${own.files}`);
    assert.ok(own.cases > 1000, `expected the repo's declared cases; got ${own.cases}`);
    assert.equal(own.parserTier, astTierAvailable() ? 'js-ast' : 'regex-fallback');
  });
});
