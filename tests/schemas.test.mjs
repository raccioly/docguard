import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSchemasDeep, generateERDiagram } from '../cli/scanners/schemas.mjs';

describe('schemas.mjs - walkDir error handling', () => {
  it('should gracefully handle readdirSync errors during schema scan', () => {
    // We create a temp dir structure that matches drizzle scanning (e.g. src/db)
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-schemas-'));
    const drizzleDir = join(tempDir, 'src', 'db');
    fs.mkdirSync(drizzleDir, { recursive: true });

    // Write a dummy file so it's not totally empty if we wanted it to be found
    fs.writeFileSync(join(drizzleDir, 'schema.ts'), 'export const users = pgTable("users", {});');

    const originalReaddirSync = fs.readdirSync;

    // Mock readdirSync to throw when reading the drizzle dir
    mock.method(fs, 'readdirSync', (path, options) => {
      if (typeof path === 'string' && path.includes(join('src', 'db'))) {
        throw new Error('EACCES: permission denied');
      }
      return originalReaddirSync(path, options);
    });

    try {
      // scanSchemasDeep will eventually call scanDrizzleSchemas, which calls walkDir
      // If walkDir doesn't catch the error, this will throw and fail the test.
      const result = scanSchemasDeep(tempDir, { orm: 'drizzle' }, {});

      // We expect it to complete successfully, even though no entities might be found due to the error
      assert.ok(result);
      assert.ok(Array.isArray(result.entities));
    } finally {
      mock.restoreAll();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('generateERDiagram', () => {
  it('returns empty string for empty entities array', () => {
    const result = generateERDiagram([], []);
    assert.equal(result, '');
  });

  it('generates a basic ER diagram with an entity', () => {
    const entities = [{
      name: 'User',
      source: 'prisma',
      fields: [
        { name: 'id', type: 'Int', primaryKey: true, unique: false },
        { name: 'email', type: 'String', primaryKey: false, unique: true },
        { name: 'name', type: 'String', primaryKey: false, unique: false }
      ]
    }];
    const result = generateERDiagram(entities, []);

    assert.ok(result.includes('erDiagram'));
    assert.ok(result.includes('User {'));
    assert.ok(result.includes('Int id PK'));
    assert.ok(result.includes('String email UK'));
    assert.ok(result.includes('String name'));
  });

  it('limits to 8 fields per entity', () => {
    const entities = [{
      name: 'LargeEntity',
      source: 'prisma',
      fields: Array.from({ length: 10 }).map((_, i) => ({
        name: `field${i}`,
        type: 'String',
        primaryKey: false,
        unique: false
      }))
    }];
    const result = generateERDiagram(entities, []);

    assert.ok(result.includes('field7')); // 8th field (0-indexed)
    assert.ok(!result.includes('field8')); // 9th field should be omitted
  });

  it('skips entities with source "prisma-enum"', () => {
    const entities = [{
      name: 'Role',
      source: 'prisma-enum',
      fields: []
    }];
    const result = generateERDiagram(entities, []);
    assert.ok(!result.includes('Role {'));
  });

  it('generates correct relationship arrows', () => {
    const entities = [
      { name: 'User', source: 'prisma', fields: [] },
      { name: 'Post', source: 'prisma', fields: [] }
    ];

    const relationships = [
      { type: 'one-to-many', from: 'User', to: 'Post', field: 'posts' },
      { type: 'many-to-one', from: 'Post', to: 'User', field: 'author' },
      { type: 'one-to-one', from: 'User', to: 'Profile', field: 'profile' }
    ];

    const result = generateERDiagram(entities, relationships);

    assert.ok(result.includes('User ||--o{ Post : "posts"'));
    assert.ok(result.includes('Post }o--|| User : "author"'));
    assert.ok(result.includes('User ||--|| Profile : "profile"'));
  });

  it('sanitizes field types by replacing non-alphanumeric characters with underscores', () => {
    const entities = [{
      name: 'TypeTest',
      source: 'prisma',
      fields: [
        { name: 'customType', type: 'Custom::Type[]', primaryKey: false, unique: false }
      ]
    }];
    const result = generateERDiagram(entities, []);

    assert.ok(result.includes('Custom__Type__ customType'));
  });
});

describe('scanSchemasDeep — honors config.ignore (.docguardignore consolidation)', () => {
  it('drops entities whose source file the user excluded', () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'docguard-schema-ignore-'));
    fs.mkdirSync(join(dir, 'src', 'schema'), { recursive: true });
    fs.mkdirSync(join(dir, 'src', 'fixtures'), { recursive: true });
    fs.writeFileSync(join(dir, 'src/schema/user.ts'), 'export const UserSchema = z.object({ name: z.string() });');
    fs.writeFileSync(join(dir, 'src/fixtures/fake.ts'), 'export const FakeSchema = z.object({ x: z.string() });');

    const noSpec = { openapi: { found: false } };
    const ignored = scanSchemasDeep(dir, {}, noSpec, { ignore: ['src/fixtures/**'] });
    const names = ignored.entities.map(e => e.name);
    assert.ok(names.includes('User'), `real schema kept; got ${JSON.stringify(names)}`);
    assert.ok(!names.includes('Fake'), `ignored fixtures schema dropped; got ${JSON.stringify(names)}`);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
