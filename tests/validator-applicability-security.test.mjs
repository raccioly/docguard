/**
 * Security under the spec 097 result contract: it applies to a project that has
 * source or configuration files it scans, it reports how many it scanned, and a
 * run that scanned nothing says why and which setting to change.
 *
 * Security cannot end `empty` through the verdict, because a run that scanned
 * nothing already carries the SEC011 warning; the cause therefore lives in
 * `applies.evidence` and in the SEC011 suggestion, and no `emptyCause` is set
 * (the contract forbids one on a result that found something).
 *
 * @implements docguard.strict-by-default#FR-004
 * @implements docguard.strict-by-default#FR-005
 * @implements docguard.strict-by-default#FR-006
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
// @implements docguard.test-temp-dirs#FR-001: this file's temporary directories come from the helper.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';


import { validateSecurity, applies } from '../cli/validators/security.mjs';
import { validateResultContract } from '../cli/validator-coverage.mjs';

function put(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}
const withKey = result => ({ key: 'security', ...result });

describe('security result contract', () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDir('docguard-sec-contract-');
    writeFileSync(join(dir, '.gitignore'), '.env\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('does not apply: a project with no source or configuration file it scans', () => {
    put(dir, 'README.md', '# Notes\n');
    put(dir, 'data/table.csv', 'a,b\n');
    const a = applies(dir, {});
    assert.equal(a.applies, false);
    assert.match(a.evidence, /no file with a scanned extension/);
    const r = validateSecurity(dir, {});
    assert.deepEqual(validateResultContract(withKey(r)), []);
    assert.equal(r.performed, 0);
    assert.equal(r.applies.applies, false);
    assert.equal(r.emptyCause, undefined);
    const sec011 = r.findings.find(f => f.code === 'SEC011');
    assert.ok(sec011, 'the existing SEC011 warning is unchanged');
    assert.match(sec011.suggestion.text, /no .* file|nothing to scan/i);
  });

  it('applies and scanned nothing: securityIgnore excludes every candidate, and the text names it', () => {
    put(dir, 'src/a.js', 'export const x = 1;\n');
    put(dir, 'src/b.py', 'x = 1\n');
    const config = { securityIgnore: ['src/**'] };
    const a = applies(dir, config);
    assert.equal(a.applies, true);
    assert.match(a.evidence, /securityIgnore/);
    const r = validateSecurity(dir, config);
    assert.deepEqual(validateResultContract(withKey(r)), []);
    assert.equal(r.performed, 0);
    assert.equal(r.applies.applies, true);
    assert.match(r.applies.evidence, /2 candidate file\(s\).*securityIgnore/);
    const sec011 = r.findings.find(f => f.code === 'SEC011');
    assert.match(sec011.suggestion.text, /securityIgnore/);
  });

  it('applies and scanned nothing: the global ignore excludes every candidate, and the text names it', () => {
    put(dir, 'src/a.js', 'export const x = 1;\n');
    const config = { ignore: ['src/**'] };
    const r = validateSecurity(dir, config);
    assert.deepEqual(validateResultContract(withKey(r)), []);
    assert.equal(r.performed, 0);
    assert.match(r.applies.evidence, /ignore|\.docguardignore/);
    assert.match(r.findings.find(f => f.code === 'SEC011').suggestion.text, /ignore.*\.docguardignore|\.docguardignore/);
  });

  it('the fix applied: a scannable file is scanned, performed counts files, no cause', () => {
    put(dir, 'src/a.js', 'export const x = 1;\n');
    put(dir, 'src/b.py', 'x = 1\n');
    put(dir, 'tests/c.js', 'export const y = 2;\n');
    const r = validateSecurity(dir, { securityIgnore: ['tests/**'] });
    assert.deepEqual(validateResultContract(withKey(r)), []);
    assert.equal(r.performed, 2, 'two files scanned; the excluded one is not counted');
    assert.equal(r.applies.applies, true);
    assert.match(r.applies.evidence, /scanned 2 file/);
    assert.equal(r.emptyCause, undefined);
    assert.equal(r.findings.some(f => f.code === 'SEC011'), false);
  });

  it('a result with findings still carries the contract', () => {
    put(dir, 'src/a.js', 'const password = "Tr0ub4dor&3xyz";\n');
    const r = validateSecurity(dir, {});
    assert.deepEqual(validateResultContract(withKey(r)), []);
    assert.equal(r.performed, 1);
  });

  it('standard behavior is unchanged: total, passed and every finding level', () => {
    put(dir, 'src/a.js', 'export const x = 1;\n');
    const r = validateSecurity(dir, {});
    assert.equal(r.total, 2);
    assert.equal(r.passed, 2);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    const none = makeTempDir('docguard-sec-none-');
    try {
      writeFileSync(join(none, '.gitignore'), '.env\n');
      const e = validateSecurity(none, {});
      assert.equal(e.total, 1, 'only the .gitignore check: the secret scan did not count');
      assert.equal(e.passed, 1);
      assert.equal(e.warnings.length, 1);
      assert.match(e.warnings[0], /^No source files were scanned for secrets/);
    } finally { rmSync(none, { recursive: true, force: true }); }
  });
});
