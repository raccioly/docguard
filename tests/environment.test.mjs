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

  it('## Setup Steps satisfies the setup section but NOT the Environment Variables section', () => {
    // Previously "## Setup Steps" wrongly satisfied BOTH checks; now each section
    // must be present on its own.
    fs.writeFileSync(envDocPath, '## Setup Steps\nDo this and that.', 'utf-8');
    const results = validateEnvironment(tempDir, {});
    assert.equal(results.total, 3); // 2 section checks + 1 .env file check
    assert.equal(results.passed, 2); // setup section + .env file check; Env Vars section missing
    assert.equal(results.warnings.length, 1);
    assert.ok(results.warnings[0].includes('missing "## Environment Variables"'));
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

  it('flags an env var used in code (process.env) but not documented', () => {
    fs.writeFileSync(envDocPath, '## Prerequisites\n## Environment Variables\n`DOCUMENTED_VAR` is set.', 'utf-8');
    fs.mkdirSync(join(tempDir, 'backend', 'src'), { recursive: true });
    fs.writeFileSync(join(tempDir, 'backend', 'src', 'config.ts'),
      'const a = process.env.UNDOCUMENTED_SECRET;\nconst b = process.env.DOCUMENTED_VAR;');
    const config = { sourceRoot: 'backend/src', projectTypeConfig: { needsEnvVars: true } };
    const results = validateEnvironment(tempDir, config);
    assert.ok(
      results.warnings.some(w => w.includes('UNDOCUMENTED_SECRET')),
      'should flag the undocumented env var used in code'
    );
    assert.ok(
      !results.warnings.some(w => w.includes('DOCUMENTED_VAR')),
      'documented var should not be flagged'
    );
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

  // Regression for hugocross Bug 3: variables documented in a markdown pipe
  // table WITHOUT backticks around the name were silently treated as
  // undocumented, even though they were clearly present in the doc. Both
  // forms (`| `VAR` | desc |` and `| VAR | desc |`) must now count as
  // documented; the suffix-strip alternative theory from the original report
  // turned out NOT to be the actual root cause.
  it('recognises env vars in markdown table rows without backticks (hugocross bug 3)', () => {
    fs.writeFileSync(envDocPath, [
      '## Prerequisites',
      '## Environment Variables',
      '',
      '| Variable              | Description                | Required |',
      '|-----------------------|----------------------------|----------|',
      '| DYNAMODB_TABLE_JOBS   | DynamoDB table for jobs    | Yes      |',
      '| DYNAMODB_TABLE_SOURCES| DynamoDB table for sources | Yes      |',
      '',
    ].join('\n'), 'utf-8');
    fs.mkdirSync(join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(join(tempDir, 'src', 'index.js'), [
      'const a = process.env.DYNAMODB_TABLE_JOBS;',
      'const b = process.env.DYNAMODB_TABLE_SOURCES;',
    ].join('\n'), 'utf-8');

    const results = validateEnvironment(tempDir, {});
    const undocumentedWarning = results.warnings.find(w => w.includes('not documented'));
    assert.strictEqual(undocumentedWarning, undefined,
      `expected no undocumented warning; got: ${results.warnings.join('\n')}`);
  });

  // Regression for v0.20 field-test bug: `grepEnvUsage` only matched
  // JavaScript env-var access patterns. On a Python project, every
  // documented env var was reported as "in docs but not in code" because
  // `os.environ[...]`, `os.environ.get(...)`, and `os.getenv(...)` were all
  // invisible to the scanner — despite the `explain` command and templates
  // telling users these forms were supported.
  it('detects Python os.environ access patterns (v0.20 bug)', () => {
    fs.writeFileSync(envDocPath, [
      '## Prerequisites',
      '## Environment Variables',
      '',
      '| Variable              | Description |',
      '|-----------------------|-------------|',
      '| `DATABASE_URL`        | DB URL      |',
      '| `PYTEST_CURRENT_TEST` | Pytest flag |',
      '| `LOG_LEVEL`           | Log level   |',
      '',
    ].join('\n'), 'utf-8');
    fs.mkdirSync(join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(join(tempDir, 'src', 'app.py'), [
      'import os',
      'db = os.environ["DATABASE_URL"]',
      'if os.environ.get("PYTEST_CURRENT_TEST"):',
      '    pass',
      'level = os.getenv("LOG_LEVEL")',
    ].join('\n'), 'utf-8');

    const results = validateEnvironment(tempDir, {});
    const undocumentedWarning = results.warnings.find(w => w.includes('not documented'));
    assert.strictEqual(undocumentedWarning, undefined,
      `expected no undocumented warning; got: ${results.warnings.join('\n')}`);
  });
});
