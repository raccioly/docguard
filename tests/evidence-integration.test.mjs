import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { coverSemanticClaims, evaluateEvidence } from '../cli/evidence/evaluate.mjs';
import { EVIDENCE_SCHEMA_URL } from '../cli/evidence/manifest.mjs';
import { contentHash } from '../cli/scanners/semantic-claims.mjs';
import { validateEvidence } from '../cli/validators/evidence.mjs';
import { extractSemanticClaims } from '../cli/scanners/semantic-claims.mjs';
import { runGuardInternal } from '../cli/commands/guard.mjs';
import { toSarif } from '../cli/writers/sarif.mjs';
import { toJUnit } from '../cli/writers/junit.mjs';

/**
 * @req docguard.evidence-scoped-verification#FR-002
 * @req docguard.evidence-scoped-verification#FR-005
 * @req docguard.evidence-scoped-verification#FR-006
 * @req docguard.evidence-scoped-verification#FR-007
 * @req docguard.evidence-scoped-verification#FR-008
 * @req docguard.evidence-scoped-verification#FR-009
 * @req docguard.evidence-scoped-verification#FR-010
 * @req docguard.evidence-scoped-verification#FR-011
 * @req docguard.evidence-scoped-verification#FR-012
 * @req docguard.evidence-scoped-verification#SC-001
 * @req docguard.evidence-scoped-verification#SC-002
 * @req docguard.evidence-scoped-verification#SC-003
 * @req docguard.evidence-scoped-verification#SC-004
 */

