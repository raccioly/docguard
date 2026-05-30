import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateSecurity } from '../cli/validators/security.mjs';

describe('validateSecurity', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'docguard-test-security-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('should pass and return no errors when no secrets are found and .gitignore includes .env', () => {
    writeFileSync(join(projectDir, '.gitignore'), 'node_modules\n.env\n');
    writeFileSync(join(projectDir, 'app.js'), 'console.log("Hello, world!");');

    const result = validateSecurity(projectDir, {});

    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.passed, 2); // 1 for no secrets, 1 for correct .gitignore
    assert.equal(result.total, 2);
  });

  it('should flag hardcoded AWS and Stripe keys', () => {
    writeFileSync(join(projectDir, '.gitignore'), '.env');
    writeFileSync(join(projectDir, 'secrets.js'), `
      const awsKey = "AKIAIOSFODNN7TESTING";
      const stripeKey = "sk_live_12345678901234567890";
    `);

    const result = validateSecurity(projectDir, {});

    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some(e => e.includes('secrets.js') && e.includes('AWS Access Key ID')));
    assert.ok(result.errors.some(e => e.includes('secrets.js') && e.includes('API secret key (Stripe/OpenAI pattern)')));
    assert.equal(result.passed, 1); // Only .gitignore check passes
  });

  it('should flag common hardcoded passwords and API keys', () => {
    writeFileSync(join(projectDir, '.gitignore'), '.env');
    writeFileSync(join(projectDir, 'auth.js'), `
      const password = "SuperSecretPassword!";
      const apiKey = "1234567890abcdef1234567890abcdef";
    `);

    const result = validateSecurity(projectDir, {});

    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some(e => e.includes('auth.js') && e.includes('hardcoded password')));
    assert.ok(result.errors.some(e => e.includes('auth.js') && e.includes('hardcoded API key')));
  });

  it('detects a REAL secret that sits below a safe placeholder of the same kind', () => {
    // Regression: the scanner used to inspect only the FIRST match per pattern.
    // A placeholder on the first matching line caused it to skip to the next
    // pattern, missing a real hardcoded key further down the same file.
    writeFileSync(join(projectDir, '.gitignore'), '.env');
    writeFileSync(join(projectDir, 'config.js'), `
      // Example for the docs — should be ignored:
      const exampleKey = "AKIAIOSFODNN7EXAMPLE";
      // The real, accidentally-committed key:
      const awsKey = "AKIAIOSFODNN7REALKEY";
    `);

    const result = validateSecurity(projectDir, {});

    assert.ok(
      result.errors.some(e => e.includes('config.js') && e.includes('AWS Access Key ID')),
      'the real AWS key below the EXAMPLE placeholder must still be flagged'
    );
  });

  it('should skip known safe placeholder values', () => {
    writeFileSync(join(projectDir, '.gitignore'), '.env');
    writeFileSync(join(projectDir, 'examples.js'), `
      const awsKey = "AKIAIOSFODNN7EXAMPLE"; // Contains EXAMPLE
      const testPass = 'password123'; // Matches password123 pattern
      const htmlExample = '<input placeholder="password123">';
      // example: password = "MySecretPassword!";
    `);

    const result = validateSecurity(projectDir, {});

    assert.equal(result.errors.length, 0);
    assert.equal(result.passed, 2);
  });

  it('should ignore .env, .env.local, and .env.example files', () => {
    writeFileSync(join(projectDir, '.gitignore'), '.env');
    writeFileSync(join(projectDir, '.env'), 'PASSWORD="RealSecretPassword123!"');
    writeFileSync(join(projectDir, '.env.local'), 'API_KEY="RealSecretAPIKey1234567890!"');
    writeFileSync(join(projectDir, '.env.example'), 'PASSWORD="RealSecretPassword123!"');

    const result = validateSecurity(projectDir, {});

    // No scannable source files (only .env* which are skipped) → the secret
    // scan is NOT counted as a pass; only the .gitignore check passes, and a
    // warning surfaces that nothing was scanned.
    assert.equal(result.errors.length, 0);
    assert.equal(result.passed, 1);
    assert.ok(result.warnings.some(w => w.includes('No source files were scanned')));
  });

  it('should emit a warning when .gitignore does not contain .env', () => {
    writeFileSync(join(projectDir, '.gitignore'), 'node_modules\n');
    writeFileSync(join(projectDir, 'app.js'), 'console.log("No secrets");');

    const result = validateSecurity(projectDir, {});

    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('.gitignore does not include .env'));
    assert.equal(result.passed, 1); // Only the secrets check passes
  });

  it('should emit a warning when .gitignore is completely missing', () => {
    writeFileSync(join(projectDir, 'app.js'), 'console.log("No secrets");');

    const result = validateSecurity(projectDir, {});

    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('No .gitignore found'));
    assert.equal(result.passed, 1); // Only the secrets check passes
  });

  it('should respect config.securityIgnore to skip files', () => {
    writeFileSync(join(projectDir, '.gitignore'), '.env');
    writeFileSync(join(projectDir, 'ignored-secrets.js'), `
      const password = "SuperSecretPassword!";
    `);

    const result = validateSecurity(projectDir, { securityIgnore: ['ignored-secrets.js'] });

    // The only code file is ignored → nothing scanned for secrets → that
    // sub-check is N/A (warning), and only the .gitignore check passes.
    assert.equal(result.errors.length, 0);
    assert.equal(result.passed, 1);
    assert.ok(result.warnings.some(w => w.includes('No source files were scanned')));
  });

  it('should recursively walk directories and respect IGNORE_DIRS', () => {
    writeFileSync(join(projectDir, '.gitignore'), '.env');

    // Create nested dirs
    const nestedDir = join(projectDir, 'src', 'config');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, 'secrets.js'), 'const apiKey = "1234567890abcdef1234567890abcdef";');

    // Create ignored dir
    const nodeModulesDir = join(projectDir, 'node_modules');
    mkdirSync(nodeModulesDir);
    writeFileSync(join(nodeModulesDir, 'bad-dep.js'), 'const awsKey = "AKIAIOSFODNN7TESTING";');

    const result = validateSecurity(projectDir, {});

    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes('src/config/secrets.js'));
  });
});
