/**
 * TypeORM and Sequelize models in every consumer (spec 056).
 *
 * Each assertion compares a scanner with the ground truth written by hand in
 * tests/fixtures/orm-class-projects.mjs. Each project is written to a fresh
 * temp dir; only the docs test (FR-008) reads repository files.
 *
 * @req docguard.typeorm-models#FR-001
 * @req docguard.typeorm-models#FR-002
 * @req docguard.typeorm-models#FR-003
 * @req docguard.typeorm-models#FR-004
 * @req docguard.typeorm-models#FR-005
 * @req docguard.typeorm-models#FR-006
 * @req docguard.typeorm-models#FR-007
 * @req docguard.typeorm-models#FR-008
 * @req docguard.typeorm-models#SC-001
 * @req docguard.typeorm-models#SC-002
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { writeFiles, UNPARSEABLE } from './fixtures/js-ts-projects.mjs';
import { TYPEORM_FILES, TYPEORM_TRUTH, SEQUELIZE_FILES, SEQUELIZE_TRUTH } from './fixtures/orm-class-projects.mjs';
import { notesSince } from './fixtures/changelog-notes.mjs';
import {
  scanSchemasDeep, discoverOrmSchemaFiles, generateERDiagram, clearWalkDirCache,
} from '../cli/scanners/schemas.mjs';
import { validateSchemaSync } from '../cli/validators/schema-sync.mjs';
import { generateDataModel } from '../cli/writers/doc-generators.mjs';
import { diffEntities } from '../cli/commands/diff.mjs';
import { buildMemoryPlan, clearMemoryPlanCache } from '../cli/scanners/memory-plan.mjs';
import { collectAreaFacts } from '../cli/scanners/as-built.mjs';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  clearWalkDirCache();
  clearMemoryPlanCache();
});

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-056-'));
  dirs.push(dir);
  writeFiles(dir, files);
  return dir;
}

/** The same project with every model file made unparseable. */
function unparseable(files, pattern) {
  const out = { ...files };
  for (const f of Object.keys(out)) if (pattern.test(f) && !f.includes('legacy')) out[f] += UNPARSEABLE;
  return out;
}

const sorted = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
const fieldsByEntity = s => sorted(Object.fromEntries(s.entities.map(e => [e.name, e.fields.map(f => f.name).sort()])));
const relTyped = s => s.relationships.map(r => `${r.from}->${r.to}:${r.field} ${r.type}`).sort();
const fieldFacts = (s, truth) => Object.fromEntries(Object.keys(truth.fields).map(key => {
  const [entity, name] = key.split('.');
  const f = s.entities.find(e => e.name === entity)?.fields.find(x => x.name === name);
  return [key, f ? [f.type, f.required, Boolean(f.primaryKey), Boolean(f.unique), f.default] : null];
}));

function guardModelNames(dir, dataModel = '# Data Model\n') {
  writeFiles(dir, { 'docs-canonical/DATA-MODEL.md': dataModel });
  return validateSchemaSync(dir, {}).findings.filter(f => f.code === 'SCH002')
    .map(f => f.message.match(/model "([^"]+)"/)[1]).sort();
}

const TS_MODEL = /^src\/(entity|posts)\//;
const SEQ_MODEL = /models\//;

// ── FR-001: discovery ──────────────────────────────────────────────────────

