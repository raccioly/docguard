import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateDrift } from '../cli/validators/drift.mjs';

describe('validateDrift', () => {
  it('is not-applicable (NOT a fake pass) when no DRIFT comments are found', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-drift-'));
    try {
      const config = { requiredFiles: { driftLog: 'DRIFT-LOG.md' } };
      fs.writeFileSync(join(tempDir, 'test.js'), 'console.log("hello");');

      const result = validateDrift(tempDir, config);
      assert.equal(result.name, 'drift');
      // No comments to reconcile → total 0 (guard renders this as N/A, not green)
      assert.equal(result.total, 0);
      assert.equal(result.passed, 0);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.warnings, []);
      assert.ok(result.note, 'should explain why it is not applicable');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns errors when DRIFT comments exist but DRIFT-LOG.md is missing', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-drift-'));
    try {
      const config = { requiredFiles: { driftLog: 'DRIFT-LOG.md' } };
      fs.writeFileSync(join(tempDir, 'test.js'), '// DRIFT: We needed to do this\nconsole.log("hello");');

      const result = validateDrift(tempDir, config);
      assert.equal(result.name, 'drift');
      assert.equal(result.total, 1);
      assert.equal(result.passed, 0);
      assert.equal(result.errors.length, 1);
      assert.ok(result.errors[0].includes("has DRIFT comment but DRIFT-LOG.md doesn't exist"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns errors when DRIFT comments exist but are not mentioned in DRIFT-LOG.md', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-drift-'));
    try {
      const config = { requiredFiles: { driftLog: 'DRIFT-LOG.md' } };
      fs.writeFileSync(join(tempDir, 'test.js'), '// DRIFT: We needed to do this\nconsole.log("hello");');
      fs.writeFileSync(join(tempDir, 'DRIFT-LOG.md'), '# Drift Log\nNothing here.');

      const result = validateDrift(tempDir, config);
      assert.equal(result.name, 'drift');
      assert.equal(result.total, 1);
      assert.equal(result.passed, 0);
      assert.equal(result.errors.length, 1);
      assert.ok(result.errors[0].includes("DRIFT comment not logged in DRIFT-LOG.md"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns passed when DRIFT comments are correctly logged in DRIFT-LOG.md for various styles', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-drift-'));
    try {
      const config = { requiredFiles: { driftLog: 'DRIFT-LOG.md' } };

      fs.writeFileSync(join(tempDir, 'test1.js'), '// DRIFT: JS comment\n');
      fs.writeFileSync(join(tempDir, 'test2.py'), '# DRIFT: Python comment\n');
      fs.writeFileSync(join(tempDir, 'test3.c'), '/* DRIFT: C comment */\n');
      fs.writeFileSync(join(tempDir, 'test4.java'), '-- DRIFT: SQL comment in java file for testing regex\n');

      fs.writeFileSync(join(tempDir, 'DRIFT-LOG.md'), '# Drift Log\n- test1.js\n- test2.py\n- test3.c\n- test4.java\n');

      const result = validateDrift(tempDir, config);
      assert.equal(result.name, 'drift');
      assert.equal(result.total, 4);
      assert.equal(result.passed, 4);
      assert.equal(result.errors.length, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
