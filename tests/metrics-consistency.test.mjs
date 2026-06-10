import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateMetricsConsistency } from '../cli/validators/metrics-consistency.mjs';

describe('Metrics-Consistency Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-metrics-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when metrics correctly match actual actuals', () => {
    // DocGuard-bound (Bug #2): the line references DocGuard, so the numbers are
    // DocGuard's to govern.
    writeFileSync(join(tmpDir, 'README.md'), 'DocGuard runs 15 checks across 12 validators.');

    const guardResults = [];
    for(let i=0; i<11; i++) {
      guardResults.push({ status: 'passed', total: i === 0 ? 5 : 1 });
    }

    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.strictEqual(result.passed, 2);
    assert.strictEqual(result.total, 2);
  });

  it('returns warnings when numbers mismatch actuals', () => {
    writeFileSync(join(tmpDir, 'README.md'), 'DocGuard runs 20 checks across 12 validators.');

    const guardResults = [];
    for(let i=0; i<11; i++) {
      guardResults.push({ status: 'passed', total: i === 0 ? 5 : 1 });
    }

    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('README.md says "20 checks" but DocGuard\'s own checks count is 15'));
    assert.strictEqual(result.passed, 1); // 1 passed for validators
    assert.strictEqual(result.total, 2); // total 2 numbers
  });

  it('skips processing changelog files', () => {
    writeFileSync(join(tmpDir, 'CHANGELOG.md'), 'We removed 5 checks and 3 validators.');

    const guardResults = [{ status: 'passed', total: 10 }];
    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
  });

  it('skips validation when there are no actual metrics', () => {
    writeFileSync(join(tmpDir, 'README.md'), 'We have 20 checks.');

    // guardResults is undefined
    const result = validateMetricsConsistency(tmpDir, {});

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
  });

  it('skips processing ignored files', () => {
    writeFileSync(join(tmpDir, '.docguardignore'), 'ignore-this.md');
    writeFileSync(join(tmpDir, 'ignore-this.md'), 'We have 20 checks, 12 validators.');

    const guardResults = [{ status: 'passed', total: 15 }];
    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
  });

  it('checks for test count if test files exist', () => {
    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests', 'a.test.mjs'), '...');
    writeFileSync(join(tmpDir, 'tests', 'b.test.mjs'), '...');

    // we don't have pattern for tests in the current implementation, but it shouldn't crash
    const result = validateMetricsConsistency(tmpDir, {});

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
  });

  // Field test (wu-whatsappinbox): the recursive root walk swept in OpenWolf
  // session archives and vendored toolkit READMEs deep under security/, then
  // reported their unrelated "N validators / N checks" prose as the user's
  // drift (~39 false warnings). Markdown buried in arbitrary subdirectories is
  // NOT a doc DocGuard governs, so it must not be scanned.
  it('does NOT scan markdown buried in arbitrary subdirectories (over-reach fix)', () => {
    mkdirSync(join(tmpDir, 'security', 'wolf-archive', 'old-session'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'security', 'wolf-archive', 'old-session', 'memory.md'),
      'Session note: the guard ran 99 validators back then.'
    );
    const guardResults = [{ status: 'passed', total: 15 }];
    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, [],
      `deep-subdir markdown must not be flagged; got: ${result.warnings.join(' | ')}`);
  });

  // Conversely, a canonical doc the user actually configures — even outside the
  // conventional docs-canonical/ tree — MUST still be scanned, so the scoping
  // fix narrows noise without losing real detection.
  it('still scans a configured canonical doc located outside docs-canonical/', () => {
    mkdirSync(join(tmpDir, 'documentation'), { recursive: true });
    writeFileSync(join(tmpDir, 'documentation', 'OVERVIEW.md'), 'DocGuard runs 99 validators.');
    const guardResults = [];
    for (let i = 0; i < 11; i++) guardResults.push({ status: 'passed', total: i === 0 ? 5 : 1 });

    const result = validateMetricsConsistency(
      tmpDir,
      { requiredFiles: { canonical: ['documentation/OVERVIEW.md'] } },
      guardResults
    );

    assert.strictEqual(result.warnings.length, 1, `expected the configured doc to be scanned; got: ${result.warnings.join(' | ')}`);
    assert.ok(result.warnings[0].includes('99 validators'));
  });

  // Bug #2 (field report): TEST-SPEC.md said the proof harness contributes "10
  // checks". That number is NOT about DocGuard, so comparing it to DocGuard's
  // own count — and offering to overwrite it — corrupts a correct number.
  it('does NOT flag an unbound "N checks" that describes a different subject (Bug #2)', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'TEST-SPEC.md'),
      'The proof harness contributes 10 checks to the suite.\n');
    const guardResults = [{ status: 'passed', total: 86 }]; // DocGuard's own count = 86

    const result = validateMetricsConsistency(
      tmpDir,
      { requiredFiles: { canonical: ['docs-canonical/TEST-SPEC.md'] } },
      guardResults
    );

    assert.deepEqual(result.warnings, [],
      `an unbound "10 checks" must not be flagged; got: ${result.warnings.join(' | ')}`);
    assert.deepEqual(result.fixes || [], [], 'no corrupting fix may be emitted for an unbound number');
  });

  it('stamps provenance (actualSource) on a bound metric fix (Bug #2)', () => {
    writeFileSync(join(tmpDir, 'README.md'), 'DocGuard runs 20 checks.');
    const guardResults = [{ status: 'passed', total: 15 }];
    const result = validateMetricsConsistency(tmpDir, {}, guardResults);
    const fix = (result.fixes || []).find(f => f.type === 'replace-count');
    assert.ok(fix, 'a bound mismatch should still produce a fix');
    assert.equal(fix.actualSource, 'docguard.guard.checks', 'fix must carry provenance for the applier');
  });
});
