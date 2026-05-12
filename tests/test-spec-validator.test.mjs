import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateTestSpec } from '../cli/validators/test-spec.mjs';

describe('validateTestSpec', () => {
  it('returns empty results if TEST-SPEC.md does not exist', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    try {
      const config = { projectTypeConfig: {} };
      const results = validateTestSpec(tmpDir, config);
      assert.equal(results.name, 'test-spec');
      assert.equal(results.total, 0);
      assert.equal(results.passed, 0);
      assert.equal(results.warnings.length, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('parses Source-to-Test Map correctly', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    try {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      mkdirSync(join(tmpDir, 'src'), { recursive: true });
      mkdirSync(join(tmpDir, 'tests'), { recursive: true });

      writeFileSync(join(tmpDir, 'src', 'app.js'), 'console.log("hello")');
      writeFileSync(join(tmpDir, 'tests', 'app.test.js'), 'test()');

      const content = `
## Source-to-Test Map
| Source File | Test File | Description | Status |
|---|---|---|---|
| src/app.js | tests/app.test.js | Main app | ✅ |
| src/missing.js | tests/missing.test.js | Missing | ❌ |
`;
      writeFileSync(join(tmpDir, 'docs-canonical', 'TEST-SPEC.md'), content);

      const config = { projectTypeConfig: {} };
      const results = validateTestSpec(tmpDir, config);

      // rows:
      // 1. status ✅ (total++, passed++)
      // 2. status ❌ (total++, warning++)
      // 3. source src/app.js exists (total++, passed++)
      // 4. test tests/app.test.js exists (total++, passed++)
      // 5. source src/missing.js missing (total++, warning++)
      // 6. test tests/missing.test.js missing (total++, warning++)

      assert.equal(results.total, 6);
      assert.equal(results.passed, 3);
      assert.equal(results.warnings.length, 3);
      assert.ok(results.warnings.some(w => w.includes('src/missing.js as ❌')));
      assert.ok(results.warnings.some(w => w.includes('source file `src/missing.js` not found')));
      assert.ok(results.warnings.some(w => w.includes('test file `tests/missing.test.js` not found')));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('parses Critical CLI Flows correctly', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    try {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      const content = `
## Critical CLI Flows
| # | Journey | Test File | Status |
|---|---|---|---|
| 1 | Basic Flow | tests/e2e.test.js | ✅ |
| 2 | Advanced Flow | tests/adv.test.js | ❌ |
`;
      writeFileSync(join(tmpDir, 'docs-canonical', 'TEST-SPEC.md'), content);

      const config = { projectTypeConfig: { needsE2E: true } };
      const results = validateTestSpec(tmpDir, config);

      // Source-to-Test Map not found, so only Critical CLI Flows checked
      // 1. status ✅ (total++, passed++)
      // 2. status ❌ (total++, warning++)

      assert.equal(results.total, 2);
      assert.equal(results.passed, 1);
      assert.equal(results.warnings.length, 1);
      assert.match(results.warnings[0], /E2E Journey #2/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips E2E if needsE2E is false', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    try {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      const content = `
## Critical CLI Flows
| # | Journey | Test File | Status |
|---|---|---|---|
| 1 | Basic Flow | tests/e2e.test.js | ❌ |
`;
      writeFileSync(join(tmpDir, 'docs-canonical', 'TEST-SPEC.md'), content);

      const config = { projectTypeConfig: { needsE2E: false } };
      const results = validateTestSpec(tmpDir, config);

      // E2E skipped, total should be 1 (fallback check) if nothing else found
      assert.equal(results.total, 1);
      assert.equal(results.passed, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
