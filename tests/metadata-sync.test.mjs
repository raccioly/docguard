import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateMetadataSync } from '../cli/validators/metadata-sync.mjs';

describe('Metadata Sync Validator', () => {
  it('returns empty results if package.json is missing', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-meta-'));
    try {
      const result = validateMetadataSync(tmpDir, {});
      assert.deepEqual(result, { errors: [], warnings: [], passed: 0, total: 0 });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty results if package.json is malformed', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-meta-'));
    try {
      writeFileSync(join(tmpDir, 'package.json'), '{ malformed json');
      const result = validateMetadataSync(tmpDir, {});
      assert.deepEqual(result, { errors: [], warnings: [], passed: 0, total: 0 });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty results if package.json has no version', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-meta-'));
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: "test" }));
      const result = validateMetadataSync(tmpDir, {});
      assert.deepEqual(result, { errors: [], warnings: [], passed: 0, total: 0 });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects mismatched version in extension.yml', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-meta-'));
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ version: "1.0.0" }));
      mkdirSync(join(tmpDir, 'extensions'));
      writeFileSync(join(tmpDir, 'extensions', 'extension.yml'), 'version: "0.9.0"\n');

      const result = validateMetadataSync(tmpDir, {});
      assert.equal(result.total, 1);
      assert.equal(result.passed, 0);
      assert.equal(result.warnings.length, 1);
      assert.ok(result.warnings[0].includes('0.9.0'));
      assert.ok(result.warnings[0].includes('1.0.0'));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects matching version in root extension.yml', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-meta-'));
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ version: "1.0.0" }));
      writeFileSync(join(tmpDir, 'extension.yml'), 'version: "1.0.0"\n');

      const result = validateMetadataSync(tmpDir, {});
      assert.equal(result.total, 1);
      assert.equal(result.passed, 1);
      assert.equal(result.warnings.length, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects older version references in actionable contexts in markdown', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-meta-'));
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ version: "1.1.0" }));
      writeFileSync(join(tmpDir, 'README.md'), 'Download /download/v1.0.0/');
      writeFileSync(join(tmpDir, 'INSTALL.md'), 'npm install @1.0.0');
      writeFileSync(join(tmpDir, 'extension.md'), 'version: "1.0.0"');

      const result = validateMetadataSync(tmpDir, { ignore: [] });
      assert.equal(result.total, 3);
      assert.equal(result.warnings.length, 3);
      assert.ok(result.warnings.some(w => w.includes('v1.0.0')));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('passes current version references in markdown', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-meta-'));
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ version: "1.1.0" }));
      writeFileSync(join(tmpDir, 'README.md'), 'Download /download/v1.1.0/');
      writeFileSync(join(tmpDir, 'INSTALL.md'), 'npm install @1.1.0');

      const result = validateMetadataSync(tmpDir, { ignore: [] });
      assert.equal(result.total, 2);
      assert.equal(result.passed, 2);
      assert.equal(result.warnings.length, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips CHANGELOG.md and DRIFT-LOG.md', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-meta-'));
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ version: "1.1.0" }));
      writeFileSync(join(tmpDir, 'CHANGELOG.md'), 'Version: "1.0.0"');
      writeFileSync(join(tmpDir, 'DRIFT-LOG.md'), 'Download /download/v1.0.0/');

      const result = validateMetadataSync(tmpDir, { ignore: [] });
      assert.equal(result.total, 0);
      assert.equal(result.passed, 0);
      assert.equal(result.warnings.length, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips non-actionable version strings in prose', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'sg-meta-'));
      try {
        writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ version: "1.1.0" }));
        writeFileSync(join(tmpDir, 'README.md'), 'In v1.0.0 we added a feature.');

        const result = validateMetadataSync(tmpDir, { ignore: [] });
        // The regex looks for actionable contexts. "In v1.0.0" doesn't match the actionable patterns.
        assert.equal(result.total, 0);
        assert.equal(result.passed, 0);
        assert.equal(result.warnings.length, 0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
  });
});
