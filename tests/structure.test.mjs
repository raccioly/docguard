import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDocSections } from '../cli/validators/structure.mjs';

describe('validateDocSections Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-'));
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ignores missing files without warnings', () => {
    // No files created in docs-canonical
    const result = validateDocSections(tmpDir, {});
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('passes when all required sections are present', () => {
    writeFileSync(
      join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'),
      '## System Overview\nContent\n## Component Map\nContent\n## Tech Stack\nContent'
    );

    const result = validateDocSections(tmpDir, {});
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.passed, 3);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('warns when required sections are missing', () => {
    writeFileSync(
      join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'),
      '## System Overview\nContent'
    );

    const result = validateDocSections(tmpDir, {});
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.warnings.length, 2);
    assert.match(result.warnings[0], /docs-canonical\/ARCHITECTURE.md: missing section "## Component Map"/);
    assert.match(result.warnings[1], /docs-canonical\/ARCHITECTURE.md: missing section "## Tech Stack"/);
  });

  it('handles projectTypeConfig for needsDatabase', () => {
    writeFileSync(
      join(tmpDir, 'docs-canonical', 'DATA-MODEL.md'),
      'Some content without entities'
    );

    // default config, needsDatabase is not false
    let result = validateDocSections(tmpDir, {});
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0], /docs-canonical\/DATA-MODEL.md: missing section "## Entities"/);

    // needsDatabase is false
    result = validateDocSections(tmpDir, { projectTypeConfig: { needsDatabase: false } });
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('handles projectTypeConfig for needsEnvVars', () => {
    writeFileSync(
      join(tmpDir, 'docs-canonical', 'ENVIRONMENT.md'),
      '## Setup Steps\nContent'
    );

    // default config, needsEnvVars is not false
    let result = validateDocSections(tmpDir, {});
    assert.strictEqual(result.total, 2); // expects Setup Steps and Environment Variables
    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0], /docs-canonical\/ENVIRONMENT.md: missing section "## Environment Variables"/);

    // needsEnvVars is false
    result = validateDocSections(tmpDir, { projectTypeConfig: { needsEnvVars: false } });
    assert.strictEqual(result.total, 1); // expects only Setup Steps
    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.warnings.length, 0);
  });
});
