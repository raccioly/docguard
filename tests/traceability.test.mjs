import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateTraceability } from '../cli/validators/traceability.mjs';

describe('Traceability Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles missing docs-canonical directory gracefully', () => {
    const config = { requiredFiles: { canonical: [] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  it('validates successful source traceability', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), '# Arch');

    writeFileSync(join(tmpDir, 'index.js'), 'console.log("hello");');

    const config = { requiredFiles: { canonical: ['ARCHITECTURE.md'] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.total, 1);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  it('warns when a required document is missing', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    // Don't create ARCHITECTURE.md

    const config = { requiredFiles: { canonical: ['ARCHITECTURE.md'] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 1);
    assert.deepEqual(result.errors, []);
    assert.strictEqual(result.warnings.length, 1);
    assert.strictEqual(result.warnings[0], 'ARCHITECTURE.md — required but missing, no traceability possible');
  });

  it('warns when a document has no matching source files (unlinked)', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), '# Arch');
    // No index.js or matching source file

    const config = { requiredFiles: { canonical: ['ARCHITECTURE.md'] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 1);
    assert.deepEqual(result.errors, []);
    assert.strictEqual(result.warnings.length, 1);
    assert.strictEqual(result.warnings[0], 'ARCHITECTURE.md — exists but no matching source code found (unlinked doc)');
  });

  it('warns when an orphaned document is present', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    // SECURITY.md is created but not in requiredFiles
    writeFileSync(join(tmpDir, 'docs-canonical', 'SECURITY.md'), '# Security');

    const config = { requiredFiles: { canonical: [] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
    assert.deepEqual(result.errors, []);
    assert.strictEqual(result.warnings.length, 1);
    assert.strictEqual(result.warnings[0], 'SECURITY.md — file exists in docs-canonical/ but is not in your requiredFiles config. Consider deleting it or adding it to .docguard.json requiredFiles.canonical');
  });

  it('validates Requirement ID traceability successfully', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'REQUIREMENTS.md'), '# Requirements\nREQ-001\n');

    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests', 'app.test.js'), '// Testing REQ-001 functionality');

    const config = { requiredFiles: { canonical: [] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.total, 1);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  it('warns when a requirement has no test coverage', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'REQUIREMENTS.md'), '# Requirements\nREQ-002\n');
    // No test file referencing REQ-002

    const config = { requiredFiles: { canonical: [] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 1);
    assert.deepEqual(result.errors, []);
    assert.strictEqual(result.warnings.length, 1);
    assert.strictEqual(result.warnings[0], 'Requirement REQ-002 (REQUIREMENTS.md:2) has no test coverage. Add @req REQ-002 comment to the test that verifies this requirement');
  });

  it('warns when an orphaned test reference exists', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    // REQ-002 exists, but test references REQ-003
    writeFileSync(join(tmpDir, 'REQUIREMENTS.md'), '# Requirements\nREQ-002\n');

    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests', 'app.test.js'), '// Testing REQ-003');

    const config = { requiredFiles: { canonical: [] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 2); // 1 missing coverage, 1 orphaned test ref
    assert.deepEqual(result.errors, []);
    assert.strictEqual(result.warnings.length, 2);

    const hasOrphanedWarning = result.warnings.some(w =>
      w.includes('Test references REQ-003') && w.includes('but no requirement with this ID exists')
    );
    assert.strictEqual(hasOrphanedWarning, true);
  });
});
