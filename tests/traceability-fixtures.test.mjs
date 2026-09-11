import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateTraceability } from '../cli/validators/traceability.mjs';

describe('Traceability declarations versus fixture data', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dg-trace-fixtures-'));
    mkdirSync(join(dir, 'docs-canonical'));
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'REQUIREMENTS.md'), 'REQ-900 documented control\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const scan = (config = {}) => validateTraceability(dir, config);
  const writeTest = (name, content) => writeFileSync(join(dir, 'tests', name), content);
  const requirementFindings = result => result.findings.filter(f => /^TRC00[45]$/.test(f.code));

  for (const name of ['speckit-bugfix.test.mjs', 'speckit-phantom.test.mjs', 'traceability-ir.test.mjs']) {
    it(`does not turn the real ${name} fixtures into declarations`, () => {
      writeTest(name, readFileSync(new URL(name, import.meta.url), 'utf8'));
      const findings = requirementFindings(scan());
      assert.deepEqual(findings.map(f => f.code), ['TRC004']);
      assert.match(findings[0].message, /REQ-900/);
    });
  }

  it('does not use fixture strings, regexes, assertions or prose as coverage', () => {
    writeTest('fixture.test.mjs', [
      'const data = "REQ-900";',
      'const source = `// @req REQ-900\n- [x] T001 fixture\ntest("REQ-900", () => {});`;',
      'const pattern = /REQ-900/;',
      'assert.equal(data, "REQ-900");',
      '// A test that never annotates @req REQ-900.',
    ].join('\n'));
    assert.deepEqual(requirementFindings(scan()).map(f => f.code), ['TRC004']);
  });

  it('retains high-confidence orphan annotations with physical line locations', () => {
    writeTest('explicit.test.mjs', [
      'const fixture = "// @req REQ-901";',
      '// @req REQ-900',
      '/*',
      ' * @req REQ-901',
      ' * @task T001',
      ' */',
      'test("ordinary test", () => {}); // @covers REQ-902',
    ].join('\n'));
    const result = scan();
    assert.equal(result.passed, 1);
    const findings = requirementFindings(result);
    assert.equal(findings.length, 3);
    for (const [index, line] of [4, 5, 7].entries()) {
      assert.equal(findings[index].code, 'TRC005');
      assert.equal(findings[index].confidence, 'high');
      assert.equal(findings[index].location, `tests/explicit.test.mjs:${line}`);
    }
  });

  for (const label of [
    'test("REQ-900 verifies behavior", () => {});',
    'it.only(\n "REQ-900 verifies behavior", () => {});',
    'describe("REQ-900 suite", () => {});',
    't.test(`REQ-900 verifies behavior`, () => {});',
  ]) {
    it(`recognizes a real label: ${label.split('(')[0]}`, () => {
      writeTest('label.test.mjs', label);
      assert.deepEqual(requirementFindings(scan()), []);
      assert.equal(scan().passed, 1);
    });
  }

  for (const [name, source] of [
    ['test_app.py', 'fixture = """\n# @req REQ-901\n"""\n# @req REQ-900\ndef test_app(): pass'],
    ['app_test.go', 'package app\n// @req REQ-900\nfunc TestApp() {}'],
    ['app.rs', '// @req REQ-900\n#[test]\nfn works() {}'],
    ['AppTest.java', '/**\n * @req REQ-900\n */\nclass AppTest {}'],
    ['AppSpec.kt', '// @req REQ-900\nclass AppSpec {}'],
    ['app_spec.rb', 'fixture = "# @req REQ-901"\n# @req REQ-900\nit "works" do\nend'],
    ['AppTest.php', '<?php\n# @req REQ-900\nfunction testApp() {}'],
    ['labels_test.go', 'package app\nfunc TestApp(t *testing.T) { t.Run("REQ-900", func(t *testing.T) {}) }'],
    ['labels_spec.rb', 'it "REQ-900 works" do\nend'],
    ['LabelsTest.java', '@DisplayName("REQ-900 works")\nclass LabelsTest {}'],
  ]) {
    it(`preserves multilingual declarations in ${name}`, () => {
      writeTest(name, source);
      const result = scan();
      assert.deepEqual(requirementFindings(result), []);
      assert.equal(result.passed, 1);
    });
  }

  it('preserves configurable requirement patterns and document paths', () => {
    writeFileSync(join(dir, 'custom.md'), 'CUSTOM:alpha documented\n');
    writeTest('custom.test.mjs', '// @req CUSTOM:alpha\n// @req CUSTOM:missing\nconst data = "CUSTOM:fixture";');
    const result = scan({ traceability: { requirementDocs: ['custom.md'], requirementPattern: 'CUSTOM:[a-z]+' } });
    assert.equal(result.passed, 1);
    assert.equal(result.total, 2);
    const findings = requirementFindings(result);
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /CUSTOM:missing/);
  });

  it('keeps scanning when JS parsing fails without treating fixtures as annotations', () => {
    writeTest('broken.test.mjs', 'const broken = ;\nconst fixture = `// @req REQ-901`;\n// @req REQ-900');
    const result = scan();
    assert.deepEqual(requirementFindings(result), []);
    assert.equal(result.passed, 1);
  });
});
