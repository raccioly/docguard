#!/usr/bin/env node

/**
 * CI test runtime budget: no top-level test may take longer than a ceiling,
 * measured in reference-runner seconds.
 *
 * Spec: specs/051-release-cut-green FR-007 (docguard.release-cut-green).
 * @implements docguard.release-cut-green#FR-007
 *
 *   node tools/suite-runtime-budget.mjs check --tap <file> [--reference <json>] [--ceiling-ms N] [--summary <file>]
 *   node tools/suite-runtime-budget.mjs reference <tap>... --sources <ids> --out tools/suite-runtime-reference.json \
 *     --runs-out tests/fixtures/suite-runtime-runs.json
 *
 * Refresh the reference only when `check` reports fewer than MIN_COMMON shared
 * tests. Take the TAP of every leg of a few main runs, e.g.
 *   gh run download <run-id> --pattern 'test-tap-node-*'
 * and pass all of them, so the inputs span fast and slow runners.
 *
 * WHY NOT A TOTAL: across 445 CI jobs (2026-10-10 to 10-13) the same code ran
 * 187-370s. That spread is one speed factor per runner: dividing each job by
 * the median ratio of its tests to their reference durations leaves 0.5%
 * variation, so the runner, not the code, is the noise. The total also hides
 * the regression it exists for. Test files run three at a time, so a single
 * test that walks an unintended tree (PR #328: 0.1s became 190s) adds about a
 * third of its time to the wall clock, while the total itself grows with
 * every test added.
 *
 * So each top-level test is divided by this run's speed factor and compared
 * with one ceiling. Adding tests does not move a per-test duration, the speed
 * factor removes the runner, and a runaway test exceeds the ceiling by itself.
 * The reference only has to share enough tests with the run to measure the
 * speed factor; its durations need no refresh as tests are added.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REFERENCE = fileURLToPath(new URL('./suite-runtime-reference.json', import.meta.url));
/** Tests shorter than this carry timer noise, not runner speed. */
export const MIN_REFERENCE_MS = 50;
/** Below this many shared tests the speed factor is not trustworthy. */
export const MIN_COMMON = 100;

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Reads node:test TAP output (Node 18-24). Returns the suite's
 * `# duration_ms` and every top-level test with its own duration_ms.
 */
