import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateEnvironment } from '../cli/validators/environment.mjs';

describe('validateEnvironment', () => {
  let tempDir;
  let docsCanonicalDir;
  let envDocPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-environment-'));
    docsCanonicalDir = join(tempDir, 'docs-canonical');
    fs.mkdirSync(docsCanonicalDir, { recursive: true });
    envDocPath = join(docsCanonicalDir, 'ENVIRONMENT.md');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns base results if ENVIRONMENT.md is missing', () => {
    const results = validateEnvironment(tempDir, {});
    assert.deepEqual(results, {
      name: 'environment',
      errors: [],
      warnings: [],
      passed: 0,
      total: 0
    });
  });

  it('issues warnings if required sections are missing', () => {
    fs.writeFileSync(envDocPath, 'Some content', 'utf-8');
    const results = validateEnvironment(tempDir, {});
    assert.equal(results.total, 3); // 2 sections checks + 1 .env file check
    assert.equal(results.passed, 1); // 0 sections passed + 1 .env file check passed (none exist)
    assert.equal(results.warnings.length, 2);
    assert.ok(results.warnings[0].includes('missing "## Prerequisites" or "## Setup Steps"'));
    assert.ok(results.warnings[1].includes('missing "## Environment Variables"'));
  });

  it('passes both section checks if ## Setup Steps is present', () => {
    // ## Setup Steps counts for BOTH the prerequisite check AND the environment variables check based on validateEnvironment code
    fs.writeFileSync(envDocPath, '## Setup Steps\nDo this and that.', 'utf-8');
    const results = validateEnvironment(tempDir, {});
    assert.equal(results.total, 3); // 2 section checks + 1 .env file check
    assert.equal(results.passed, 3); // both passed + 1 .env file check passed
    assert.equal(results.warnings.length, 0);
  });

  it('issues a warning if .env.example is referenced but does not exist', () => {
    fs.writeFileSync(envDocPath, '## Prerequisites\n## Environment Variables\nCopy .env.example to .env', 'utf-8');
    const results = validateEnvironment(tempDir, {});
    // total: 2 section checks + 1 ref check + 1 .env file check = 4
    assert.equal(results.total, 4);
    // passed: 2 section checks + 0 ref check + 1 .env file check passed = 3
    assert.equal(results.passed, 3);
    assert.equal(results.warnings.length, 1);
    assert.ok(results.warnings[0].includes('references .env.example but the file does not exist'));
  });

  it('passes if .env.example is referenced and exists', () => {
    fs.writeFileSync(envDocPath, '## Prerequisites\n## Environment Variables\nCopy .env.example to .env', 'utf-8');
    fs.writeFileSync(join(tempDir, '.env.example'), 'VAR=1', 'utf-8');
    const results = validateEnvironment(tempDir, {});
    // total: 2 section checks + 1 ref check + 1 .env file check = 4
    assert.equal(results.total, 4);
    // passed: 2 section checks + 1 ref check + 1 .env file check passed = 4
    assert.equal(results.passed, 4);
    assert.equal(results.warnings.length, 0);
  });

  it('issues a warning if .env exists but .env.example does not', () => {
    fs.writeFileSync(envDocPath, '## Prerequisites\n## Environment Variables', 'utf-8');
    fs.writeFileSync(join(tempDir, '.env'), 'VAR=1', 'utf-8');
    const results = validateEnvironment(tempDir, {});
    assert.equal(results.total, 3); // 2 section checks + 1 env file check
    assert.equal(results.passed, 2); // 2 section checks
    assert.equal(results.warnings.length, 1);
    assert.ok(results.warnings[0].includes('.env file exists but no .env.example template'));
  });

  it('issues a warning if .env.local exists but .env.example does not', () => {
    fs.writeFileSync(envDocPath, '## Prerequisites\n## Environment Variables', 'utf-8');
    fs.writeFileSync(join(tempDir, '.env.local'), 'VAR=1', 'utf-8');
    const results = validateEnvironment(tempDir, {});
    assert.equal(results.total, 3);
    assert.equal(results.passed, 2);
    assert.equal(results.warnings.length, 1);
    assert.ok(results.warnings[0].includes('.env file exists but no .env.example template'));
  });

  it('issues a warning if .env.development exists but .env.example does not', () => {
    fs.writeFileSync(envDocPath, '## Prerequisites\n## Environment Variables', 'utf-8');
    fs.writeFileSync(join(tempDir, '.env.development'), 'VAR=1', 'utf-8');
    const results = validateEnvironment(tempDir, {});
    assert.equal(results.total, 3);
    assert.equal(results.passed, 2);
    assert.equal(results.warnings.length, 1);
    assert.ok(results.warnings[0].includes('.env file exists but no .env.example template'));
  });

  it('bypasses .env.example checks if needsEnvExample is false', () => {
    fs.writeFileSync(envDocPath, '## Prerequisites\n## Environment Variables\nCopy .env.example to .env', 'utf-8');
    fs.writeFileSync(join(tempDir, '.env'), 'VAR=1', 'utf-8');
    const config = { projectTypeConfig: { needsEnvExample: false } };
    const results = validateEnvironment(tempDir, config);
    // total: 2 section checks + 1 CLI project basic content check = 3
    assert.equal(results.total, 3);
    assert.equal(results.passed, 3);
    assert.equal(results.warnings.length, 0);
  });

  it('bypasses .env.example checks if needsEnvVars is false', () => {
    fs.writeFileSync(envDocPath, '## Prerequisites\n## Environment Variables\nCopy .env.example to .env', 'utf-8');
    fs.writeFileSync(join(tempDir, '.env'), 'VAR=1', 'utf-8');
    const config = { projectTypeConfig: { needsEnvVars: false } };
    const results = validateEnvironment(tempDir, config);
    // total: 2 section checks + 1 CLI project basic content check = 3
    assert.equal(results.total, 3);
    assert.equal(results.passed, 3);
    assert.equal(results.warnings.length, 0);
  });
});
