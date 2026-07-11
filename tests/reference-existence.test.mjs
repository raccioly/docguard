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

describe('REF002 — ADR citations in code comments', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dg-adr-'));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@t.co'); git(dir, 'config', 'user.name', 'T');
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'docs-canonical'));
    writeFileSync(join(dir, 'docs-canonical', 'ADR.md'),
      '# Architecture Decision Records\n\n## ADR-001: Use PostgreSQL\n\nBecause.\n');
    writeFileSync(join(dir, 'src', 'db.ts'), [
      '// Connection pooling per ADR-001',           // defined → pass (also tests padding: 001 vs 1)
      'export function connect(){}',
      '// Retry budget chosen in ADR-007',           // NOT defined → REF002
      'export function retry(){}',
      'const label = "ADR-009";',                    // string literal, no comment → ignored
      '// docguard:ignore REF002 — external decision log',
      '// see ADR-042 for the sharding plan',        // suppressed by the line above
      '// RFC 793 keepalive semantics',              // RFC → out of scope, never flagged
    ].join('\n'));
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'c1');
  });
  after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('flags a cited ADR number with no defining document', () => {
    const r = validateReferenceExistence(dir, {});
    const ref2 = r.findings.filter(f => f.code === 'REF002');
    assert.ok(ref2.some(f => /ADR-007/.test(f.message)), `expected ADR-007 flagged; got ${JSON.stringify(ref2.map(f => f.message))}`);
    assert.ok(ref2.every(f => f.confidence === 'low' && f.severity === 'warn'));
  });

  it('padding-insensitive: ADR-001 citation matches the ## ADR-001 heading', () => {
    const r = validateReferenceExistence(dir, {});
    assert.ok(!r.findings.some(f => f.code === 'REF002' && /ADR-001\b/.test(f.message)));
  });

  it('ignores string literals, suppressed lines, and RFC citations', () => {
    const r = validateReferenceExistence(dir, {});
    const msgs = r.findings.filter(f => f.code === 'REF002').map(f => f.message).join('\n');
    assert.ok(!/ADR-009/.test(msgs), 'string literal must not count as a citation');
    assert.ok(!/ADR-042/.test(msgs), 'docguard:ignore REF002 on the line above must suppress');
    assert.ok(!/RFC/.test(msgs), 'RFC citations are out of scope');
  });

  it('flags citations when the repo has no ADR docs at all (strongest signal)', () => {
    const t = mkdtempSync(join(tmpdir(), 'dg-adr-none-'));
    try {
      git(t, 'init', '-q', '-b', 'main');
      git(t, 'config', 'user.email', 't@t.co'); git(t, 'config', 'user.name', 'T');
      mkdirSync(join(t, 'src'));
      writeFileSync(join(t, 'src', 'a.ts'), '// per ADR-003 we cache aggressively\nexport const x = 1;\n');
      git(t, 'add', '-A'); git(t, 'commit', '-qm', 'c1');
      const r = validateReferenceExistence(t, {});
      assert.equal(r.applicable, true);
      const ref2 = r.findings.filter(f => f.code === 'REF002');
      assert.ok(ref2.some(f => /no ADR documents/.test(f.message)), JSON.stringify(ref2.map(f => f.message)));
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('config referenceExistence.adrCitations=false disables the check', () => {
    const r = validateReferenceExistence(dir, { referenceExistence: { adrCitations: false } });
    assert.ok(!r.findings.some(f => f.code === 'REF002'));
  });

  it('madr-style docs/adr/0007-*.md defines the number', () => {
    const t = mkdtempSync(join(tmpdir(), 'dg-adr-madr-'));
    try {
      git(t, 'init', '-q', '-b', 'main');
      git(t, 'config', 'user.email', 't@t.co'); git(t, 'config', 'user.name', 'T');
      mkdirSync(join(t, 'src')); mkdirSync(join(t, 'docs')); mkdirSync(join(t, 'docs', 'adr'));
      writeFileSync(join(t, 'docs', 'adr', '0007-retry-budget.md'), '# Retry budget\n');
      writeFileSync(join(t, 'src', 'a.ts'), '// per ADR-7\nexport const x = 1;\n');
      git(t, 'add', '-A'); git(t, 'commit', '-qm', 'c1');
      const r = validateReferenceExistence(t, {});
      assert.ok(!r.findings.some(f => f.code === 'REF002'), JSON.stringify(r.findings.map(f => f.message)));
    } finally { rmSync(t, { recursive: true, force: true }); }
  });
});
