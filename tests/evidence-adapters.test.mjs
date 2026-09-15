import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { countEvidenceCollection, readEvidenceSource, resolveJsonPointer } from '../cli/evidence/adapters.mjs';
import { createEvidenceReader } from '../cli/scanners/semantic-claims.mjs';

/**
 * @req docguard.evidence-scoped-verification#FR-003
 * @req docguard.evidence-scoped-verification#FR-004
 * @req docguard.evidence-scoped-verification#SC-001
 */

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-evidence-adapters-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, path, content = '') {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

describe('evidence source primitives', () => {
  it('implements RFC 6901 decoding and strict array indices', () => {
    const source = { 'a/b': { '~key': ['zero', 'one'] }, empty: null };
    assert.deepEqual(resolveJsonPointer(source, '/a~1b/~0key/1'), { found: true, value: 'one' });
    assert.deepEqual(resolveJsonPointer(source, ''), { found: true, value: source });
    assert.equal(resolveJsonPointer(source, '/a~2b').reason, 'invalid-json-pointer-escape');
    assert.equal(resolveJsonPointer(source, '/a~1b/~0key/01').reason, 'invalid-array-index');
    assert.equal(resolveJsonPointer(source, '/missing').reason, 'unresolved-json-pointer');
  });

  it('counts a bounded collection with shared ignores and excludes symlinks', t => {
    const dir = fixture(t);
    write(dir, 'src/a.js');
    write(dir, 'src/b.js');
    write(dir, 'src/skip.test.js');
    write(dir, 'outside/linked.js');
    symlinkSync(join(dir, 'outside/linked.js'), join(dir, 'src/linked.js'));
    write(dir, 'node_modules/noise.js');
    const result = countEvidenceCollection(dir, 'src/*.js', { ignore: ['**/*.test.js'] });
    assert.equal(result.status, 'ok');
    assert.equal(result.value, 2);
  });

  it('distinguishes an absent collection from an unsafe base', t => {
    const dir = fixture(t);
    assert.deepEqual(countEvidenceCollection(dir, 'missing/*.js').value, 0);
    assert.equal(countEvidenceCollection(dir, '../outside/*.js').status, 'inconclusive');
  });

  it('counts a Python literal through the bounded reader and enforces allowEmpty', t => {
    const dir = fixture(t);
    write(dir, 'src/registry.py', 'PLUGINS: list[type[Plugin]] = []\n');
    const declaration = { source: {
      adapter: 'python-literal-count', path: 'src/registry.py', symbol: 'PLUGINS', allowEmpty: false,
    } };
    const blocked = readEvidenceSource(dir, declaration, createEvidenceReader(dir));
    assert.equal(blocked.status, 'inconclusive');
    assert.equal(blocked.reasonCode, 'empty-python-literal-not-allowed');
    assert.equal(blocked.sourceEvidence.path, 'src/registry.py');

    declaration.source.allowEmpty = true;
    const allowed = readEvidenceSource(dir, declaration, createEvidenceReader(dir));
    assert.equal(allowed.status, 'ok');
    assert.equal(allowed.value, 0);

    write(dir, 'outside/registry.py', 'PLUGINS = [Plugin]\n');
    symlinkSync(join(dir, 'outside/registry.py'), join(dir, 'src/linked.py'));
    declaration.source.path = 'src/linked.py';
    const linked = readEvidenceSource(dir, declaration, createEvidenceReader(dir));
    assert.equal(linked.status, 'inconclusive');
    assert.equal(linked.reasonCode, 'source-symlink');
  });
});
