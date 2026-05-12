import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateTestSpec } from '../cli/validators/test-spec.mjs';

describe('Test Spec Validator', () => {
  let tmpDir;
  let docsDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    docsDir = join(tmpDir, 'docs-canonical');
    mkdirSync(docsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns early with empty results if TEST-SPEC.md does not exist', () => {
    rmSync(docsDir, { recursive: true, force: true });
    const result = validateTestSpec(tmpDir, {});
    assert.deepEqual(result, { name: 'test-spec', errors: [], warnings: [], passed: 0, total: 0 });
  });

  it('parses Source-to-Test Map correctly for statuses', () => {
    const md = `
## Source-to-Test Map

| Source File | Test File | Status |
|---|---|---|
| \`src/a.js\` | \`tests/a.test.js\` | ✅ |
| \`src/b.js\` | \`tests/b.test.js\` | ❌ |
| \`src/c.js\` | \`tests/c.test.js\` | ⚠️ |
    `;
    writeFileSync(join(docsDir, 'TEST-SPEC.md'), md);

    mkdirSync(join(tmpDir, 'src'));
    mkdirSync(join(tmpDir, 'tests'));
    writeFileSync(join(tmpDir, 'src', 'a.js'), '');
    writeFileSync(join(tmpDir, 'src', 'b.js'), '');
    writeFileSync(join(tmpDir, 'src', 'c.js'), '');
    writeFileSync(join(tmpDir, 'tests', 'a.test.js'), '');
    writeFileSync(join(tmpDir, 'tests', 'b.test.js'), '');
    writeFileSync(join(tmpDir, 'tests', 'c.test.js'), '');

    const result = validateTestSpec(tmpDir, {});

    assert.equal(result.total, 9);
    assert.equal(result.passed, 7);
    assert.equal(result.warnings.length, 2);
    assert.ok(result.warnings.some(w => w.includes('src/b.js') && w.includes('❌')));
    assert.ok(result.warnings.some(w => w.includes('src/c.js') && w.includes('⚠️')));
  });

  it('detects missing source files and missing test files', () => {
    const md = `
## Source-to-Test Map

| Source File | Test File | Status |
|---|---|---|
| \`src/missing-source.js\` | \`tests/exists.test.js\` | ✅ |
| \`src/exists.js\` | \`tests/missing-test.test.js\` | ✅ |
    `;
    writeFileSync(join(docsDir, 'TEST-SPEC.md'), md);

    mkdirSync(join(tmpDir, 'src'));
    mkdirSync(join(tmpDir, 'tests'));
    writeFileSync(join(tmpDir, 'src', 'exists.js'), '');
    writeFileSync(join(tmpDir, 'tests', 'exists.test.js'), '');

    const result = validateTestSpec(tmpDir, {});
    assert.equal(result.warnings.length, 2);
    assert.ok(result.warnings.some(w => w.includes('source file \`src/missing-source.js\` not found')));
    assert.ok(result.warnings.some(w => w.includes('test file \`tests/missing-test.test.js\` not found')));
  });

  it('parses Critical User Journeys', () => {
    const md = `
## Critical User Journeys

| # | Journey | Test File | Status |
|---|---|---|---|
| 1 | Login | \`tests/e2e/login.spec.js\` | ✅ |
| 2 | Logout | \`tests/e2e/logout.spec.js\` | ❌ |
    `;
    writeFileSync(join(docsDir, 'TEST-SPEC.md'), md);

    const result = validateTestSpec(tmpDir, {});
    assert.equal(result.total, 2);
    assert.equal(result.passed, 1);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('E2E Journey #2 (Logout) — missing test: \`tests/e2e/logout.spec.js\`'));
  });

  it('skips E2E journeys when needsE2E is false', () => {
    const md = `
## Critical User Journeys

| # | Journey | Test File | Status |
|---|---|---|---|
| 1 | Login | \`tests/e2e/login.spec.js\` | ✅ |
    `;
    writeFileSync(join(docsDir, 'TEST-SPEC.md'), md);

    const result = validateTestSpec(tmpDir, { projectTypeConfig: { needsE2E: false } });

    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('No test directory or co-located test files found'));
  });

  it('falls back to directory search if no valid tables exist', () => {
    const md = `
# Just some documentation
    `;
    writeFileSync(join(docsDir, 'TEST-SPEC.md'), md);

    mkdirSync(join(tmpDir, 'tests'));

    const result = validateTestSpec(tmpDir, {});
    assert.equal(result.total, 1);
    assert.equal(result.passed, 1);
    assert.equal(result.warnings.length, 0);
  });
});
