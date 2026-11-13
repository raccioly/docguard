/**
 * Security classification (spec 097, FR-010, as amended during the build):
 *   - value half: a value synthetic by its own text is not reported (it extends
 *     `isSafePlaceholder`; `example` was already covered, `xxx`/`your-` are out);
 *   - path half: SEC001-SEC004 findings carry `context: product | test-path`;
 *     the level never changes, and `isGatingEligible` is false for test-path.
 *
 * @implements docguard.strict-by-default#FR-010
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
// @implements docguard.test-temp-dirs#FR-004: this file's temporary directories come from the helper.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { spawnSync } from 'node:child_process';
import { fixtureGit } from './helpers/git.mjs';

import { validateSecurity, isSyntheticValue, secretContext } from '../cli/validators/security.mjs';
import { isGatingEligible } from '../cli/findings.mjs';
import { toSarif } from '../cli/writers/sarif.mjs';

const CLI = new URL('../cli/docguard.mjs', import.meta.url).pathname;

function put(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

describe('security synthetic values and context', () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDir('docguard-sec-ctx-');
    writeFileSync(join(dir, '.gitignore'), '.env\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const sec = r => r.findings.filter(f => /^SEC00[1-6]$/.test(f.code));

  describe('value half: provably synthetic text is not reported', () => {
    const values = {
      placeholder: 'placeholder-key-1234567890',
      synthetic: 'synthetic-api-key-1234567890',
      'not-a-real': 'this-is-not-a-real-key-value',
      notreal: 'notreal-key-1234567890abc',
      dummy: 'dummy_api_key_1234567890',
      changeme: 'changeme-1234567890abcdef',
      'change-me': 'please-change-me-1234567890',
      'repeated character': '0000000000000000',
      'case-insensitive': 'PLACEHOLDER_KEY_1234567890',
    };
    for (const [name, value] of Object.entries(values)) {
      it(`drops the "${name}" pattern in a source path`, () => {
        put(dir, 'src/config.js', `const apiKey = "${value}";\n`);
        const r = validateSecurity(dir, {});
        assert.deepEqual(sec(r), []);
        assert.deepEqual(r.errors, []);
      });
    }

    it('also drops it in a test path', () => {
      put(dir, 'tests/config.js', 'const apiKey = "dummy_api_key_1234567890";\n');
      assert.deepEqual(sec(validateSecurity(dir, {})), []);
    });

    it('still finds a real secret below a placeholder of the same kind', () => {
      put(dir, 'src/config.js', 'const apiKey = "placeholder-key-1234567890";\nconst apiKey2 = "k8Jd93kfLQ0Zp2Wm7xR41abc";\n');
      put(dir, 'src/real.js', 'const apiKey = "k8Jd93kfLQ0Zp2Wm7xR41abc";\n');
      assert.equal(validateSecurity(dir, {}).errors.length, 1);
    });

    it('does not clear a provider-signature key by text (existing rule kept)', () => {
      put(dir, 'src/billing.js', 'const s = "sk_test_dummydummydummydummydummy";\n');
      assert.equal(sec(validateSecurity(dir, {}))[0].severity, 'error');
    });

    it('leaves `xxx` and `your-` values reported (not in the list)', () => {
      put(dir, 'src/a.js', 'const apiKey = "xxx-k8Jd93kfLQ0Zp2Wm7xR41";\n');
      put(dir, 'src/b.js', 'const apiKey = "your-api-key-goes-here-123";\n');
      assert.equal(validateSecurity(dir, {}).errors.length, 2);
    });

    it('isSyntheticValue: the list', () => {
      for (const v of ['placeholder', 'MyPlaceholderKey', 'synthetic-not-a-real-key', 'not-a-real-key', 'notreal', 'dummy', 'dummykey123', 'DUMMY_KEY', 'changeme', 'ChangeMe', 'change-me', 'change_me', 'aaaaaaaaaaaaaaaa', '************']) {
        assert.equal(isSyntheticValue(v), true, v);
      }
      for (const v of ['demo1234', 'k8Jd93kfLQ0Zp2Wm7xR41abc', 'Tr0ub4dor&3xyz', '', 'xxx-k8Jd93kfLQ0', 'your-key']) {
        assert.equal(isSyntheticValue(v), false, v);
      }
    });

    it('JUDGMENT: a word buried in a high-entropy run is not synthetic', () => {
      for (const v of ['Zp2Wm7xdummyR41k8Jd93kfLQ0', 'q9w8placeholderE7r6', 'k8Jd93kfLQ0changemeZp2Wm7', 'a1B2syntheticD4e5F6g7H8']) {
        assert.equal(isSyntheticValue(v), false, v);
      }
    });

    it('JUDGMENT, end to end: a real-looking key with a buried word keeps its error', () => {
      put(dir, 'src/config.js', 'const apiKey = "Zp2Wm7xdummyR41k8Jd93kfLQ0";\n');
      assert.equal(sec(validateSecurity(dir, {}))[0].severity, 'error');
    });
  });

  describe('path half: context, never a level change', () => {
    const testPaths = ['tests/helpers/auth.js', 'src/__tests__/auth.js', 'e2e/login.spec.ts', 'src/auth.test.js', 'fixtures/users.js', 'src/__mocks__/auth.js', 'examples/demo/auth.js'];
    for (const rel of testPaths) {
      it(`${rel}: context test-path, level unchanged (error)`, () => {
        put(dir, rel, 'const password = "Tr0ub4dor&3xyz";\n');
        const r = validateSecurity(dir, {});
        const [f] = sec(r);
        assert.equal(f.severity, 'error');
        assert.equal(f.confidence, 'high');
        assert.equal(f.context, 'test-path');
        assert.equal(isGatingEligible(f), false);
        assert.equal(r.errors.length, 1);
      });
    }

    it('message text is unchanged, so baseline fingerprints do not move', () => {
      put(dir, 'tests/a.js', 'const password = "Tr0ub4dor&3xyz";\n');
      assert.equal(sec(validateSecurity(dir, {}))[0].message, 'tests/a.js:1: possible hardcoded password found');
    });

    it('labels every SEC001-SEC004 finding, including low-confidence ones', () => {
      put(dir, 'tests/creds.js', [
        'const password = "Tr0ub4dor&3xyz";',
        'const apiKey = "k8Jd93kfLQ0Zp2Wm7xR41abc";',
        'const secretKey = "q1w2e3r4t5y6u7i8o9p0abcd";',
        'const accessToken = "z9y8x7w6v5u4t3s2r1q0abcd";',
      ].join('\n'));
      put(dir, 'src/prose.js', 'const password = "New password must differ from recent ones";\n');
      const found = sec(validateSecurity(dir, {}));
      assert.equal(found.length, 5);
      for (const f of found) assert.ok(['product', 'test-path'].includes(f.context), f.code);
      assert.equal(found.find(f => f.location.startsWith('src/prose')).context, 'product');
    });

    it('SEC005 and SEC006 carry no context', () => {
      put(dir, 'src/k.js', 'const a = "AKIAIOSFODNN7REALKEY";\nconst s = "sk_live_12345678901234567890";\n');
      for (const f of sec(validateSecurity(dir, {}))) assert.equal(f.context, undefined);
    });

    it('is not test-path when the project includes non-product paths', () => {
      put(dir, 'tests/auth.js', 'const password = "Tr0ub4dor&3xyz";\n');
      assert.equal(sec(validateSecurity(dir, { detection: { includeNonProduct: true } }))[0].context, 'product');
    });

    it('secretContext reuses isNonProductPath and the existing test-file names', () => {
      assert.equal(secretContext('src/a.test.ts'), 'test-path');
      assert.equal(secretContext('src/service.ts'), 'product');
      assert.equal(secretContext('scripts/setup.mjs'), 'product');
    });
  });

  describe('controls: demo credentials in non-test source keep their level', () => {
    it('setup script', () => {
      put(dir, 'scripts/setup.mjs', "const user = { email: 'demo@acme.test', password: 'demo1234' };\n");
      const [f] = sec(validateSecurity(dir, {}));
      assert.equal(f.severity, 'error');
      assert.equal(f.context, 'product');
      assert.equal(isGatingEligible(f), true);
    });
    it('login page prefill', () => {
      put(dir, 'app/login/page.tsx', "export const prefill = { email: 'demo@acme.test', password: 'demo1234' };\n");
      const [f] = sec(validateSecurity(dir, {}));
      assert.equal(f.severity, 'error');
      assert.equal(f.context, 'product');
    });
    it('a real-looking key in a source file', () => {
      put(dir, 'src/config.js', 'const apiKey = "k8Jd93kfLQ0Zp2Wm7xR41abcdEf";\n');
      const [f] = sec(validateSecurity(dir, {}));
      assert.equal(f.severity, 'error');
      assert.equal(f.context, 'product');
    });
  });

  describe('isGatingEligible', () => {
    it('is false only for test-path', () => {
      assert.equal(isGatingEligible({ context: 'test-path' }), false);
      assert.equal(isGatingEligible({ context: 'product' }), true);
      assert.equal(isGatingEligible({}), true);
      assert.equal(isGatingEligible(undefined), true);
    });
  });

  describe('output formats carry the context', () => {
    function project() {
      put(dir, 'tests/auth.js', 'const password = "Tr0ub4dor&3xyz";\n');
      put(dir, 'src/config.js', 'const apiKey = "k8Jd93kfLQ0Zp2Wm7xR41abcdEf";\n');
      writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'x', validators: { security: true } }));
      fixtureGit(dir, ['init', '-q']);
    }
    const run = fmt => spawnSync(process.execPath, [CLI, 'guard', '--format', fmt], { cwd: dir, encoding: 'utf-8' });

    it('--format json', () => {
      project();
      const f = JSON.parse(run('json').stdout).findings.filter(x => x.validator === 'security' && x.code.startsWith('SEC00'));
      assert.deepEqual(f.map(x => x.context).sort(), ['product', 'test-path']);
      assert.ok(f.every(x => x.severity === 'error'));
    });
    it('--format sarif: properties.context', () => {
      project();
      const r = JSON.parse(run('sarif').stdout).runs[0].results.filter(x => /^SEC00/.test(x.ruleId));
      assert.deepEqual(r.map(x => x.properties.context).sort(), ['product', 'test-path']);
    });
    it('toSarif omits properties.context when absent', () => {
      const s = toSarif({ findings: [{ code: 'SEC005', severity: 'error', message: 'x', location: 'a.js:1' }], validators: [] });
      assert.equal('context' in s.runs[0].results[0].properties, false);
    });
    it('--format junit: the context is in the finding body', () => {
      project();
      const xml = run('junit').stdout;
      assert.match(xml, /\[SEC001\][^\n]*\[context: test-path\]/);
      assert.match(xml, /\[SEC002\][^\n]*\[context: product\]/);
    });
  });
});

import { CONTEXT_EVIDENCE, evidenceForContext, evidenceForCode } from '../cli/precision-evidence.mjs';
import { CODES } from '../cli/findings.mjs';
import { existsSync } from 'node:fs';

describe('precision-evidence rows by context', () => {
  it('has a product and a test-path row for each of SEC001-SEC004, shape only', () => {
    for (const code of ['SEC001', 'SEC002', 'SEC003', 'SEC004']) {
      assert.ok(CODES[code]);
      for (const context of ['product', 'test-path']) {
        const row = evidenceForContext(code, context);
        assert.equal(row.status, 'not-measured');
        assert.equal(row.gatingEligible, context === 'product');
        assert.ok(row.cases.length > 0);
        assert.equal(JSON.stringify(row).match(/precision"|\d\.\d/), null, 'no invented number');
        for (const c of row.cases) assert.ok(existsSync(new URL(`../${c.split(':')[0]}`, import.meta.url)), c);
      }
    }
    assert.equal(Object.keys(CONTEXT_EVIDENCE).length, 8);
    assert.equal(evidenceForContext('SEC005', 'product'), null);
  });
  it('never alters the per-code evidence', () => {
    assert.equal(evidenceForCode('SEC001').status, 'measured');
  });
});
