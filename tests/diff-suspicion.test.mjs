import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateDiffSuspicion } from '../cli/validators/diff-suspicion.mjs';

// Build a real git repo: commit code + doc, then change the code (remove a
// symbol the doc talks about) so HEAD~1..HEAD carries a removed token.
function git(dir, ...args) { spawnSync('git', args, { cwd: dir, encoding: 'utf-8' }); }

describe('validateDiffSuspicion', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dg-dsp-'));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@t.co');
    git(dir, 'config', 'user.name', 'T');
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'docs-canonical'));
    writeFileSync(join(dir, 'src', 'auth.ts'),
      'export function validateToken(t) { return check(t); }\nexport function legacyLogin() {}\n');
    writeFileSync(join(dir, 'docs-canonical', 'AUTH.md'),
      '# Auth\nCall `validateToken` in `auth` to authenticate. See src/auth.ts.\n');
    writeFileSync(join(dir, 'docs-canonical', 'PRICING.md'),
      '# Pricing\nInvoices render on the billing page.\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'initial');
    // Change: rename validateToken → verifyToken (removes the token the doc uses)
    writeFileSync(join(dir, 'src', 'auth.ts'),
      'export function verifyToken(t) { return check(t); }\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'rename token fn');
  });
  after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('flags a doc that references the changed file AND shares a removed token', () => {
    const r = validateDiffSuspicion(dir, { changedSinceRef: 'HEAD~1' });
    assert.equal(r.applicable, true);
    const dsp = r.findings.filter(f => f.code === 'DSP001');
    assert.ok(dsp.length >= 1, `expected a DSP001 finding; got ${JSON.stringify(r.findings)}`);
    assert.match(dsp[0].message, /AUTH\.md/);
    assert.match(dsp[0].message, /validatetoken/i);
    // all findings are low-confidence / soft
    assert.ok(dsp.every(f => f.confidence === 'low' && f.severity === 'warn'));
  });

  it('does NOT flag an unrelated doc', () => {
    const r = validateDiffSuspicion(dir, { changedSinceRef: 'HEAD~1' });
    assert.ok(!r.findings.some(f => /PRICING\.md/.test(f.message)));
  });

  it('is not applicable outside a git repo', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-dsp-nogit-'));
    try {
      const r = validateDiffSuspicion(tmp, {});
      assert.equal(r.applicable, false);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  it('is not applicable when the diff removed nothing (pure additions)', () => {
    const d2 = mkdtempSync(join(tmpdir(), 'dg-dsp-add-'));
    try {
      git(d2, 'init', '-q', '-b', 'main');
      git(d2, 'config', 'user.email', 't@t.co'); git(d2, 'config', 'user.name', 'T');
      mkdirSync(join(d2, 'src'));
      writeFileSync(join(d2, 'src', 'a.ts'), 'export const x = 1;\n');
      git(d2, 'add', '-A'); git(d2, 'commit', '-qm', 'init');
      writeFileSync(join(d2, 'src', 'a.ts'), 'export const x = 1;\nexport const y = 2;\n'); // add only
      git(d2, 'add', '-A'); git(d2, 'commit', '-qm', 'add y');
      const r = validateDiffSuspicion(d2, { changedSinceRef: 'HEAD~1' });
      assert.equal(r.applicable, false);
    } finally { rmSync(d2, { recursive: true, force: true }); }
  });
});
