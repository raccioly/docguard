import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDocsCoverage } from '../cli/validators/docs-coverage.mjs';

describe('Docs-Coverage Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty result when no documentation exists', () => {
    const result = validateDocsCoverage(tmpDir, {});
    assert.deepEqual(result, { errors: [], warnings: [], passed: 0, total: 0 });
  });

  it('detects undocumented artifacts and missing standard sections', () => {
    // 1. Create a config file not mentioned in docs
    writeFileSync(join(tmpDir, '.customconfig.json'), '{}');

    // 2. Create package.json with bin entries not mentioned in docs
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      bin: { 'my-cli': './cli.js' }
    }));

    // 3. Create a source directory not mentioned in ARCHITECTURE.md
    mkdirSync(join(tmpDir, 'src'));
    mkdirSync(join(tmpDir, 'src', 'utils'));
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Architecture doc');

    // 4. Create source file referencing a config not mentioned in docs
    writeFileSync(join(tmpDir, 'src', 'utils', 'index.js'), "const p = resolve(__dirname, '.secretconfig');");

    // 5. Create a basic README missing standard sections
    writeFileSync(join(tmpDir, 'README.md'), '# Project\nThis is a test.');

    const result = validateDocsCoverage(tmpDir, {});

    assert.strictEqual(result.errors.length, 0);
    assert.ok(result.warnings.some(w => w.includes('Config file ".customconfig.json" exists but is not mentioned')));
    assert.ok(result.warnings.some(w => w.includes('package.json defines CLI command "my-cli" but it\'s not mentioned')));
    assert.ok(result.warnings.some(w => w.includes('Source directory "src/utils/" is not referenced')));
    assert.ok(result.warnings.some(w => w.includes('Code references config file ".secretconfig" but no documentation mentions it')));
    assert.ok(result.warnings.some(w => w.includes('README.md is missing a "Installation" section')));
    assert.ok(result.warnings.some(w => w.includes('README.md is missing a "Usage" section')));
    assert.ok(result.warnings.some(w => w.includes('README.md is missing a "License" section')));
  });

  it('passes when all artifacts are documented and standard sections exist', () => {
    // 1. Create a config file mentioned in docs
    writeFileSync(join(tmpDir, '.customconfig.json'), '{}');

    // 2. Create package.json with bin entries mentioned in docs
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      bin: { 'my-cli': './cli.js' }
    }));

    // 3. Create a source directory mentioned in ARCHITECTURE.md
    mkdirSync(join(tmpDir, 'src'));
    mkdirSync(join(tmpDir, 'src', 'utils'));
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Architecture for src/utils. Configures .secretconfig.');

    // 4. Create source file referencing a config mentioned in docs
    writeFileSync(join(tmpDir, 'src', 'utils', 'index.js'), "const p = resolve(__dirname, '.secretconfig');");

    // 5. Create a comprehensive README
    writeFileSync(join(tmpDir, 'README.md'), '# Project\n## Description\nDesc\n## Installation\nInstall it.\n## Usage\nRun my-cli.\n## License\nMIT. Also uses .customconfig.json.\n## Contributing\nGuidelines');

    const result = validateDocsCoverage(tmpDir, {});

    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.warnings.length, 0);
    assert.ok(result.passed > 0);
    assert.strictEqual(result.passed, result.total);
  });
});
