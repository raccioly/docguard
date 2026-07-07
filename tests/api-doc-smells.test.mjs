/**
 * v0.31.0 feat 4 — API-doc-smells (APS001 Bloated, APS002 Lazy).
 * Deterministic length signals on signature-headed doc units.
 */
import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateApiDocSmells } from '../cli/validators/api-doc-smells.mjs';

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-aps-'));
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(dir, rel), content);
  return dir;
}

describe('validateApiDocSmells', () => {
  let dir;
  after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('flags a Lazy endpoint (documented in name only)', () => {
    dir = repo({
      'docs-canonical/API-REFERENCE.md':
        '# API\n\n#### `GET /api/health`\n\n#### `POST /api/users`\n\nCreates a user. Accepts a JSON body with name and email; returns the new user id and a 201 status on success, 409 on duplicate email.\n',
    });
    const r = validateApiDocSmells(dir, {});
    const lazy = r.findings.filter(f => f.code === 'APS002');
    assert.equal(lazy.length, 1, `expected 1 lazy; got ${JSON.stringify(r.findings.map(f => f.message))}`);
    assert.match(lazy[0].message, /GET \/api\/health/);
    assert.ok(lazy[0].confidence === 'low');
    // the well-documented POST is NOT flagged
    assert.ok(!r.findings.some(f => /POST \/api\/users/.test(f.message)));
  });

  it('flags a Bloated unit (grossly over-documented)', () => {
    const filler = Array.from({ length: 320 }, (_, i) => `word${i}`).join(' ');
    dir = repo({ 'docs-canonical/API-REFERENCE.md': `# API\n\n#### \`getConfig()\`\n\n${filler}\n` });
    const r = validateApiDocSmells(dir, {});
    const bloated = r.findings.filter(f => f.code === 'APS001');
    assert.equal(bloated.length, 1);
    assert.match(bloated[0].message, /getConfig/);
    assert.match(bloated[0].message, /Bloated/);
  });

  it('does NOT flag prose headings with parentheticals (no false positives)', () => {
    dir = repo({
      'docs-canonical/ARCHITECTURE.md':
        '# Arch\n\n## Migration Plan (v0.19 → v0.20)\n\nshort.\n\n## Unit Tests (vitest)\n\nx.\n\n## 4.1 Enrollment (Base Record)\n\ny.\n',
    });
    const r = validateApiDocSmells(dir, {});
    assert.equal(r.findings.length, 0,
      `prose headings with parentheticals must not be treated as API units; got ${JSON.stringify(r.findings.map(f => f.message))}`);
  });

  it('is not applicable without docs-canonical', () => {
    const t = mkdtempSync(join(tmpdir(), 'dg-aps-none-'));
    try { assert.equal(validateApiDocSmells(t, {}).applicable, false); }
    finally { rmSync(t, { recursive: true, force: true }); }
  });
});