describe('FR-001: TypeORM and Sequelize files come from the shared discovery', () => {
  it('finds entity files by their typeorm import, in any layout, and skips MikroORM and the data source', () => {
    const dir = project(TYPEORM_FILES);
    const rel = discoverOrmSchemaFiles(dir, {}).typeorm.map(f => f.slice(dir.length + 1).replace(/\\/g, '/'));
    assert.deepEqual(rel, [
      'src/entity/AuditLog.ts', 'src/entity/Base.ts', 'src/entity/Profile.ts',
      'src/entity/Tag.ts', 'src/entity/User.ts', 'src/posts/post.entity.ts',
    ]);
  });

  it('searches a top-level entities directory and skips test directories', () => {
    const entity = "import { Entity, PrimaryColumn } from 'typeorm';\n@Entity()\nexport class Order { @PrimaryColumn() code: string; }\n";
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { typeorm: '0.3.20' } }),
      'src/index.ts': 'export {};\n', // a source root exists, so the project root is not searched
      'entities/order.entity.ts': entity,
      'src/__tests__/fake.entity.ts': entity.replace('Order', 'Fake'),
    });
    assert.deepEqual(scanSchemasDeep(dir, {}, {}, {}).entities.map(e => e.name), ['Order']);
  });

  it('finds Sequelize models under models/ and the source roots', () => {
    const dir = project(SEQUELIZE_FILES);
    const rel = discoverOrmSchemaFiles(dir, {}).sequelize.map(f => f.slice(dir.length + 1).replace(/\\/g, '/'));
    assert.deepEqual(rel, ['models/profile.js', 'models/team.js', 'models/user.js', 'src/models/post.ts']);
  });
});

// ── FR-002 / FR-003 / FR-004: TypeORM entities ─────────────────────────────

describe('FR-002: TypeORM columns', () => {
  it('reports each @Entity class once, by class name, with its table', () => {
    const s = scanSchemasDeep(project(TYPEORM_FILES), {}, {}, {});
    assert.deepEqual(fieldsByEntity(s), sorted(TYPEORM_TRUTH.entities));
    assert.deepEqual(sorted(Object.fromEntries(s.entities.map(e => [e.name, e.table ?? null]))), sorted(TYPEORM_TRUTH.tables));
    assert.ok(s.entities.every(e => e.source === 'typeorm'));
  });

  it('reads type, nullability, primary key, unique, default and comment', () => {
    const s = scanSchemasDeep(project(TYPEORM_FILES), {}, {}, {});
    assert.deepEqual(fieldFacts(s, TYPEORM_TRUTH), TYPEORM_TRUTH.fields);
    for (const [key, text] of Object.entries(TYPEORM_TRUTH.descriptions)) {
      const [entity, name] = key.split('.');
      assert.equal(s.entities.find(e => e.name === entity).fields.find(f => f.name === name).description, text);
    }
  });
});

describe('FR-003: TypeORM relations are relationships, each drawn once', () => {
  it('draws the owning side of every relation and no relation field as a column', () => {
    const s = scanSchemasDeep(project(TYPEORM_FILES), {}, {}, {});
    assert.deepEqual(relTyped(s), TYPEORM_TRUTH.relationships);
    const er = generateERDiagram(s.entities, s.relationships);
    assert.equal((er.match(/ : "/g) || []).length, TYPEORM_TRUTH.relationships.length);
    assert.match(er, /Post \}o--o\{ Tag : "tags"/);
  });

  it('draws an inverse side whose owner is not scanned, and a self-reference once', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { typeorm: '0.3.20' } }),
      'src/category.entity.ts': `import { Entity, PrimaryGeneratedColumn, ManyToOne, OneToMany } from 'typeorm';
@Entity()
export class Category {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => Category, (c) => c.children, { nullable: true }) parent: Category;
  @OneToMany(() => Category, (c) => c.parent) children: Category[];
  @OneToMany(() => Product, (p) => p.category) products: Product[];
}
`,
    });
    assert.deepEqual(relTyped(scanSchemasDeep(dir, {}, {}, {})), [
      'Category->Category:parent many-to-one',
      'Category->Product:products one-to-many',
    ]);
  });
});

describe('FR-004: inheritance', () => {
  it('gives entities the columns of their base classes, transitively, and no base is an entity', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { typeorm: '0.3.20' } }),
      'src/db/base.ts': `import { PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
export abstract class Identified { @PrimaryGeneratedColumn('uuid') id: string; }
export abstract class Timestamped extends Identified { @CreateDateColumn() createdAt: Date; }
`,
      'src/db/invoice.entity.ts': `import { Entity, Column } from 'typeorm';
import { Timestamped } from './base';
@Entity('invoices')
export class Invoice extends Timestamped { @Column('decimal', { precision: 10, scale: 2 }) total: string; }
`,
    });
    const s = scanSchemasDeep(dir, {}, {}, {});
    assert.deepEqual(s.entities.map(e => [e.name, e.fields.map(f => `${f.name}:${f.type}`)]), [
      ['Invoice', ['id:uuid', 'createdAt:datetime', 'total:decimal']],
    ]);
  });
});

