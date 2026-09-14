import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * @req docguard.precision-evidence-loop#FR-002
 * @req docguard.precision-evidence-loop#FR-005
 * @req docguard.precision-evidence-loop#FR-006
 * @req docguard.precision-evidence-loop#FR-017
 * @req docguard.precision-evidence-loop#SC-003
 * @req docguard.precision-evidence-loop#SC-004
 */

import { applyExactMutations, findingIdentity, runBenchmark } from '../benchmarks/lib/runner.mjs';

const manifestPath = resolve('benchmarks/corpus.json');
const benchmarkRoots = () => new Set(readdirSync(tmpdir()).filter(name => name.startsWith('docguard-benchmark-')));

describe('benchmark runner', () => {
  it('detects the defect, keeps its opposite control clean, and classifies unsupported evidence', () => {
    const result = runBenchmark({ manifestPath });
    const byId = new Map(result.core.cases.map(item => [item.id, item]));
    assert.equal(byId.get('dev-js-security-control').status, 'PASS');
    assert.equal(byId.get('dev-js-security-control').actual.length, 0);
    assert.equal(byId.get('dev-js-security-defect').status, 'PASS');
    assert.deepEqual(byId.get('dev-js-security-defect').actual, ['SEC001@src/config.js']);
    assert.equal(byId.get('eval-python-unsupported').status, 'UNSUPPORTED');
    assert.equal(result.observations.retainedRoot, null);
  });

  it('keeps deterministic core output byte-identical while isolating timings', () => {
    const first = runBenchmark({ manifestPath });
    const second = runBenchmark({ manifestPath });
    assert.equal(JSON.stringify(first.core), JSON.stringify(second.core));
    assert.ok(first.observations.cases.every(item => item.coldMs > 0 && item.warmMs > 0));
    assert.equal(Object.hasOwn(first.core, 'environment'), false);
  });

  it('removes its disposable root by default', () => {
    const before = benchmarkRoots();
    runBenchmark({ manifestPath });
    const after = benchmarkRoots();
    assert.deepEqual(after, before);
  });

  it('fails exact mutations without changing the source when preconditions differ', t => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-mutation-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'source.js');
    writeFileSync(path, 'const value = 1;\n');
    assert.throws(() => applyExactMutations(dir, [{
      path: 'source.js', find: 'const value = 2;', replace: 'const value = 3;', expectedOccurrences: 1,
    }]), /precondition failed/);
    assert.equal(readFileSync(path, 'utf8'), 'const value = 1;\n');
    assert.equal(existsSync(join(dir, '.local')), false);
  });

  it('normalizes volatile line coordinates out of finding identity', () => {
    assert.equal(findingIdentity({ code: 'SEC001', location: 'src/config.js:42:3' }), 'SEC001@src/config.js');
    assert.equal(findingIdentity({ code: 'SEC001', location: { file: 'src\\config.js', line: 42 } }), 'SEC001@src/config.js');
  });
});
