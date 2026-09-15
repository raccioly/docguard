// @req docguard.adoption-workflow-integrity#FR-014
// @req docguard.adoption-workflow-integrity#SC-008
// @req docs-canonical/REQUIREMENTS.md#FR-016
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { computeApiSurfaceDrift, validateApiSurface } from '../cli/validators/api-surface.mjs';
import { applyApiSurfaceWrites } from '../cli/commands/fix.mjs';

const defaultDoc = 'docs-canonical/API-REFERENCE.md';
const endpointDoc = paths => '<!-- docguard:generated true -->\n' +
  paths.map(path => '#### GET ' + path).join('\n');
const spec = paths => JSON.stringify({ openapi: '3.0.3', info: { title: 'Synthetic API', version: '1.0.0' },
  paths: Object.fromEntries(paths.map(path => [path, { get: { summary: 'Read resource' } }])) });

describe('API authority precision', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'docguard-authority-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const write = (path, content) => safeWrite(join(dir, path), content);
  function fixture({ routes = true, doc = defaultDoc } = {}) {
    write('openapi.json', spec(['/api/health']));
    write(doc, endpointDoc(['/api/health', '/api/items/{id}', '/api/items/{id}/export']));
    if (routes) {
      write('src/server.ts', "import { itemRoutes as items } from './routes/items'; app.use('/api', auth, items); app.get('/api/health', health);");
      write('src/routes/items.ts', "const router = Router(); router.get('/items/:id', enabled, detail); export const itemRoutes = router;");
    }
  }
  function assertNoDeletion(config = {}) {
    const before = readFileSync(join(dir, defaultDoc), 'utf8');
    for (const force of [false, true]) {
      const result = applyApiSurfaceWrites(dir, config, { force });
      assert.equal(result.applied, false);
      assert.deepEqual(result.removed, []);
      assert.equal(readFileSync(join(dir, defaultDoc), 'utf8'), before);
    }
  }

  it('attributes implemented omissions to the contract and prevents normal and forced deletion', () => {
    fixture();
    write(defaultDoc, endpointDoc(['/api/health', '/api/items/{id}']));
    const drift = computeApiSurfaceDrift(dir, {});
    assert.equal(drift.confidence, 'spec');
    assert.equal(drift.source, 'openapi.json');
    assert.deepEqual(drift.documentedButAbsent, []);
    assert.equal(drift.contractMismatches.length, 1);
    const result = validateApiSurface(dir, {});
    const present = result.findings.find(f => f.code === 'API004' && f.evidence.code.status === 'present');
    assert.ok(present);
    assert.equal(present.evidence.authority.source, 'openapi.json');
    assert.equal(present.evidence.authority.status, 'not-declared');
    assert.equal(present.evidence.authority.confidence, 'high');
    assert.equal(present.suggestion.kind, 'review');
    assert.match(present.suggestion.text, /update OpenAPI/);
    assert.doesNotMatch(present.message, /not found in code/);
    assert.ok(!present.suggestion.command);
    assert.deepEqual(result.fixes, []);
    assertNoDeletion();
  });

  it('never deletes an endpoint from negative route-scan evidence', () => {
    fixture();
    const result = validateApiSurface(dir, {});
    const removed = result.findings.find(f => f.code === 'API004' && f.message.includes('/export'));
    assert.equal(removed.severity, 'error');
    assert.equal(removed.evidence.code.status, 'not-found');
    assert.equal(removed.evidence.code.confidence, 'low');
    assert.match(removed.message, /coverage may be incomplete/);
    assert.equal(removed.suggestion.kind, 'review');
    assert.ok(!removed.suggestion.command);
    assert.deepEqual(result.fixes, []);
    assertNoDeletion();
  });

  it('reports unknown code coverage conservatively for unsupported registrations', () => {
    fixture({ routes: false });
    write('src/server.js', "registerEndpointsFromMetadata(runtimeManifest);");
    const drift = computeApiSurfaceDrift(dir, {});
    assert.ok(drift.contractMismatches.every(e => e.codeEvidence.status === 'unknown'));
    const result = validateApiSurface(dir, {});
    const omissions = result.findings.filter(f => f.code === 'API004');
    assert.equal(omissions.length, 2);
    assert.ok(omissions.every(f => f.message.includes('Code presence is unknown')));
    assert.ok(omissions.every(f => f.suggestion.kind === 'review'));
    assert.deepEqual(result.fixes, []);
    assertNoDeletion();
  });

  it('keeps spec-declared missing routes independently actionable', () => {
    fixture();
    write('openapi.json', spec(['/api/health', '/api/retired']));
    const result = validateApiSurface(dir, {});
    const mismatch = result.findings.find(f => f.code === 'API003');
    assert.ok(mismatch.message.includes('/api/retired'));
    assert.equal(mismatch.location, 'openapi.json');
    assert.equal(mismatch.confidence, 'low');
    assert.ok(result.findings.some(f => f.code === 'API004' && f.evidence.code.status === 'present'));
    assert.ok(result.findings.some(f => f.code === 'API005' && f.message.includes('OpenAPI contract')));
  });

  it('uses the configured API document role for contract omissions', () => {
    const doc = 'reference/HTTP.md';
    fixture({ doc });
    write(doc, endpointDoc(['/api/health', '/api/items/{id}']));
    const config = { docs: { roles: { apiReference: doc } } };
    const drift = computeApiSurfaceDrift(dir, config);
    assert.equal(drift.contractMismatches.length, 1);
    const result = validateApiSurface(dir, config);
    assert.ok(result.findings.filter(f => f.code === 'API004').every(f => f.location === doc));
    assert.deepEqual(result.fixes, []);
  });

  it('keeps overflow contract findings review-only with their authority named', () => {
    fixture({ routes: false });
    write(defaultDoc, endpointDoc(Array.from({ length: 18 }, (_, i) => '/api/resource-' + i)));
    const result = validateApiSurface(dir, {});
    const omissions = result.findings.filter(f => f.code === 'API004');
    assert.equal(omissions.length, 16);
    assert.match(omissions.at(-1).message, /3 more.*OpenAPI contract/);
    assert.ok(omissions.every(f => f.suggestion.kind === 'review' && !f.suggestion.command));
    assertNoDeletion();
  });
});
