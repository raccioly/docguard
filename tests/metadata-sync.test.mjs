import { makeTempDir } from './helpers/temp-dir.mjs';
// @implements docguard.test-temp-dirs#FR-004: this file's temporary directories come from the helper.
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { validateMetadataSync } from '../cli/validators/metadata-sync.mjs';
import { legacyShape } from './helpers/legacy-result.mjs';

describe('Metadata Sync Validator', () => {
  it('returns empty results if package.json is missing', () => {
    const tmpDir = makeTempDir('sg-meta-');
    try {
      const result = validateMetadataSync(tmpDir, {});
      assert.deepEqual(legacyShape(result), { errors: [], warnings: [], passed: 0, total: 0 });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty results if package.json is malformed', () => {
    const tmpDir = makeTempDir('sg-meta-');
    try {
      writeFileSync(join(tmpDir, 'package.json'), '{ malformed json');
      const result = validateMetadataSync(tmpDir, {});
      assert.deepEqual(legacyShape(result), { errors: [], warnings: [], passed: 0, total: 0 });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty results if package.json has no version', () => {
    const tmpDir = makeTempDir('sg-meta-');
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: "test" }));
      const result = validateMetadataSync(tmpDir, {});
      assert.deepEqual(legacyShape(result), { errors: [], warnings: [], passed: 0, total: 0 });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects mismatched version in extension.yml', () => {
    const tmpDir = makeTempDir('sg-meta-');
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
    const tmpDir = makeTempDir('sg-meta-');
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
    const tmpDir = makeTempDir('sg-meta-');
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: "myapp", version: "1.1.0" }));
      writeFileSync(join(tmpDir, 'README.md'), 'Download https://example.com/myapp/download/v1.0.0/');
      // Package-qualified install command (the realistic form). The bare
      // `@1.0.0` the old fixture used is now intentionally NOT matched.
      writeFileSync(join(tmpDir, 'INSTALL.md'), 'npm install myapp@1.0.0');
      writeFileSync(join(tmpDir, 'extension.md'), '# myapp\n\nversion: "1.0.0"');

      const result = validateMetadataSync(tmpDir, { ignore: [] });
      assert.equal(result.total, 3);
      assert.equal(result.warnings.length, 3);
      assert.ok(result.warnings.some(w => w.includes('v1.0.0')));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('passes current version references in markdown', () => {
    const tmpDir = makeTempDir('sg-meta-');
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: "myapp", version: "1.1.0" }));
      writeFileSync(join(tmpDir, 'README.md'), 'Download https://example.com/myapp/download/v1.1.0/');
      writeFileSync(join(tmpDir, 'INSTALL.md'), 'npm install myapp@1.1.0');

      const result = validateMetadataSync(tmpDir, { ignore: [] });
      assert.equal(result.total, 2);
      assert.equal(result.passed, 2);
      assert.equal(result.warnings.length, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does NOT read a version stated for another tool (a URL for another project, a key that merely ends in version:)', () => {
    const tmpDir = makeTempDir('sg-meta-');
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: "myapp", version: "1.1.0" }));
      writeFileSync(join(tmpDir, 'README.md'), 'myapp hooks\n\nminimum_pre_commit_version: 1.0.0\nSee https://example.com/other-tool/releases/download/v1.0.0/ too.\n');
      const result = validateMetadataSync(tmpDir, { ignore: [] });
      assert.equal(result.total, 0);
      assert.equal(result.warnings.length, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does NOT flag @version refs for OTHER packages (over-match fix)', () => {
    const tmpDir = makeTempDir('sg-meta-');
    try {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: "myapp", version: "2.0.0" }));
      // All of these are unrelated `@x.y.z` — a bare /@(\d+\.\d+\.\d+)/ used to
      // flag every one of them as a stale "myapp" reference.
      writeFileSync(join(tmpDir, 'README.md'),
        'Requires node@18.2.0 and @types/node@1.2.3. See release 1.0.0 of another tool.');
      const result = validateMetadataSync(tmpDir, { ignore: [] });
      assert.equal(result.warnings.length, 0,
        'unrelated @-versioned packages must not be reported as stale refs to this package');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips CHANGELOG.md and DRIFT-LOG.md', () => {
    const tmpDir = makeTempDir('sg-meta-');
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
      const tmpDir = makeTempDir('sg-meta-');
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
