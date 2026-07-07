import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateReferenceExistence } from '../cli/validators/reference-existence.mjs';

function git(dir, ...args) { spawnSync('git', args, { cwd: dir, encoding: 'utf-8' }); }

describe('validateReferenceExistence', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dg-ref-'));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@t.co'); git(dir, 'config', 'user.name', 'T');
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'docs-canonical'));
    // Commit 1: code defines validateToken + getUserById; doc references both.
    writeFileSync(join(dir, 'src', 'auth.ts'),
      'export function validateToken(t){}\nexport function getUserById(id){}\n');
    writeFileSync(join(dir, 'docs-canonical', 'API-REFERENCE.md'),
      '# API\nUse `validateToken` and `getUserById`. The `token` is a string.\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'c1');
    // The doc is FROZEN at c1 (not touched again). Now remove validateToken.
    writeFileSync(join(dir, 'src', 'auth.ts'),
      'export function verifyToken(t){}\nexport function getUserById(id){}\n');
    git(dir, 'add', 'src/auth.ts'); git(dir, 'commit', '-qm', 'c2 rename validateToken');
  });
  after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('flags a ref that existed at doc-time but is gone at HEAD', () => {
    const r = validateReferenceExistence(dir, {});
    assert.equal(r.applicable, true);
    const ref = r.findings.filter(f => f.code === 'REF001');
    assert.ok(ref.some(f => /validateToken/.test(f.message)), `expected validateToken flagged; got ${JSON.stringify(ref.map(f=>f.message))}`);
    assert.ok(ref.every(f => f.confidence === 'low'));
  });

  it('does NOT flag a ref that still exists (getUserById)', () => {
    const r = validateReferenceExistence(dir, {});
    assert.ok(!r.findings.some(f => /getUserById/.test(f.message)));
  });

  it('does NOT flag prose words (`token`) — non-compound identifiers', () => {
    const r = validateReferenceExistence(dir, {});
    assert.ok(!r.findings.some(f => /references `token`/.test(f.message)));
  });

  it('not applicable outside git', () => {
    const t = mkdtempSync(join(tmpdir(), 'dg-ref-nogit-'));
    try { assert.equal(validateReferenceExistence(t, {}).applicable, false); }
    finally { rmSync(t, { recursive: true, force: true }); }
  });
});
