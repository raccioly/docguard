/**
 * v0.31.0 feat 5 — IR soft-link recovery in traceability. An untraced
 * requirement (no @req annotation) is enriched with the TF-IDF-closest test.
 */
import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateTraceability } from '../cli/validators/traceability.mjs';

describe('traceability IR soft-match (feat 5)', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dg-trc-ir-'));
    mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version: '0.0.0' }));
    // A requirement about authentication, with NO @req annotation anywhere.
    writeFileSync(join(dir, 'docs-canonical', 'REQUIREMENTS.md'),
      '# Requirements\n\nREQ-001 The system must authenticate users with a password and reject invalid login credentials.\n');
    // A test that clearly covers auth (but never annotates @req REQ-001).
    writeFileSync(join(dir, 'tests', 'auth.test.js'),
      'test("authenticate user rejects invalid password credentials on login", () => {});\n');
    // A decoy unrelated test.
    writeFileSync(join(dir, 'tests', 'invoice.test.js'),
      'test("invoice totals and refund calculations for subscription billing", () => {});\n');
  });
  after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('enriches the untraced-requirement finding with the closest test file', () => {
    const r = validateTraceability(dir, { projectName: 't' });
    const trc = r.findings.find(f => f.code === 'TRC004' && /REQ-001/.test(f.message));
    assert.ok(trc, `expected a TRC004 for REQ-001; got ${JSON.stringify(r.findings.map(f => f.code))}`);
    assert.match(trc.message, /IR soft-match/, 'message should carry an IR soft-match hint');
    assert.match(trc.message, /auth\.test\.js/, 'the auth test — not the invoice decoy — should be surfaced');
  });
});
