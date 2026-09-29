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
const IMPORT_RE = /\bfrom\s+['"](\.\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;

describe('validator isolation (Constitution IV)', () => {
  it('no module in cli/validators/ imports a sibling module', () => {
    const siblings = new Set(readdirSync(DIR).filter(f => f.endsWith('.mjs')));
    const offenders = [];
    for (const file of siblings) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      for (const m of source.matchAll(IMPORT_RE)) {
        const target = (m[1] || m[2]).replace(/^\.\//, '');
        if (siblings.has(target)) offenders.push(`${file} → ${target}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
