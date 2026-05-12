import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateSchemaSync } from '../cli/validators/schema-sync.mjs';

describe('validateSchemaSync', () => {
  let projectDir;
  let docsCanonicalDir;
  let dataModelPath;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-schema-sync-'));
    docsCanonicalDir = join(projectDir, 'docs-canonical');
    dataModelPath = join(docsCanonicalDir, 'DATA-MODEL.md');
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('should return 0 passed/warnings if no DATA-MODEL.md and no schemas are found', () => {
    const results = validateSchemaSync(projectDir, {});
    assert.deepEqual(results.errors, []);
    assert.deepEqual(results.warnings, []);
    assert.equal(results.passed, 0);
    assert.equal(results.total, 0);
  });

  it('should warn if no DATA-MODEL.md exists but schemas are found', () => {
    // Create a mock Prisma schema
    const prismaDir = join(projectDir, 'prisma');
    fs.mkdirSync(prismaDir, { recursive: true });
    fs.writeFileSync(join(prismaDir, 'schema.prisma'), 'model User { id Int @id }');

    const results = validateSchemaSync(projectDir, {});

    assert.deepEqual(results.errors, []);
    assert.equal(results.passed, 0);
    assert.equal(results.total, 1);
    assert.equal(results.warnings.length, 1);
    assert.match(results.warnings[0], /Found 1 database model\(s\) \(User\)/);
    assert.match(results.warnings[0], /no DATA-MODEL.md exists/);
  });

  it('should pass for schemas that are documented in DATA-MODEL.md', () => {
    // Create DATA-MODEL.md
    fs.mkdirSync(docsCanonicalDir, { recursive: true });
    fs.writeFileSync(dataModelPath, 'Entity Definitions\n- users: Represents a user');

    // Create a mock Drizzle schema
    const drizzleDir = join(projectDir, 'src', 'db');
    fs.mkdirSync(drizzleDir, { recursive: true });
    fs.writeFileSync(join(drizzleDir, 'schema.ts'), "export const users = pgTable('users', {});");

    // Create a mock Prisma schema (tests pluralization/case insensitivity, 'User' documented as 'users')
    const prismaDir = join(projectDir, 'prisma');
    fs.mkdirSync(prismaDir, { recursive: true });
    fs.writeFileSync(join(prismaDir, 'schema.prisma'), 'model User { id Int @id }');

    const results = validateSchemaSync(projectDir, {});

    assert.deepEqual(results.errors, []);
    assert.deepEqual(results.warnings, []);
    assert.equal(results.passed, 2);
    assert.equal(results.total, 2);
  });

  it('should warn for schemas that are not documented in DATA-MODEL.md', () => {
    // Create DATA-MODEL.md without the models
    fs.mkdirSync(docsCanonicalDir, { recursive: true });
    fs.writeFileSync(dataModelPath, 'Entity Definitions\n- other: Other thing');

    // Create a mock Prisma schema
    const prismaDir = join(projectDir, 'prisma');
    fs.mkdirSync(prismaDir, { recursive: true });
    fs.writeFileSync(join(prismaDir, 'schema.prisma'), 'model Product { id Int @id }');

    const results = validateSchemaSync(projectDir, {});

    assert.deepEqual(results.errors, []);
    assert.equal(results.passed, 0);
    assert.equal(results.total, 1);
    assert.equal(results.warnings.length, 1);
    assert.match(results.warnings[0], /model "Product"/);
    assert.match(results.warnings[0], /not documented in DATA-MODEL.md/);
  });

  it('should ignore common utility models like migrations', () => {
    // Create DATA-MODEL.md
    fs.mkdirSync(docsCanonicalDir, { recursive: true });
    fs.writeFileSync(dataModelPath, 'Entity Definitions\n');

    // Create mock schema with utility model names
    const prismaDir = join(projectDir, 'prisma');
    fs.mkdirSync(prismaDir, { recursive: true });
    fs.writeFileSync(join(prismaDir, 'schema.prisma'), `
      model migration { id Int @id }
      model _prisma_migrations { id Int @id }
      model seed { id Int @id }
    `);

    const results = validateSchemaSync(projectDir, {});

    // Total should be 0 because utility models are ignored during detection
    assert.deepEqual(results.errors, []);
    assert.deepEqual(results.warnings, []);
    assert.equal(results.passed, 0);
    assert.equal(results.total, 0);
  });
});
