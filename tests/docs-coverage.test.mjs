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

  it('returns default zeroed object if no docs are found', () => {
    const result = validateDocsCoverage(tmpDir, {});
    assert.deepEqual(result, { errors: [], warnings: [], passed: 0, total: 0 });
  });

  it('Check 1: Project-specific config/dotfiles', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'));

    // Warns if config is not mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');
    writeFileSync(join(tmpDir, 'jest.config.js'), 'export default {}');

    let result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('jest.config.js')), true);

    // Passes if config is mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Uses jest.config.js');
    result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('jest.config.js')), false);
  });

  it('Check 2: package.json bins', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'));
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ bin: { "my-cli": "./index.js" } }));

    // Warns if bin not mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');
    let result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('my-cli')), true);

    // Passes if bin mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Run my-cli tool');
    result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('my-cli')), false);
  });

  it('Check 3: Source Directories', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'));
    mkdirSync(join(tmpDir, 'src'));
    mkdirSync(join(tmpDir, 'src', 'components'));

    // Warns if source dir not mentioned in ARCHITECTURE.md
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');
    let result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('src/components/')), true);

    // Passes if source dir mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'The src/components dir');
    result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('src/components/')), false);
  });

  it('Check 4: Code Referenced Configs', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'));
    mkdirSync(join(tmpDir, 'src'));
    // The regex expects the config to be the first/only string argument matching the pattern
    // or capturing the last one if there are multiple.
    writeFileSync(join(tmpDir, 'src', 'index.js'), "readFileSync('.customrc');");

    // Warns if config not mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');
    let result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('.customrc')), true);

    // Passes if config mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Configures with .customrc');
    result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('.customrc')), false);
  });

  it('Check 5: README sections completeness', () => {
    // Warns about missing sections
    writeFileSync(join(tmpDir, 'README.md'), '# Project Title\n\nSome text');
    let result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('Installation')), true);
    assert.equal(result.warnings.some(w => w.includes('Usage')), true);
    assert.equal(result.warnings.some(w => w.includes('License')), true);

    // Passes if sections are present
    writeFileSync(join(tmpDir, 'README.md'), '# Title\n\n## Installation\n\n## Usage\n\n## License');
    result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('Installation')), false);
    assert.equal(result.warnings.some(w => w.includes('Usage')), false);
    assert.equal(result.warnings.some(w => w.includes('License')), false);
  });
});
