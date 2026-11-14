import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { spawnSync } from 'node:child_process';
import { writeSubsetManifest } from './helpers/benchmark-subset.mjs';

/**
 * @req docguard.precision-evidence-loop#FR-009
 * @req docguard.precision-evidence-loop#FR-018
 * @req docguard.precision-evidence-loop#SC-005
 * @req docguard.precision-evidence-loop#SC-007
 */

import {
  BASELINE_MEASURES, BASELINE_SCHEMA_URL, benchmarkCaveat, benchmarkProvenance,
  buildBaselineEnvelope, loadBaseline, parseBaseline,
} from '../benchmarks/lib/baseline.mjs';
import { calculateMetrics } from '../benchmarks/lib/metrics.mjs';

const BASELINE_PATH = resolve('benchmarks/baseline.json');
const SCHEMA_PATH = resolve('schemas/docguard-benchmark-baseline.schema.json');
const RUN = resolve('benchmarks/run.mjs');
const committed = () => JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const schema = () => JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

describe('reviewed baseline envelope', () => {
  it('is quotable: it says what its ratios measure and carries the derived caveat', () => {
    const baseline = loadBaseline(BASELINE_PATH);
    assert.equal(baseline.$schema, BASELINE_SCHEMA_URL);
    assert.equal(baseline.schemaVersion, 2);
    assert.equal(baseline.review.status, 'reviewed');
    assert.equal(baseline.review.measures, 'benchmark-precision');
    assert.equal(baseline.review.caveat, benchmarkCaveat(baseline.core.cases));
    assert.match(baseline.review.caveat, /not the probability that a finding in your repository is real/);
    assert.match(baseline.review.caveat, /19 defect and 19 clean-control cases/);
  });

  it('keeps its published metrics recomputable from its retained cases', () => {
    const baseline = committed();
    assert.deepEqual(baseline.core.metrics, calculateMetrics(baseline.core.cases));
    assert.equal(baseline.core.metrics.aggregate.precision, 1);
    assert.deepEqual(baseline.core.metrics.aggregate.confidence95.precision, { lower: 0.83887, upper: 1 });
  });

  it('rejects a hand-edited ratio, a stale caveat, a missing measure, and the pre-provenance envelope', () => {
    const tampered = committed();
    tampered.core.metrics.aggregate.precision = 0.999;
    assert.throws(() => parseBaseline(tampered), /cannot be edited by hand/);

    const stale = committed();
    stale.review.caveat = 'Precision 100%.';
    assert.throws(() => parseBaseline(stale), /caveat does not match/);

    const unmeasured = committed();
    unmeasured.review.measures = 'calibration';
    assert.throws(() => parseBaseline(unmeasured), /not a calibrated probability/);

    const legacy = committed();
    delete legacy.$schema;
    legacy.schemaVersion = 1;
    delete legacy.review.measures;
    delete legacy.review.caveat;
    assert.throws(() => parseBaseline(legacy), /schemaVersion 1 predates the provenance contract/);
  });

  it('rejects unknown fields, unsorted cases, and a reviewed status without reviewer provenance', () => {
    const extra = committed();
    extra.review.confidence = 0.95;
    assert.throws(() => parseBaseline(extra), /unknown field\(s\): confidence/);

    const unsorted = committed();
    unsorted.core.cases.reverse();
    assert.throws(() => parseBaseline(unsorted), /sorted by ID/);

    const anonymous = committed();
    delete anonymous.review.reviewer;
    assert.throws(() => parseBaseline(anonymous), /review\.reviewer/);

    const candidateWithDate = committed();
    candidateWithDate.review.status = 'candidate';
    assert.throws(() => parseBaseline(candidateWithDate), /belong to a reviewed baseline/);
  });

  it('derives the caveat from case counts so it cannot drift from the numbers it qualifies', () => {
    const cases = committed().core.cases.filter(item => item.split === 'development');
    assert.match(benchmarkCaveat(cases), /^Benchmark precision on a deliberately balanced corpus of 11 defect and 11 clean-control cases across 11 repository groups and 11 causal families\./);
    assert.ok(benchmarkCaveat(cases).length <= 512);
    assert.deepEqual(benchmarkProvenance({ cases }), { measures: BASELINE_MEASURES, caveat: benchmarkCaveat(cases) });
  });

  it('builds a candidate envelope that round-trips through the loader without supplying the caveat', () => {
    const { core, observations } = committed();
    const envelope = buildBaselineEnvelope({ core, observations, review: { caveat: 'ignored', measures: 'ignored' } });
    assert.equal(envelope.review.status, 'candidate');
    assert.equal(envelope.review.reviewedAt, undefined);
    assert.equal(envelope.review.measures, BASELINE_MEASURES);
    assert.equal(envelope.review.caveat, benchmarkCaveat(core.cases));
    assert.deepEqual(parseBaseline(JSON.parse(JSON.stringify(envelope))), envelope);
  });
});