function write(dir, path, content) {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function read(dir, path) {
  return readFileSync(join(dir, path), 'utf8');
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-evidence-integration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  write(dir, 'docs-canonical/FACTS.md', [
    '# Facts', '', '## Policy', 'Retention is 30 days.', 'Roles are admin, editor, viewer.', '',
    '## Surface', 'There are 2 handlers.', '',
    '## API compatibility', 'No OpenAPI breaking changes were detected.', '',
    '## Protobuf compatibility', 'No Protobuf breaking changes were detected.', '',
    '```', 'Retention is 999 days.', '```', '',
  ].join('\n'));
  write(dir, 'config/policy.json', JSON.stringify({ retentionDays: 30, roles: ['admin', 'editor', 'viewer'] }));
  write(dir, 'src/handlers/a.js', 'export default 1;');
  write(dir, 'src/handlers/b.js', 'export default 2;');
  write(dir, 'api/base.yaml', 'openapi: 3.0.0\n');
  write(dir, 'api/current.yaml', 'openapi: 3.0.0\n');
  write(dir, 'proto/current.proto', 'syntax = "proto3";\n');
  write(dir, 'reports/oasdiff.json', '[]\n');
  write(dir, 'reports/buf.jsonl', '');
  const input = path => ({ path, sha256: contentHash(read(dir, path)) });
  const declarations = [
    {
      id: 'policy.retention', applicability: { mode: 'always' },
      target: { document: 'docs-canonical/FACTS.md', heading: 'Policy', statement: 'Retention is {{value}} days.' },
      source: { adapter: 'json-pointer', path: 'config/policy.json', pointer: '/retentionDays' },
      predicate: { kind: 'equals', valueType: 'number' },
    },
    {
      id: 'policy.roles', applicability: { mode: 'always' },
      target: { document: 'docs-canonical/FACTS.md', heading: 'Policy', statement: 'Roles are {{value}}.' },
      source: { adapter: 'json-pointer', path: 'config/policy.json', pointer: '/roles' },
      predicate: { kind: 'set-equals', itemType: 'string', separator: ',' },
    },
    {
      id: 'surface.handlers', applicability: { mode: 'always' },
      target: { document: 'docs-canonical/FACTS.md', heading: 'Surface', statement: 'There are {{value}} handlers.' },
      source: { adapter: 'collection-count', glob: 'src/handlers/*.js', allowEmpty: false },
      predicate: { kind: 'count-equals' },
    },
    {
      id: 'api.compatibility', applicability: { mode: 'always' },
      target: { document: 'docs-canonical/FACTS.md', heading: 'API compatibility', statement: 'No OpenAPI breaking changes were detected.' },
      source: { adapter: 'oasdiff', adapterVersion: 1, path: 'reports/oasdiff.json', producerVersion: '1.22.0', command: 'breaking', inputs: [input('api/base.yaml'), input('api/current.yaml')] },
      predicate: { kind: 'no-findings' },
    },
    {
      id: 'proto.compatibility', applicability: { mode: 'always' },
      target: { document: 'docs-canonical/FACTS.md', heading: 'Protobuf compatibility', statement: 'No Protobuf breaking changes were detected.' },
      source: { adapter: 'buf', adapterVersion: 1, path: 'reports/buf.jsonl', producerVersion: '1.57.0', command: 'breaking', inputs: [input('proto/current.proto')] },
      predicate: { kind: 'no-findings' },
    },
  ];
  write(dir, '.docguard-evidence.json', `${JSON.stringify({ $schema: EVIDENCE_SCHEMA_URL, schemaVersion: 1, declarations }, null, 2)}\n`);
  return dir;
}

describe('evidence-scoped verification', () => {
  it('verifies scalar, set, collection, oasdiff, and Buf evidence within exact scope', t => {
    const dir = fixture(t);
    const result = evaluateEvidence(dir, { ignore: [] });
    assert.equal(result.status, 'verified-within-scope');
    assert.equal(result.summary['verified-within-scope'], 5);
    assert.ok(result.results.every(item => item.scopeLimitation.includes('declared Markdown statement')));
    assert.equal(validateEvidence(dir, {}).passed, 5);
  });

  it('exposes evidence through verify, guard, SARIF/JUnit, and exact semantic coverage', t => {
    const dir = fixture(t);
    write(dir, '.docguard.json', JSON.stringify({ projectName: 'evidence-fixture', profile: 'starter', requiredFiles: { canonical: [] }, validators: { evidence: true } }));
    const cli = spawnSync(process.execPath, ['cli/docguard.mjs', 'verify', '--evidence', '--format', 'json', '--dir', dir], {
      cwd: resolveRepo(), encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(cli.status, 0, cli.stderr);
    const output = JSON.parse(cli.stdout);
    assert.equal(output.summary['verified-within-scope'], 5);

    const guard = runGuardInternal(dir, { projectName: 'evidence-fixture', profile: 'starter', requiredFiles: { canonical: [] }, validators: onlyEvidence() });
    assert.equal(guard.evidence.summary['verified-within-scope'], 5);
    assert.match(JSON.stringify(toSarif(guard, { projectDir: dir })), /DocGuard/);
    assert.match(toJUnit(guard), /testsuite/);

    const claims = extractSemanticClaims(dir, {});
    const coverage = coverSemanticClaims(claims, output);
    assert.equal(coverage.verifiedWithinScope, 2);
    assert.ok(coverage.remaining.length < coverage.total);
  });

  it('distinguishes contradiction, stale input, malformed report, and unsupported shape', t => {
    const dir = fixture(t);
    write(dir, 'config/policy.json', JSON.stringify({ retentionDays: 31, roles: ['admin', 'editor', 'viewer'] }));
    let result = evaluateEvidence(dir, {});
    assert.equal(result.results.find(item => item.declarationId === 'policy.retention').state, 'contradicted');

    write(dir, 'api/current.yaml', 'openapi: 3.1.0\n');
    result = evaluateEvidence(dir, {});
    assert.equal(result.results.find(item => item.declarationId === 'api.compatibility').state, 'stale');

    write(dir, 'proto/current.proto', 'syntax = "proto2";\n');
    const manifest = JSON.parse(read(dir, '.docguard-evidence.json'));
    manifest.declarations.find(item => item.id === 'proto.compatibility').source.inputs[0].sha256 = contentHash(read(dir, 'proto/current.proto'));
    write(dir, '.docguard-evidence.json', `${JSON.stringify(manifest, null, 2)}\n`);
    write(dir, 'reports/buf.jsonl', '{bad json\n');
    result = evaluateEvidence(dir, {});
    assert.equal(result.results.find(item => item.declarationId === 'proto.compatibility').state, 'inconclusive');

    write(dir, 'reports/buf.jsonl', '{"unexpected":true}\n');
    result = evaluateEvidence(dir, {});
    assert.equal(result.results.find(item => item.declarationId === 'proto.compatibility').state, 'unsupported');
    const guard = validateEvidence(dir, {});
    assert.ok(guard.findings.some(item => item.code === 'EVD002'));
    assert.ok(guard.findings.some(item => item.code === 'EVD003'));
    assert.ok(guard.findings.some(item => item.code === 'EVD005'));
  });

  it('keeps identities stable across line movement and changes them with covered evidence', t => {
    const dir = fixture(t);
    const first = evaluateEvidence(dir, {}).results.find(item => item.declarationId === 'policy.retention');
    const doc = read(dir, 'docs-canonical/FACTS.md');
    write(dir, 'docs-canonical/FACTS.md', doc.replace('## Policy\n', '## Policy\nUnrelated context.\n'));
    const moved = evaluateEvidence(dir, {}).results.find(item => item.declarationId === 'policy.retention');
    assert.equal(moved.claimId, first.claimId);
    assert.equal(moved.evidenceId, first.evidenceId);
    write(dir, 'config/policy.json', JSON.stringify({ retentionDays: 31, roles: ['admin', 'editor', 'viewer'] }));
    const changed = evaluateEvidence(dir, {}).results.find(item => item.declarationId === 'policy.retention');
    assert.notEqual(changed.claimId, first.claimId);
    assert.notEqual(changed.evidenceId, first.evidenceId);
  });

  it('fails closed on duplicate statements and invalid manifests', t => {
    const dir = fixture(t);
    write(dir, 'docs-canonical/FACTS.md', read(dir, 'docs-canonical/FACTS.md').replace('Retention is 30 days.', 'Retention is 30 days. Retention is 30 days.'));
    let result = evaluateEvidence(dir, {});
    assert.equal(result.results.find(item => item.declarationId === 'policy.retention').reasonCode, 'statement-ambiguous');
    const manifest = JSON.parse(read(dir, '.docguard-evidence.json'));
    manifest.declarations.push(structuredClone(manifest.declarations[0]));
    write(dir, '.docguard-evidence.json', `${JSON.stringify(manifest, null, 2)}\n`);
    result = evaluateEvidence(dir, {});
    assert.equal(result.status, 'invalid');
    assert.ok(validateEvidence(dir, {}).findings.every(item => item.code === 'EVD001'));
  });

  it('reports unknown adapter versions and command modes as unsupported evidence', t => {
    const dir = fixture(t);
    const manifest = JSON.parse(read(dir, '.docguard-evidence.json'));
    const source = manifest.declarations.find(item => item.id === 'api.compatibility').source;
    source.adapterVersion = 2;
    source.command = 'diff';
    write(dir, '.docguard-evidence.json', `${JSON.stringify(manifest, null, 2)}\n`);
    const result = evaluateEvidence(dir, {});
    assert.equal(result.status, 'attention-required');
    assert.equal(result.results.find(item => item.declarationId === 'api.compatibility').state, 'unsupported');
  });
});

function resolveRepo() {
  return new URL('..', import.meta.url).pathname.replace(/\/$/, '');
}

function onlyEvidence() {
  return Object.fromEntries([
    'structure', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security', 'architecture',
    'freshness', 'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage', 'docQuality',
    'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'specRegistry', 'crossReference',
    'generatedStaleness', 'surfaceSync', 'diffSuspicion', 'referenceExistence', 'apiDocSmells',
    'canonicalSync', 'metricsConsistency',
  ].map(key => [key, false]).concat([['evidence', true]]));
}
