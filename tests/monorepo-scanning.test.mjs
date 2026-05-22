import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateSchemaSync } from '../cli/validators/schema-sync.mjs';
import { collectCodeTests } from '../cli/validators/docs-diff.mjs';
import { validateDocsSync } from '../cli/validators/docs-sync.mjs';

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

describe('monorepo-aware validators (config.sourceRoot)', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'docguard-mono-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('schema-sync finds Prisma models under a sourceRoot package, not just root', () => {
    write(tmp, 'backend/prisma/schema.prisma', 'model User {\n id Int @id\n}\nmodel Order {\n id Int @id\n}');
    write(tmp, 'backend/src/index.ts', 'export {};');
    // DATA-MODEL.md documents only User → Order should be flagged as undocumented.
    write(tmp, 'docs-canonical/DATA-MODEL.md', '### User\nThe user entity.');

    const r = validateSchemaSync(tmp, { sourceRoot: 'backend/src' });
    assert.ok(r.total >= 2, 'should detect models under backend/prisma');
    assert.ok(r.warnings.some(w => w.includes('Order')), 'undocumented Order model should be flagged');
  });

  it('schema-sync is N/A (not a fake pass) when no schema files exist anywhere', () => {
    write(tmp, 'backend/src/index.ts', 'export {};');
    write(tmp, 'docs-canonical/DATA-MODEL.md', '# Data Model\nDynamoDB single-table.');
    const r = validateSchemaSync(tmp, { sourceRoot: 'backend/src' });
    assert.equal(r.total, 0);
    assert.equal(r.errors.length, 0);
  });

  it('collectCodeTests finds nested __tests__, co-located tests, and root e2e', () => {
    write(tmp, 'backend/src/controllers/__tests__/userController.test.ts', 'test');
    write(tmp, 'backend/src/services/foo.test.ts', 'test'); // co-located
    write(tmp, 'e2e/login.spec.ts', 'test'); // root-level e2e
    write(tmp, 'backend/src/index.ts', 'export {};');

    const tests = collectCodeTests(tmp, { sourceRoot: 'backend/src' });
    const rels = [...tests];
    assert.ok(rels.some(t => t.endsWith('userController.test.ts')), 'nested __tests__');
    assert.ok(rels.some(t => t.endsWith('services/foo.test.ts')), 'co-located test');
    assert.ok(rels.some(t => t.endsWith('e2e/login.spec.ts')), 'root e2e');
  });

  it('docs-sync scans routes under the configured sourceRoot', () => {
    write(tmp, 'backend/src/routes/userRoutes.ts', "router.get('/users', h);");
    write(tmp, 'backend/src/index.ts', 'export {};');
    // Canonical doc does NOT mention the route file → should warn (proves it scanned it).
    write(tmp, 'docs-canonical/ARCHITECTURE.md', '# Architecture\nNo routes mentioned here.');

    const r = validateDocsSync(tmp, { sourceRoot: 'backend/src' });
    assert.ok(r.total > 0, 'should have discovered the backend route file');
    assert.ok(r.warnings.some(w => w.includes('userRoutes')), 'undocumented backend route should be flagged');
  });
});
