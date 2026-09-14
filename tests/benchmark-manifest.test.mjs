import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * @req docguard.precision-evidence-loop#FR-001
 * @req docguard.precision-evidence-loop#FR-003
 * @req docguard.precision-evidence-loop#FR-004
 * @req docguard.precision-evidence-loop#FR-005
 * @req docguard.precision-evidence-loop#FR-008
 * @req docguard.precision-evidence-loop#SC-004
 */

import { loadBenchmarkManifest, parseBenchmarkManifest, safeRelativePath } from '../benchmarks/lib/manifest.mjs';

const manifestPath = resolve('benchmarks/corpus.json');
const fresh = () => JSON.parse(readFileSync(manifestPath, 'utf8'));

describe('benchmark manifest contract', () => {
  it('accepts the committed corpus and sorts immutable case IDs', () => {
    const manifest = loadBenchmarkManifest(manifestPath);
    assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
  });

  it('rejects unknown fields, duplicate IDs, and cross-split leakage', () => {
    const unknown = fresh();
    unknown.cases[0].surprise = true;
    assert.throws(() => parseBenchmarkManifest(unknown, manifestPath), /unknown field/);

    const duplicate = fresh();
    duplicate.cases[1].id = duplicate.cases[0].id;
    assert.throws(() => parseBenchmarkManifest(duplicate, manifestPath), /Duplicate benchmark case ID/);

    const leakage = fresh();
    const development = leakage.cases.find(item => item.split === 'development');
    const evaluation = leakage.cases.find(item => item.split === 'evaluation');
    const evaluationGroup = evaluation.repositoryGroup;
    for (const item of leakage.cases.filter(candidate => candidate.repositoryGroup === evaluationGroup)) {
      item.repositoryGroup = development.repositoryGroup;
    }
    assert.throws(() => parseBenchmarkManifest(leakage, manifestPath), /split leakage in repositoryGroup/);
  });

  it('rejects missing controls, floating Git revisions, and unsafe paths', () => {
    const missingControl = fresh();
    missingControl.cases[1].oppositeControl = 'missing-control';
    assert.throws(() => parseBenchmarkManifest(missingControl, manifestPath), /oppositeControl/);

    const floating = fresh();
    floating.cases.find(item => item.id === 'eval-python-unsupported').source = { kind: 'git', url: 'https://github.com/example/project.git', revision: 'main', license: 'MIT' };
    assert.throws(() => parseBenchmarkManifest(floating, manifestPath), /full 40- or 64-character/);

    for (const path of ['../secret', '.local/secret', '.git/config', 'dir\\file']) {
      assert.throws(() => safeRelativePath(path), /path/);
    }
  });

  it('requires every measured identity to stay inside the declared code scope', () => {
    const manifest = fresh();
    manifest.cases[1].expected = ['SEC002@src/config.js'];
    assert.throws(() => parseBenchmarkManifest(manifest, manifestPath), /outside scope.codes/);
  });

  it('rejects private Git endpoints and hostile benchmark configuration', () => {
    for (const url of [
      'https://user:secret@example.com/project.git',
      'https://localhost/project.git',
      'https://127.0.0.1/project.git',
      'https://example.com:8443/project.git',
    ]) {
      const manifest = fresh();
      manifest.cases.find(item => item.id === 'eval-python-unsupported').source = { kind: 'git', url, revision: 'a'.repeat(40), license: 'MIT' };
      assert.throws(() => parseBenchmarkManifest(manifest, manifestPath), /credential-free|public HTTPS/);
    }

    for (const config of [
      { sourceRoot: '../private' },
      { sourceRoot: '/etc' },
      JSON.parse('{"__proto__":{"polluted":true}}'),
    ]) {
      const manifest = fresh();
      manifest.cases[0].config = config;
      assert.throws(() => parseBenchmarkManifest(manifest, manifestPath), /escape|unsafe keys/);
    }
  });
});
