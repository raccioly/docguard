import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { loadConfig } from '../cli/config.mjs';
import { applyDocRoles, assertDefaultDocWrites, DOC_ROLES } from '../cli/shared-doc-roles.mjs';
import { listCanonicalDocs } from '../cli/shared-ignore.mjs';
import { runGuardInternal } from '../cli/commands/guard.mjs';
import { runScoreInternal } from '../cli/commands/score.mjs';

const roles = {
  architecture: 'docs/plan.md', dataModel: 'docs/entities.md',
  security: 'ops/access.md', testSpec: 'quality/checks.md',
  environment: 'ops/setup.md', apiReference: 'reference/http.md',
  requirements: 'docs/needs.md',
};
const docs = {
  architecture: '# Architecture\n## System Overview\nA small service.\n## Component Map\nThe handler serves requests.\n## Tech Stack\nJavaScript.\n',
  dataModel: '# Data\n## Entities\nRecords use an external database.\n',
  security: '# Security\n## Authentication\nRequests require a token.\n## Secrets Management\nCredentials come from the environment.\n',
  testSpec: '# Testing\n## Test Categories\nUnit tests.\n## Coverage Rules\nExercise success and failure.\n',
  environment: '# Environment\n## Setup Steps\nStart the service.\n## Environment Variables\n\x60SERVICE_REGION\x60 selects the deployment region.\n',
  apiReference: '# HTTP\n#### GET \x60/api/items\x60\nReturns the item collection.\n',
  requirements: '# Requirements\nRequests return item collections.\n',
};
const validatorNames = 'structure docsSync drift changelog testSpec environment security architecture freshness traceability docsDiff apiSurface metadataSync docsCoverage docQuality todoTracking schemaSync specKit crossReference generatedStaleness surfaceSync diffSuspicion referenceExistence apiDocSmells canonicalSync metricsConsistency'.split(' ');

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-role-map-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function snapshot(dir) {
  const entries = [];
  function visit(base, prefix = '') {
    for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) { entries.push([rel + '/']); visit(join(base, entry.name), rel + '/'); }
      else entries.push([rel, readFileSync(join(base, entry.name), 'utf8')]);
    }
  }
  visit(dir);
  return entries;
}
function fixture(t, { mapped = true, missingRole, missingEnv = false, missingApi = false } = {}) {
  const dir = temp(t);
  const paths = mapped ? roles : DOC_ROLES;
  const raw = {
    projectName: 'role-fixture', projectType: 'api', diskCache: false,
    sourceRoot: 'src', projectTypeConfig: { needsEnvVars: true, needsEnvExample: false, needsDatabase: true },
    requiredFiles: { canonical: Object.values(DOC_ROLES), agentFile: ['AGENTS.md'], changelog: 'CHANGELOG.md', driftLog: 'DRIFT-LOG.md' },
    documentTypes: Object.fromEntries(Object.values(DOC_ROLES).map(path => [path, { required: true, category: 'canonical' }])),
    validators: Object.fromEntries(validatorNames.map(name => [name, ['structure', 'environment', 'apiSurface'].includes(name)])),
    ...(mapped ? { docs: { roles } } : {}),
  };
  for (const [role, path] of Object.entries(paths)) {
    if (role === missingRole) continue;
    let content = docs[role];
    if (role === 'environment' && missingEnv) content = '# Environment\n## Setup Steps\nStart the service.\n## Environment Variables\nNo entries yet.\n';

    safeWrite(join(dir, path), content);
  }
  safeWrite(join(dir, '.docguard.json'), JSON.stringify(raw));
  safeWrite(join(dir, 'package.json'), JSON.stringify({ name: 'role-fixture', type: 'module' }));
  safeWrite(join(dir, 'AGENTS.md'), '# Instructions\nRead the project documentation.\n');
  safeWrite(join(dir, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n### Added\n- Initial service.\n');
  safeWrite(join(dir, 'DRIFT-LOG.md'), '# Drift log\nNo deviations.\n');
  safeWrite(join(dir, '.gitignore'), '.env\n');
  safeWrite(join(dir, 'src/routes.js'), 'export const region = process.env.SERVICE_REGION;\napp.get("/api/items", handler);\n' + (missingApi ? 'app.post("/api/items", handler);\n' : ''));
  safeWrite(join(dir, 'openapi.yaml'), 'openapi: 3.0.3\ninfo:\n  title: Item API\n  version: 1.0.0\npaths:\n  /api/items:\n    get:\n      summary: List items\n' + (missingApi ? '    post:\n      summary: Create item\n' : ''));
  return { dir, raw };
}

for (const mode of ['raw', 'loaded']) {
  test('uses existing mapped documents in configured guard without writes: ' + mode, t => {
    const { dir, raw } = fixture(t);
    const before = snapshot(dir);
    const config = mode === 'raw' ? raw : loadConfig(dir);
    const result = runGuardInternal(dir, config);
    assert.deepEqual(result.findings, [], JSON.stringify(result.findings));
    for (const name of ['Structure', 'Doc Sections', 'Environment', 'API-Surface']) {
      const checked = result.validators.find(r => r.name === name);
      assert.ok(checked?.total > 0, name + ' must actually run');
      assert.equal(checked.passed, checked.total, name);
    }
    assert.equal(existsSync(join(dir, 'docs-canonical')), false);
    assert.deepEqual(snapshot(dir), before);
  });

  test('fails structure when mapped file is missing despite legacy copy: ' + mode, t => {
    const { dir, raw } = fixture(t, { missingRole: 'architecture' });
    safeWrite(join(dir, DOC_ROLES.architecture), docs.architecture);
    const config = mode === 'raw' ? raw : loadConfig(dir);
    const result = runGuardInternal(dir, config);
    assert.ok(result.findings.some(f => f.code === 'STR001' && f.severity === 'error' && f.location === roles.architecture));
  });

  test('reports real undocumented env and API at mapped locations: ' + mode, t => {
    const { dir, raw } = fixture(t, { missingEnv: true, missingApi: true });
    const config = mode === 'raw' ? raw : loadConfig(dir);
    const result = runGuardInternal(dir, config);
    const env = result.findings.find(f => f.code === 'ENV003');
    assert.equal(env?.location, roles.environment);
    assert.match(env.message, /SERVICE_REGION/);
    const api = result.findings.find(f => f.code === 'API005' && f.message.includes('POST /api/items'));
    assert.equal(api?.location, roles.apiReference);
  });

  test('keeps structure score identical for canonical and mapped layouts: ' + mode, t => {
    const canonical = fixture(t, { mapped: false });
    const mapped = fixture(t);
    const before = snapshot(mapped.dir);
    const config = f => mode === 'raw' ? f.raw : loadConfig(f.dir);
    const a = runScoreInternal(canonical.dir, config(canonical));
    const b = runScoreInternal(mapped.dir, config(mapped));
    assert.equal(a.categories.structure, 100);
    assert.equal(b.categories.structure, a.categories.structure);
    assert.deepEqual(snapshot(mapped.dir), before);
  });
}

test('normalizes every explicit role without retaining default requirements or mutating input', t => {
  const { dir, raw } = fixture(t);
  const before = structuredClone(raw);
  const normalized = applyDocRoles(dir, raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(normalized.requiredFiles.canonical.slice().sort(), Object.values(roles).sort());
  for (const [role, path] of Object.entries(roles)) {
    assert.equal(normalized.documentTypes[path].required, true);
    assert.equal(normalized.documentTypes[path].category, 'canonical');
    assert.equal(normalized.documentTypes[DOC_ROLES[role]], undefined);
  }
  assert.deepEqual(applyDocRoles(dir, normalized), normalized);
  const loaded = loadConfig(dir);
  assert.deepEqual(loaded.requiredFiles.canonical, normalized.requiredFiles.canonical);
});

test('adds explicit roles omitted from a minimal required list', t => {
  const dir = temp(t);
  const result = applyDocRoles(dir, { docs: { roles: { requirements: roles.requirements } }, requiredFiles: { canonical: [] } });
  assert.deepEqual(result.requiredFiles.canonical, [roles.requirements]);
  assert.equal(result.documentTypes[roles.requirements].required, true);
});

test('includes mapped Markdown in shared inventory from raw, loaded, and disk config', t => {
  const { dir, raw } = fixture(t);
  safeWrite(join(dir, 'docs/unassigned.md'), '# Unassigned\n');
  const before = snapshot(dir);
  for (const opts of [{ config: raw }, { config: loadConfig(dir) }, {}]) {
    const inventory = listCanonicalDocs(dir, opts);
    assert.deepEqual(inventory.map(d => d.rel), Object.values(roles).sort());
    for (const doc of inventory) assert.equal(doc.abs, join(dir, doc.rel));
  }
  assert.deepEqual(snapshot(dir), before);
});

test('deduplicates mapped canonical entries and honors the inventory ignore predicate', t => {
  const dir = temp(t);
  safeWrite(join(dir, DOC_ROLES.architecture), docs.architecture);
  const config = { docs: { roles: { architecture: DOC_ROLES.architecture, requirements: DOC_ROLES.architecture } } };
  assert.deepEqual(listCanonicalDocs(dir, { config }).map(d => d.rel), [DOC_ROLES.architecture]);
  assert.deepEqual(listCanonicalDocs(dir, { config, isIgnored: rel => rel === DOC_ROLES.architecture }), []);
});

test('preserves default behavior and does not discover arbitrary Markdown as canonical', t => {
  const { dir, raw } = fixture(t, { mapped: false });
  safeWrite(join(dir, 'docs/plan.md'), docs.architecture);
  const loaded = loadConfig(dir);
  assert.deepEqual(loaded.requiredFiles.canonical, raw.requiredFiles.canonical);
  assert.deepEqual(listCanonicalDocs(dir).map(d => d.rel), Object.values(DOC_ROLES).sort());
  assert.deepEqual(applyDocRoles(dir, raw), raw);
  assert.deepEqual(runGuardInternal(dir, loaded).findings, []);
});

for (const path of ['/tmp/outside.md', '../outside.md', 'docs/../../outside.md', '.local/notes.md', 'docs/.local/notes.md', '.git/notes.md', 'C:\\outside.md', '..\\outside.md']) {
  test('rejects unsafe raw and loaded role path: ' + path, t => {
    const dir = temp(t);
    const config = { docs: { roles: { architecture: path } } };
    assert.throws(() => applyDocRoles(dir, config), /path|project/i);
    safeWrite(join(dir, '.docguard.json'), JSON.stringify(config));
    const before = snapshot(dir);
    const script = 'import { loadConfig } from ' + JSON.stringify(new URL('../cli/config.mjs', import.meta.url).href) + '; loadConfig(process.argv[1]);';
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, dir], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(snapshot(dir), before);
  });
}

for (const kind of ['file', 'directory']) {
  test('rejects a mapped path through a ' + kind + ' symlink', t => {
    const dir = temp(t);
    const target = temp(t);
    safeWrite(join(target, 'plan.md'), docs.architecture);
    const mapped = kind === 'file' ? 'linked.md' : 'linked/plan.md';
    symlinkSync(kind === 'file' ? join(target, 'plan.md') : target, join(dir, kind === 'file' ? 'linked.md' : 'linked'));
    assert.throws(() => applyDocRoles(dir, { docs: { roles: { architecture: mapped } } }), /symlink/i);
    assert.throws(() => listCanonicalDocs(dir, { config: { docs: { roles: { architecture: mapped } } } }), /symlink/i);
  });
}

for (const [role, path] of Object.entries(roles)) {
  test('blocks automatic writes for custom role: ' + role, () => {
    assert.throws(() => assertDefaultDocWrites({ docs: { roles: { [role]: path } } }), /read-only|unavailable/i);
  });
}

test('permits default write layouts with absent, empty, and explicit default roles', () => {
  for (const config of [{}, { docs: { roles: {} } }, { docs: { roles: { ...DOC_ROLES } } }]) {
    assert.doesNotThrow(() => assertDefaultDocWrites(config));
  }
});

test('allows shared-file roles for reading but blocks their automatic writes', t => {
  const dir = temp(t);
  const config = { docs: { roles: { architecture: 'docs/plan.md', requirements: 'docs/plan.md' } } };
  safeWrite(join(dir, 'docs/plan.md'), docs.architecture + docs.requirements);
  const before = snapshot(dir);
  const normalized = applyDocRoles(dir, config);
  assert.deepEqual(normalized.requiredFiles.canonical, ['docs/plan.md']);
  assert.deepEqual(listCanonicalDocs(dir, { config: normalized }).map(d => d.rel), ['docs/plan.md']);
  assert.throws(() => assertDefaultDocWrites(normalized), /read-only|unavailable/i);
  assert.deepEqual(snapshot(dir), before);
});

for (const args of [['generate', '--plan', '--write'], ['generate', '--plan', '--write', '--format', 'json']]) {
  test('fails CLI mapped generation before scaffolding: ' + args.join(' '), t => {
    const { dir } = fixture(t);
    const before = snapshot(dir);
    const cli = new URL('../cli/docguard.mjs', import.meta.url).pathname;
    const result = spawnSync(process.execPath, [cli, ...args, '--dir', dir], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr + result.stdout, /Custom docs.roles.*read-only/);
    assert.deepEqual(snapshot(dir), before, 'blocked command must not create or overwrite any file');
    for (const path of ['.agent', '.agents', '.specify', 'docs-canonical', 'docs-implementation']) {
      assert.equal(existsSync(join(dir, path)), false, path + ' must not be scaffolded');
    }
  });
}

test('permits CLI read-only planning and remaps documents and agent tasks without writes', t => {
  const { dir } = fixture(t);
  const before = snapshot(dir);
  const cli = new URL('../cli/docguard.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, 'generate', '--plan', '--format', 'json', '--dir', dir], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.ok(plan.docs.some(d => d.path === roles.architecture), 'architecture plan uses mapped path');
  assert.ok(plan.docs.some(d => d.path === roles.environment), 'environment plan uses mapped path');
  assert.ok(plan.agentTasks.some(task => task.doc === roles.architecture), 'human tasks use mapped path');
  for (const path of [...plan.docs.map(d => d.path), ...plan.agentTasks.map(task => task.doc)]) {
    assert.ok(!Object.values(DOC_ROLES).includes(path), 'replaced default must not survive in plan: ' + path);
  }
  assert.deepEqual(snapshot(dir), before);
});
