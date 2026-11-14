import { makeTempDir } from './helpers/temp-dir.mjs';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeSubsetManifest } from './helpers/benchmark-subset.mjs';


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

describe('benchmark runner', () => {
  // One real run of the whole corpus serves every assertion that reads the verdicts of that same
  // run. Running it once per test was most of this suite's cost; a test that needs another run (the
  // determinism check, the retained-root check) runs a few real cases of the same corpus instead.
  // The hook sits inside the suite, so its time counts against the suite's runtime budget.
  let corpusRun;
  before(() => { corpusRun = runBenchmark({ manifestPath }); });

  it('detects the defect, keeps its opposite control clean, and classifies unsupported evidence', () => {
    const result = corpusRun;
    const byId = new Map(result.core.cases.map(item => [item.id, item]));
    assert.equal(byId.get('dev-js-security-control').status, 'PASS');
    assert.equal(byId.get('dev-js-security-control').actual.length, 0);
    assert.equal(byId.get('dev-js-security-defect').status, 'PASS');
    assert.deepEqual(byId.get('dev-js-security-defect').actual, ['SEC001@src/config.js']);
    assert.match(byId.get('dev-js-security-defect').configDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(byId.get('dev-js-security-defect').checkCoverage.status, 'fail');
    assert.ok(byId.get('dev-js-security-defect').checkCoverage.total > 0);
    assert.equal(byId.get('eval-python-unsupported').status, 'UNSUPPORTED');
    assert.equal(result.observations.retainedRoot, null);
  });

  it('keeps deterministic core output byte-identical while isolating timings', t => {
    const first = corpusRun;
    // A second, independent run over a spread of the same cases (both defect/control pairs, plus
    // an unsupported case) must reproduce the full run's per-case core exactly.
    const directory = makeTempDir('docguard-benchmark-determinism-');
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const ids = ['dev-js-security-control', 'dev-js-security-defect', 'dev-go-todo-control', 'dev-go-todo-defect', 'eval-python-unsupported'];
    const second = runBenchmark({ manifestPath: writeSubsetManifest(directory, ids) });
    assert.deepEqual(second.core.cases.map(item => item.id), [...ids].sort((a, b) => a.localeCompare(b)));
    for (const item of second.core.cases) {
      assert.equal(JSON.stringify(item), JSON.stringify(first.core.cases.find(candidate => candidate.id === item.id)));
    }
    assert.ok(first.observations.cases.every(item => item.coldMs > 0 && item.warmMs > 0));
    assert.equal(Object.hasOwn(first.core, 'environment'), false);
  });

  it('removes its own disposable root even when other benchmarks run concurrently', t => {
    const temporaryParent = makeTempDir('docguard-benchmark-test-');
    t.after(() => rmSync(temporaryParent, { recursive: true, force: true }));
    // Cleanup does not depend on how many cases ran: a defect and its control are enough.
    const subset = join(temporaryParent, 'subset');
    mkdirSync(subset);
    const subsetManifest = writeSubsetManifest(subset, ['dev-js-security-defect', 'dev-js-security-control']);
    const parent = join(temporaryParent, 'runs');
    mkdirSync(parent);
    runBenchmark({ manifestPath: subsetManifest, temporaryParent: parent });
    assert.deepEqual(readdirSync(parent), []);
    assert.throws(
      () => runBenchmark({ manifestPath: subsetManifest, temporaryParent: join(temporaryParent, 'missing') }),
      /existing non-symlink directory/,
    );
  });

  it('fails exact mutations without changing the source when preconditions differ', t => {
    const dir = makeTempDir('docguard-mutation-');
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

  /**
   * docguard.ignore-and-todo-parsing and docguard.todo-quoted-forms changed the
   * TODO detector; its labelled corpus cases must keep their verdicts.
   * @req docguard.ignore-and-todo-parsing#SC-002
   * @req docguard.todo-quoted-forms#SC-004
   */
  describe('TODO detector keeps its benchmark verdicts', () => {
    it('passes both the Go TODO defect and its clean control', () => {
      const result = corpusRun;
      const byId = new Map(result.core.cases.map(item => [item.id, item]));
      assert.equal(byId.get('dev-go-todo-defect').status, 'PASS');
      assert.equal(byId.get('dev-go-todo-control').status, 'PASS');
      assert.equal(byId.get('dev-go-todo-control').actual.length, 0);
    });
  });
});
