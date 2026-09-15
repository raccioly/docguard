// @req docguard.adoption-workflow-integrity#FR-014
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { loadConfig } from '../cli/config.mjs';
import { applyDocRoles } from '../cli/shared-doc-roles.mjs';
import { listCanonicalDocs } from '../cli/shared-ignore.mjs';
import { applyApiSurfaceWrites } from '../cli/commands/fix.mjs';
import { computeApiSurfaceDrift, validateApiSurface } from '../cli/validators/api-surface.mjs';
import { validateEnvironment } from '../cli/validators/environment.mjs';
import { validateTestSpec } from '../cli/validators/test-spec.mjs';
import { pyAstAvailable } from '../cli/scanners/py-ast.mjs';

const cli = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));
const validatorKeys = 'structure docsSync drift changelog testSpec environment security architecture freshness traceability docsDiff apiSurface metadataSync docsCoverage docQuality todoTracking schemaSync specKit crossReference generatedStaleness surfaceSync diffSuspicion referenceExistence apiDocSmells canonicalSync metricsConsistency'.split(' ');
const enabledOnly = key => Object.fromEntries(validatorKeys.map(k => [k, k === key]));
function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-role-boundary-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function snapshot(dir) {
  const out = [];
  function walk(base, prefix = '') {
    for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix + entry.name;
      const path = join(base, entry.name);
      if (entry.isSymbolicLink()) out.push([rel, 'symlink', readlinkSync(path)]);
      else if (entry.isDirectory()) { out.push([rel, 'directory']); walk(path, rel + '/'); }
      else out.push([rel, 'file', readFileSync(path).toString('base64')]);
    }
  }
  walk(dir);
  return out;
}
function mappedFixture(t) {
  const dir = temp(t);
  const raw = {
    projectName: 'boundary-fixture', diskCache: false, sourceRoot: 'src',
    docs: { roles: { apiReference: 'reference/http.md' } },
    validators: enabledOnly('apiSurface'),
    requiredFiles: { canonical: [], agentFile: [], changelog: 'CHANGELOG.md', driftLog: 'DRIFT-LOG.md' },
  };
  safeWrite(join(dir, '.docguard.json'), JSON.stringify(raw));
  safeWrite(join(dir, 'src/routes.js'), "app.get('/api/live', handler);");
  safeWrite(join(dir, 'openapi.json'), JSON.stringify({ openapi: '3.0.3', paths: { '/api/live': { get: {} } } }));
  const doc = '<!-- docguard:generated true -->\n#### GET /api/live\n#### GET /api/removed\n';
  safeWrite(join(dir, 'reference/http.md'), doc);
  // A stale default copy also must not be touched by a legacy writer.
  safeWrite(join(dir, 'docs-canonical/API-REFERENCE.md'), doc);
  return { dir, raw };
}
function invoke(dir, args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--dir', dir], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  return result;
}

for (const mode of ['raw', 'loaded']) {
  /** @req docguard.language-repository-coverage#FR-010 */
  test('keeps mapped API contract mismatches review-only: ' + mode, t => {
    const { dir, raw } = mappedFixture(t);
    const config = mode === 'raw' ? raw : loadConfig(dir);
    const candidates = validateApiSurface(dir, config).fixes;
    assert.deepEqual(candidates, []);
    const before = snapshot(dir);
    const result = applyApiSurfaceWrites(dir, config);
    assert.equal(result.applied, false);
    assert.deepEqual(result.removed, []);
    assert.match(result.skipped, /require review/);
    assert.deepEqual(snapshot(dir), before);
  });
}

for (const args of [['diagnose', '--auto'], ['diagnose', '--auto', '--force'], ['diagnose', '--auto', '--format', 'json']]) {
  test('keeps broad diagnose scaffolding blocked for mapped layouts: ' + args.join(' '), t => {
    const { dir } = mappedFixture(t);
    const before = snapshot(dir);
    const result = invoke(dir, args);
    assert.equal(result.status, 1);
    assert.match(result.stderr + result.stdout, /read-only planning/);
    assert.deepEqual(snapshot(dir), before);
  });
}

test('CLI fix preserves generated mapped API docs when intent requires review', t => {
  const { dir } = mappedFixture(t);
  const before = snapshot(dir);
  const result = invoke(dir, ['fix', '--write']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(dir), before);
});

