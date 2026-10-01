/**
 * Accurate JS/TS extraction for Express and Next.js projects (spec 045).
 *
 * Every assertion compares a scanner with a ground truth written by hand in
 * tests/fixtures/js-ts-projects.mjs. Each project is written to a fresh temp
 * dir; nothing here reads repository state except the docs test (FR-011).
 *
 * @req docguard.js-ts-extraction#FR-001
 * @req docguard.js-ts-extraction#FR-002
 * @req docguard.js-ts-extraction#FR-003
 * @req docguard.js-ts-extraction#FR-004
 * @req docguard.js-ts-extraction#FR-005
 * @req docguard.js-ts-extraction#FR-006
 * @req docguard.js-ts-extraction#FR-007
 * @req docguard.js-ts-extraction#FR-008
 * @req docguard.js-ts-extraction#FR-009
 * @req docguard.js-ts-extraction#FR-010
 * @req docguard.js-ts-extraction#FR-011
 * @req docguard.js-ts-extraction#SC-001
 * @req docguard.js-ts-extraction#SC-002
 * @req docguard.js-ts-extraction#SC-003
 * @req docguard.js-ts-extraction#SC-004
 * @req docguard.js-ts-extraction#SC-005
 * @req docguard.js-ts-extraction#SC-006
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  writeFiles, UNPARSEABLE,
  EXPRESS_FILES, EXPRESS_TRUTH, NEXT_FILES, NEXT_TRUTH, PRISMA_FILES, PRISMA_TRUTH,
} from './fixtures/js-ts-projects.mjs';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { scanSchemasDeep, generateERDiagram, clearWalkDirCache } from '../cli/scanners/schemas.mjs';
import { grepEnvUsage, resolveSourceRoots } from '../cli/shared-source.mjs';
import { buildImportGraph, clearImportGraphCache } from '../cli/scanners/import-graph.mjs';
import { detectProjectProfile } from '../cli/scanners/project-type.mjs';
import { buildMemoryPlan, clearMemoryPlanCache } from '../cli/scanners/memory-plan.mjs';
import { collectAreaFacts, checkAsBuiltSync } from '../cli/scanners/as-built.mjs';
import { validateSchemaSync } from '../cli/validators/schema-sync.mjs';
import { generateDataModel } from '../cli/writers/doc-generators.mjs';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  clearWalkDirCache();
  clearImportGraphCache();
  clearMemoryPlanCache();
});

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-045-'));
  dirs.push(dir);
  writeFiles(dir, files);
  return dir;
}

function routesOf(dir) {
  const profile = detectProjectProfile(dir, {});
  return scanRoutesDeep(dir, { framework: profile.frameworks.join(' ') }, {}, { config: {} });
}

const keys = routes => routes.map(r => `${r.method} ${r.path}`).sort();
const authMap = routes => Object.fromEntries(routes.map(r => [`${r.method} ${r.path}`, Boolean(r.auth)]));
const sorted = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
const fieldsByEntity = s => sorted(Object.fromEntries(s.entities.map(e => [e.name, e.fields.map(f => f.name).sort()])));
const relKeys = s => s.relationships.map(r => `${r.from}->${r.to}:${r.field}`).sort();
const edgesOf = dir => buildImportGraph(dir, {}).edges.map(e => `${e.from.replace(/\\/g, '/')}->${e.to.replace(/\\/g, '/')}`).sort();
const envTruth = set => sorted(Object.fromEntries([...set].map(name => [name, (set.sites.get(name) || []).every(s => s.defaulted)])));

// ── FR-001: route chains ────────────────────────────────────────────────────

describe('FR-001: router.route() chains', () => {
  it('reports every method of every chain, with mount prefixes (AST tier)', () => {
    const dir = project(EXPRESS_FILES);
    const routes = routesOf(dir);
    assert.deepEqual(keys(routes), Object.keys(EXPRESS_TRUTH.routes).sort());
  });

  it('reads app.route() in the app file', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { express: '4.19.2' } }),
      'src/server.js': "const express = require('express');\nconst app = express();\n" +
        "app.route('/items').get(list).put(replace);\napp.route(`/items/:id`)\n  .delete(remove);\n",
    });
    assert.deepEqual(keys(routesOf(dir)), ['DELETE /items/:id', 'GET /items', 'PUT /items']);
  });

  it('reads the same chains by pattern when the file does not parse', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { express: '4.19.2' } }),
      'src/orders.ts': EXPRESS_FILES['src/routes/orders.ts'] + UNPARSEABLE,
    });
    assert.deepEqual(keys(routesOf(dir)), ['DELETE /:id', 'GET /', 'GET /:id', 'POST /']);
  });

  it('does not read a client chain as a route', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { express: '4.19.2' } }),
      'src/client.ts': "const res = await request(app).route('/x').get('/y');\n",
    });
    assert.deepEqual(keys(routesOf(dir)), []);
  });
});

// ── FR-002: per-route auth ─────────────────────────────────────────────────

describe('FR-002: auth is judged per route', () => {
  it('applies mount-level auth and ignores req.user in a sibling handler (Express)', () => {
    const dir = project(EXPRESS_FILES);
    assert.deepEqual(sorted(authMap(routesOf(dir))), sorted(EXPRESS_TRUTH.routes));
  });

  it('honours use(auth) on a receiver only for routes registered after it', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { express: '4.19.2' } }),
      'src/admin.js': "const router = require('express').Router();\n" +
        "router.get('/status', status);\nrouter.use(authenticate);\nrouter.get('/secrets', secrets);\n" +
        "module.exports = router;\n",
    });
    assert.deepEqual(authMap(routesOf(dir)), { 'GET /status': false, 'GET /secrets': true });
  });

  it('reads an auth check in a same-file named handler and passport.authenticate()', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { express: '4.19.2' } }),
      'src/api.js': "const router = require('express').Router();\n" +
        "router.get('/a', guarded);\nrouter.get('/b', open);\n" +
        "router.get('/c', passport.authenticate('jwt', { session: false }), open);\n" +
        "function guarded(req, res) { const claims = jwt.verify(req.headers.authorization, key); res.json(claims); }\n" +
        "function open(req, res) { res.json({ user: req.user || null }); }\n",
    });
    assert.deepEqual(authMap(routesOf(dir)), { 'GET /a': true, 'GET /b': false, 'GET /c': true });
  });

  it('judges each route by its own statement in the regex fallback', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { express: '4.19.2' } }),
      'src/users.ts': EXPRESS_FILES['src/routes/users.ts'] + UNPARSEABLE,
    });
    assert.deepEqual(sorted(authMap(routesOf(dir))),
      sorted({ 'POST /login': false, 'POST /register': false, 'GET /me': true }));
  });

  it('judges each Next.js handler by its own body and the middleware matcher', () => {
    const dir = project(NEXT_FILES);
    const routes = routesOf(dir);
    assert.deepEqual(keys(routes), Object.keys(NEXT_TRUTH.routes).sort());
    assert.deepEqual(sorted(authMap(routes)), sorted(NEXT_TRUTH.routes));
  });
});

// ── FR-003: env destructuring and read sites ───────────────────────────────

describe('FR-003: env destructuring and read sites', () => {
  it('reads destructured names with defaults and renames, and records each site', () => {
    const dir = project(EXPRESS_FILES);
    const env = grepEnvUsage(dir, {});
    assert.deepEqual(envTruth(env), sorted(EXPRESS_TRUTH.env));
    assert.deepEqual(env.sites.get('MONGO_URI'), [{ file: 'src/config.ts', line: 1, defaulted: false, default: null }]);
    assert.deepEqual(env.sites.get('LOG_LEVEL'), [{ file: 'src/config.ts', line: 1, defaulted: true, default: 'info' }]);
    assert.deepEqual(env.sites.get('PORT'), [{ file: 'src/config.ts', line: 1, defaulted: true, default: '3000' }]);
    assert.deepEqual(env.sites.get('REDIS_URL'), [{ file: 'src/config.ts', line: 3, defaulted: true, default: 'redis://localhost:6379' }]);
  });

  it('handles quoted keys, rest elements, import.meta.env, multi-line patterns and mixed sites', () => {
    const dir = project({
      'src/a.ts': "const {\n  'QUOTED_KEY': q,\n  ...others\n} = process.env;\n" +
        "const { VITE_API_URL, VITE_FLAG = false } = import.meta.env;\n" +
        "export const token = process.env.API_TOKEN;\n",
      'src/b.ts': "export const token = process.env.API_TOKEN || 'dev-token';\n" +
        "// const { COMMENTED } = process.env;\nconst s = 'const { IN_STRING } = process.env';\n",
    });
    const env = grepEnvUsage(dir, {});
    assert.deepEqual([...env].sort(), ['API_TOKEN', 'QUOTED_KEY', 'VITE_API_URL', 'VITE_FLAG']);
    assert.deepEqual(env.sites.get('QUOTED_KEY'), [{ file: 'src/a.ts', line: 2, defaulted: false, default: null }]);
    assert.deepEqual(env.sites.get('VITE_FLAG'), [{ file: 'src/a.ts', line: 5, defaulted: true, default: 'false' }]);
    assert.deepEqual(env.sites.get('API_TOKEN').map(s => [s.file, s.defaulted]).sort(),
      [['src/a.ts', false], ['src/b.ts', true]]);
  });
});

// ── FR-004: Next.js roots ───────────────────────────────────────────────────

describe('FR-004: Next.js source roots', () => {
  it('reads env in pages/, components/ and the root middleware and next.config', () => {
    const dir = project({
      ...NEXT_FILES,
      'middleware.ts': NEXT_FILES['middleware.ts'] + "export const edge = process.env.EDGE_SECRET;\n",
      'next.config.mjs': "export default { env: { BUILD_ID: process.env.BUILD_ID } };\n",
    });
    const env = grepEnvUsage(dir, {});
    assert.deepEqual([...env].sort(), [...Object.keys(NEXT_TRUTH.env), 'BUILD_ID', 'EDGE_SECRET'].sort());
    assert.deepEqual(env.sites.get('NEXT_PUBLIC_ANALYTICS_ID'), [{ file: 'pages/index.tsx', line: 3, defaulted: false, default: null }]);
    const roots = resolveSourceRoots(dir, {}).map(r => r.slice(dir.length + 1)).sort();
    assert.deepEqual(roots, ['app', 'components', 'lib', 'pages']);
  });

  it('leaves the roots of a project that is not Next.js unchanged', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { react: '18.3.1' } }),
      'src/a.ts': 'export const a = 1;\n',
      'pages/x.ts': 'export const b = process.env.NOT_NEXT;\n',
      'components/y.ts': 'export const c = 1;\n',
    });
    assert.deepEqual(resolveSourceRoots(dir, {}).map(r => r.slice(dir.length + 1)), ['src']);
    assert.equal(grepEnvUsage(dir, {}).has('NOT_NEXT'), false);
  });
});

// ── FR-005: path aliases ────────────────────────────────────────────────────

describe('FR-005: tsconfig/jsconfig path aliases', () => {
  it('adds alias edges through an extended JSONC tsconfig (Express)', () => {
    assert.deepEqual(edgesOf(project(EXPRESS_FILES)), EXPRESS_TRUTH.edges);
  });

  it('adds alias edges with a ./* mapping (Next.js)', () => {
    assert.deepEqual(edgesOf(project(NEXT_FILES)), NEXT_TRUTH.edges);
  });

  it('follows extends into a package config, reads jsconfig, and never guesses', () => {
    const dir = project({
      'node_modules/@acme/tsconfig/base.json': '{ "compilerOptions": { "baseUrl": "../../..", "paths": { "~/*": ["src/*"] } } }',
      'jsconfig.json': '{ "extends": "@acme/tsconfig/base.json" }',
      'src/a.js': "import b from '~/b';\nimport express from 'express';\nimport gone from '~/missing';\nimport c from 'src/c';\n",
      'src/b.js': 'export default 1;\n',
      'src/c.js': 'export default 2;\n',
    });
    // `src/c` resolves through baseUrl alone; `express` and `~/missing` add nothing.
    assert.deepEqual(edgesOf(dir), ['src/a.js->src/b.js', 'src/a.js->src/c.js']);
  });

  it('stops on an extends cycle', () => {
    const dir = project({
      'tsconfig.json': '{ "extends": "./tsconfig.b.json", "compilerOptions": { "paths": { "@/*": ["src/*"] } } }',
      'tsconfig.b.json': '{ "extends": "./tsconfig.json", "compilerOptions": { "baseUrl": "." } }',
      'src/a.ts': "import b from '@/b';\n",
      'src/b.ts': 'export default 1;\n',
    });
    assert.deepEqual(edgesOf(dir), ['src/a.ts->src/b.ts']);
  });
});

// ── FR-006: Drizzle ─────────────────────────────────────────────────────────

describe('FR-006: Drizzle discovery and columns', () => {
  it('reads the schema named by drizzle.config.ts, with every column and relation', () => {
    const s = scanSchemasDeep(project(NEXT_FILES), {}, {}, {});
    assert.deepEqual(fieldsByEntity(s), sorted(NEXT_TRUTH.entities));
    assert.deepEqual(relKeys(s), NEXT_TRUTH.relationships);
    const users = s.entities.find(e => e.name === 'users');
    const email = users.fields.find(f => f.name === 'email');
    assert.equal(email.type, 'string');
    assert.equal(email.required, true);
    assert.equal(email.unique, true);
    assert.equal(users.fields.find(f => f.name === 'id').type, 'serial');
    assert.equal(s.entities.find(e => e.name === 'tasks').fields.find(f => f.name === 'priority').type, 'enum');
  });

  it('draws Mermaid-safe types', () => {
    const s = scanSchemasDeep(project(NEXT_FILES), {}, {}, {});
    const er = generateERDiagram(s.entities, s.relationships);
    assert.doesNotMatch(er, /integer__auto_|priorityEnum/);
    assert.match(er, /serial id PK/);
    assert.match(er, /enum priority/);
    const described = generateERDiagram([{ name: 'legacy', fields: [{ name: 'id', type: 'integer (auto)', primaryKey: true }] }], []);
    assert.match(described, /^ {8}integer id PK$/m);
  });

  it('reads a schema the config names outside every searched directory, and only there', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { 'drizzle-orm': '0.30.10' } }),
      'src/index.ts': "export { audits } from '../infra/tables';\n",
      'infra/tables.ts': "import { pgTable, serial } from 'drizzle-orm/pg-core';\n" +
        "export const audits = pgTable('audits', { id: serial('id').primaryKey() });\n",
    };
    assert.deepEqual(scanSchemasDeep(project(files), {}, {}, {}).entities.map(e => e.name), [],
      'infra/ is not a source root, so the bounded search does not reach it');
    const configured = project({ ...files, 'drizzle.config.ts': "export default { schema: './infra/tables.ts' };\n" });
    assert.deepEqual(scanSchemasDeep(configured, {}, {}, {}).entities.map(e => e.name), ['audits']);
  });

  it('reports each table once when the schema sits in src/db with no config', () => {
    const files = { ...NEXT_FILES, 'src/db/schema.ts': NEXT_FILES['lib/db/schema.ts'] };
    delete files['drizzle.config.ts'];
    delete files['lib/db/schema.ts'];
    delete files['lib/db/index.ts'];
    const s = scanSchemasDeep(project(files), {}, {}, {});
    assert.deepEqual(s.entities.map(e => e.name).sort(), ['projects', 'tasks', 'users']);
  });

  it('reads a glob or an array in the config, and maps references to table names', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { 'drizzle-orm': '0.30.10' } }),
      'drizzle.config.js': "module.exports = { schema: ['./db/schema/*.ts'], dialect: 'sqlite' };\n",
      'db/schema/users.ts': "import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';\n" +
        "export const appUsers = sqliteTable('app_users', { id: integer('id').primaryKey(), handle: text('handle', { length: 40 }) });\n",
      'db/schema/posts.ts': "import { sqliteTable, integer } from 'drizzle-orm/sqlite-core';\nimport { appUsers } from './users';\n" +
        "export const posts = sqliteTable('posts', {\n  id: integer('id').primaryKey(),\n  authorId: integer('author_id').references(() => appUsers.id),\n});\n",
    });
    const s = scanSchemasDeep(dir, {}, {}, {});
    assert.deepEqual(fieldsByEntity(s), { app_users: ['handle', 'id'], posts: ['authorId', 'id'] });
    assert.deepEqual(relKeys(s), ['posts->app_users:authorId']);
  });

  it('reads the same tables by pattern when the schema does not parse', () => {
    const files = { ...NEXT_FILES, 'lib/db/schema.ts': NEXT_FILES['lib/db/schema.ts'] + UNPARSEABLE };
    const s = scanSchemasDeep(project(files), {}, {}, {});
    assert.deepEqual(fieldsByEntity(s), sorted(NEXT_TRUTH.entities));
    assert.deepEqual(relKeys(s), NEXT_TRUTH.relationships);
  });
});

// ── FR-007: Mongoose ────────────────────────────────────────────────────────

describe('FR-007: Mongoose fields, refs and discovery', () => {
  it('reads nested field objects, arrays and refs from lib/models', () => {
    const s = scanSchemasDeep(project(EXPRESS_FILES), {}, {}, {});
    assert.deepEqual(fieldsByEntity(s), sorted(EXPRESS_TRUTH.entities));
    assert.deepEqual(relKeys(s), EXPRESS_TRUTH.relationships);
    const user = s.entities.find(e => e.name === 'User');
    const email = user.fields.find(f => f.name === 'email');
    assert.deepEqual([email.type, email.required, email.unique], ['string', true, true]);
    assert.equal(user.fields.find(f => f.name === 'profile').type, 'object');
    assert.equal(s.entities.find(e => e.name === 'Order').fields.find(f => f.name === 'items').type, 'array');
    assert.equal(s.entities.find(e => e.name === 'Product').fields.find(f => f.name === 'tags').type, 'array');
  });

  it('reads the same fields and refs by pattern when a model does not parse', () => {
    const files = { ...EXPRESS_FILES };
    for (const f of ['lib/models/User.ts', 'lib/models/Order.ts', 'lib/models/Product.ts']) files[f] += UNPARSEABLE;
    const s = scanSchemasDeep(project(files), {}, {}, {});
    assert.deepEqual(fieldsByEntity(s), sorted(EXPRESS_TRUTH.entities));
    assert.deepEqual(relKeys(s), EXPRESS_TRUTH.relationships);
  });

  it('finds a CommonJS schema in any source root, once', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { mongoose: '8.4.0' } }),
      'server/schemas/audit.js': "const mongoose = require('mongoose');\n" +
        "const auditSchema = new mongoose.Schema({ action: { type: String, required: true }, at: Date });\n" +
        "module.exports = mongoose.model('AuditEntry', auditSchema);\n",
    });
    const s = scanSchemasDeep(dir, {}, {}, {});
    assert.deepEqual(fieldsByEntity(s), { AuditEntry: ['action', 'at'] });
  });
});

// ── FR-008: Prisma and the stack ───────────────────────────────────────────

describe('FR-008: Prisma enums, relations, and the stack', () => {
  it('reports enums apart from entities and each relation once', () => {
    const s = scanSchemasDeep(project(PRISMA_FILES), {}, {}, {});
    assert.deepEqual(fieldsByEntity(s), sorted(PRISMA_TRUTH.entities));
    assert.deepEqual(sorted(Object.fromEntries(s.enums.map(e => [e.name, e.values.slice().sort()]))), sorted(PRISMA_TRUTH.enums));
    assert.deepEqual(relKeys(s), PRISMA_TRUTH.relationships);
    const type = (from, to) => s.relationships.find(r => r.from === from && r.to === to).type;
    assert.equal(type('Profile', 'User'), 'one-to-one');
    assert.equal(type('Post', 'User'), 'many-to-one');
    assert.equal(type('Post', 'Tag'), 'many-to-many');
    const er = generateERDiagram(s.entities, s.relationships);
    assert.equal((er.match(/ : "/g) || []).length, 3, 'three relationship lines');
    assert.doesNotMatch(er, /Role \{/);
  });

  it('names ORM, UI and auth libraries in the profile and the plan', () => {
    for (const [files, truth] of [[EXPRESS_FILES, EXPRESS_TRUTH], [NEXT_FILES, NEXT_TRUTH], [PRISMA_FILES, PRISMA_TRUTH]]) {
      const dir = project(files);
      const [eco] = detectProjectProfile(dir, {}).ecosystems;
      const names = [eco.framework, eco.language, ...eco.libraries].filter(n => n && n !== 'JavaScript');
      assert.deepEqual(names.sort(), truth.stack);
    }
    const plan = buildMemoryPlan(project(NEXT_FILES), {});
    const arch = plan.docs.find(d => d.path.endsWith('ARCHITECTURE.md'));
    const table = arch.sections.find(s => s.id === 'tech-stack').body;
    assert.match(table, /\| Path \| Language \| Framework \| Libraries \| Kind \|/);
    assert.match(table, /Drizzle, NextAuth\.js, React/);
  });

  it('writes Prisma enums in their own DATA-MODEL section, not as entities', () => {
    const dir = project(PRISMA_FILES);
    assert.equal(generateDataModel(dir, { projectName: 'blog' }, {}, { models: [] }, {}, scanSchemasDeep(dir, {}, {}, {})), true);
    const [entitiesPart, enumsPart = ''] = readFileSync(join(dir, 'docs-canonical/DATA-MODEL.md'), 'utf8').split('## Enums');
    assert.doesNotMatch(entitiesPart, /### (?:Role|Status)\b|^\| (?:Role|Status) \|/m);
    assert.match(enumsPart, /### Role[\s\S]*\| ADMIN \|/);
    assert.match(enumsPart, /### Status[\s\S]*\| PUBLISHED \|/);
  });

  it('keeps the tech-stack table unchanged when no library is found', () => {
    const plan = buildMemoryPlan(project({
      'package.json': JSON.stringify({ name: 'plain', dependencies: { express: '4.19.2' } }),
      'src/index.js': "const app = require('express')();\napp.get('/x', (q, s) => s.end());\n",
    }), {});
    const arch = plan.docs.find(d => d.path.endsWith('ARCHITECTURE.md'));
    assert.match(arch.sections.find(s => s.id === 'tech-stack').body, /^\| Path \| Language \| Framework \| Kind \|$/m);
  });
});

// ── FR-009: as-built facts ─────────────────────────────────────────────────

describe('FR-009: as-built facts are counted once and cited', () => {
  it('lists each Next.js handler once, as a route fact with file and line', () => {
    const dir = project(NEXT_FILES);
    const facts = collectAreaFacts(dir, 'app/api/projects', {});
    assert.deepEqual(facts.map(f => `${f.kind} ${f.key} ${f.file}:${f.line}`), [
      'route DELETE /api/projects/:id app/api/projects/[id]/route.ts:9',
      'route GET /api/projects app/api/projects/route.ts:6',
      'route GET /api/projects/:id app/api/projects/[id]/route.ts:5',
      'route POST /api/projects app/api/projects/route.ts:10',
    ]);
  });

  it('cites the file and line of each env read and Express route', () => {
    const next = collectAreaFacts(project(NEXT_FILES), 'lib', {}).filter(f => f.kind === 'env');
    assert.deepEqual(next.map(f => `${f.key} ${f.file}:${f.line}`),
      ['DATABASE_URL lib/db/index.ts:5', 'NEXTAUTH_SECRET lib/auth.ts:1']);
    const express = collectAreaFacts(project(EXPRESS_FILES), 'src/routes', {}).filter(f => f.kind === 'route');
    assert.ok(express.length === 7 && express.every(f => f.file && Number.isInteger(f.line)), JSON.stringify(express));
    assert.equal(express.find(f => f.key === 'POST /api/orders').line, 9);
  });

  it('drops the default export of a Pages Router API file and reports one drift per new handler', () => {
    const dir = project({
      ...NEXT_FILES,
      'pages/api/hello.ts': "export default function handler(req, res) { res.json({ hi: true }); }\n",
    });
    const facts = collectAreaFacts(dir, 'pages/api', {});
    assert.deepEqual(facts.map(f => `${f.kind} ${f.key}`), ['route ALL /api/hello']);
    const { unclaimed } = checkAsBuiltSync(dir, '# spec with no markers\n', ['app/api/projects'], {});
    assert.equal(unclaimed.length, 4, 'one unclaimed fact per handler, not two');
  });
});

// ── FR-010: one entity discovery ───────────────────────────────────────────

function guardModelNames(dir) {
  writeFiles(dir, { 'docs-canonical/DATA-MODEL.md': '# Data Model\n' });
  const result = validateSchemaSync(dir, {});
  return result.findings.filter(f => f.code === 'SCH002')
    .map(f => f.message.match(/model "([^"]+)"/)[1]).sort();
}

describe('FR-010: guard and generate agree on entities', () => {
  for (const [label, files] of [['Express', EXPRESS_FILES], ['Next.js', NEXT_FILES], ['Prisma', PRISMA_FILES]]) {
    it(`reports the same entity names on the ${label} fixture`, () => {
      const dir = project(files);
      const scanned = scanSchemasDeep(dir, {}, {}, {}).entities.map(e => e.name).sort();
      assert.ok(scanned.length > 0);
      assert.deepEqual(guardModelNames(dir), scanned);
    });
  }
});

// ── FR-011: docs ───────────────────────────────────────────────────────────

describe('FR-011: the docs describe the scanned forms', () => {
  const read = p => readFileSync(resolve(p), 'utf8');

  it('ARCHITECTURE names path aliases and the shared entity discovery', () => {
    const arch = read('docs-canonical/ARCHITECTURE.md');
    assert.match(arch, /compilerOptions\.paths/);
    assert.match(arch, /scanOrmEntities/);
    assert.match(arch, /per-route auth/i);
  });

  it('commands.md describes the generate scanners and as-built citations', () => {
    const commands = read('docs/commands.md');
    assert.match(commands, /router\.route\(/);
    assert.match(commands, /drizzle\.config/);
    assert.match(commands, /file and line/);
  });

  it('the CHANGELOG records the fix', () => {
    const unreleased = read('CHANGELOG.md').split(/^## \[/m)[1];
    assert.match(unreleased, /^Unreleased\]/);
    assert.match(unreleased, /js-ts-extraction/);
  });
});

// ── Success criteria ───────────────────────────────────────────────────────

describe('Success criteria against the written truth', () => {
  it('SC-001: all 8 Express routes at the right path with the right auth', () => {
    const routes = routesOf(project(EXPRESS_FILES));
    assert.equal(routes.length, 8);
    assert.deepEqual(sorted(authMap(routes)), sorted(EXPRESS_TRUTH.routes));
  });

  it('SC-002: Next.js auth, env with defaults, and module edges', () => {
    const dir = project(NEXT_FILES);
    assert.deepEqual(sorted(authMap(routesOf(dir))), sorted(NEXT_TRUTH.routes));
    assert.deepEqual(envTruth(grepEnvUsage(dir, {})), sorted(NEXT_TRUTH.env));
    assert.deepEqual(edgesOf(dir), NEXT_TRUTH.edges);
  });

  it('SC-003: entities once with exact fields, relations once, on all three fixtures', () => {
    for (const [files, truth] of [[EXPRESS_FILES, EXPRESS_TRUTH], [NEXT_FILES, NEXT_TRUTH], [PRISMA_FILES, PRISMA_TRUTH]]) {
      const s = scanSchemasDeep(project(files), {}, {}, {});
      assert.equal(s.entities.length, Object.keys(truth.entities).length);
      assert.deepEqual(fieldsByEntity(s), sorted(truth.entities));
      assert.deepEqual(relKeys(s), truth.relationships);
    }
  });

  it('SC-004: guard and generate report the same entity set on all three fixtures', () => {
    for (const files of [EXPRESS_FILES, NEXT_FILES, PRISMA_FILES]) {
      const dir = project(files);
      assert.deepEqual(guardModelNames(dir), scanSchemasDeep(dir, {}, {}, {}).entities.map(e => e.name).sort());
    }
  });

  it('SC-005: the stack names every framework, language and library', () => {
    for (const [files, truth] of [[EXPRESS_FILES, EXPRESS_TRUTH], [NEXT_FILES, NEXT_TRUTH], [PRISMA_FILES, PRISMA_TRUTH]]) {
      const [eco] = detectProjectProfile(project(files), {}).ecosystems;
      assert.deepEqual([eco.framework, eco.language, ...eco.libraries].filter(n => n && n !== 'JavaScript').sort(), truth.stack);
    }
  });

  it('SC-006: the as-built facts of app/api/projects are routes, once, each cited', () => {
    const facts = collectAreaFacts(project(NEXT_FILES), 'app/api/projects', {});
    assert.equal(facts.length, 4);
    assert.ok(facts.every(f => f.kind === 'route' && f.file && Number.isInteger(f.line)));
  });
});
