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

  // ── v0.11.1 FP-6 regressions: multi-path Journey rows ───────────────────

  // @req FR-016 — Journey row cells may list multiple test paths in backticks
  // @req SC-010 — multi-path Journey rows recognized
  it('FP-6: parses comma-separated multi-path Journey cells', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });
    fs.mkdirSync(join(tempDir, 'backend/src/__tests__/integration'), { recursive: true });
    fs.writeFileSync(join(tempDir, 'backend/src/__tests__/integration/message-a.test.ts'), '');
    fs.writeFileSync(join(tempDir, 'backend/src/__tests__/integration/message-b.test.ts'), '');

    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), `
## Critical User Journeys

| # | Journey | Test File | Status |
|---|---------|-----------|--------|
| 1 | Receive WhatsApp message | \`backend/src/__tests__/integration/message-a.test.ts\`, \`backend/src/__tests__/integration/message-b.test.ts\` | ✅ |
`);

    const results = validateTestSpec(tempDir, {});
    assert.equal(results.total, 1, 'one Journey row evaluated');
    assert.equal(results.passed, 1, 'passes because both files exist');
    assert.equal(results.warnings.length, 0,
      `No warnings expected, got: ${JSON.stringify(results.warnings)}`);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('FP-6: passes when ANY of the multi-path files exists', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });
    fs.mkdirSync(join(tempDir, 'backend/src/__tests__'), { recursive: true });
    fs.writeFileSync(join(tempDir, 'backend/src/__tests__/exists.test.ts'), '');

    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), `
## Critical User Journeys

| # | Journey | Test File | Status |
|---|---------|-----------|--------|
| 1 | X | \`backend/src/__tests__/missing.test.ts\`, \`backend/src/__tests__/exists.test.ts\` | ✅ |
`);

    const results = validateTestSpec(tempDir, {});
    assert.equal(results.passed, 1, 'passes because at least one file exists');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('FP-6: still warns when NO multi-path files exist', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });

    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), `
## Critical User Journeys

| # | Journey | Test File | Status |
|---|---------|-----------|--------|
| 1 | X | \`missing-a.test.ts\`, \`missing-b.test.ts\` | ✅ |
`);

    const results = validateTestSpec(tempDir, {});
    assert.equal(results.passed, 0);
    assert.equal(results.warnings.length, 1);
    assert.ok(results.warnings[0].includes('missing-a.test.ts'));
    assert.ok(results.warnings[0].includes('missing-b.test.ts'));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('FP-6: expands globs in Journey path cells', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });
    fs.mkdirSync(join(tempDir, 'backend/test-helpers/security'), { recursive: true });
    fs.writeFileSync(join(tempDir, 'backend/test-helpers/security/idor_users.test.ts'), '');
    fs.writeFileSync(join(tempDir, 'backend/test-helpers/security/idor_admin.test.ts'), '');
    fs.writeFileSync(join(tempDir, 'backend/test-helpers/security/idor_messages.test.ts'), '');

    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), `
## Critical User Journeys

| # | Journey | Test File | Status |
|---|---------|-----------|--------|
| 8 | IDOR | \`backend/test-helpers/security/idor_*.test.ts (3 suites)\` | ✅ |
`);

    const results = validateTestSpec(tempDir, {});
    assert.equal(results.passed, 1, 'passes when glob expands to existing files');
    assert.equal(results.warnings.length, 0);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('FP-6: accepts (N suites) annotation when literal path missing', () => {
    // Author claim of coverage — trust the annotation rather than reject.
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });

    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), `
## Critical User Journeys

| # | Journey | Test File | Status |
|---|---------|-----------|--------|
| 9 | Custom | \`backend/legacy/oldpath.test.ts (2 suites)\` | ✅ |
`);

    const results = validateTestSpec(tempDir, {});
    assert.equal(results.passed, 1, 'annotation provides evidence even without literal file');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('#9: header-aware parser verifies BOTH Unit Test and Integration Test columns', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-spec-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });
    // Files on disk: unit + integration for `a`, only unit for `b`.
    fs.writeFileSync(join(tempDir, 'a.js'), '');
    fs.writeFileSync(join(tempDir, 'a.unit.js'), '');
    fs.writeFileSync(join(tempDir, 'a.int.js'), '');
    fs.writeFileSync(join(tempDir, 'b.js'), '');
    fs.writeFileSync(join(tempDir, 'b.unit.js'), '');
    // The generated 4-column shape, plus a row with a BLANK Integration cell
    // (must not shift Status into the integration slot).
    fs.writeFileSync(join(tempDir, 'docs-canonical/TEST-SPEC.md'), `# Test Spec

## Source-to-Test Map
| Source File | Unit Test | Integration Test | Status |
|-------------|-----------|------------------|--------|
| a.js | a.unit.js | a.int.js | ✅ |
| b.js | b.unit.js | b.int.MISSING.js | ✅ |
| c.js | c.unit.MISSING.js |  | ✅ |
`);
    const r = validateTestSpec(tempDir, { projectTypeConfig: { needsE2E: false } });
    // The Integration Test column is now checked: b's missing integration test
    // is caught (the old parser never looked at column 3).
    assert.ok(r.warnings.some(w => w.includes('b.int.MISSING.js') && w.includes('not found')),
      `missing Integration Test must be flagged; got ${JSON.stringify(r.warnings)}`);
    // c's unit test is missing AND its Integration cell is blank — the blank must
    // NOT be mis-read (no spurious warning for an empty integration cell), but
    // the missing unit test IS flagged (proves columns didn't shift).
    assert.ok(r.warnings.some(w => w.includes('c.unit.MISSING.js') && w.includes('not found')),
      `missing Unit Test must be flagged even with a blank Integration cell; got ${JSON.stringify(r.warnings)}`);
    assert.ok(!r.warnings.some(w => w.includes('✅')),
      'a blank Integration cell must not be parsed as a path (no Status leakage)');
    // a.js: source + unit + integration all exist → 3 passes.
    assert.ok(r.passed >= 3, `a.js's source+unit+integration should all pass; passed=${r.passed}`);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
