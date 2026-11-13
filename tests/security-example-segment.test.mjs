/**
 * Issue #655: the word `example` exempts a secret-shaped value only as a whole
 * segment (split on separators and camelCase boundaries) or at the start of the
 * value, the same rule FR-010 applies to `placeholder`, `synthetic`, `dummy` and
 * `changeme`. A substring inside an unbroken high-entropy run no longer hides it.
 *
 * @implements docguard.strict-by-default#FR-010
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateSecurity, isSyntheticValue } from '../cli/validators/security.mjs';

const EXEMPT = [
  'EXAMPLE_API_KEY', 'my-example-token', 'exampleSecret123',
  'example_api_key_1234567890', 'Example-Key-1234567890', 'EXAMPLEKEY1234567890',
  'myExampleKey1234567890', 'MY_EXAMPLE_KEY_1234', 'my_key_1234_example',
  'k8Jd93kfLQ0-example', 'k8Jd93kfLQ0_EXAMPLE',
];
const REPORTED = [
  'k8Jd93kfLQ0exampleZp2Wm7xR41abc', 'k8Jd93kfLQ0EXAMPLEZp2Wm7xR41abc',
  'k8Jd93kfLQ0ExAmPlEZp2Wm7xR41abc', 'k8Jd93kfLQ0Zp2Wm7xR41example',
];

describe('"example" is exempt only as a whole segment (#655)', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-sec-example-'));
    writeFileSync(join(dir, '.gitignore'), '.env\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const scan = value => {
    mkdirSync(dirname(join(dir, 'src/a.js')), { recursive: true });
    writeFileSync(join(dir, 'src/a.js'), `const apiKey = "${value}";\n`);
    return validateSecurity(dir, {}).findings.filter(f => /^SEC00[1-6]$/.test(f.code));
  };

  for (const v of EXEMPT) {
    it(`stays exempt: ${v}`, () => {
      assert.equal(isSyntheticValue(v), true);
      assert.deepEqual(scan(v), []);
    });
  }
  for (const v of REPORTED) {
    it(`is reported: ${v}`, () => {
      assert.equal(isSyntheticValue(v), false);
      const f = scan(v);
      assert.equal(f.length, 1);
      assert.equal(f[0].code, 'SEC002');
    });
  }

  it('AKIAIOSFODNN7EXAMPLE keeps its exact-match exception', () => {
    writeFileSync(join(dir, 'a.js'), 'const k = "AKIAIOSFODNN7EXAMPLE";\n');
    assert.deepEqual(validateSecurity(dir, {}).findings.filter(f => /^SEC00/.test(f.code)), []);
  });

  it('a different AKIA key containing EXAMPLE is still reported', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/a.js'), 'const k = "AKIAABCDEFGHEXAMPLE12";\n');
    assert.equal(validateSecurity(dir, {}).findings.filter(f => /^SEC00/.test(f.code)).length, 1);
  });

  it('password123 is unchanged', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/a.js'), 'const password = "password123";\n');
    assert.deepEqual(validateSecurity(dir, {}).findings.filter(f => /^SEC00/.test(f.code)), []);
  });
});
