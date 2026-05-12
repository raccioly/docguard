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
    writeFileSync(join(tmpDir, 'README.md'), 'We have 15 checks, 12 validators.');

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
    writeFileSync(join(tmpDir, 'README.md'), 'We have 20 checks, 12 validators.');

    const guardResults = [];
    for(let i=0; i<11; i++) {
      guardResults.push({ status: 'passed', total: i === 0 ? 5 : 1 });
    }

    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('README.md says "20 checks" but actual count is 15.'));
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
});
