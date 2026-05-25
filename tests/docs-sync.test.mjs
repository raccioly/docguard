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

  // ── v0.11.1 regressions: FP-1, FP-2 ─────────────────────────────────────

  describe('FP-1: src/api/ is frontend client, not backend route', () => {
    // @req FR-001 — drop bare 'api' from route-dir conventions
    // @req SC-001 — frontend client not flagged
    it('does not treat src/api/*.ts as a route file', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'api.md'), 'docs');

      // Frontend axios client — must NOT be scanned as a route
      mkdirSync(join(tmpDir, 'src/api'), { recursive: true });
      writeFileSync(join(tmpDir, 'src/api/client.ts'), 'export const apiClient = {};');
      writeFileSync(join(tmpDir, 'src/api/agentStatus.ts'), 'export const fetchStatus = () => {};');

      const result = validateDocsSync(tmpDir, {});

      // No warnings about src/api/* — bare 'api' was dropped from route conventions
      const apiWarnings = result.warnings.filter(w => w.includes('src/api/'));
      assert.strictEqual(apiWarnings.length, 0,
        `Expected no warnings about src/api/, got: ${JSON.stringify(apiWarnings)}`);
    });

    // @req FR-002 — Next.js strict route.{ts,js} matching
    it('only matches route.{ts,js} inside src/app/api (Next.js convention)', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'api.md'), 'docs');

      mkdirSync(join(tmpDir, 'src/app/api/users'), { recursive: true });
      // Next.js route handler — IS a route
      writeFileSync(join(tmpDir, 'src/app/api/users/route.ts'), 'export async function GET() {}');
      // Helper file — NOT a route
      writeFileSync(join(tmpDir, 'src/app/api/users/helpers.ts'), 'export const x = 1;');

      const result = validateDocsSync(tmpDir, {});

      // Exactly one file (route.ts) should be checked; helpers.ts must be skipped
      const routeWarnings = result.warnings.filter(w => w.startsWith('route '));
      assert.strictEqual(routeWarnings.length, 1,
        `Expected 1 route warning (route.ts), got ${routeWarnings.length}: ${JSON.stringify(routeWarnings)}`);
      assert.ok(routeWarnings[0].includes('route.ts'),
        `Warning should mention route.ts, got: ${routeWarnings[0]}`);
      // Helpers.ts must NOT appear
      const helperWarnings = result.warnings.filter(w => w.includes('helpers.ts'));
      assert.strictEqual(helperWarnings.length, 0);
    });
  });

  describe('FP-2: test files are not services or routes', () => {
    // @req FR-003 — skip __tests__/ paths
    // @req FR-004 — __tests__ in IGNORE_DIRS
    // @req SC-002 — test files not flagged as undocumented services
    it('does not flag __tests__/ files in service dirs', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 's.md'), 'docs');

      mkdirSync(join(tmpDir, 'src/services/__tests__'), { recursive: true });
      writeFileSync(join(tmpDir, 'src/services/userService.ts'), 'export class UserService {}');
      writeFileSync(join(tmpDir, 'src/services/__tests__/userService.test.ts'),
        'import { UserService } from "../userService";');

      const result = validateDocsSync(tmpDir, {});

      const testWarnings = result.warnings.filter(w => w.includes('.test.ts') || w.includes('__tests__'));
      assert.strictEqual(testWarnings.length, 0,
        `Expected no warnings about test files, got: ${JSON.stringify(testWarnings)}`);
    });

    // @req FR-003 — *.test.* / *.spec.* file basename exclusion
    it('does not flag *.test.ts files even without __tests__/ dir', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 's.md'), 'docs');

      mkdirSync(join(tmpDir, 'src/services'), { recursive: true });
      writeFileSync(join(tmpDir, 'src/services/auth.ts'), 'export const auth = {};');
      writeFileSync(join(tmpDir, 'src/services/auth.test.ts'), 'test stuff');
      writeFileSync(join(tmpDir, 'src/services/auth.spec.ts'), 'more test stuff');

      const result = validateDocsSync(tmpDir, {});

      const testWarnings = result.warnings.filter(w => w.includes('.test.') || w.includes('.spec.'));
      assert.strictEqual(testWarnings.length, 0,
        `Expected no warnings about test/spec files, got: ${JSON.stringify(testWarnings)}`);
    });

    // @req FR-003 — test-file exclusion in OpenAPI cross-check loop too
    it('does not flag __tests__/ in route dirs (OpenAPI cross-check)', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'api.md'), 'mentions userRoutes');
      writeFileSync(join(tmpDir, 'openapi.yaml'), 'paths:\n  /users:\n    get:\n');

      mkdirSync(join(tmpDir, 'src/routes/__tests__'), { recursive: true });
      writeFileSync(join(tmpDir, 'src/routes/userRoutes.ts'), "app.get('/users', () => {})");
      writeFileSync(join(tmpDir, 'src/routes/__tests__/userRoutes.test.ts'), 'test');

      const result = validateDocsSync(tmpDir, {});

      const testWarnings = result.warnings.filter(w => w.includes('.test.ts'));
      assert.strictEqual(testWarnings.length, 0,
        `Expected no warnings about test files in route dir, got: ${JSON.stringify(testWarnings)}`);
    });

    it('still checks non-test files normally (no over-suppression)', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 's.md'), 'unrelated');

      mkdirSync(join(tmpDir, 'src/services'), { recursive: true });
      writeFileSync(join(tmpDir, 'src/services/orphanService.ts'), 'export const x = 1;');

      const result = validateDocsSync(tmpDir, {});

      // Real undocumented service still flagged
      assert.ok(result.warnings.some(w => w.includes('orphanService.ts')),
        `Expected warning about orphanService.ts, got: ${JSON.stringify(result.warnings)}`);
    });
  });
});