test('generate plan updates only owned mapped code sections', t => {
  const dir = temp(t);
  safeWrite(join(dir, '.docguard.json'), JSON.stringify({
    projectName: 'bounded-plan', diskCache: false, sourceRoot: 'src',
    docs: { roles: {
      architecture: 'handbook/system.md',
      testSpec: 'handbook/testing.md',
    } },
  }));
  safeWrite(join(dir, 'package.json'), JSON.stringify({ name: 'bounded-plan', type: 'module' }));
  safeWrite(join(dir, 'src/index.js'), 'export const answer = 42;\n');
  const previewResult = invoke(dir, ['generate', '--plan', '--format', 'json']);
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout);
  for (const doc of preview.docs.filter(item => item.path.startsWith('handbook/'))) {
    const owned = doc.sections.filter(section => section.source === 'code')
      .map(section => `<!-- docguard:section id=${section.id} source=code -->\nstale\n<!-- /docguard:section -->`)
      .join('\n');
    safeWrite(join(dir, doc.path), `# Human title\nKeep before.\n${owned}\nKeep after.\n`);
  }
  const before = readFileSync(join(dir, 'handbook/system.md'), 'utf8');
  const result = invoke(dir, ['generate', '--plan', '--write']);
  assert.equal(result.status, 0, result.stderr);
  const after = readFileSync(join(dir, 'handbook/system.md'), 'utf8');
  assert.match(after, /Keep before\./);
  assert.match(after, /Keep after\./);
  assert.notEqual(after, before);
  assert.equal(readFileSync(join(dir, 'handbook/system.md.bak'), 'utf8'), before);
  assert.equal(existsSync(join(dir, 'docs-canonical')), false);
});

test('generate plan authorizes every mapped target before its first write', t => {
  const dir = temp(t);
  safeWrite(join(dir, '.docguard.json'), JSON.stringify({
    projectName: 'atomic-plan', diskCache: false, sourceRoot: 'src',
    docs: { roles: {
      architecture: 'handbook/system.md',
      testSpec: 'handbook/testing.md',
    } },
  }));
  safeWrite(join(dir, 'package.json'), JSON.stringify({ name: 'atomic-plan', type: 'module' }));
  safeWrite(join(dir, 'src/index.js'), 'export const answer = 42;\n');
  safeWrite(join(dir, 'tests/index.test.js'), "import test from 'node:test';\ntest('answer', () => {});\n");
  const previewResult = invoke(dir, ['generate', '--plan', '--format', 'json']);
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout);
  const architecture = preview.docs.find(item => item.path === 'handbook/system.md');
  const valid = architecture.sections.filter(section => section.source === 'code')
    .map(section => `<!-- docguard:section id=${section.id} source=code -->\nstale\n<!-- /docguard:section -->`)
    .join('\n');
  safeWrite(join(dir, 'handbook/system.md'), `# Human\n${valid}\n`);
  safeWrite(join(dir, 'handbook/testing.md'), '<!-- docguard:section id=test-inventory source=code -->\nstale\n');
  const before = snapshot(dir);
  const result = invoke(dir, ['generate', '--plan', '--write']);
  assert.equal(result.status, 1);
  assert.match(result.stderr + result.stdout, /malformed|no write was applied/);
  assert.deepEqual(snapshot(dir), before);
});

test('full generation honors all mapped role paths in files and AGENTS.md', t => {
  const dir = temp(t);
  const roles = {
    architecture: 'handbook/architecture.md', apiReference: 'handbook/api.md',
    dataModel: 'handbook/data.md', security: 'handbook/security.md',
    testSpec: 'handbook/testing.md', environment: 'handbook/environment.md',
  };
  safeWrite(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'mapped-generate', diskCache: false, docs: { roles } }));
  safeWrite(join(dir, 'package.json'), JSON.stringify({ name: 'mapped-generate', type: 'module' }));
  safeWrite(join(dir, 'src/index.js'), "app.get('/health', handler);\n");
  const result = invoke(dir, ['generate']);
  assert.equal(result.status, 0, result.stderr);
  for (const path of Object.values(roles)) assert.equal(existsSync(join(dir, path)), true, path);
  assert.equal(existsSync(join(dir, 'docs-canonical')), false);
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  for (const path of Object.values(roles)) assert.match(agents, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(agents, /docs-canonical\/(?:ARCHITECTURE|API-REFERENCE|DATA-MODEL|SECURITY|TEST-SPEC|ENVIRONMENT)\.md/);
});

test('full generation preflights shared mapped targets before creating anything', t => {
  const dir = temp(t);
  safeWrite(join(dir, '.docguard.json'), JSON.stringify({
    projectName: 'mapped-atomic', diskCache: false,
    docs: { roles: {
      architecture: 'handbook/architecture.md',
      dataModel: 'handbook/shared.md', testSpec: 'handbook/shared.md',
    } },
  }));
  safeWrite(join(dir, 'package.json'), JSON.stringify({ name: 'mapped-atomic', type: 'module' }));
  const result = invoke(dir, ['generate']);
  assert.equal(result.status, 1);
  assert.match(result.stderr + result.stdout, /multiple roles/);
  assert.equal(existsSync(join(dir, 'handbook')), false);
  assert.equal(existsSync(join(dir, 'docs-canonical')), false);
  for (const path of ['AGENTS.md', 'CHANGELOG.md', 'DRIFT-LOG.md']) {
    assert.equal(existsSync(join(dir, path)), false, path);
  }
});

