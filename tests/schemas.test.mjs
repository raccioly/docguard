import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { generateERDiagram } from '../cli/scanners/schemas.mjs';

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
