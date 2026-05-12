import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDocsSync } from '../cli/validators/docs-sync.mjs';

describe('Docs-Sync Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty results if no canonical docs exist', () => {
    mkdirSync(join(tmpDir, 'src/routes'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/routes/user.js'), 'export const getUser = () => {};');

    const result = validateDocsSync(tmpDir, {});

    assert.strictEqual(result.name, 'docs-sync');
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.warnings.length, 0);
    assert.strictEqual(result.errors.length, 0);
  });

  it('warns if route file is not mentioned in canonical docs', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'api.md'), 'Some canonical docs.');

    mkdirSync(join(tmpDir, 'src/routes'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/routes/user.js'), 'export const getUser = () => {};');

    const result = validateDocsSync(tmpDir, {});

    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('src/routes/user.js not referenced'));
  });

  it('passes if route file is mentioned in canonical docs by path', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'api.md'), 'Mentions src/routes/user.js explicitly.');

    mkdirSync(join(tmpDir, 'src/routes'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/routes/user.js'), 'export const getUser = () => {};');

    const result = validateDocsSync(tmpDir, {});

    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('passes if route file is mentioned in canonical docs by name', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'api.md'), 'Mentions user explicitly.');

    mkdirSync(join(tmpDir, 'src/routes'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/routes/user.js'), 'export const getUser = () => {};');

    const result = validateDocsSync(tmpDir, {});

    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('warns if service file is not mentioned in canonical docs', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'services.md'), 'Some canonical docs.');

    mkdirSync(join(tmpDir, 'src/services'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/services/auth.js'), 'export const login = () => {};');

    const result = validateDocsSync(tmpDir, {});

    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('Service src/services/auth.js not referenced'));
  });

  it('passes if service file is mentioned in canonical docs', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'services.md'), 'We use the auth service.');

    mkdirSync(join(tmpDir, 'src/services'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/services/auth.js'), 'export const login = () => {};');

    const result = validateDocsSync(tmpDir, {});

    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('cross-checks route files against OpenAPI spec and passes when route path matches', () => {
    // Both canonical doc and OpenAPI spec exist to pass the first and second checks
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'api.md'), 'Mentions user API.');

    // OpenAPI spec with /api/users
    writeFileSync(join(tmpDir, 'openapi.yaml'), 'paths:\n  /api/users:\n    get:\n');

    // Route file defining /api/users
    mkdirSync(join(tmpDir, 'src/routes'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/routes/user.js'), "app.get('/api/users', () => {})");

    const result = validateDocsSync(tmpDir, {});

    // First loop: route file vs canonical docs -> passed (name 'user' is in docs)
    // Second loop: route vs openapi -> passed (/api/users is in openapi.yaml)
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.passed, 2);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('cross-checks route files against OpenAPI spec and warns when route not found', () => {
    // Both canonical doc and OpenAPI spec exist
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'api.md'), 'Mentions src/routes/user.js');

    // OpenAPI spec with /api/something_else
    writeFileSync(join(tmpDir, 'openapi.yaml'), 'paths:\n  /api/something_else:\n    get:\n');

    // Route file defining /api/users
    mkdirSync(join(tmpDir, 'src/routes'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/routes/user.js'), "app.get('/api/users', () => {})");

    const result = validateDocsSync(tmpDir, {});

    // First loop: route file vs canonical docs -> passed
    // Second loop: route vs openapi -> failed
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.passed, 1); // canonical doc check passed
    assert.strictEqual(result.warnings.length, 1); // openapi check warned
    assert.ok(result.warnings[0].includes('no matching paths found in openapi.yaml'));
  });

  it('falls back to filename check for OpenAPI spec when no actual routes match', () => {
    // Canonical doc
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'api.md'), 'userRoutes');

    // OpenAPI spec containing 'user'
    writeFileSync(join(tmpDir, 'openapi.yaml'), 'paths:\n  /v1/user:\n    get:\n');

    // Route file with no identifiable app.get(...) paths, but named userRoutes.js
    mkdirSync(join(tmpDir, 'src/routes'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/routes/userRoutes.js'), "function handler() {}");

    const result = validateDocsSync(tmpDir, {});

    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.passed, 2);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('skips non-source files when checking routes', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'api.md'), 'user');

    mkdirSync(join(tmpDir, 'src/routes'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/routes/README.md'), 'Just some docs');
    writeFileSync(join(tmpDir, 'src/routes/user.js'), 'export const getUser = () => {};');

    const result = validateDocsSync(tmpDir, {});

    assert.strictEqual(result.total, 1);
  });
});
