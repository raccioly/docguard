import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSchemasDeep } from '../cli/scanners/schemas.mjs';

function createTempProject() {
  const projectDir = fs.mkdtempSync(join(tmpdir(), 'docguard-schema-test-'));
  return projectDir;
}

function cleanupTempProject(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('scanSchemasDeep', () => {
  it('prioritizes OpenAPI schemas if found', () => {
    const docTools = {
      openapi: {
        found: true,
        path: 'openapi.yaml',
        schemas: [
          { name: 'User', fields: [{ name: 'id', type: 'integer' }], description: 'User schema' }
        ]
      }
    };
    const result = scanSchemasDeep('.', {}, docTools);

    assert.equal(result.source, 'openapi');
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].name, 'User');
    assert.equal(result.entities[0].source, 'openapi');
  });

  it('collects entities from Prisma', () => {
    const projectDir = createTempProject();
    try {
      fs.mkdirSync(join(projectDir, 'prisma'), { recursive: true });
      fs.writeFileSync(join(projectDir, 'prisma/schema.prisma'), `
        model User {
          id    Int    @id
          email String @unique
        }
      `);

      const result = scanSchemasDeep(projectDir, { orm: 'prisma' }, {});
      assert.ok(result.entities.some(e => e.name === 'User' && e.source === 'prisma'));
      const user = result.entities.find(e => e.name === 'User');
      assert.equal(user.fields.length, 2);
    } finally {
      cleanupTempProject(projectDir);
    }
  });

  it('collects entities from Mongoose', () => {
    const projectDir = createTempProject();
    try {
      fs.mkdirSync(join(projectDir, 'models'), { recursive: true });
      fs.writeFileSync(join(projectDir, 'models/User.js'), `
        const UserSchema = new mongoose.Schema({
          username: String,
          email: { type: String, required: true }
        });
      `);

      const result = scanSchemasDeep(projectDir, { orm: 'mongoose' }, {});
      assert.ok(result.entities.some(e => e.name === 'User' && e.source === 'mongoose'));
    } finally {
      cleanupTempProject(projectDir);
    }
  });

  it('falls back to Zod schemas when no other entities are found', () => {
    const projectDir = createTempProject();
    try {
      fs.mkdirSync(join(projectDir, 'src/schema'), { recursive: true });
      fs.writeFileSync(join(projectDir, 'src/schema/user.ts'), `
        export const UserSchema = z.object({
          id: z.string(),
          name: z.string().optional()
        });
      `);

      const result = scanSchemasDeep(projectDir, {}, {});
      assert.ok(result.entities.some(e => e.name === 'User' && e.source === 'zod'));
      assert.equal(result.source, 'zod');
    } finally {
      cleanupTempProject(projectDir);
    }
  });

  it('returns empty result when nothing is found', () => {
    const projectDir = createTempProject();
    try {
      const result = scanSchemasDeep(projectDir, {}, {});
      assert.equal(result.entities.length, 0);
      assert.equal(result.source, 'none');
    } finally {
      cleanupTempProject(projectDir);
    }
  });
});