export function parseTap(text) {
  const tests = [];
  let durationMs = null;
  let pending = null;
  for (const line of text.split(/\r?\n/)) {
    const top = line.match(/^(?:not )?ok \d+ - (.*)$/);
    if (top) {
      pending = top[1].replace(/ # (?:SKIP|TODO)\b.*$/, '').replace(/\\#/g, '#').replace(/\\\\/g, '\\');
      continue;
    }
    const own = line.match(/^ {2}duration_ms: ([\d.]+)/);
    if (own && pending !== null) {
      tests.push({ name: pending, ms: Number(own[1]) });
      pending = null;
      continue;
    }
    const total = line.match(/^# duration_ms ([\d.]+)/);
    if (total) durationMs = Number(total[1]);
  }
  return { durationMs, tests };
}

/** Top-level names repeat across files; the speed factor compares their sums. */
function byName(tests) {
  const sums = new Map();
  for (const { name, ms } of tests) sums.set(name, (sums.get(name) ?? 0) + ms);
  return sums;
}

/** Median ratio of this run's tests to their reference durations. */
export function speedFactor(tests, referenceTests) {
  const ratios = [];
  for (const [name, ms] of byName(tests)) {
    const ref = referenceTests[name];
    if (ref >= MIN_REFERENCE_MS) ratios.push(ms / ref);
  }
  return { factor: median(ratios), common: ratios.length };
}

/**
 * Applies the budget to one parsed run. `errors` is empty when the run passes.
 */
export function evaluate(run, reference, { ceilingMs, minCommon = MIN_COMMON } = {}) {
  const errors = [];
  if (!Number.isFinite(ceilingMs) || ceilingMs <= 0) errors.push('No per-test ceiling was given.');
  if (run.durationMs === null || !Number.isFinite(run.durationMs)) errors.push('Missing TAP suite duration.');
  if (!run.tests.length) errors.push('No top-level test durations in the TAP output.');
  const { factor, common } = speedFactor(run.tests, reference.tests);
  if (common < minCommon) {
    errors.push(`Only ${common} tests are shared with the reference (need ${minCommon}); the runner speed cannot be measured. Refresh tools/suite-runtime-reference.json (see the header of tools/suite-runtime-budget.mjs).`);
  }
  const normalized = Number.isFinite(factor) && factor > 0
    ? run.tests.map(t => ({ ...t, normalizedMs: t.ms / factor })).sort((a, b) => b.normalizedMs - a.normalizedMs)
    : [];
  const measurable = common >= minCommon && Number.isFinite(ceilingMs) && ceilingMs > 0;
  const over = measurable ? normalized.filter(t => t.normalizedMs > ceilingMs) : [];
  for (const t of over) {
    errors.push(`"${t.name}" took ${Math.round(t.ms)}ms on this runner, ${Math.round(t.normalizedMs)}ms at reference speed: over the ${ceilingMs}ms ceiling. Something is scanning far more than it should (see PR #328).`);
  }
  return {
    ok: errors.length === 0,
    errors,
    durationMs: run.durationMs,
    speedFactor: factor,
    common,
    normalizedDurationMs: Number.isFinite(factor) && factor > 0 ? run.durationMs / factor : null,
    slowest: normalized.slice(0, 5),
    over,
  };
}

/**
 * Builds a reference from several TAP outputs, in the units of the median
 * runner among them. Each input is normalized by its own speed factor before
 * the per-test medians are taken, so a test missing from some inputs is not
 * skewed toward the runners it happened to run on.
 */
export function buildReference(runs, { sources = [] } = {}) {
  const sumsList = runs.map(r => byName(r.tests));
  const collect = (scale) => {
    const values = new Map();
    sumsList.forEach((sums, i) => {
      for (const [name, ms] of sums) {
        if (!values.has(name)) values.set(name, []);
        values.get(name).push(ms / scale[i]);
      }
    });
    const tests = {};
    for (const [name, list] of values) {
      // Present in at least 80% of the inputs, so a renamed or flaky entry does not anchor it.
      if (list.length >= runs.length * 0.8) tests[name] = median(list);
    }
    return tests;
  };
  let tests = collect(runs.map(() => 1));
  let factors = runs.map(r => speedFactor(r.tests, tests).factor);
  tests = collect(factors);
  factors = runs.map(r => speedFactor(r.tests, tests).factor);
  // Rescale so the median input runs at factor 1.
  const mid = median(factors);
  const kept = {};
  for (const name of Object.keys(tests).sort()) {
    const ms = tests[name] * mid;
    if (ms >= MIN_REFERENCE_MS) kept[name] = Math.round(ms);
  }
  factors = runs.map(r => speedFactor(r.tests, kept).factor);
  const maxNormalized = runs.map((r, i) => Math.max(...r.tests.map(t => t.ms)) / factors[i]);
  return {
    description: 'Per-test durations (ms) at reference-runner speed for tools/suite-runtime-budget.mjs. Only the speed factor uses them; refresh when fewer than ' + MIN_COMMON + ' tests are shared with a run.',
    inputs: runs.length,
    sources,
    speedFactorRange: [Math.min(...factors), Math.max(...factors)].map(f => Number(f.toFixed(3))),
    maxNormalizedTestMs: Math.round(Math.max(...maxNormalized)),
    tests: kept,
  };
}

/**
 * The fastest and the slowest inputs of a reference, kept so a test can replay
 * the rule on real runs. Tests under 10ms are dropped: they cannot reach the
 * ceiling and do not enter the speed factor.
 */
export function extremeRuns(runs, reference, sources = []) {
  const factors = runs.map(r => speedFactor(r.tests, reference.tests).factor);
  const pick = (i) => ({
    source: sources[i] ?? null,
    speedFactor: Number(factors[i].toFixed(3)),
    durationMs: Math.round(runs[i].durationMs),
    tests: runs[i].tests.filter(t => t.ms >= 10).map(t => [t.name, Math.round(t.ms * 10) / 10]),
  });
  const fastest = factors.indexOf(Math.min(...factors));
  const slowest = factors.indexOf(Math.max(...factors));
  return {
    description: 'The fastest and slowest CI runs behind tools/suite-runtime-reference.json, replayed by tests/release-cut-green.test.mjs (spec 051 FR-007, SC-003).',
    runs: [pick(fastest), pick(slowest)],
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

/** Workflow-command data escaping, as @actions/core does it. */
const escapeData = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

function summaryMarkdown(result, ceilingMs) {
  const s = n => (n / 1000).toFixed(1);
  const rows = result.slowest.map(t => `| ${t.name.replace(/\|/g, '\\|')} | ${s(t.ms)} | ${s(t.normalizedMs)} |`);
  return [
    `### Test runtime budget: ${result.ok ? 'PASS' : 'FAIL'}`,
    '',
    `Suite ${s(result.durationMs ?? 0)}s on this runner; speed factor ${result.speedFactor?.toFixed(3)} over ${result.common} shared tests; ${result.normalizedDurationMs ? s(result.normalizedDurationMs) : '?'}s at reference speed. Ceiling per top-level test: ${s(ceilingMs)}s at reference speed.`,
    '',
    '| Slowest top-level tests | s (runner) | s (reference) |',
    '|---|---:|---:|',
    ...rows,
    '',
  ].join('\n');
}

function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (command === 'check') {
    const ceilingMs = Number(args['ceiling-ms'] ?? process.env.TEST_CEILING_MS);
    const reference = JSON.parse(readFileSync(args.reference ?? DEFAULT_REFERENCE, 'utf8'));
    const result = evaluate(parseTap(readFileSync(args.tap, 'utf8')), reference, { ceilingMs });
    const s = n => `${Math.round(n)}ms`;
    console.log(`Test suite duration: ${s(result.durationMs ?? 0)}; speed factor ${result.speedFactor?.toFixed(3)} over ${result.common} shared tests; ${result.normalizedDurationMs ? s(result.normalizedDurationMs) : '?'} at reference speed`);
    for (const t of result.slowest) console.log(`  ${s(t.normalizedMs).padStart(8)} at reference speed (${s(t.ms)} here)  ${t.name}`);
    console.log(`Per-test ceiling: ${ceilingMs}ms at reference speed`);
    if (args.summary) appendFileSync(args.summary, summaryMarkdown(result, ceilingMs));
    for (const e of result.errors) console.log(`::error::${escapeData(e)}`);
    return result.ok ? 0 : 1;
  }
  if (command === 'reference') {
    if (!args._.length) throw new Error('reference needs at least one TAP file');
    const runs = args._.map(f => parseTap(readFileSync(f, 'utf8')));
    const sources = args.sources ? args.sources.split(',') : args._;
    const reference = buildReference(runs, { sources });
    const text = `${JSON.stringify(reference, null, 2)}\n`;
    if (args.out) writeFileSync(args.out, text);
    else process.stdout.write(text);
    if (args['runs-out']) {
      // One test per line keeps a refresh reviewable as a diff.
      const runsText = JSON.stringify(extremeRuns(runs, reference, sources), null, 2)
        .replace(/\[\n\s+("(?:[^"\\]|\\.)*"),\n\s+([\d.]+)\n\s+\]/g, '[$1, $2]');
      writeFileSync(args['runs-out'], `${runsText}\n`);
    }
    return 0;
  }
  console.error('usage: suite-runtime-budget.mjs check --tap <file> [--reference <json>] [--ceiling-ms N] [--summary <file>]\n       suite-runtime-budget.mjs reference <tap>... [--sources a,b] [--out <json>]');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
