import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateSecurity } from '../cli/validators/security.mjs';

describe('Security Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-security-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when no secrets are found and .gitignore includes .env', () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules\n.env\n');
    writeFileSync(join(tmpDir, 'index.js'), 'console.log("Hello, world!");');

    const config = {};
    const result = validateSecurity(tmpDir, config);

    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.warnings.length, 0);
    assert.strictEqual(result.passed, 2); // 1 for no findings, 1 for gitignore
    assert.strictEqual(result.total, 2);
  });

  it('detects hardcoded secrets in code files', () => {
    writeFileSync(join(tmpDir, '.gitignore'), '.env\n');
    writeFileSync(join(tmpDir, 'config.js'), 'const apiKey = "1234567890abcdef1234567890";'); // > 16 chars

    const config = {};
    const result = validateSecurity(tmpDir, config);

    assert.strictEqual(result.errors.length, 1);
    assert.match(result.errors[0], /config\.js: possible hardcoded API key found/);
    assert.strictEqual(result.passed, 1); // Only gitignore passed
  });

  it('ignores .env, .env.local, and .env.example files', () => {
    writeFileSync(join(tmpDir, '.gitignore'), '.env\n');
    writeFileSync(join(tmpDir, '.env'), 'API_KEY="1234567890abcdef1234567890"');
    writeFileSync(join(tmpDir, '.env.local'), 'API_KEY="1234567890abcdef1234567890"');
    writeFileSync(join(tmpDir, '.env.example'), 'API_KEY="1234567890abcdef1234567890"');

    const config = {};
    const result = validateSecurity(tmpDir, config);

    assert.strictEqual(result.errors.length, 0);
  });

  it('ignores safe placeholders', () => {
    writeFileSync(join(tmpDir, '.gitignore'), '.env\n');
    writeFileSync(join(tmpDir, 'safe.js'), 'const apiKey = "EXAMPLE_1234567890abcdef";\nconst password = "password123";');

    const config = {};
    const result = validateSecurity(tmpDir, config);

    assert.strictEqual(result.errors.length, 0);
  });

  it('warns if .gitignore is missing .env', () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules\n');
    writeFileSync(join(tmpDir, 'index.js'), 'console.log("Hello");');

    const config = {};
    const result = validateSecurity(tmpDir, config);

    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0], /\.gitignore does not include \.env/);
  });

  it('warns if .gitignore is totally missing', () => {
    writeFileSync(join(tmpDir, 'index.js'), 'console.log("Hello");');

    const config = {};
    const result = validateSecurity(tmpDir, config);

    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0], /No \.gitignore found/);
  });

  it('respects config.securityIgnore', () => {
    writeFileSync(join(tmpDir, '.gitignore'), '.env\n');
    writeFileSync(join(tmpDir, 'ignored-file.js'), 'const apiKey = "1234567890abcdef1234567890";');

    const config = { securityIgnore: ['ignored-file.js'] };
    const result = validateSecurity(tmpDir, config);

    assert.strictEqual(result.errors.length, 0);
  });

  it('ignores files in ignored directories like node_modules', () => {
    writeFileSync(join(tmpDir, '.gitignore'), '.env\n');
    mkdirSync(join(tmpDir, 'node_modules'));
    writeFileSync(join(tmpDir, 'node_modules', 'bad-module.js'), 'const apiKey = "1234567890abcdef1234567890";');

    const config = {};
    const result = validateSecurity(tmpDir, config);

    assert.strictEqual(result.errors.length, 0);
  });
});
