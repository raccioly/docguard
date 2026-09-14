import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { loadConfig } from '../cli/config.mjs';
import { applyDocRoles } from '../cli/shared-doc-roles.mjs';
import { listCanonicalDocs } from '../cli/shared-ignore.mjs';
import { applyAllMechanicalFixes, applyApiSurfaceWrites } from '../cli/commands/fix.mjs';
import { runDiagnose } from '../cli/commands/diagnose.mjs';
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
  test('refuses direct mapped writers before any mutation: ' + mode, t => {
    const { dir, raw } = mappedFixture(t);
    const config = mode === 'raw' ? raw : loadConfig(dir);
    const before = snapshot(dir);
    const candidates = validateApiSurface(dir, config).fixes;
    assert.ok(candidates.some(f => f.type === 'remove-endpoint' && f.doc === 'reference/http.md'), 'fixture must exercise a real pending write');
    for (const force of [false, true]) {
      for (const write of [applyAllMechanicalFixes, applyApiSurfaceWrites]) {
        assert.throws(() => write(dir, config, { force }), /read-only planning/);
        assert.deepEqual(snapshot(dir), before);
      }
      assert.throws(() => runDiagnose(dir, config, { auto: true, force }), /read-only planning/);
      assert.deepEqual(snapshot(dir), before);
    }
  });
}

for (const args of [['diagnose', '--auto'], ['diagnose', '--auto', '--force'], ['diagnose', '--auto', '--format', 'json'], ['fix', '--write'], ['sync', '--write'], ['generate', '--plan', '--write']]) {
  test('refuses CLI mapped writes without auxiliary side effects: ' + args.join(' '), t => {
    const { dir } = mappedFixture(t);
    const before = snapshot(dir);
    const result = invoke(dir, args);
    assert.equal(result.status, 1);
    assert.match(result.stderr + result.stdout, /read-only planning/);
    assert.deepEqual(snapshot(dir), before);
  });
}

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
