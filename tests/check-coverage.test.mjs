import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuardInternal } from '../cli/commands/guard.mjs';
import { describeCheckCoverage } from '../cli/validator-coverage.mjs';
const fixture = t => { const dir = mkdtempSync(join(tmpdir(), 'docguard-check-coverage-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
test('coverage distinguishes configuration, absence, unsupported input and completed predicates', t => {
  const dir = fixture(t);
  assert.equal(describeCheckCoverage(dir, {}, { status: 'skipped' }).status, 'disabled');
  assert.equal(describeCheckCoverage(dir, {}, { status: 'na', note: 'declared N/A: no API' }).status, 'not-applicable');
  assert.equal(describeCheckCoverage(dir, {}, { key: 'environment', total: 0 }).status, 'missing-prerequisite');
  assert.equal(describeCheckCoverage(dir, {}, { key: 'schemaSync', total: 0 }).status, 'no-matches');
  assert.equal(describeCheckCoverage(dir, {}, { total: 2 }).status, 'checked');
  assert.equal(describeCheckCoverage(dir, {}, { total: 0, applicability: { status: 'unsupported', reason: 'language' } }).status, 'unsupported');
  assert.equal(describeCheckCoverage(dir, {}, { total: 1, applicability: { status: 'error', reason: 'parser failed' } }).status, 'error');
});
test('guard preserves Python unsupported status and missing prerequisites without claiming coverage', t => {
  const dir = fixture(t); mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src/main.py'), 'import os\n');
  const r = runGuardInternal(dir, { projectName: 'capability', validators: { architecture: true, security: false, freshness: false }, requiredFiles: { canonical: [], agentFile: [] } });
  assert.equal(r.validators.find(v => v.key === 'architecture').applicability.status, 'unsupported');
  assert.equal(r.validators.find(v => v.key === 'environment').applicability.status, 'missing-prerequisite');
  assert.ok(r.checkCoverage.counts.disabled >= 2);
  assert.equal(r.checkCoverage.limitations.find(v => v.key === 'architecture').status, 'unsupported');
  assert.equal(Object.values(r.checkCoverage.counts).reduce((a,b) => a+b, 0), r.validators.length);
});
test('document inventory honors configured ignores and does not imply claim scanning', t => {
  const dir = fixture(t); mkdirSync(join(dir, 'docs')); writeFileSync(join(dir, 'docs/ignored.md'), '# Ignored');
  const r = runGuardInternal(dir, { projectName: 'inventory', ignore: ['docs/ignored.md'], requiredFiles: { canonical: ['docs/ignored.md'], agentFile: [] }, validators: { freshness: false } });
  assert.equal(r.coverage.ignored, 1); assert.equal(r.coverage.canonical, 0);
});
