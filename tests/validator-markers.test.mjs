/**
 * Inline whole-validator N/A markers — `<!-- docguard:validator <key> n/a — reason -->`.
 *
 * Resolves #8 (visible whole-validator suppression) and #14 (a POC/no-tests
 * project declares testSpec + traceability N/A in-repo instead of fighting the
 * score), and completes the "declare intentional non-applicability, visibly"
 * theme alongside the section-level `docguard:section … n/a` marker.
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadValidatorSuppressions } from '../cli/validator-markers.mjs';
import { runGuardInternal } from '../cli/commands/guard.mjs';

const KEYS = ['structure', 'testSpec', 'traceability', 'security', 'metricsConsistency'];

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-vmarker-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('loadValidatorSuppressions', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('reads a marker with a reason from a canonical doc', () => {
    dir = make({ 'docs-canonical/TEST-SPEC.md': '<!-- docguard:validator testSpec n/a — POC, no tests -->' });
    const { suppressed, unknown } = loadValidatorSuppressions(dir, KEYS);
    assert.equal(suppressed.get('testSpec'), 'POC, no tests');
    assert.equal(unknown.length, 0);
  });

  it('is tolerant of key casing/separators (test-spec, Test_Spec)', () => {
    dir = make({ 'AGENTS.md': '<!-- docguard:validator test-spec n/a — x -->\n<!-- docguard:validator Security n/a -->' });
    const { suppressed } = loadValidatorSuppressions(dir, KEYS);
    assert.ok(suppressed.has('testSpec'), 'test-spec resolves to testSpec');
    assert.ok(suppressed.has('security'), 'Security resolves to security');
    assert.equal(suppressed.get('security'), '', 'reason is optional');
  });

  it('accepts `:` and `--` as the reason separator', () => {
    dir = make({
      'README.md': '<!-- docguard:validator traceability n/a: no formal reqs -->',
      'docs-canonical/X.md': '<!-- docguard:validator structure n/a -- intentional -->',
    });
    const { suppressed } = loadValidatorSuppressions(dir, KEYS);
    assert.equal(suppressed.get('traceability'), 'no formal reqs');
    assert.equal(suppressed.get('structure'), 'intentional');
  });

  it('reports unknown keys instead of silently ignoring them', () => {
    dir = make({ 'docs-canonical/A.md': '<!-- docguard:validator testspce n/a — typo -->' });
    const { suppressed, unknown } = loadValidatorSuppressions(dir, KEYS);
    assert.equal(suppressed.size, 0);
    assert.equal(unknown.length, 1);
    assert.equal(unknown[0].raw, 'testspce');
  });

  it('ignores docs with no markers', () => {
    dir = make({ 'docs-canonical/A.md': '# Just a heading\n\nProse.' });
    const { suppressed, unknown } = loadValidatorSuppressions(dir, KEYS);
    assert.equal(suppressed.size, 0);
    assert.equal(unknown.length, 0);
  });
});

describe('guard integration — a marked validator renders N/A, not pass/skip', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('marks Test-Spec as N/A (status:na) with the reason as the note', () => {
    dir = make({
      'package.json': JSON.stringify({ name: 'poc', version: '1.0.0' }),
      'docs-canonical/TEST-SPEC.md': '# Test Spec\n<!-- docguard:validator testSpec n/a — POC, no automated tests -->',
    });
    const r = runGuardInternal(dir, {});
    const ts = r.validators.find(v => v.key === 'testSpec');
    assert.equal(ts.status, 'na', 'a marked validator is N/A, not a silent skip or fake pass');
    assert.match(ts.note, /declared N\/A: POC, no automated tests/);
  });

  it('a POC can mute testSpec + traceability together (resolves #14)', () => {
    dir = make({
      'package.json': JSON.stringify({ name: 'poc', version: '1.0.0' }),
      'AGENTS.md': '<!-- docguard:validator testSpec n/a — POC -->\n<!-- docguard:validator traceability n/a — POC -->',
    });
    const r = runGuardInternal(dir, {});
    assert.equal(r.validators.find(v => v.key === 'testSpec').status, 'na');
    assert.equal(r.validators.find(v => v.key === 'traceability').status, 'na');
  });

  it('surfaces unknown-key markers as warnings (typo protection)', () => {
    dir = make({
      'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }),
      'docs-canonical/A.md': '<!-- docguard:validator bogusKey n/a — oops -->',
    });
    const r = runGuardInternal(dir, {});
    assert.ok(r.validatorMarkerWarnings.some(w => w.includes('bogusKey')));
  });
});
