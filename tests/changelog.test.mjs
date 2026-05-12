import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateChangelog } from '../cli/validators/changelog.mjs';

describe('Changelog Validator', () => {
  let tmpDir;
  const config = {
    requiredFiles: {
      changelog: 'CHANGELOG.md'
    }
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-changelog-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return empty results if changelog file is missing', () => {
    const result = validateChangelog(tmpDir, config);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('should warn if [Unreleased] section is missing', () => {
    writeFileSync(join(tmpDir, 'CHANGELOG.md'), '## [1.0.0]\n- Initial release');
    const result = validateChangelog(tmpDir, config);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.passed, 1);
    assert.ok(result.warnings.some(w => w.includes('missing [Unreleased] section')));
  });

  it('should warn if version headers are missing', () => {
    writeFileSync(join(tmpDir, 'CHANGELOG.md'), '# Changelog\n[Unreleased]\n- Some changes');
    const result = validateChangelog(tmpDir, config);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.passed, 1);
    assert.ok(result.warnings.some(w => w.includes('no version sections found')));
  });

  it('should pass both checks if [Unreleased] and version headers are present', () => {
    writeFileSync(join(tmpDir, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n## [1.0.0]');
    const result = validateChangelog(tmpDir, config);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.passed, 2);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('should handle lowercase [unreleased] case-insensitively', () => {
    writeFileSync(join(tmpDir, 'CHANGELOG.md'), '# Changelog\n## [unreleased]\n## [1.0.0]');
    const result = validateChangelog(tmpDir, config);
    assert.strictEqual(result.passed, 2);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('should fail both checks if file is empty', () => {
    writeFileSync(join(tmpDir, 'CHANGELOG.md'), '');
    const result = validateChangelog(tmpDir, config);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.warnings.length, 2);
  });
});
