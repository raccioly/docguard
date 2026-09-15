// @req docguard.adoption-workflow-integrity#FR-011
// @req docs-canonical/REQUIREMENTS.md#FR-014
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { countPythonLiteralEntries, PYTHON_LITERAL_LIMITS } from '../cli/evidence/python-literal.mjs';
import { readEvidenceSource } from '../cli/evidence/adapters.mjs';
import { createEvidenceReader } from '../cli/scanners/semantic-claims.mjs';

/**
 * @req docguard.evidence-scoped-verification#FR-002
 * @req docguard.evidence-scoped-verification#FR-004
 * @req docguard.evidence-scoped-verification#SC-001
 */

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-python-literal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, path, content) {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

describe('Python literal count evidence', () => {
  it('counts list, annotated tuple, set, and dictionary entries without inspecting values', () => {
    const cases = [
      ['SCANNERS = [HeadersScanner(), TLSScanner()]', 2],
      ['SCANNERS: tuple[type[Scanner], ...] = (HeadersScanner, TLSScanner,)', 2],
      ['SCANNERS = {HeadersScanner, TLSScanner}', 2],
      ['SCANNERS = {"headers": HeadersScanner, "tls": TLSScanner}', 2],
      ['SCANNERS = []', 0],
      ['\uFEFFSCANNERS = [HeadersScanner()]', 1],
    ];
    for (const [source, expected] of cases) {
      const actual = countPythonLiteralEntries(source, 'SCANNERS');
      assert.equal(actual.status, 'ok', actual.message);
      assert.equal(actual.value, expected);
    }
  });

  it('treats comments and prefixed, escaped, and triple-quoted strings as opaque syntax', () => {
    const source = String.raw`SCANNERS = [
    r"comma, bracket ]",
    f'''triple, {not_evaluated}''',
    "escaped \", still one",
    # ignored, comment
    Factory({"nested": [1, 2]}),
]`;
    const actual = countPythonLiteralEntries(source, 'SCANNERS');
    assert.equal(actual.status, 'ok', actual.message);
    assert.equal(actual.value, 4);
  });

  it('rejects dynamic or ambiguous outer-container syntax', () => {
    const cases = [
      ['SCANNERS = [item for item in items]', 'python-dynamic-literal'],
      ['SCANNERS = [*CORE, Extra]', 'python-unpacked-literal'],
      ['SCANNERS = {**CORE, "extra": Extra}', 'python-unpacked-literal'],
      ['SCANNERS = CORE + OPTIONAL', 'python-nonliteral-assignment'],
      ['SCANNERS = [A] + [B]', 'python-trailing-expression'],
      ['SCANNERS = [A] if enabled else []', 'python-trailing-expression'],
      ['SCANNERS = A, B', 'python-nonliteral-assignment'],
      ['SCANNERS = (A)', 'python-not-tuple-literal'],
      ['SCANNERS += [A]', 'python-augmented-assignment'],
    ];
    for (const [source, reasonCode] of cases) {
      const actual = countPythonLiteralEntries(source, 'SCANNERS');
      assert.notEqual(actual.status, 'ok', source);
      assert.equal(actual.reasonCode, reasonCode, source);
    }
  });

  it('requires exactly one direct module-level assignment', () => {
    assert.equal(countPythonLiteralEntries('if enabled:\n    SCANNERS = [A]\n', 'SCANNERS').reasonCode, 'python-symbol-unassigned');
    assert.equal(countPythonLiteralEntries('SCANNERS = [A]\nSCANNERS = [B]\n', 'SCANNERS').reasonCode, 'python-symbol-ambiguous');
    assert.equal(countPythonLiteralEntries('SCANNERS[0] = A\n', 'SCANNERS').reasonCode, 'python-assignment-target');
    const nestedNeighbor = countPythonLiteralEntries('def configure():\n    SCANNERS = [Wrong]\nSCANNERS = [A, B]\n', 'SCANNERS');
    assert.equal(nestedNeighbor.status, 'ok');
    assert.equal(nestedNeighbor.value, 2);
  });

  it('fails closed when explicit parser budgets are exceeded', () => {
    const deep = `SCANNERS = ${'['.repeat(PYTHON_LITERAL_LIMITS.nesting + 1)}A${']'.repeat(PYTHON_LITERAL_LIMITS.nesting + 1)}`;
    assert.equal(countPythonLiteralEntries(deep, 'SCANNERS').reasonCode, 'python-nesting-budget');
    const many = `SCANNERS = [${Array(PYTHON_LITERAL_LIMITS.entries + 1).fill('A').join(',')}]`;
    assert.equal(countPythonLiteralEntries(many, 'SCANNERS').reasonCode, 'python-entry-budget');
    const huge = `#${'x'.repeat(PYTHON_LITERAL_LIMITS.sourceCharacters)}\nSCANNERS = []`;
    assert.equal(countPythonLiteralEntries(huge, 'SCANNERS').reasonCode, 'python-source-budget');
    const tokenHeavy = `${'x\n'.repeat(PYTHON_LITERAL_LIMITS.tokens)}SCANNERS = []`;
    assert.equal(countPythonLiteralEntries(tokenHeavy, 'SCANNERS').reasonCode, 'python-token-budget');
  });

  it('reads through the safe evidence reader and never executes malicious Python', t => {
    const dir = fixture(t);
    const marker = join(dir, 'executed.txt');
    write(dir, 'src/scanners.py', [
      'from pathlib import Path',
      `Path(${JSON.stringify(marker)}).write_text("executed")`,
      'SCANNERS = [HeadersScanner(), TLSScanner()]',
    ].join('\n'));
    const declaration = {
      source: { adapter: 'python-literal-count', path: 'src/scanners.py', symbol: 'SCANNERS', allowEmpty: false },
    };
    const actual = readEvidenceSource(dir, declaration, createEvidenceReader(dir));
    assert.equal(actual.status, 'ok', actual.message);
    assert.equal(actual.value, 2);
    assert.equal(readFileSync(new URL('../cli/evidence/python-literal.mjs', import.meta.url), 'utf8').includes('node:child_process'), false);
    assert.throws(() => readFileSync(marker, 'utf8'), { code: 'ENOENT' });
  });
});
