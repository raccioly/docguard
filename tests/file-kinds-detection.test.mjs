/**
 * What spec 100's case-insensitive vocabulary does to detection: the context
 * Security records for a secret-shaped literal, and which directories route
 * detection still reads. `corpus` and `golden` are instruction-copy words
 * only: a product package can carry either name.
 *
 * @req docguard.file-kinds#FR-006
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { makeTempDir } from './helpers/temp-dir.mjs';
import { secretContext, validateSecurity } from '../cli/validators/security.mjs';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';

const SECRET = 'const apiKey = "k8Jd93kfLQ0Zp2Wm7xR41abcDEFg9Qw";\nexport default apiKey;\n';
const write = (dir, rel, body) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };

/** Context recorded per directory, from a project with one secret-shaped literal in `<dir>/config.js`. */
function contexts(t, dirs) {
  const root = makeTempDir('dg-kinds-sec-', t);
  for (const d of dirs) write(root, `${d}/config.js`, SECRET);
  const out = {};
  for (const f of validateSecurity(root, { securityChecks: true, validators: { security: true } }).findings) {
    if (f.code === 'SEC002') out[String(f.location).replace(/\/config\.js:\d+$/, '')] = f.context ?? f.evidence?.context;
  }
  return out;
}

describe('Security context for a secret-shaped literal (SEC001 to SEC004)', () => {
  it('lowercase directories: unchanged from main, corpus and golden stay product', t => {
    assert.deepEqual(contexts(t, ['src', 'tests', 'examples', 'fixtures', '__mocks__', 'corpus', 'golden']), {
      src: 'product', tests: 'test-path', examples: 'test-path', fixtures: 'test-path', __mocks__: 'test-path', corpus: 'product', golden: 'product',
    });
  });

  it('capitalized directories are test-path now (they were product on main)', t => {
    assert.deepEqual(contexts(t, ['Examples', 'Fixtures', 'Tests', '__Mocks__', 'Corpus', 'Golden']), {
      Examples: 'test-path', Fixtures: 'test-path', Tests: 'test-path', __Mocks__: 'test-path', Corpus: 'product', Golden: 'product',
    });
  });

  it('secretContext follows isNonProductPath', () => {
    assert.equal(secretContext('Examples/a.js'), 'test-path');
    assert.equal(secretContext('corpus/a.js'), 'product');
    assert.equal(secretContext('src/a.js'), 'product');
  });
});

describe('route detection', () => {
  const routes = (t, dirs) => {
    const root = makeTempDir('dg-kinds-routes-', t);
    write(root, 'package.json', '{"name":"x","dependencies":{"express":"4.18.0"}}');
    for (const d of dirs) write(root, `src/${d}/app.js`, `const express = require('express');\nconst app = express();\napp.get('/api/${d}-items', (req, res) => res.json([]));\n`);
    return scanRoutesDeep(root, { framework: 'Express' }, {}, { config: {} }).map(r => r.file).sort();
  };

  it('a capitalized Examples/ drops out of detection like examples/; corpus and golden stay product', t => {
    assert.deepEqual(routes(t, ['Examples', 'Tests', 'Corpus', 'golden', 'api']), ['src/Corpus/app.js', 'src/api/app.js', 'src/golden/app.js']);
  });
});
