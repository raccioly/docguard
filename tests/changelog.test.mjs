import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
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
      total: 0,
      fixes: [],
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
    assert.ok(result.warnings[0].startsWith('CHANGELOG.md: missing [Unreleased] section'));
    assert.ok(result.fixes.some(f => f.type === 'insert-changelog-unreleased'));
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

describe('validateChangelog — staged-change check (STANDARD.md)', () => {
  let repo;
  const git = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] });
  const goodChangelog = '# Changelog\n## [Unreleased]\n- wip\n## [1.0.0]\n- init\n';

  beforeEach(() => {
    repo = fs.mkdtempSync(join(tmpdir(), 'docguard-changelog-git-'));
    git(['init']);
    fs.writeFileSync(join(repo, 'CHANGELOG.md'), goodChangelog);
  });
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

  const config = { requiredFiles: { changelog: 'CHANGELOG.md' } };

  it('warns when code is staged but CHANGELOG.md is not', () => {
    fs.writeFileSync(join(repo, 'feature.ts'), 'export const x = 1;');
    git(['add', 'feature.ts']);
    const result = validateChangelog(repo, config);
    assert.ok(result.warnings.some(w => w.includes('code file(s) staged but CHANGELOG.md is not')));
  });

  it('passes the staged check when CHANGELOG.md is staged alongside code', () => {
    fs.writeFileSync(join(repo, 'feature.ts'), 'export const x = 1;');
    git(['add', 'feature.ts', 'CHANGELOG.md']);
    const result = validateChangelog(repo, config);
    assert.ok(!result.warnings.some(w => w.includes('staged but CHANGELOG.md is not')));
  });

  it('does not run the staged check when nothing is staged (N/A)', () => {
    const result = validateChangelog(repo, config);
    // Only the 2 structural checks run; staged check is not applicable.
    assert.equal(result.total, 2);
  });
});
