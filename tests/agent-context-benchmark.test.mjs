/**
 * @req docguard.task-specific-agent-context#FR-011
 * @req docguard.task-specific-agent-context#FR-012
 * @req docguard.task-specific-agent-context#FR-013
 * @req docguard.task-specific-agent-context#FR-014
 * @req docguard.task-specific-agent-context#FR-015
 * @req docguard.task-specific-agent-context#SC-003
 * @req docguard.task-specific-agent-context#SC-004
 * @req docguard.task-specific-agent-context#SC-005
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregateTrials,
  buildTrialPrompt,
  decidePromotion,
  digestTree,
  loadManifest,
  orderedTrials,
  verifyFixtures,
} from '../benchmarks/agent-context/run.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BENCHMARK = join(ROOT, 'benchmarks/agent-context');

function allPaths(root, prefix = '') {
  const result = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    result.push(path);
    if (entry.isDirectory()) result.push(...allPaths(root, path));
  }
  return result;
}

function observation(condition, overrides = {}) {
  return {
    condition,
    success: true,
    requirementViolations: 0,
    unnecessaryEdits: 0,
    steps: 10,
    latencyMs: 1000,
    usage: { uncachedInputTokens: 1000 },
    ...overrides,
  };
}

test('freezes a deterministic 27-trial matrix and immutable promotion thresholds', () => {
  const manifest = loadManifest();
  const first = orderedTrials(manifest).map(trial => trial.id);
  const second = orderedTrials(manifest).map(trial => trial.id);
  assert.equal(first.length, 27);
  assert.equal(new Set(first).size, 27);
  assert.deepEqual(first, second);
  assert.equal(manifest.protocol.repetitions, 3);
  assert.equal(manifest.promotion.nonInferiorityFailures, 1);
  assert.equal(manifest.promotion.minimumMedianReductionPercent, 15);
});

test('proves visible controls pass, hidden defects fail, and references satisfy both', () => {
  const results = verifyFixtures();
  assert.deepEqual(results.map(result => [result.id, result.initial.passed, result.initial.failures.length]), [
    ['status-alias', 5, 2],
    ['python-config', 5, 3],
    ['option-migration', 5, 2],
  ]);
  assert.ok(results.every(result => /^sha256:[a-f0-9]{64}$/.test(result.fixtureDigest)));
});

test('keeps hidden evaluators and reviewed references outside agent-visible fixtures', () => {
  const manifest = loadManifest();
  for (const task of manifest.tasks) {
    const fixture = join(BENCHMARK, task.fixture);
    const paths = allPaths(fixture);
    assert.ok(paths.every(path => !path.includes('hidden') && !path.includes('reference')));
    assert.ok(!readFileSync(join(BENCHMARK, task.hiddenEvaluator), 'utf8').includes(digestTree(fixture)));
  }
});

test('builds repeatable condition prompts without leaking evaluator paths or retired prose', () => {
  const manifest = loadManifest();
  for (const task of manifest.tasks) {
    const fixture = join(BENCHMARK, task.fixture);
    for (const condition of manifest.conditions) {
      const first = buildTrialPrompt(task, condition, fixture);
      const second = buildTrialPrompt(task, condition, fixture);
      assert.equal(first, second);
      assert.ok(!first.includes('/hidden/'));
      assert.ok(!first.includes('Retired timeout removal plan'));
      if (condition === 'targeted-packet') {
        assert.match(first, /"status": "targeted"/);
        assert.match(first, /"factualAccuracy": null/);
      }
    }
  }
});

test('promotion gate requires non-inferiority, safety, and measured benefit', () => {
  const manifest = loadManifest();
  const safeGain = manifest.conditions.flatMap(condition => Array.from({ length: 9 }, (_, index) => observation(condition, {
    success: condition === 'context-pack' && index === 8 ? false : true,
    steps: condition === 'targeted-packet' ? 8 : 10,
  })));
  const promotedAggregate = aggregateTrials(manifest, safeGain);
  assert.equal(decidePromotion(manifest, promotedAggregate).status, 'promote');

  const unsafe = safeGain.map((trial, index) => index === 18 ? { ...trial, requirementViolations: 1 } : trial);
  assert.equal(decidePromotion(manifest, aggregateTrials(manifest, unsafe)).status, 'reject');

  const noBenefit = manifest.conditions.flatMap(condition => Array.from({ length: 9 }, () => observation(condition)));
  assert.equal(decidePromotion(manifest, aggregateTrials(manifest, noBenefit)).status, 'reject');
});

test('ships strict schemas for packets, frozen inputs, and recorded outputs', () => {
  for (const file of ['docguard-task-context.schema.json', 'docguard-agent-context-benchmark.schema.json', 'docguard-agent-context-result.schema.json']) {
    const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
  }
});