/** @req docguard.language-repository-coverage#FR-011 */
test('force cannot turn uncertain API absence into a documentation deletion', t => {
  const { dir, raw } = mappedFixture(t);
  const path = join(dir, 'reference/http.md');
  safeWrite(path, 'Human introduction\n#### GET /api/removed\n');
  const before = snapshot(dir);
  const result = applyApiSurfaceWrites(dir, raw, { force: true });
  assert.equal(result.applied, false);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(snapshot(dir), before);
});

test('mapped sync with no owned generated sections is a read-only no-op', t => {
  const { dir } = mappedFixture(t);
  const before = snapshot(dir);
  const result = invoke(dir, ['sync', '--write']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(dir), before);
});

test('keeps ordinary mapped diagnose JSON read-only', t => {
  const { dir } = mappedFixture(t);
  const before = snapshot(dir);
  const result = invoke(dir, ['diagnose', '--format', 'json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.issueCount > 0);
  assert.ok(payload.checkCoverage);
  assert.deepEqual(snapshot(dir), before);
});

for (const path of ['.LOCAL/notes.md', 'docs/.LoCaL/notes.md', '.GIT/notes.md', 'docs/.GiT/notes.md', 'docs\\.LOCAL\\notes.md']) {
  test('rejects private directory aliases regardless of case: ' + path, t => {
    const dir = temp(t);
    const config = { docs: { roles: { architecture: path } } };
    assert.throws(() => applyDocRoles(dir, config), /within the project/);
    assert.throws(() => listCanonicalDocs(dir, { config }), /within the project/);
    safeWrite(join(dir, '.docguard.json'), JSON.stringify(config));
    const before = snapshot(dir);
    const result = invoke(dir, ['guard', '--format', 'json']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /within the project/);
    assert.deepEqual(snapshot(dir), before);
    assert.doesNotThrow(() => applyDocRoles(dir, { docs: { roles: { architecture: 'docs/local-notes.md' } } }));
  });
}

for (const [role, validate, content] of [
  ['apiReference', computeApiSurfaceDrift, '#### GET /api/synthetic\n'],
  ['environment', validateEnvironment, '## Setup Steps\nStart the service.\n## Environment Variables\nNone.\n'],
  ['testSpec', validateTestSpec, '## Test Categories\nUnit tests.\n## Coverage Rules\nExercise valid and invalid inputs.\n'],
]) {
  for (const kind of ['file', 'directory']) {
    test('rejects direct ' + role + ' reads through a ' + kind + ' symlink', t => {
      const dir = temp(t);
      const external = temp(t);
      safeWrite(join(external, 'synthetic.md'), content);
      safeWrite(join(dir, 'reference/plain.md'), content);
      const plain = { docs: { roles: { [role]: 'reference/plain.md' } } };
      assert.doesNotThrow(() => validate(dir, plain), 'regular mapped documents remain readable');
      const mapped = kind === 'file' ? 'linked.md' : 'linked/synthetic.md';
      symlinkSync(kind === 'file' ? join(external, 'synthetic.md') : external, join(dir, kind === 'file' ? 'linked.md' : 'linked'));
      const config = { docs: { roles: { [role]: mapped } } };
      const before = snapshot(dir);
      const externalBefore = snapshot(external);
      assert.throws(() => validate(dir, config), /symlink/);
      if (role === 'apiReference') assert.throws(() => validateApiSurface(dir, config), /symlink/);
      assert.deepEqual(snapshot(dir), before);
      assert.deepEqual(snapshot(external), externalBefore);
    });
  }
}

test('preserves supported-or-unsupported versus disabled coverage in diagnose JSON', t => {
  const dir = temp(t);
  safeWrite(join(dir, 'src/main.py'), 'import os\n');
  for (const enabled of [true, false]) {
    safeWrite(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'coverage-fixture', projectType: 'cli', diskCache: false,
      validators: enabledOnly(enabled ? 'architecture' : null), requiredFiles: { canonical: [], agentFile: [] } }));
    const before = snapshot(dir);
    const guardResult = invoke(dir, ['guard', '--format', 'json']);
    const diagnoseResult = invoke(dir, ['diagnose', '--format', 'json']);
    assert.equal(guardResult.status, 0, guardResult.stderr);
    assert.equal(diagnoseResult.status, 0, diagnoseResult.stderr);
    const guard = JSON.parse(guardResult.stdout);
    const diagnose = JSON.parse(diagnoseResult.stdout);
    assert.equal(diagnose.status, 'PASS');
    assert.equal(diagnose.issueCount, 0);
    assert.deepEqual(diagnose.checkCoverage, guard.checkCoverage);
    const architecture = diagnose.checkCoverage.limitations.find(v => v.key === 'architecture');
    if (!enabled) assert.equal(architecture.status, 'disabled');
    else if (pyAstAvailable()) assert.equal(architecture, undefined);
    else assert.equal(architecture.status, 'unsupported');
    assert.deepEqual(snapshot(dir), before);
  }
});