describe('baseline schema', () => {
  it('is a strict draft 2020-12 contract aligned with the loader', () => {
    const contract = schema();
    assert.equal(contract.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(contract.$id, BASELINE_SCHEMA_URL);
    assert.equal(contract.additionalProperties, false);
    assert.equal(contract.properties.schemaVersion.const, 2);
    assert.equal(contract.$defs.review.properties.measures.const, BASELINE_MEASURES);
    assert.deepEqual(contract.$defs.review.required, ['status', 'methodology', 'limitations', 'measures', 'caveat']);
    assert.deepEqual(contract.$defs.review.properties.status.enum, ['candidate', 'reviewed']);
    assert.equal(contract.$defs.review.properties.caveat.maxLength, 512);
    assert.deepEqual(contract.$defs.core.required, ['schemaVersion', 'manifestDigest', 'tool', 'cases', 'metrics']);
  });

  it('names every metric the calculator emits, so a new ratio cannot ship unlabelled', () => {
    const emitted = Object.keys(calculateMetrics(committed().core.cases).aggregate).sort();
    assert.deepEqual(schema().$defs.metricGroup.required.slice().sort(), emitted);
    assert.deepEqual(Object.keys(schema().$defs.metricGroup.properties).sort(), emitted);
  });

  it('validates the committed baseline field-for-field against the schema shape', () => {
    const contract = schema();
    const baseline = committed();
    const allowed = (definition) => new Set(Object.keys(definition.properties));
    const assertShape = (value, definition, label) => {
      const unknown = Object.keys(value).filter(key => !allowed(definition).has(key));
      assert.deepEqual(unknown, [], `${label} has fields outside the schema`);
      for (const key of definition.required) assert.ok(key in value, `${label}.${key} is required`);
    };
    assertShape(baseline, contract, 'baseline');
    assertShape(baseline.review, contract.$defs.review, 'review');
    assertShape(baseline.core, contract.$defs.core, 'core');
    assertShape(baseline.core.tool, contract.$defs.tool, 'core.tool');
    assertShape(baseline.core.metrics, contract.$defs.core.properties.metrics, 'core.metrics');
    assertShape(baseline.core.metrics.aggregate, contract.$defs.metricGroup, 'core.metrics.aggregate');
    for (const group of ['byRepository', 'byDetector', 'byParserTier']) {
      for (const [name, metrics] of Object.entries(baseline.core.metrics[group])) assertShape(metrics, contract.$defs.metricGroup, `${group}.${name}`);
    }
    baseline.core.cases.forEach((item, index) => assertShape(item, contract.$defs.case, `core.cases[${index}]`));
    assertShape(baseline.observations, contract.$defs.observations, 'observations');
  });
});

describe('benchmark run provenance', () => {
  it('refuses a legacy baseline before spending a run on it', t => {
    const dir = makeTempDir('docguard-baseline-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const legacy = committed();
    delete legacy.$schema;
    legacy.schemaVersion = 1;
    const path = join(dir, 'legacy.json');
    writeFileSync(path, JSON.stringify(legacy));
    const started = Date.now();
    const result = spawnSync(process.execPath, [RUN, '--baseline', path], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).error, /predates the provenance contract/);
    assert.ok(Date.now() - started < 3000, 'a rejected baseline must fail before the benchmark runs');
  });

  it('carries the caveat on every report and writes a validated candidate envelope', t => {
    const dir = makeTempDir('docguard-baseline-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const target = join(dir, 'candidate.json');
    const written = spawnSync(process.execPath, [RUN, '--split', 'development', '--write-baseline', target], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    assert.equal(written.status, 0, written.stderr);
    const report = JSON.parse(written.stdout);
    assert.deepEqual(report.provenance, benchmarkProvenance(report.core));
    assert.deepEqual(report.selection.split, 'development');
    const candidate = loadBaseline(target);
    assert.equal(candidate.review.status, 'candidate');
    assert.equal(candidate.review.caveat, benchmarkCaveat(report.core.cases));

    // The candidate came from a run of the whole development split, which therefore covers every
    // case the candidate holds. A fresh run over a few of those cases (two defect/control pairs)
    // must compare clean against it; the cases it did not select are reported as out of selection,
    // not as regressions. Re-running the whole split here would only repeat the run above.
    assert.deepEqual(report.selection.caseIds, candidate.core.cases.map(item => item.id));
    const subset = join(dir, 'subset');
    mkdirSync(subset);
    const ids = ['dev-js-security-control', 'dev-js-security-defect', 'dev-go-todo-control', 'dev-go-todo-defect'];
    const manifest = writeSubsetManifest(subset, ids);
    const compared = spawnSync(process.execPath, [RUN, '--manifest', manifest, '--split', 'development', '--baseline', target], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    assert.equal(compared.status, 0, compared.stderr);
    const comparison = JSON.parse(compared.stdout).comparison;
    assert.equal(comparison.core.status, 'PASS');
    assert.deepEqual(comparison.core.regressions, []);
    assert.deepEqual([...comparison.core.outOfSelection].sort(), candidate.core.cases.map(item => item.id).filter(id => !ids.includes(id)));
    assert.equal(comparison.baseline.review.measures, BASELINE_MEASURES);
  });

  it('--acknowledge-file moves a declared fixture correction out of the comparison and errors on an unreadable file', t => {
    const dir = makeTempDir('docguard-baseline-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const baseline = committed();
    const victim = baseline.core.cases.find(item => item.id === 'dev-generated-security-control');
    assert.ok(victim, 'the committed baseline has the case this test rebaselines');
    victim.sourceRevision = 'sha256:an-older-fixture';
    const path = join(dir, 'older.json');
    writeFileSync(path, JSON.stringify(baseline));
    const notes = join(dir, 'notes.md');
    writeFileSync(notes, 'Benchmark-Rebaselined: dev-generated-security-control \u2014 the fixture literal was replaced; no metric moved\n');
    const options = { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 };
    // The rebaselined case is the only case these runs need; they run it from a manifest holding it.
    const subset = join(dir, 'subset');
    mkdirSync(subset);
    const manifest = writeSubsetManifest(subset, ['dev-generated-security-control']);
    const selection = ['--manifest', manifest, '--split', 'development'];
    const plain = spawnSync(process.execPath, [RUN, ...selection, '--baseline', path], options);
    assert.equal(plain.status, 1);
    assert.deepEqual(JSON.parse(plain.stdout).comparison.core.regressions.map(item => item.kind), ['case-evidence-changed']);
    const acknowledged = spawnSync(process.execPath, [RUN, ...selection, '--baseline', path, '--acknowledge-file', notes], options);
    assert.equal(acknowledged.status, 0, acknowledged.stderr);
    const core = JSON.parse(acknowledged.stdout).comparison.core;
    assert.equal(core.status, 'PASS');
    assert.deepEqual(core.rebaselined.map(item => item.id), ['dev-generated-security-control']);
    const missing = spawnSync(process.execPath, [RUN, ...selection, '--baseline', path, '--acknowledge-file', join(dir, 'absent.md')], options);
    assert.equal(missing.status, 1);
    assert.equal(JSON.parse(missing.stderr).status, 'ERROR');
  });
});