// ── FR-005: tiers ───────────────────────────────────────────────────────────

describe('FR-005: both parser tiers read the same entities and say which read them', () => {
  it('reads every entity from the syntax tree, with its line', () => {
    const s = scanSchemasDeep(project(TYPEORM_FILES), {}, {}, {});
    assert.ok(s.entities.every(e => e.tier === 'js-ast'), JSON.stringify(s.entities.map(e => [e.name, e.tier])));
    for (const [name, line] of Object.entries(TYPEORM_TRUTH.lines)) assert.equal(s.entities.find(e => e.name === name).line, line, name);
  });

  it('reads the same TypeORM columns and relations by pattern when no file parses', () => {
    const s = scanSchemasDeep(project(unparseable(TYPEORM_FILES, TS_MODEL)), {}, {}, {});
    assert.deepEqual(fieldsByEntity(s), sorted(TYPEORM_TRUTH.entities));
    assert.deepEqual(fieldFacts(s, TYPEORM_TRUTH), TYPEORM_TRUTH.fields);
    assert.deepEqual(relTyped(s), TYPEORM_TRUTH.relationships);
    assert.ok(s.entities.every(e => e.tier === 'regex-fallback' && e.tierReason), JSON.stringify(s.entities.map(e => [e.name, e.tier])));
    for (const [name, line] of Object.entries(TYPEORM_TRUTH.lines)) assert.equal(s.entities.find(e => e.name === name).line, line, name);
  });

  it('marks the plan entity surface partial when entities were read by pattern', () => {
    const full = buildMemoryPlan(project(TYPEORM_FILES), {});
    assert.equal(full.surface.parserTiers.entities.degraded, false);
    clearMemoryPlanCache();
    const partial = buildMemoryPlan(project(unparseable(TYPEORM_FILES, TS_MODEL)), {});
    assert.equal(partial.surface.parserTiers.entities.degraded, true);
  });
});

// ── FR-006: Sequelize ───────────────────────────────────────────────────────

describe('FR-006: Sequelize models and associations', () => {
  for (const [label, files] of [['syntax tree', SEQUELIZE_FILES], ['pattern', unparseable(SEQUELIZE_FILES, SEQ_MODEL)]]) {
    it(`reads define and init models, attributes and associations (${label})`, () => {
      const s = scanSchemasDeep(project(files), {}, {}, {});
      assert.deepEqual(fieldsByEntity(s), sorted(SEQUELIZE_TRUTH.entities));
      assert.deepEqual(sorted(Object.fromEntries(s.entities.map(e => [e.name, e.table ?? null]))), sorted(SEQUELIZE_TRUTH.tables));
      assert.deepEqual(fieldFacts(s, SEQUELIZE_TRUTH), SEQUELIZE_TRUTH.fields);
      assert.equal(s.entities.find(e => e.name === 'User').fields.find(f => f.name === 'isAdmin').description, 'Can manage teams');
      assert.deepEqual(relTyped(s), SEQUELIZE_TRUTH.relationships);
      assert.ok(s.entities.every(e => e.source === 'sequelize'));
      assert.ok(s.entities.every(e => e.tier === (label === 'pattern' ? 'regex-fallback' : 'js-ast')));
      for (const [name, line] of Object.entries(SEQUELIZE_TRUTH.lines)) assert.equal(s.entities.find(e => e.name === name).line, line, name);
    });
  }

  it('does not read an init call without sequelize in its options as a model', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { sequelize: '6.37.3', i18next: '23.11.5' } }),
      'src/boot.js': "const { Sequelize } = require('sequelize');\nconst i18n = require('i18next');\n" +
        "const sequelize = new Sequelize(process.env.DATABASE_URL);\ni18n.init({ lng: 'en' }, { debug: false });\n",
    };
    for (const variant of [files, unparseable(files, /boot/)]) {
      assert.deepEqual(scanSchemasDeep(project(variant), {}, {}, {}).entities, []);
    }
  });
});

