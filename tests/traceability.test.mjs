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
    // Note: REQ IDs are built from parts so this test file doesn't appear as
    // an "orphan test reference" when DocGuard scans its own test suite.
    const ID1 = 'REQ' + '-' + '901';
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'REQUIREMENTS.md'), `# Requirements\n${ID1}\n`);

    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests', 'app.test.js'), `// Testing ${ID1} functionality`);

    const config = { requiredFiles: { canonical: [] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.total, 1);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  it('warns when a requirement has no test coverage', () => {
    const ID2 = 'REQ' + '-' + '902';
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'REQUIREMENTS.md'), `# Requirements\n${ID2}\n`);
    // No test file referencing this ID

    const config = { requiredFiles: { canonical: [] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 1);
    assert.deepEqual(result.errors, []);
    assert.strictEqual(result.warnings.length, 1);
    assert.strictEqual(result.warnings[0], `Requirement ${ID2} (REQUIREMENTS.md:2) has no test coverage. Add @req ${ID2} comment to the test that verifies this requirement`);
  });

  it('warns when an orphaned test reference exists', () => {
    const ID2 = 'REQ' + '-' + '902';
    const ID3 = 'REQ' + '-' + '903';
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    // ID2 is documented; the test will reference an undocumented ID3
    writeFileSync(join(tmpDir, 'REQUIREMENTS.md'), `# Requirements\n${ID2}\n`);

    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests', 'app.test.js'), `// Testing ${ID3}`);

    const config = { requiredFiles: { canonical: [] } };
    const result = validateTraceability(tmpDir, config);

    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 2); // 1 missing coverage, 1 orphaned test ref
    assert.deepEqual(result.errors, []);
    assert.strictEqual(result.warnings.length, 2);

    const hasOrphanedWarning = result.warnings.some(w =>
      w.includes(`Test references ${ID3}`) && w.includes('but no requirement with this ID exists')
    );
    assert.strictEqual(hasOrphanedWarning, true);
  });

  // Regression for hugocross Bug 5 (compound):
  //   (a) `// @doc API-REFERENCE.md` annotations were documented in templates
  //       but never actually scanned — they had zero effect on traceability.
  //   (b) Next.js App Router route files (`src/app/api/...`) did not match
  //       any TRACE_MAP pattern, so a fully-populated API tree was reported
  //       as "API-REFERENCE.md — unlinked doc".
  describe('@doc annotations and Next.js App Router (hugocross bug 5)', () => {
    it('@doc annotation links a source file to a canonical doc', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'API-REFERENCE.md'), '# API');
      // Source file lives OUTSIDE any of the TRACE_MAP path globs
      // (routes/, controllers/, handlers/, app/api/, middleware/, openapi.*)
      // — only the @doc annotation can link it.
      mkdirSync(join(tmpDir, 'src', 'weird-place'), { recursive: true });
      writeFileSync(
        join(tmpDir, 'src', 'weird-place', 'thing.ts'),
        '// @doc API-REFERENCE.md\nexport const foo = 1;\n'
      );

      const config = { requiredFiles: { canonical: ['API-REFERENCE.md'] } };
      const result = validateTraceability(tmpDir, config);
      assert.strictEqual(result.passed, 1,
        `annotation should count as a link; warnings: ${result.warnings.join('\n')}`);
      assert.ok(
        !result.warnings.some(w => w.includes('API-REFERENCE.md — exists but no matching')),
        'no unlinked-doc warning expected when @doc annotation is present'
      );
    });

    it('Next.js App Router src/app/api/ is recognised by TRACE_MAP', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'API-REFERENCE.md'), '# API');
      mkdirSync(join(tmpDir, 'src', 'app', 'api', 'health'), { recursive: true });
      writeFileSync(
        join(tmpDir, 'src', 'app', 'api', 'health', 'route.ts'),
        'export async function GET() {}'
      );

      const config = { requiredFiles: { canonical: ['API-REFERENCE.md'] } };
      const result = validateTraceability(tmpDir, config);
      assert.strictEqual(result.passed, 1,
        `App Router route should link to API-REFERENCE.md; warnings: ${result.warnings.join('\n')}`);
    });
  });

  it('recognizes non-JS test files (multilingual traceability — Issue 3)', () => {
    // Pre-v0.23.0 the guard Traceability validator was JS/TS-only, so a Python
    // project's TEST-SPEC.md was reported as an "unlinked doc". It now shares
    // the multilingual patterns with `docguard trace` via shared-trace-patterns.
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'TEST-SPEC.md'), '# Test Spec\n\nTests live in `tests/`.');
    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests', 'test_payment.py'), 'def test_charge():\n    assert True\n');

    const config = { requiredFiles: { canonical: ['TEST-SPEC.md'] } };
    const result = validateTraceability(tmpDir, config);
    assert.strictEqual(result.passed, 1,
      `Python test should link TEST-SPEC.md; warnings: ${result.warnings.join('\n')}`);
    assert.deepEqual(result.warnings, []);
  });
});
