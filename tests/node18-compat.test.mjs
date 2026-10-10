/**
 * DocGuard supports Node 18 (package.json engines; CI runs 18, 20, 22, 24).
 * `import.meta.dirname` / `import.meta.filename` exist only from Node 20.11,
 * so a use of either breaks Node 18 at runtime. Spec 058's test did exactly
 * that and failed CI on Node 18.
 *
 * @req docguard.js-framework-routes#SC-002
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const files = dir => readdirSync(join(ROOT, dir)).flatMap(name => {
  const rel = join(dir, name);
  if (statSync(join(ROOT, rel)).isDirectory()) return name === 'node_modules' || name === 'fixtures' ? [] : files(rel);
  return /\.(mjs|cjs|js)$/.test(name) ? [rel] : [];
});

describe('the code runs on Node 18 (engines >=18)', () => {
  it('no source, tool or test uses import.meta.dirname or import.meta.filename', () => {
    const offenders = ['cli', 'tools', 'tests', '.github/scripts', 'benchmarks']
      .flatMap(files)
      .filter(rel => rel !== join('tests', 'node18-compat.test.mjs'))
      .filter(rel => /import\.meta\.(dirname|filename)\b/.test(readFileSync(join(ROOT, rel), 'utf8')));
    assert.deepEqual(offenders, []);
  });
});
