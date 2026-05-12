import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateChangelog } from '../cli/validators/changelog.mjs';

describe('validateChangelog', () => {
  let tempDir;

  before(() => {
    tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-changelog-test-'));
  });

  after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const runTest = (filename, content, config) => {
    const filePath = join(tempDir, filename);
    if (content !== null) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
    const result = validateChangelog(tempDir, config);
    if (content !== null) {
      fs.rmSync(filePath);
    }
    return result;
  };

  it('returns empty result when changelog file is missing', () => {
    const config = { requiredFiles: { changelog: 'MISSING.md' } };
    const result = runTest('MISSING.md', null, config);

    assert.deepEqual(result, {
      name: 'changelog',
      errors: [],
      warnings: [],
      passed: 0,
      total: 0
    });
  });

  it('registers warning when [Unreleased] section is missing', () => {
    const config = { requiredFiles: { changelog: 'CHANGELOG1.md' } };
    const content = `
# Changelog
## [1.0.0] - 2023-01-01
- Initial release
    `;
    const result = runTest('CHANGELOG1.md', content, config);

    assert.equal(result.total, 2);
    assert.equal(result.passed, 1);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0], 'CHANGELOG.md: missing [Unreleased] section');
  });

  it('registers warning when version headers are missing', () => {
    const config = { requiredFiles: { changelog: 'CHANGELOG2.md' } };
    const content = `
# Changelog
[Unreleased]
- Some unreleased feature
    `;
    const result = runTest('CHANGELOG2.md', content, config);

    assert.equal(result.total, 2);
    assert.equal(result.passed, 1);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0], 'CHANGELOG.md: no version sections found (expected ## [version] format)');
  });

  it('passes completely with valid changelog', () => {
    const config = { requiredFiles: { changelog: 'CHANGELOG3.md' } };
    const content = `
# Changelog
## [Unreleased]
- New feature coming up
## [1.0.0] - 2023-01-01
- Initial release
    `;
    const result = runTest('CHANGELOG3.md', content, config);

    assert.equal(result.total, 2);
    assert.equal(result.passed, 2);
    assert.equal(result.warnings.length, 0);
  });

  it('passes case-insensitivity check for [unreleased]', () => {
    const config = { requiredFiles: { changelog: 'CHANGELOG4.md' } };
    const content = `
# Changelog
## [unreleased]
- New feature coming up
## [1.0.0] - 2023-01-01
- Initial release
    `;
    const result = runTest('CHANGELOG4.md', content, config);

    assert.equal(result.total, 2);
    assert.equal(result.passed, 2);
    assert.equal(result.warnings.length, 0);
  });
});
