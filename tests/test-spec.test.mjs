import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateTestSpec } from '../cli/validators/test-spec.mjs';

describe('validateTestSpec', () => {
  it('should return empty results if TEST-SPEC.md does not exist', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    const config = {};
    const results = validateTestSpec(tempDir, config);
    assert.deepEqual(results, { name: 'test-spec', errors: [], warnings: [], passed: 0, total: 0 });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should parse Source-to-Test Map and Critical User Journeys', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });

    // Create source files
    fs.writeFileSync(join(tempDir, 'src1.js'), '');
    fs.writeFileSync(join(tempDir, 'src2.js'), '');
    fs.writeFileSync(join(tempDir, 'src3.js'), '');

    // Create test files
    fs.writeFileSync(join(tempDir, 'test1.js'), '');
    fs.writeFileSync(join(tempDir, 'test3.js'), '');

    const testSpecContent = `
## Source-to-Test Map
| Source File | Test File | Notes | Status |
|---|---|---|---|
| src1.js | test1.js | | ✅ |
| src2.js | test2.js | | ❌ |
| src3.js | test3.js | | ⚠️ |
| missing_src.js | test1.js | | ✅ |
| src1.js | missing_test.js | | ✅ |

## Critical User Journeys
| # | Journey | Test File | Status |
|---|---|---|---|
| 1 | Login | e2e1.js | ✅ |
| 2 | Logout | e2e2.js | ❌ |
`;
    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), testSpecContent);
    fs.writeFileSync(join(tempDir, 'e2e1.js'), '');

    const config = { projectTypeConfig: { needsE2E: true } };
    const results = validateTestSpec(tempDir, config);

    // ✅ glyphs are no longer counted as passes — passes come from real file
    // existence (source + test files), so a ✅ row with a missing file does not pass.
    assert.equal(results.total, 14);
    assert.equal(results.passed, 8);
    assert.equal(results.warnings.length, 6);

    assert.ok(results.warnings.some(w => w.includes('src2.js as ❌')));
    assert.ok(results.warnings.some(w => w.includes('src3.js as ⚠️')));
    assert.ok(results.warnings.some(w => w.includes('missing_src.js\` not found on disk')));
    assert.ok(results.warnings.some(w => w.includes('missing_test.js\` not found')));
    assert.ok(results.warnings.some(w => w.includes('E2E Journey #2 (Logout) — missing test: e2e2.js')));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should skip Critical User Journeys if needsE2E is false', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });

    const testSpecContent = `
## Critical User Journeys
| # | Journey | Test File | Status |
|---|---|---|---|
| 2 | Logout | e2e2.js | ❌ |
`;
    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), testSpecContent);

    const config = { projectTypeConfig: { needsE2E: false } };
    const results = validateTestSpec(tempDir, config);

    // E2E skipped + no other entries + no tests found → a real warning (not a pass).
    assert.equal(results.total, 0);
    assert.equal(results.warnings.length, 1);
    assert.ok(results.warnings[0].includes('No test directory or co-located test files found.'));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('is N/A (not a fake pass) when the spec maps nothing but a tests dir exists', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });
    fs.mkdirSync(join(tempDir, 'tests'), { recursive: true });
    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), 'Empty doc');

    const results = validateTestSpec(tempDir, {});

    // Tests exist but TEST-SPEC.md declares no mappings → nothing to verify → N/A.
    assert.equal(results.total, 0);
    assert.equal(results.passed, 0);
    assert.equal(results.warnings.length, 0);
    assert.ok(results.note, 'should explain why it is not applicable');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('is N/A when the spec maps nothing but co-located tests exist', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });
    fs.mkdirSync(join(tempDir, 'src/components/__tests__'), { recursive: true });
    fs.writeFileSync(join(tempDir, 'src/components/__tests__/x.test.ts'), 'test');
    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), 'Empty doc');

    const results = validateTestSpec(tempDir, {});

    assert.equal(results.total, 0);
    assert.equal(results.warnings.length, 0);
    assert.ok(results.note);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('is N/A when the spec maps nothing but vitest.config.ts exists', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });
    fs.writeFileSync(join(tempDir, 'vitest.config.ts'), '');
    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), 'Empty doc');

    const results = validateTestSpec(tempDir, {});

    assert.equal(results.total, 0);
    assert.equal(results.warnings.length, 0);
    assert.ok(results.note);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