// ── FR-007: one reading for guard, generate, the plan and diff ─────────────

describe('FR-007: every consumer reads the same models', () => {
  for (const [label, files] of [['TypeORM', TYPEORM_FILES], ['Sequelize', SEQUELIZE_FILES]]) {
    it(`guard and generate name the same ${label} entities`, () => {
      const dir = project(files);
      const scanned = scanSchemasDeep(dir, {}, {}, {}).entities.map(e => e.name).sort();
      assert.ok(scanned.length > 0);
      assert.deepEqual(guardModelNames(dir), scanned);
    });
  }

  it('guard accepts the table name or the class name as documented', () => {
    const dir = project(TYPEORM_FILES);
    assert.deepEqual(guardModelNames(dir, '# Data Model\n\n### users\n\n### posts\n\n### Profile\n'), ['AuditLog', 'Tag']);
  });

  it('generate writes every entity, its columns and its relations to DATA-MODEL.md', () => {
    const dir = project(TYPEORM_FILES);
    assert.equal(generateDataModel(dir, { projectName: 'blog' }, {}, { models: [] }, {}, scanSchemasDeep(dir, {}, {}, {})), true);
    const doc = readFileSync(join(dir, 'docs-canonical/DATA-MODEL.md'), 'utf8');
    for (const name of Object.keys(TYPEORM_TRUTH.entities)) assert.match(doc, new RegExp(`^### ${name}$`, 'm'));
    assert.match(doc, /\| email \| string \| ✓ \| — \|  UK \|/);
    assert.match(doc, /Profile \|\|--\|\| User : "user"/);
    assert.doesNotMatch(doc, /BaseModel|Invoice/);
  });

  it('the plan and the as-built facts list the same entities', () => {
    const dir = project(TYPEORM_FILES);
    const plan = buildMemoryPlan(dir, {});
    assert.deepEqual(plan.surface.entities.map(e => e.name).sort(), Object.keys(TYPEORM_TRUTH.entities));
    assert.deepEqual(plan.surface.entities.find(e => e.name === 'Tag').fields.map(f => f.name).sort(), TYPEORM_TRUTH.entities.Tag);
    const facts = collectAreaFacts(dir, 'src/posts', {}).filter(f => f.kind === 'entity');
    assert.deepEqual(facts.map(f => `${f.key} ${f.file}:${f.line}`), ['Post src/posts/post.entity.ts:8']);
  });

  it('diff lists the undocumented entities as in code only', () => {
    const dir = project({ ...TYPEORM_FILES, 'docs-canonical/DATA-MODEL.md': '# Data Model\n\n### User\n\n### Post\n' });
    const d = diffEntities(dir, {});
    assert.ok(d, 'diff has a Data Entities section');
    assert.deepEqual(d.onlyInCode.sort(), ['auditlog', 'profile', 'tag']);
    assert.deepEqual(d.matched.sort(), ['post', 'user']);
  });
});

// ── FR-008: docs ────────────────────────────────────────────────────────────

describe('FR-008: the docs say what is read', () => {
  const read = p => readFileSync(resolve(p), 'utf8');

  it('the languages reference lists TypeORM and Sequelize for every consumer and Knex for guard only', () => {
    const doc = read('docs/reference/languages.md');
    assert.match(doc, /^\| TypeORM \|.*\| Both \|/m);
    assert.match(doc, /^\| Sequelize \|.*\| Both \|/m);
    assert.match(doc, /^\| Knex \|.*\| `guard` only \|/m);
    assert.doesNotMatch(doc, /TypeORM, Sequelize, Knex \(names only\)/);
  });

  it('the scanner header, ARCHITECTURE and the CHANGELOG name the change', () => {
    assert.match(read('cli/scanners/schemas.mjs').slice(0, 800), /TypeORM[\s\S]*Sequelize/);
    assert.match(read('docs-canonical/ARCHITECTURE.md'), /TypeORM/);
    const notes = notesSince(read('CHANGELOG.md'), '0.43.1');
    assert.match(notes, /typeorm-models/);
    assert.match(notes, /#520/);
  });
});
