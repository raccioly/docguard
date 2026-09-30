/**
 * Constitution IV — Validator Isolation: a validator never imports another
 * validator. Shared infrastructure lives in shared modules. The rule was
 * written down in 2026-03 and broken by cli/validators/docs-sync.mjs, which
 * imported api-surface.mjs; nothing enforced it until this test.
 *
 * @req docguard.spec-kit-artifact-coverage#FR-007
 * @req docguard.spec-kit-artifact-coverage#SC-004
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve('cli/validators');
// `from './x.mjs'` (static and re-export), `import('./x.mjs')`, and the bare
// side-effect form `import './x.mjs'`, which the first two miss.
const IMPORT_RE = /\bfrom\s+['"](\.\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.\/[^'"]+)['"]\s*\)|\bimport\s+['"](\.\/[^'"]+)['"]/g;
const targets = source => [...source.matchAll(IMPORT_RE)].map(m => (m[1] || m[2] || m[3]).replace(/^\.\//, ''));

describe('validator isolation (Constitution IV)', () => {
  it('no module in cli/validators/ imports a sibling module', () => {
    const siblings = new Set(readdirSync(DIR).filter(f => f.endsWith('.mjs')));
    const offenders = [];
    for (const file of siblings) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      for (const target of targets(source)) {
        if (siblings.has(target)) offenders.push(`${file} → ${target}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('recognizes every relative import form, including a bare side-effect import', () => {
    const source = [
      "import { a } from './a.mjs';",
      "export { b } from './b.mjs';",
      "const c = await import('./c.mjs');",
      "import './d.mjs';",
      "import e from '../shared.mjs';",
    ].join('\n');
    assert.deepEqual(targets(source), ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs']);
  });
});
